# Better Bookmarks 2 — Technical Documentation

Audience: developers maintaining or extending this app, and administrators doing a deep-dive self-host. For a quick-start overview, see [README.md](../README.md).

---

## 1. Overview

Better Bookmarks 2 is a self-hosted bookmark manager built with React 19, TypeScript, and Vite. All user data is AES-256-GCM encrypted in the browser before transmission; the backend stores only ciphertext and never holds an encryption key.

**Frontend:** React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + Radix UI
**Data API:** PostgREST 12.2 fronted by Nginx, backed by PostgreSQL 16 with Row Level Security
**Email service:** Fastify 5 + TypeScript microservice (`services/email`) for verification, password reset, and account-deletion confirmation
**Tests:** Vitest 4 + jsdom + @testing-library/react (frontend); Vitest 3 (email service); pgTAP for the database
**CI:** GitHub Actions — `npm audit --audit-level=moderate` then `npm test` then `npm run build` on every push/PR to `main`

---

## 2. Architecture

### Container topology

```
                   ┌────────────────────────┐
  Browser ──────►  │ frontend (Nginx :80)   │
  (React)          │   • static SPA assets  │
                   │   • rate-limit zones   │
                   │   • security headers   │
                   │   • /api/* proxy split │
                   └─────────┬──────────────┘
                             │
                ┌────────────┴──────────────┐
                ▼                           ▼
       ┌───────────────────┐      ┌──────────────────────┐
       │ postgrest :3000   │      │ email-service :5001  │
       │ schema = api      │      │ Fastify + jose + pg  │
       │ JWT verify (HS256)│      │ JWT verify only      │
       │ pre-request:      │      │ never signs JWTs     │
       │   check_token_ver │      │ DB role: email_svc   │
       └─────────┬─────────┘      └──────────┬───────────┘
                 │                           │
                 ▼                           ▼
            ┌────────────────────────────────────┐
            │  postgres :5432                    │
            │  schemas: auth (private), api      │
            │  roles: anon / app_user / email_svc│
            │  RLS enforced on every api table   │
            └────────────────────────────────────┘
```

All four containers run on the same `betterbookmarks2` Docker network. Only the frontend exposes a port to the host. PostgREST and the email service are reachable only via the Nginx reverse proxy. See [section 14](#14-self-hosting--operations) for the full Compose layout.

### Request flow

| Path prefix              | Routed to                | Notes                                                                                              |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------- |
| `/`                      | static SPA               | `try_files $uri /index.html` — React Router handles the rest                                       |
| `/api/email/*`           | `email-service:5001`     | Eight individually rate-limited locations; everything else under `/api/email/` returns `404`        |
| `/api/rpc/sign_in`       | `postgrest:3000`         | Tight rate limit (5 r/m), separate zone                                                            |
| `/api/rpc/sign_up`       | `postgrest:3000`         | 10 r/m                                                                                             |
| `/api/rpc/change_password` | `postgrest:3000`       | 5 r/m (`auth_mutation` zone)                                                                       |
| `/api/rpc/delete_account` | —                       | Returns `404` — legacy direct-delete path was removed in favour of the email-confirmed flow        |
| `/api/(bookmarks_with_tags\|thumbnail_images)` | `postgrest:3000` | 60 r/m (`api_read` zone) — caps export-loop exfiltration                                          |
| Other `/api/*`           | `postgrest:3000`         | Default proxy block, no rate limit                                                                 |

In dev, `vite dev` proxies `/api/*` directly to `postgrest:3000` and `email-service:5001` (both bound to host ports via `docker-compose.override.yml`). In production, the Nginx config in `docker/frontend/nginx.conf` is the only ingress.

### Routing (frontend)

React Router v7 manages two routes from `src/main.tsx`:

| Path     | Component        | Behaviour                                                                          |
| -------- | ---------------- | ---------------------------------------------------------------------------------- |
| `/`      | `App.tsx`        | Wrapped in `ProtectedRoute`; redirects to `/login` (preserving the hash fragment) when no session |
| `/login` | `AuthPage.tsx`   | Sign in / sign up; reads `#reset-password` to open `ResetPasswordModal` automatically              |

`ProtectedRoute` keys the `App` subtree on `userId` so a re-login as a different user fully unmounts the previous tree (prevents stale `useBookmarks` state and the `IntersectionObserver` reload loop seen when switching accounts).

Hash-fragment entry points handled by `App.tsx`'s `useHashFragmentHandler`:

| Fragment                              | Effect                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `#email-verified?success=true`        | Calls `setEmailVerified(true)` and shows a success toast                              |
| `#email-verified?error=...`           | Shows a verification-failed toast                                                     |
| `#delete-confirmed?token=...`         | Captures the deletion token and auto-opens `DeleteAccountModal` in the confirm step   |
| `#reset-password` (handled in `AuthPage`) | Opens `ResetPasswordModal`                                                        |

Each handler `replaceState`s the URL back to its bare pathname so refreshing does not re-trigger the action.

---

## 3. Security Model

### Key derivation

The encryption key is derived once at sign-in and sign-up using PBKDF2:

| Parameter   | Value                                            |
| ----------- | ------------------------------------------------ |
| Algorithm   | PBKDF2                                           |
| Hash        | SHA-256                                          |
| Iterations  | 600,000                                          |
| Salt        | UTF-8 bytes of `email.toLowerCase()`             |
| Key length  | 256 bits                                         |
| Key usage   | `encrypt`, `decrypt` (AES-GCM)                   |
| Extractable | `false`                                          |

Because the key is non-extractable, the Web Crypto engine will not return the raw key bytes via `exportKey`. An XSS attacker cannot extract the key from memory using standard Web Crypto APIs.

### AES-256-GCM encryption

Each encrypt call generates a fresh 12-byte random IV using `crypto.getRandomValues`. The output is `base64(iv || ciphertext)` for both text (`encrypt` / `decrypt`) and binary (`encryptBinary` / `decryptBinary`) variants. `bytesToBase64` chunks at 8 KB to avoid the call-stack overflow that `String.fromCharCode(...bytes)` triggers on arrays larger than ~100 KB.

### HMAC-SHA256 tag deduplication

When a tag is created, the app computes `HMAC-SHA256(key = userId, data = tagName)` and stores the result as `name_hmac` (base64-encoded). PostgreSQL enforces `UNIQUE (user_id, name_hmac)` on `api.tags`, giving the database a stable, collision-resistant token for deduplication without ever seeing the plaintext name. The HMAC is keyed on `userId` (not the password), so it is unaffected by password / key rotation.

### JWT lifecycle

The JWT returned by `sign_in` or `sign_up` is stored in a module-level variable inside `src/lib/api.ts`. It is:

- Injected into `Authorization: Bearer <token>` on every `apiFetch` and email-service call.
- Cleared (set to `null`) on logout.
- Never written to `localStorage`, `sessionStorage`, cookies, or any persistent storage.

A page reload clears both the JWT and the crypto key, requiring sign-in again. JWTs are HS256, expire in 24 hours, and carry these claims:

| Claim            | Source                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- |
| `sub`            | `auth.users.id` (UUID)                                                              |
| `role`           | `app_user`                                                                          |
| `email`          | normalized email address                                                            |
| `tv`             | `auth.users.token_version` — used for server-side session invalidation (see below)  |
| `email_verified` | `auth.users.email_verified` boolean                                                 |
| `exp`            | issue time + 24 h                                                                   |

### Token-version session invalidation

Every JWT carries a `tv` claim. A PostgREST pre-request hook, `api.check_token_version()` (set via `PGRST_DB_PRE_REQUEST=api.check_token_version`), runs before every authenticated request and rejects the request with `PT401 Session invalidated` whenever the JWT's `tv` differs from `auth.users.token_version`. `token_version` is incremented in two places:

1. `api.change_password` — invalidates every other live tab the user has open.
2. `auth.reset_password_destroy_data` — invalidates all sessions immediately after a password reset.

Tokens issued before the `tv` claim was added are also rejected; this is deliberate to avoid carrying legacy sessions across the upgrade boundary.

### Crypto key lifecycle

The `CryptoKey` object is stored in `AuthContext` state. It is:

- Created at sign-in / sign-up via `deriveKey`.
- Available to all components via `useAuth()`.
- Replaceable in place via `updateKey()` (used after a successful key rotation or recovery).
- Cleared on logout when `AuthContext` resets its state.
- Never serialized or sent over the network.

### Encrypted fields

Always call `encrypt(key, value)` before sending and `decrypt(key, value)` after receiving:

| Table                  | Encrypted columns                                            |
| ---------------------- | ------------------------------------------------------------ |
| `api.bookmarks`        | `title_enc`, `url_enc`, `thumbnail_url_enc`                  |
| `api.tags`             | `name_enc`                                                   |
| `api.thumbnail_images` | `data_enc`, `original_name_enc`                              |

`user_id` must be present in the body of every `POST` to `bookmarks`, `tags`, and `thumbnail_images`. RLS will reject the row otherwise.

### API error sanitization

`apiFetch` (in `src/lib/api.ts`) maps HTTP status codes to client-visible messages from a hardcoded `STATUS_MESSAGES` table. Raw PostgREST messages are relayed only for the three auth RPCs and only on `400` or `409`:

| Path prefix                                          | 400 / 409 body relayed?    |
| ---------------------------------------------------- | -------------------------- |
| `/rpc/sign_in`                                       | yes                        |
| `/rpc/sign_up`                                       | yes                        |
| `/rpc/change_password`                               | yes                        |
| Anything else                                        | no — generic message       |

Every other status code (or non-auth path) gets one of these:

| Status      | Message                                                  |
| ----------- | -------------------------------------------------------- |
| `401`       | Authentication required. Please sign in.                 |
| `403`       | You do not have permission to perform this action.       |
| `404`       | The requested resource was not found.                    |
| `429`       | Too many requests. Please wait a moment and try again.   |
| `500`       | An unexpected server error occurred. Please try again.   |
| `503`       | The service is temporarily unavailable. Please try again.|
| Everything else | `Request failed (NNN)`                               |

Email-service routes use their own opaque errors (`Invalid request`, `Internal error`, `Too many requests`) — none relays underlying SQL or transport detail.

### Defence in depth

- **Row Level Security:** every `api.*` table has policies scoping reads, inserts, updates, and deletes to `user_id = api.current_user_id()` (extracted from the JWT). `api.current_user_id` is `VOLATILE` to defeat plan caching that would otherwise pin one user's UUID into a shared prepared-statement plan.
- **`security_invoker = true`** on `api.bookmarks_with_tags` — without it, the view would run as its (superuser) owner and bypass RLS, leaking every user's rows to every signed-in caller.
- **Email-service role isolation:** the `email_svc` Postgres role has only column-level `SELECT` on `auth.users` (id, email, password, email_verified, email_verified_at, token_version) plus full lifecycle on `auth.email_tokens`, `auth.email_send_log`, and `INSERT` on `auth.security_audit_log`. It has *no* access to the `api` schema. All destructive operations (password reset, account delete) go through `SECURITY DEFINER` functions in the `auth` schema.
- **Password policy:** ≥ 12 characters, must contain upper, lower, and at least one non-letter. Enforced in `api.sign_up`, `api.change_password`, `auth.reset_password_destroy_data`, and mirrored in the React forms (`AuthPage`, `ChangePasswordModal`, `ResetPasswordModal`) plus the `PasswordStrengthHints` live indicator.

---

## 4. Key Rotation & Recovery

Changing or resetting the password requires re-encrypting everything because the AES-GCM key is derived from `(password, email)`. The rotation flow is split into "happy path" (user knows the current password) and "recovery" (a previous rotation was interrupted before commit).

### `key_version` tracking

`docker/db/init/06_key_versioning.sql` adds an `INTEGER NOT NULL DEFAULT 1 key_version` column to `auth.users`, `api.bookmarks`, `api.tags`, and `api.thumbnail_images`. The user-level value is the *committed* version; per-row values track which key encrypted that row.

`api.bookmarks_with_tags` exposes both as `key_version` and `thumbnail_key_version` (the latter from the joined `thumbnail_images` row, nullable when no thumbnail).

`api.rotation_status()` is the SECURITY DEFINER RPC the frontend calls on every login. It returns:

```ts
{ key_version: number; has_stale_records: boolean }
```

`has_stale_records` is true when any of the user's bookmarks, tags, or thumbnails has `key_version <> auth.users.key_version` — i.e. a previous rotation committed the password update but not all data, or the inverse.

### Stamping `key_version` on new records (issue #135)

`key_version` records *which key encrypted this row*, so a row created now must carry the owner's currently **committed** `auth.users.key_version`. That value is per-user and changes over time, so it cannot come from a column default, and it must never come from the client — it is rotation-integrity state, not user data.

`docker/db/init/13_key_version_stamp.sql` installs a `BEFORE INSERT` trigger on `api.bookmarks`, `api.tags` and `api.thumbnail_images` that resolves the value from the caller's verified JWT `sub` and overwrites whatever the request body contained. The trigger function `auth.stamp_key_version()` lives in `auth` rather than `api` because PostgREST exposes every function in its configured schema as an RPC endpoint, and it is `SECURITY DEFINER` with a pinned `search_path` because `app_user` holds no `SELECT` on `auth.users`.

It is scoped to `INSERT` only, deliberately: `reencryptBookmark`, `reencryptTag` and the thumbnail PATCH are how a rotation commits, and each sends `key_version = targetVersion` explicitly. A trigger on `UPDATE` would silently revert exactly that.

Before this file existed, `06_key_versioning.sql`'s constant `DEFAULT 1` applied to every insert. One password change plus one new bookmark was enough to make `rotation_status()` report `has_stale_records` on every subsequent login, pinning the session to `RecoveryModal` with no dismiss path — and completing that recovery incremented `key_version` again, so the next record recreated the trap. The ciphertext was never damaged; only the label was wrong.

**Applying it to an existing deployment.** `/docker-entrypoint-initdb.d/` runs only on an empty volume, so restarting with a newer image does **not** apply this. Run it once against the live container:

```
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -f /docker-entrypoint-initdb.d/13_key_version_stamp.sql
```

Expect a `NOTICE: key_version backfill: N bookmarks, N tags, N thumbnail_images restamped` line followed by `COMMIT`. The file is idempotent (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`, and the backfill matches nothing on a second run). No restart, no forced re-login — tokens issued before the migration keep working, because nothing about the JWT changed. Accounts stuck on "Incomplete Password Change Detected" are clear on their next `rotation_status()` call.

On Git Bash for Windows, prefix the command with `MSYS_NO_PATHCONV=1`, or the container-absolute path is rewritten to a host path and `psql` reports "No such file or directory".

`auth.backfill_key_version()` restamps only rows **behind** their owner's `key_version`. Those can only come from this bug — every completed rotation re-encrypts and restamps all of an account's rows before `change_password` commits — so they are encrypted with the current key and need a label change, never a ciphertext change. Rows **ahead** are the genuine interrupted-rotation signal and are deliberately left alone, so `RecoveryModal` still fires for accounts that really are mid-rotation.

`migration_state.sql` asserts the triggers and the repair function exist, so a volume that never received the migration fails the pgTAP run rather than silently keeping the bug.

### Happy-path change-password (`ChangePasswordModal.tsx`)

The modal uses a two-phase ordering chosen so an interrupted run leaves the DB recoverable on next login:

1. **Verify old password** with a throwaway `signIn` call (failures here happen before any mutation).
2. **Read** `rotation_status()` and compute `targetVersion = keyVersion + 1`.
3. **Derive** the new key client-side.
4. **Fetch** all bookmarks and tags with the *current* key.
5. **Re-encrypt bookmark text fields** (`title`, `url`, `thumbnail_url`): all crypto in parallel, all PATCHes set `key_version = targetVersion`.
6. **Re-encrypt thumbnail binaries — phase 1** (`reencryptThumbnailToBody`): fetch + decrypt + re-encrypt, in memory only.
7. **Re-encrypt thumbnail binaries — phase 2:** PATCH all `thumbnail_images` rows with `{data_enc, original_name_enc, key_version: targetVersion}`. Splitting crypto from DB writes means a network failure between phases leaves a clean "some rows stale, some rows new" state that recovery can finish.
8. **Re-encrypt tags** (`reencryptTag`) — `name_hmac` is unchanged.
9. **Fire-and-forget** `notifyPasswordChanged()`. Sent *before* `change_password` because that RPC bumps `token_version`, which would otherwise 401 the in-memory token before the email request reached the email service.
10. **Call** `api.change_password(old, new)` — atomically updates the password hash, increments `key_version`, and increments `token_version` (killing the live JWT).
11. **Logout** and redirect to `/login`. The user must sign in fresh.

A re-entrancy latch (`isRotatingRef`) prevents concurrent submissions if the form's `isSubmitting` resets mid-flight.

### Recovery mode (`RecoveryModal.tsx`)

`AuthContext.login()` always calls `rotationStatus()` after setting the in-memory session. If `hasStaleRecords` is true, `partialRotation` is set and `App.tsx` renders `RecoveryModal` *instead of* the main UI — the user cannot use the app until rotation finishes.

The modal asks for the old password (verifies via `signIn`) and the intended new password, then:

1. Re-checks `rotation_status()` — if no longer stale, calls `change_password` to commit and exits.
2. Fetches raw rows via `getBookmarkRows()` / `getTagRows()` (no decryption — these never decrypt fields belonging to the new key version, which would fail).
3. Filters to rows where `key_version < targetVersion`, decrypts them with the *old* key, re-encrypts with the new key, and PATCHes them.
4. Repeats the two-phase thumbnail dance for thumbnails where `thumbnail_key_version < targetVersion`.
5. Calls `api.change_password` to commit, calls `updateKey(newKey)` on the context, clears `partialRotation`, and the user re-enters the app.

### Password reset (forgotten password)

`auth.reset_password_destroy_data(p_user_id, p_new_pw)` does **not** rotate keys — it deletes them. See [section 6.3](#63-password-reset).

---

## 5. Data Model

The frontend interacts with the following PostgREST-exposed tables, views, and RPCs in the `api` schema. The `auth` schema (users, email tokens, audit log) is never exposed.

### `api.bookmarks`

| Column              | Type         | Notes                                                  |
| ------------------- | ------------ | ------------------------------------------------------ |
| `id`                | UUID         | Primary key, server-generated                          |
| `user_id`           | UUID         | FK to `auth.users`; RLS filters by this                |
| `title_enc`         | text         | AES-256-GCM, base64(iv \|\| ciphertext)                |
| `url_enc`           | text         | AES-256-GCM, base64(iv \|\| ciphertext)                |
| `thumbnail_url_enc` | text \| null | Encrypted URL, or null when using a file upload        |
| `thumbnail_file_id` | UUID \| null | FK to `thumbnail_images`; `ON DELETE SET NULL`         |
| `key_version`       | integer      | Tracks which key version encrypted this row            |
| `created_at`        | timestamptz  | Server-generated                                       |
| `updated_at`        | timestamptz  | Set by the client on update (passed in PATCH body)     |

### `api.bookmarks_with_tags` (view)

`security_invoker = true`. Extends `api.bookmarks` with:

| Extra column                  | Notes                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `tag_ids`                     | `UUID[]` aggregate from `bookmark_tags` (empty array, not null, when no tags) |
| `thumbnail_original_name_enc` | Joined from `thumbnail_images.original_name_enc`                              |
| `key_version`                 | Bookmark row's key version                                                    |
| `thumbnail_key_version`       | Joined `thumbnail_images.key_version`, nullable                               |

This is the only path used for bookmark listing — the frontend never queries `api.bookmarks` directly for reads.

### `api.tags`

| Column        | Type        | Notes                                                                |
| ------------- | ----------- | -------------------------------------------------------------------- |
| `id`          | UUID        | Primary key                                                          |
| `user_id`     | UUID        | RLS-scoped                                                           |
| `name_enc`    | text        | AES-256-GCM encrypted tag name                                       |
| `name_hmac`   | text        | base64 HMAC-SHA256(userId, plaintext name); `UNIQUE (user_id, name_hmac)` |
| `key_version` | integer     | Tracks which key version encrypted this row                          |
| `created_at`  | timestamptz | Server-generated                                                     |

### `api.bookmark_tags`

Junction table: `(bookmark_id UUID, tag_id UUID)` with composite PK and cascading delete on both FKs.

### `api.thumbnail_images`

| Column              | Type        | Notes                                              |
| ------------------- | ----------- | -------------------------------------------------- |
| `id`                | UUID        | Primary key                                        |
| `user_id`           | UUID        | RLS-scoped                                         |
| `data_enc`          | text        | AES-256-GCM encrypted JPEG bytes, base64           |
| `original_name_enc` | text        | Encrypted original filename                        |
| `key_version`       | integer     | Tracks which key version encrypted this row        |
| `created_at`        | timestamptz | Server-generated                                   |

### Auth schema (private)

These tables are owned by the `auth` schema and never exposed via PostgREST.

| Table                     | Purpose                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `auth.users`              | Email + bcrypt password (cost 13). `email_verified`, `email_verified_at`, `token_version`, `key_version`. |
| `auth.email_tokens`       | One unused token per `(user_id, token_type)`. Stores only SHA-256 hex of the raw token.       |
| `auth.email_send_log`     | Per-user-per-type send log; powers the resend cooldown without depending on IP.               |
| `auth.security_audit_log` | Append-only events (e.g. `account_deleted`).                                                  |

### RPCs exposed via PostgREST

| RPC                                           | Caller   | Description                                                                                 |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `sign_in(email, password)`                    | `anon`   | Returns `{ token, user_id, email_verified }`                                                |
| `sign_up(email, password)`                    | `anon`   | Creates an account; returns `{ token, user_id, email_verified }`                            |
| `change_password(current_password, new_password)` | `app_user` | Bumps `key_version` and `token_version`. Call only after re-encryption is complete. |
| `rotation_status()`                           | `app_user` | Returns `{ key_version, has_stale_records }`                                              |
| `check_token_version()`                       | (pre-request hook) | Internal — invoked by PostgREST on every request                                  |

The legacy `api.delete_account(password)` RPC was dropped in `09_drop_legacy_delete.sql`; deletion now goes through the email-service flow.

### `auth` SECURITY DEFINER helpers

| Function                                           | Caller     | Effect                                                                                                                                       |
| -------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.upsert_email_token(user, hash, type, ttl, ip)` | `email_svc` | Deletes any prior active token for that `(user, type)`, then inserts a new one. `ON CONFLICT DO NOTHING` returns null on the concurrent-insert race.   |
| `auth.redeem_email_token(hash, type)`              | `email_svc` | Atomic `UPDATE ... SET used_at = NOW() ... RETURNING user_id, id`. No TOCTOU window.                                                         |
| `auth.mark_email_verified(user_id)`                | `email_svc` | Sets `email_verified = TRUE`, `email_verified_at = NOW()`.                                                                                   |
| `auth.reset_password_destroy_data(user_id, new_pw)` | `email_svc` | Deletes all bookmark / tag / thumbnail data for the user, hashes the new password (bcrypt cost 13), increments `key_version` and `token_version`, sets `email_verified = TRUE`. |
| `auth.delete_account_with_password(user_id, pw)`   | `email_svc` | Verifies bcrypt match in-place, then `DELETE FROM auth.users` (cascades to all data). Returns `BOOLEAN` so callers can ROLLBACK on wrong password. |
| `auth.cleanup_email_tokens()`                      | `email_svc` | Deletes used / expired tokens and `email_send_log` rows older than 24 h. Email service runs this every 15 min.                               |

---

## 6. Email Service (`services/email/`)

A standalone Fastify 5 microservice. It is the *only* path for email verification, password reset, account-deletion confirmation, and the password-changed notification. It binds to port 5001 inside the Docker network and is reachable only via Nginx.

### Stack and posture

| Concern             | Choice                                                                              |
| ------------------- | ----------------------------------------------------------------------------------- |
| HTTP framework      | Fastify 5 (`trustProxy: true`)                                                      |
| JWT                 | `jose` — verify-only, HS256 algorithm allowlist; the service shares `PGRST_JWT_SECRET` but never signs |
| SMTP                | `nodemailer` — works against AWS SES, Mailgun, Postmark, or any STARTTLS provider   |
| Validation          | `zod`                                                                               |
| DB driver           | `pg` (`max: 5`, login as the `email_svc` role)                                      |
| Cookies             | `@fastify/cookie` (signed; `COOKIE_SECRET` must be ≥ 32 chars)                      |
| Container           | Multi-stage `node:22-alpine`, runs as uid 1001 (`emailsvc`), `read_only: true`, `cap_drop: ALL` |
| Dependencies        | All pinned in `services/email/package.json`; tested with Vitest 3                   |

`config.ts` validates every env var with zod and exits on failure. The base URL is normalized (no trailing slash; http/https only).

### Tokens

`tokenUtils.ts` defines:

| Constant                        | Value         | Used for                                  |
| ------------------------------- | ------------- | ----------------------------------------- |
| `TTL.EMAIL_VERIFICATION`        | 86 400 s      | sign-up verification email                |
| `TTL.PASSWORD_RESET`            | 3 600 s       | forgot-password link                      |
| `TTL.DELETE_CONFIRMATION`       | 900 s         | account-delete confirmation               |
| `TTL.RESET_COOKIE_SECS`         | 300 s         | HttpOnly cookie set by `/reset-password`  |

`generateToken()` returns a 32-byte (256-bit) URL-safe base64 string. `hashToken()` is SHA-256 hex — the *only* form persisted in `auth.email_tokens.token_hash`. Raw tokens never touch the DB.

### Routes

All routes (except `GET /health`, used by the Docker healthcheck which probes only Postgres — SMTP is intentionally not health-checked, see comment in `src/index.ts`) are mounted at the path Nginx proxies to:

| Method  | Path                       | Auth           | Rate limit zone (Nginx)         | Notes                                                                                                       |
| ------- | -------------------------- | -------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `POST`  | `/request-reset`           | none           | `email_reset` (3 r/m, burst 2)  | Always returns `200`. 800 ms response-time floor frustrates user-enumeration timing attacks.                |
| `GET`   | `/reset-password`          | none           | (no zone)                       | Validates the token *without* redeeming it, sets a 5-min HttpOnly `reset_token` cookie scoped to `/api/email/confirm-reset`, redirects to `/#reset-password`. |
| `POST`  | `/confirm-reset`           | reset cookie   | `email_reset` (3 r/m, burst 2)  | Reads token from cookie (closes the H-1 TOCTOU and the H-3 token-in-log leak), redeems atomically, calls `auth.reset_password_destroy_data`. |
| `GET`   | `/verify-email`            | none           | `email_verify` (10 r/m)         | Redeems and calls `auth.mark_email_verified`. Redirects to `/#email-verified?success=true` or `?error=...`. |
| `POST`  | `/resend-verification`     | JWT            | `email_resend` (3 r/m, burst 2) | 10-min per-user cooldown enforced server-side under `pg_advisory_xact_lock` (no row lock — `email_svc` has no UPDATE on `auth.users`). Returns 429 if cooling. |
| `POST`  | `/request-delete`          | JWT            | `email_delete_req` (2 r/m)      | Sends the 15-min token email. Send happens *inside* the transaction so a failed send rolls back the log row (user can retry). |
| `POST`  | `/confirm-delete`          | JWT + token + password | `email_delete_confirm` (5 r/m, burst 3) | Redeems token AND verifies password atomically. Wrong password → ROLLBACK (token preserved); brute-force is bounded by the rate limit and the 15-min TTL. |
| `POST`  | `/notify-password-change`  | JWT            | `email_notify` (10 r/m)         | Fire-and-forget — always returns `200` immediately; the SMTP send happens after the response.               |
| `GET`   | `/health`                  | —              | (not proxied)                   | `SELECT 1` — internal only.                                                                                 |

Any other path under `/api/email/` is returned `404` by Nginx.

### Logging hygiene

`docker/frontend/nginx.conf` defines a `email_scrubbed` log format that strips `?token=...` from access-log lines for every `/api/email/*` location (using a `map` directive that captures only `^/api/email/[^?]+`). The email service's structured logs never include token plaintext either — only hashes appear in error paths.

### Periodic cleanup

`src/index.ts` schedules `auth.cleanup_email_tokens()` every 15 minutes via `setInterval`. The function deletes used / expired tokens and `email_send_log` rows older than 24 h. Failures are logged but do not crash the service.

### 6.1 Email verification flow

1. Sign-up succeeds; the sign-up RPC returns `email_verified = false`.
2. `AuthContext.login` sees `isNewAccount && !emailVerified` and fires `resendVerificationEmail()`.
3. `EmailVerificationBanner` renders below the header (`!emailVerified` in `App.tsx`). The "Resend email" button enforces a 10-minute cooldown that mirrors the server-side limit.
4. The user clicks the link in the email → `GET /api/email/verify-email?token=...` → 302 to `/#email-verified?success=true` → `App.tsx` calls `setEmailVerified(true)` and the banner disappears.

### 6.2 Account deletion flow

1. User opens `DeleteAccountModal` ("Delete account" in the header menu).
2. User clicks **Send confirmation email** → `POST /api/email/request-delete` (JWT-authenticated). Email contains a 15-minute token to copy/paste.
3. The user can either paste the token into the modal (step 2 of the modal) or click the link in the email — that link redirects to `/#delete-confirmed?token=...`, which `App.tsx` parses and uses to auto-open the modal in step 2 with the token prefilled.
4. The user enters their password and **holds** the destructive button for 3 seconds (anti-misclick) → `POST /api/email/confirm-delete` with `{token, password}` plus the JWT.
5. Server: redeem token → `auth.delete_account_with_password(user_id, password)` in the same transaction. Wrong password → ROLLBACK (token survives) → `400`. Success → cascaded `DELETE FROM auth.users` → audit log → `200` → `logout()` → redirect to `/login`.

### 6.3 Password reset

This flow **destroys all of the user's encrypted data**. The user's encryption key is derived from `(password, email)`; without the old password the ciphertext is unrecoverable. Rather than leave un-decryptable rows in the database forever, the reset deletes the data outright. This is called out in red in `ForgotPasswordModal` and `ResetPasswordModal` and in the email body.

1. User enters their email in `ForgotPasswordModal` → `POST /api/email/request-reset`. The route always returns `200` with an 800 ms floor (no enumeration). If the email matches a user, an email containing the reset link goes out.
2. User clicks the link → `GET /api/email/reset-password?token=...`. The route validates the token *without* redeeming it, sets `reset_token` as an HttpOnly cookie scoped to `/api/email/confirm-reset` for 5 minutes, then 302s to `/#reset-password`. Token is never echoed back in the redirect URL. (Closes both the TOCTOU race a stateless redirect would create and the access-log token leak a query-string redirect would create.)
3. `AuthPage.tsx` reads the `#reset-password` fragment and opens `ResetPasswordModal`. The user enters and confirms the new password. The modal POSTs to `/api/email/confirm-reset` with `{new_password}`; the cookie carries the token automatically.
4. Server: redeem token → call `auth.reset_password_destroy_data(user_id, new_password)` in the same transaction. The function deletes all `bookmark_tags`, `thumbnail_images`, `tags`, and `bookmarks` for the user, then re-hashes the password (bcrypt cost 13), increments `key_version`, increments `token_version` (kills any live JWTs), and sets `email_verified = TRUE` (the reset link itself proved email control).
5. Cookie is cleared. User signs in fresh with the new password and starts from an empty bookmark list.

### 6.4 Password-changed notification

After a successful client-side key rotation, `ChangePasswordModal` calls `notifyPasswordChanged()` *before* `change_password` (because the latter invalidates the JWT). The route is fire-and-forget: the response is sent before the SMTP attempt; failures are logged but never break the rotation flow.

---

## 6A. Metadata-Fetcher Service (`services/metadata-fetcher/`)

Stateless Fastify microservice that performs the server-side `<title>` extraction backing the auto-fill button on the bookmark form. Sees the URL transiently during the fetch and never persists it; bound to its own `metadata_net` Docker network with no L3 path to `db` or `postgrest`.

### Why this service exists

A pure-webapp implementation that fetches `<title>` from an arbitrary URL is essentially impossible in modern browsers — same-origin policy blocks cross-origin `fetch` reads for any site that does not explicitly send permissive CORS headers, which the long tail of bookmarkable sites does not. This service is the controlled, transient regression from the otherwise strict zero-knowledge invariant: only the URL itself crosses the trust boundary, no encryption keys, no persistence, no logging of the URL.

### Endpoint

`POST /api/title/` (bearer JWT, audience `metadata-svc`):
- Request body (zod): `{ url: string }` — http/https only, length ≤ 2000, no userinfo.
- Response: `{ title: string | null }` (null = page parsed but no candidate found).
- Errors: 400 (invalid input), 401 (auth), 422 (SSRF / content-type / size / redirect / compressed-body), 429 (per-user rate or concurrent cap), 502 (upstream), 503 (global concurrent cap), 504 (timeout). Every body is `{ error: "<short generic message>" }`.

### Threat boundary

SSRF is the primary risk. Defences in layered order (`services/metadata-fetcher/src/`):
- `ssrfGuard.ts` — scheme allowlist, userinfo rejection, hostname canonicalisation (rejects decimal/hex/octal/dotless/trailing-dot/percent-encoded host disguises), scheme-default port only (80/443), full IPv4 + IPv6 deny-list (`ipRanges.ts`) covering RFC1918, loopback, link-local (incl. cloud-metadata 169.254.169.254), CGNAT, multicast, reserved, ULA, IPv4-mapped IPv6. DNS lookup via `dns.lookup({ all:true, verbatim:true })`; **any-address-private = reject**. Returns the resolved IP for the caller to dial — closes DNS rebinding TOCTOU.
- `fetcher.ts` — dial-by-IP with SNI/Host set to the original hostname; TLS minVersion 1.2; closed-set outbound headers (`Host`, `User-Agent`, `Accept`, `Accept-Encoding: identity` — nothing from the inbound request); 3-redirect cap with HTTPS→HTTP downgrade rejection and per-hop guard re-runs; 2 MiB streamed body cap (env-overridable up to 8 MiB via `MAX_BODY_BYTES`) aborted before any `Buffer.concat`; 5 s wall-clock total timeout; content-type allowlist (`text/html`, `application/xhtml+xml`); gzip / br / deflate response rejected (gzip-bomb defence).
- `titleExtractor.ts` — `htmlparser2` streaming parser, stops at `</head>`. Priority `og:title` → `twitter:title` → `<title>`, entity-decoded, whitespace-normalised, clamped to 500 chars. Charset from HTTP header only; `<meta charset>` inside the document is intentionally ignored to prevent attacker control over the decoder.
- `errorSanitizer.ts` — walks `err.cause` (depth-5 cap) and scrubs URLs, IPs, and the in-flight target hostname out of `err.message` and `err.input` BEFORE pino sees the error object. Closes the leak path pino's `redact` cannot reach (substring scrubbing inside string values).
- `concurrency.ts` — global semaphore (cap 32 → 503) plus per-user semaphore (cap 3 → 429). Plus per-route rate limit 30/min per JWT sub.

### What never appears in logs

The target URL, the hostname, and any resolved IP are treated as sensitive PII for the duration of the request. `LOG_REDACT_PATHS` covers `req.body.url`, `req.body.*.url`, `err.input`, `err.config.url`, `err.request.url`; `reqSerializer` scrubs `?token=` / `?code=` from `req.url`; the error sanitiser handles `error.message` substrings the redact paths cannot match. Per-request structured fields include only `request_id`, `user_id`, `outcome` (closed enum — see `metrics.ts` `OUTCOMES`), `latency_ms`. The `/metrics` endpoint exposes counters and histograms keyed only by the outcome enum.

### Deployment posture

- Docker: `node:22-alpine` runner, `USER node`, `cap_drop: ALL`, `read_only: true`, mem 256m / cpu 0.5.
- Network: attached only to `metadata_net`. The `frontend` container bridges both `betterbookmarks2` (where db/postgrest live) and `metadata_net`, but the metadata-fetcher itself has no L3 reach to the data tier.
- Auth: JWT verified via `jose`; pinned audience `metadata-svc`. `api._sign_jwt` mints `aud=["email-svc","metadata-svc"]` so the same session token authenticates both sibling backends (jose 6 set-membership). The SQL migration in `docker/db/init/11_jwt_audience.sql` is already idempotent (`BEGIN; CREATE OR REPLACE FUNCTION ...; COMMIT;`) and is applied to existing volumes via:
  ```
  docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -f /docker-entrypoint-initdb.d/11_jwt_audience.sql
  ```
  No forced re-login window — this migration adds a member to the existing array, which jose set-membership already accepts.
- Nginx: exact-match `POST /api/title/` route, scrubbed access log, 30r/m limit zone, `Cross-Origin-Resource-Policy: same-origin`. Wildcard `^~ /api/title/` returns 404 so `/health` and `/metrics` are unreachable from outside the deployment.

### Operator observability

- `docker compose logs metadata-fetcher` shows the version banner on every container start (`metadata-fetcher v<X.Y.Z> starting (node ...)`) plus the structured per-request log.
- `/metrics` (internal-only) emits `metadata_fetcher_requests_total{outcome="..."}` plus latency histograms. Grep by outcome to triage incidents without needing per-request URLs.

### Frontend integration

`src/lib/titleFetch.ts` is the client. It mirrors `src/lib/email.ts`'s shape (does NOT use `apiFetch`, which is PostgREST-specific). Every non-200 maps to a stable `TitleFetchError` kind; the UI surfaces a generic toast and leaves the title field unchanged. The auto-fill feature is non-essential — the bookmark form remains fully usable when the service is unreachable, slow, or returning errors (covered by an explicit graceful-degradation test).

### Troubleshooting

The auto-fill button shows "Couldn't fetch title. Please enter it manually." on every URL with no useful container log line. Two distinct causes produce this exact symptom:

1. **JWT audience mismatch on an existing DB volume.** The multi-audience SQL migration in `docker/db/init/11_jwt_audience.sql` runs only on fresh DB volumes (`/docker-entrypoint-initdb.d/` semantics). If your dev DB volume predates this feature, freshly-minted tokens still carry `aud="email-svc"` (single string) which the metadata-fetcher rejects against its `audience: 'metadata-svc'` check, returning 401. Apply the migration once against the running container:
   ```
   docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -f /docker-entrypoint-initdb.d/11_jwt_audience.sql
   ```
   Then sign out + sign in to mint a fresh token with the array audience.

2. **Stale route 404 from a routing-layer drift** (closed in the source by `routerOptions.ignoreTrailingSlash: true` in `services/metadata-fetcher/src/index.ts`). If a future change re-disables that flag or re-introduces a path mismatch between the Vite dev proxy and the service, `POST /title/` would 404 with the same UI symptom. Diagnose by curling the service directly with a valid bearer:
   ```
   curl -i -X POST http://localhost:5002/title \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://example.com/"}'
   ```
   200 → service is healthy; the issue is in front of it (Vite proxy or Nginx). 401 → token shape (cause #1). 404 → routing regression.

---

## 7. Authentication (`src/lib/auth.ts` + `AuthContext`)

### `signIn` / `signUp`

Both call the matching PostgREST RPC and return `{ token, user_id, email_verified }`. The frontend then derives the crypto key and calls `AuthContext.login(...)`.

### `rotationStatus()`

Wraps `POST /rpc/rotation_status` and reshapes the response to `{ keyVersion, hasStaleRecords }`. Called by `AuthContext.login` after every successful sign-in / sign-up; if `hasStaleRecords` is true, `partialRotation` is set and `App.tsx` renders `RecoveryModal` until the user resolves it.

### `AuthContext` shape

```typescript
interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;            // lowercased, used as PBKDF2 salt
  cryptoKey: CryptoKey | null;     // non-extractable AES-GCM key, in memory only
  partialRotation: { keyVersion: number } | null;
  emailVerified: boolean;
}

interface AuthContextValue extends AuthState {
  isLoading: boolean;
  login(token, userId, email, cryptoKey, emailVerified, isNewAccount?): Promise<void>;
  updateKey(cryptoKey): void;          // replace key after rotation / recovery
  clearPartialRotation(): void;        // called by RecoveryModal on success
  setEmailVerified(verified): void;    // called by App.tsx hash handler
  logout(): void;
}
```

`login()` sets state synchronously, kicks off `resendVerificationEmail()` (fire-and-forget) for first-login of an unverified new account, then awaits `rotationStatus()` and sets `partialRotation` if stale rows exist. `logout()` clears the in-memory token via `setAuthToken(null)` and resets every field of state.

### Sign-in flow

1. `signIn(email, password)` → `{ token, user_id, email_verified }`.
2. `deriveKey(password, email)` → non-extractable `CryptoKey`.
3. `AuthContext.login(token, user_id, email.toLowerCase(), key, email_verified)`.
4. (inside `login`) `setAuthToken(token)`; `setState({...})`; `await rotationStatus()`; set `partialRotation` if stale.

### Sign-up flow

Identical to sign-in except the RPC is `signUp` and `login(..., isNewAccount = true)` triggers the verification email.

### Logout flow

1. `setAuthToken(null)` (clears the module-level JWT in `api.ts`).
2. `setState({ token: null, ... })` — `CryptoKey` becomes garbage-collectable.
3. Caller redirects to `/login`.

---

## 8. API Layer (`src/lib/api.ts`)

### `apiFetch<T>(path, options?): Promise<T>`

A thin wrapper around `fetch` that:

1. Prepends `/api` to the path.
2. Injects `Authorization: Bearer <token>` if a token is in memory.
3. Sets `Content-Type: application/json` by default.
4. Maps non-OK responses to `ApiError` (status + sanitized message — see [section 3](#3-security-model)).
5. Returns `undefined` for `204` and falls back to `undefined` for `201` with an empty body (PostgREST does this when `Prefer: return=representation` is absent).

### `apiFetchCount(path, signal?): Promise<number | null>`

Sends `Prefer: count=exact` and reads the total from the `Content-Range` header. Returns just the count (`number`) on success or `null` on any failure. Used by `exportBookmarks` for richer progress messages — the caller degrades gracefully when count is unavailable.

### `setAuthToken(token | null)` / `getToken()`

Module-level accessors for the in-memory JWT. `email.ts` calls `getToken()` directly when a route needs `Authorization`.

---

## 9. Encryption Library (`src/lib/crypto.ts`)

All functions use the browser's native `window.crypto.subtle`. There are no third-party cryptography dependencies.

| Function        | Signature                                                          | Description                                                                                |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `deriveKey`     | `(password, email) => Promise<CryptoKey>`                          | PBKDF2-SHA256, 600k iterations, `email.toLowerCase()` as salt. Non-extractable AES-GCM key.|
| `encrypt`       | `(key, plaintext) => Promise<string>`                              | UTF-8 → AES-GCM. Output: `base64(iv \|\| ciphertext)`. Fresh 12-byte random IV each call.  |
| `decrypt`       | `(key, encoded) => Promise<string>`                                | Inverse of `encrypt`.                                                                      |
| `encryptBinary` | `(key, bytes) => Promise<string>`                                  | Bytes → AES-GCM. Output: `base64(iv \|\| ciphertext)`.                                     |
| `decryptBinary` | `(key, encoded) => Promise<Uint8Array>`                            | Inverse of `encryptBinary`.                                                                |
| `bytesToBase64` | `(bytes) => string`                                                | Chunked (8 KB) base64 encoder — avoids the call-stack overflow `String.fromCharCode(...)` triggers above ~100 KB. |
| `computeHmac`   | `(userId, value) => Promise<string>`                               | HMAC-SHA256 keyed on `userId` UTF-8 bytes; returns **base64**. Used for `name_hmac`.       |

---

## 10. Bookmarks (`src/lib/bookmarks.ts`)

### `getBookmarks(key, options?): Promise<Bookmark[]>`

```ts
interface GetBookmarksOptions {
  limit?:  number;
  offset?: number;
  signal?: AbortSignal;
}
```

GETs `/bookmarks_with_tags?order=created_at.desc&...` and decrypts every row in parallel. Does *not* take `userId` — RLS provides isolation. Returns the decrypted array; pagination metadata is inferred from the row count.

### `getBookmarkRows(): Promise<BookmarkRow[]>`

Returns raw (un-decrypted) rows. Used by `RecoveryModal` because some rows are encrypted with the old key and others with the new — bulk-decrypting up front would fail.

### `createBookmark(input, key, userId): Promise<{ id: string }>`

Encrypts `title`, `url`, and (if no `thumbnailFileId`) `thumbnailUrl`, then POSTs `/bookmarks` with `Prefer: return=representation`. Always sets `user_id` (RLS requires it in the body). File upload and URL thumbnail are mutually exclusive — passing both writes only the file id and clears `thumbnail_url_enc` to null.

### `updateBookmark(id, input, key): Promise<void>`

PATCHes `/bookmarks?id=eq.<id>` with `Prefer: return=representation`. Throws if zero rows return. Always writes `updated_at = new Date().toISOString()`.

### `deleteBookmark(id): Promise<void>`

DELETE `/bookmarks?id=eq.<id>`. Cascades to `bookmark_tags`. Thumbnail file rows are deleted separately by callers when `thumbnail_file_id` is non-null and the bookmark is being permanently removed.

### `reencryptBookmark(bookmark, newKey, targetVersion): Promise<void>`

Used during key rotation. Re-encrypts `title`, `url`, and `thumbnail_url` with `newKey`; PATCHes the row with `key_version = targetVersion` and `updated_at = now`.

### `decryptBookmark(row, key): Promise<Bookmark>`

Pure helper — decrypts all encrypted fields of a `BookmarkRow` in parallel. Used by `getBookmarks` and `RecoveryModal`.

---

## 11. Tags (`src/lib/tags.ts`)

### `getTags(key, options?): Promise<Tag[]>`

GETs `/tags?order=created_at.asc`, decrypts every `name_enc`, returns `{ id, name, keyVersion }[]`.

### `getTagRows(): Promise<TagRow[]>`

Raw rows for `RecoveryModal`.

### `createTag(name, userId, key): Promise<Tag>`

1. `name_enc = encrypt(key, name)` and `name_hmac = computeHmac(userId, name)` in parallel.
2. POST `/tags` with `{ user_id, name_enc, name_hmac }` and `Prefer: return=representation`.
3. `409 Conflict` indicates the tag already exists (`UNIQUE (user_id, name_hmac)`).

### `deleteTag(id): Promise<void>`

DELETE `/tags?id=eq.<id>`. The `bookmark_tags` rows cascade.

### `reencryptTag(id, name, newKey, targetVersion): Promise<void>`

Re-encrypts `name_enc` only. `name_hmac` is keyed on `userId` and never changes.

### `setBookmarkTags(bookmarkId, newTagIds, currentTagIds): Promise<void>`

Diff-and-sync. Adds use `POST /bookmark_tags` with `Prefer: resolution=ignore-duplicates` (idempotent in the face of replays). Removes use `DELETE /bookmark_tags?bookmark_id=eq.X&tag_id=eq.Y`. Adds and removes run in parallel via `Promise.all`.

---

## 12. Thumbnails (`src/lib/thumbnails.ts`)

### `compressImage(file): Promise<Blob>`

Uses the Canvas API to draw the image and export it as JPEG:

- Maximum dimensions: 480 × 270 px (aspect-ratio-preserving; never upscales).
- JPEG quality: `0.75`.
- Returns a `Blob`. The caller is responsible for revoking the intermediate object URL — `compressImage` does so internally for the `<img>` source.

### `uploadThumbnail(file, key, userId): Promise<string>`

`compressImage` → `encryptBinary` → encrypt filename → POST `/thumbnail_images` with `Prefer: return=representation`. Returns the new `thumbnail_images.id` for the caller to set as `thumbnail_file_id` on the bookmark.

### `uploadThumbnailFromBytes(bytes, originalName, key, userId): Promise<string>`

Same as `uploadThumbnail` but skips compression. Used by JSON import where bytes were already compressed at export time.

### `fetchThumbnailObjectUrl(imageId, key): Promise<string>`

GETs `data_enc`, decrypts, and returns `URL.createObjectURL(blob)`. **Caller must call `URL.revokeObjectURL` when done.** `useBookmarks` manages this through a `thumbCache` ref that revokes all URLs on unmount.

### `reencryptThumbnail(imageId, oldKey, newKey)`

Fetches `data_enc` and `original_name_enc`, decrypts with `oldKey`, re-encrypts with `newKey`, PATCHes back. The original filename is read from the server (not passed in) to prevent silent overwrite with empty values.

### `reencryptThumbnailToBody(imageId, oldKey, newKey)`

Same as `reencryptThumbnail` but returns the encrypted body without writing. Used for the two-phase rotation in `ChangePasswordModal` and `RecoveryModal`: phase 1 collects all bodies, phase 2 fires all PATCHes — so a network failure between phases leaves recoverable state.

### `deleteThumbnailImage(imageId)`

DELETE `/thumbnail_images?id=eq.<id>`.

---

## 13. `useBookmarks` Hook (`src/app/hooks/useBookmarks.ts`)

### Parameters

```typescript
useBookmarks({ search, selectedTagId }): {
  bookmarks: Bookmark[];
  tags: Tag[];
  isLoading: boolean;
  hasMore: boolean;
  isFiltered: boolean;
  error: string | null;
  loadMore: () => void;
  refresh: () => void;
}
```

`App.tsx` debounces the search input by 300 ms before passing it down.

### Load strategy

| Condition                                    | Strategy                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `search === ''` and `selectedTagId === null` | Paginated fetch, `PAGE_SIZE = 20`. Infinite scroll appends pages.                                     |
| Any filter active                            | Fetches all bookmarks (no limit), filters client-side. Infinite scroll disabled.                      |

### `hasMore` without count

The hook fetches `PAGE_SIZE + 1` rows per page; `hasMore` is `page.length > PAGE_SIZE`. The displayed slice drops the extra row. This avoids an extra `count=exact` round-trip per page.

### Stale-fetch protection

Each call increments `fetchIdRef`; results from older calls are discarded if a newer call has started. The previous request is also `AbortController.abort()`-ed so PostgREST can drop it.

### Thumbnail cache

`thumbCache: Map<thumbnailFileId, objectUrl>` and `bookmarkFileIdRef: Map<bookmarkId, thumbnailFileId>` together let the hook detect when a bookmark's thumbnail file id changed (replacement) and revoke the stale blob URL. Concurrency is capped at **3 simultaneous fetches** via `runWithConcurrency` (`src/lib/utils.ts`). All cached URLs are revoked on unmount.

### `loadMore`

No-ops if loading, no more, or filtered. Fetches the next `PAGE_SIZE + 1` slice at the current offset, resolves thumbnails, appends. Failures are silently swallowed (the existing list stays visible).

### Client-side filter logic

When `isFiltered`:

1. **Tag filter**: bookmark's `tagIds` must include `selectedTagId`.
2. **Search filter**: `title.toLowerCase().includes(q)` OR `url.toLowerCase().includes(q)`.
3. AND-combined.

---

## 14. Component Reference

| Component                  | File                                              | Purpose                                                                                                  |
| -------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `App`                      | `src/app/App.tsx`                                 | Root. Routes hash fragments, lifts search/filter state, runs the infinite-scroll sentinel, mounts modals |
| `AuthPage`                 | `src/app/AuthPage.tsx`                            | Sign in / sign up. Desktop sliding overlay + mobile tab switcher. Opens `ForgotPasswordModal` and `ResetPasswordModal` |
| `Header`                   | `src/app/components/Header.tsx`                   | Sticky glassmorphic header with app title and account menu                                               |
| `EmailVerificationBanner`  | `src/app/components/EmailVerificationBanner.tsx`  | Renders below `Header` until `emailVerified`. Resend button mirrors the server's 10-min cooldown         |
| `SearchBar`                | `src/app/components/SearchBar.tsx`                | Full-width glassmorphic search input                                                                     |
| `TagFilter`                | `src/app/components/TagFilter.tsx`                | Collapsible tag pills (5 visible by default)                                                             |
| `BookmarkCard`             | `src/app/components/BookmarkCard.tsx`             | Glass card with aspect-video thumbnail, title, URL, tag pills, edit/delete                               |
| `AddBookmarkButton`        | `src/app/components/AddBookmarkButton.tsx`        | Purple gradient FAB, fixed to the grid right edge                                                        |
| `FloatingFooter`           | `src/app/components/FloatingFooter.tsx`           | Fixed centered pill: app version + GitHub link                                                           |
| `BookmarkFormModal`        | `src/app/components/BookmarkFormModal.tsx`        | Add/edit form with `react-hook-form` + `TagMultiSelect`                                                  |
| `TagMultiSelect`           | `src/app/components/TagMultiSelect.tsx`           | Multi-select with create-on-type                                                                         |
| `ImportBookmarksModal`     | `src/app/components/ImportBookmarksModal.tsx`     | CSV + JSON import with row-level errors; thumbnail uploads retry transient failures and any that stay unusable are counted and reported on the done screen |
| `ExportBookmarksModal`     | `src/app/components/ExportBookmarksModal.tsx`     | JSON / CSV export with progress bar and AbortSignal cancel                                               |
| `ChangePasswordModal`      | `src/app/components/ChangePasswordModal.tsx`      | Two-phase happy-path key rotation; calls `notifyPasswordChanged` before `change_password`                |
| `RecoveryModal`            | `src/app/components/RecoveryModal.tsx`            | Full-screen takeover when `partialRotation` is set; finishes an interrupted rotation                     |
| `DeleteAccountModal`       | `src/app/components/DeleteAccountModal.tsx`       | Two-step deletion: send email → token + password + 3-second hold-to-confirm. Accepts `initialToken`      |
| `ForgotPasswordModal`      | `src/app/components/ForgotPasswordModal.tsx`      | Email form for password-reset link. Warns that reset deletes all data                                    |
| `ResetPasswordModal`       | `src/app/components/ResetPasswordModal.tsx`       | New-password form posted to `/api/email/confirm-reset`. Warns in red about data destruction              |
| `PasswordStrengthHints`    | `src/app/components/PasswordStrengthHints.tsx`    | Live indicators for the four password rules                                                              |
| `ui/*`                     | `src/app/components/ui/`                          | Radix UI primitive wrappers (shadcn-style): Dialog, Popover, Button, Input, etc.                         |

---

## 15. Import / Export

### CSV import (`src/lib/csv.ts`)

#### Format

| Column          | Required | Type   | Rules                                       |
| --------------- | -------- | ------ | ------------------------------------------- |
| `title`         | yes      | string | Non-empty                                   |
| `url`           | yes      | string | Must parse as `http:` or `https:` URL       |
| `tags`          | no       | string | Pipe-separated, e.g. `work\|tools`. Each tag truncated to 100 chars |
| `thumbnail url` | no       | string | Silently dropped if not http/https          |

#### Limits and security

- Max file size: 5 MB.
- Max rows: 500.
- Parser is RFC 4180 compliant, hand-written, zero dependencies — no `eval`, no third-party lib.
- Every URL is validated with the `URL` constructor; invalid rows are reported with a row-level message.

### JSON import (`src/lib/importJson.ts`)

#### Schema (version 1)

```json
{
  "version": 1,
  "exportedAt": "2024-01-01T00:00:00.000Z",
  "totalBookmarks": 42,
  "bookmarks": [{
    "title": "Example",
    "url": "https://example.com",
    "tags": ["work"],
    "thumbnail": { "type": "url", "value": "https://example.com/thumb.jpg" },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }]
}
```

`thumbnail` is one of:

- `{ "type": "url", "value": "<http(s)://…>" }` — stored as `thumbnail_url_enc`.
- `{ "type": "data", "value": "data:image/jpeg;base64,…", "originalName": "x.jpg" }` — JPEG magic bytes (`FF D8 FF`) are validated before re-encryption.

#### Limits

- File: ≤ 100 MB.
- Bookmarks: ≤ 5 000.
- Per-bookmark fields: `title` ≤ 500 chars, `url` ≤ 2 000 chars, ≤ 50 tags × 100 chars each.
- Decoded thumbnail bytes: ≤ 5 MB.

### Export pipeline (`src/lib/export.ts`)

#### JSON export phases

1. `apiFetchCount` for total (best-effort; export still works without it).
2. Paginated fetch (100 / page) of `bookmarks_with_tags`, decrypted in parallel.
3. `getTags(key)` once.
4. Concurrent thumbnail fetch (default 3 in-flight via `runWithConcurrency`); each thumbnail's bytes are validated against the JPEG magic prefix and embedded as a base64 data URI.
5. Serialize to the v1 JSON schema and trigger a browser download.

`exportBookmarks` accepts an `AbortSignal`. Cancellation is checked between pages and inside the thumbnail worker. `thumbnailErrorPolicy` chooses between `'skip'` (record null and continue) and `'abort'` (raise on first failure).

#### CSV export

Lossy: binary thumbnails are dropped; only URL-type thumbnails appear in the `thumbnailUrl` column. Header: `title,url,tags,thumbnailUrl,createdAt,updatedAt`. Every cell is wrapped in double quotes with internal quotes doubled.

**Formula injection mitigation:** `csvSanitize` prefixes any cell starting with `=`, `+`, `-`, or `@` with a **tab character** (OWASP-recommended; some spreadsheet versions still strip leading whitespace, but the risk is bounded because cell content originates from the user's own bookmarks). The chosen approach is documented in a code comment alongside the alternative single-quote prefix.

---

## 16. Operational Hardening

### Container security (`docker-compose.yml`)

Every container runs with the strictest posture that still works:

| Service         | `cap_drop`          | `read_only` | `tmpfs`                              | Memory / CPU limits | Notes                                                                                                                                                                              |
| --------------- | ------------------- | ----------- | ------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`            | partial             | n/a         | n/a                                  | 512 MB / 1.0 CPU    | Postgres needs CHOWN/FOWNER/SETUID/SETGID/DAC_OVERRIDE for socket and data dir management; only NET_ADMIN/SYS_ADMIN/SYS_PTRACE/AUDIT_WRITE/MKNOD are dropped                       |
| `postgrest`     | `ALL`               | yes         | `/tmp`                               | 256 MB / 0.5 CPU    | `PGRST_DB_PRE_REQUEST=api.check_token_version`, `PGRST_DB_EXTRA_SEARCH_PATH=auth`                                                                                                  |
| `frontend`     | `ALL` + 4 re-added  | yes         | `/var/cache/nginx`, `/run`           | 128 MB / 0.5 CPU    | Re-adds NET_BIND_SERVICE (port 80), CHOWN (start-up tmpfs ownership), SETGID/SETUID (master→worker drop). `/var/log/nginx` is *not* tmpfs — Alpine symlinks it to `/dev/stdout`/`/dev/stderr` |
| `email-service` | `ALL`               | yes         | `/tmp`                               | 128 MB / 0.5 CPU    | Healthcheck hits `GET /health` (Postgres only, by design — see comment in `index.ts`); shares `PGRST_JWT_SECRET` for JWT verification but never signs                              |

Only `frontend` exposes a host port (`80:80`). PostgREST and the email service are reachable only inside the `betterbookmarks2` Docker network.

### Nginx security headers

Set unconditionally on every response (`add_header ... always`):

| Header                            | Value                                                                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security`       | `max-age=31536000; includeSubDomains` (effective only when TLS terminates upstream)                                                                                                |
| `X-Frame-Options`                 | `DENY`                                                                                                                                                                             |
| `X-Content-Type-Options`          | `nosniff`                                                                                                                                                                          |
| `Referrer-Policy`                 | `strict-origin-when-cross-origin`                                                                                                                                                  |
| `Permissions-Policy`              | `camera=(), microphone=(), geolocation=(), payment=()`                                                                                                                             |
| `Content-Security-Policy`         | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |

`server_tokens off` and `client_max_body_size 2M` (thumbnails ship at ~50–100 KB; the 2 MB cap protects PostgREST and the database from large-payload DoS).

### Rate-limit zones

| Zone                     | Rate     | Used by                                                            |
| ------------------------ | -------- | ------------------------------------------------------------------ |
| `signin`                 | 5 r/m    | `POST /api/rpc/sign_in` (burst 3)                                  |
| `signup`                 | 10 r/m   | `POST /api/rpc/sign_up` (burst 5)                                  |
| `auth_mutation`          | 5 r/m    | `POST /api/rpc/change_password` (burst 2)                          |
| `api_read`               | 60 r/m   | `GET /api/bookmarks_with_tags`, `GET /api/thumbnail_images` (burst 20) — bounds export-loop exfiltration  |
| `email_reset`            | 3 r/m    | `request-reset`, `confirm-reset` (burst 2; `Retry-After: 20`)      |
| `email_verify`           | 10 r/m   | `verify-email` (burst 5)                                           |
| `email_resend`           | 3 r/m    | `resend-verification` (burst 2; `Retry-After: 20`)                 |
| `email_delete_req`       | 2 r/m    | `request-delete` (burst 1; `Retry-After: 30`)                      |
| `email_delete_confirm`   | 5 r/m    | `confirm-delete` (burst 3; `Retry-After: 12`)                      |
| `email_notify`           | 10 r/m   | `notify-password-change`                                           |

Per-user cooldowns for email sends (e.g. the 10-minute resend window) are enforced separately in the email service via `auth.email_send_log` — IP-based zones are necessary but not sufficient.

### Logging

Email-service routes use the `email_scrubbed` access-log format that drops query strings (so `?token=...` is never recorded). All other locations use the default Nginx access log. The email service's structured logs only include token plaintext at no point — only hash-keyed errors.

---

## 17. Development Guide

### Prerequisites

- Node.js 20 or later
- npm 10 or later
- Docker + Docker Compose (for the backend stack)

### First run

```bash
cp .env.example .env
# fill in POSTGRES_*, PGRST_JWT_SECRET, EMAIL_DB_PASSWORD, COOKIE_SECRET,
# SMTP_*, APP_BASE_URL, optional AWS_SES_*

docker compose up -d            # starts db + postgrest + frontend + email-service
                                # override file binds postgrest:3000 and email-service:5001 to host

npm install
npm run dev                     # http://localhost:5173 → vite proxies /api/* to localhost:3000 / :5001
```

In dev, the `docker-compose.override.yml` exposes:

- PostgREST on `localhost:3000`
- email-service on `localhost:5001`
- the optional `adminer` profile on `localhost:8080`

### Test commands

```bash
npm test               # frontend single run (used in CI)
npm run test:watch     # frontend watch mode

# Email service
cd services/email && npm test

# Database (requires the `dev` build target which includes pgTAP)
docker compose --profile test run --rm test
```

### TDD workflow (mandatory)

This project is developed test-first:

1. Write a failing test that captures the expected behaviour.
2. Run `npm test` and confirm it fails for the right reason.
3. Implement the minimum code to make it pass.
4. Run `npm test` again — all green before committing.

Test files mirror the source tree (`src/lib/foo.ts` ↔ `src/lib/foo.test.ts`). A representative coverage matrix:

| Test file                                | Covers                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/lib/crypto.test.ts`                 | Round-trip encrypt/decrypt, random IVs each call, exportKey/importKey, HMAC determinism         |
| `src/lib/api.test.ts`                    | Sanitization map, `apiFetchCount`, auth-RPC path allowlist                                      |
| `src/lib/auth.test.ts`                   | Sign-in / sign-up RPC bodies and response shape; `rotationStatus` reshape                       |
| `src/lib/bookmarks.test.ts`              | `createBookmark` body content (user_id present); PATCH URL; key_version on re-encrypt           |
| `src/lib/tags.test.ts`                   | `createTag` body (user_id, name_enc, name_hmac); `setBookmarkTags` diff; idempotent POST headers|
| `src/lib/email.test.ts`                  | Auth header injection, fetch URLs, error-shape pass-through                                     |
| `src/app/contexts/AuthContext.test.tsx`  | Login sets state, logout clears it, no persistence to storage, `setEmailVerified` flow          |
| `src/app/hooks/useBookmarks.test.ts`     | `PAGE_SIZE + 1` pagination, `loadMore` offset, `hasMore` from page length, search/tag AND logic |
| `services/email/src/routes/*.test.ts`    | Each route happy path + every documented failure mode (rate limit, expired token, wrong password, etc.) |

The missing `user_id` in `createBookmark` and `createTag` that caused an RLS violation in production was not caught because these tests were not written first — that is the case study behind the rule.

### Build

```bash
npm run build
```

Output is in `dist/`. The build fails on any TypeScript or Vite error. The frontend Docker image runs the same command in its build stage and serves the result through Nginx.

---

## 18. CI/CD

`.github/workflows/ci.yml` runs two jobs on every push and PR to `main`:

1. **Security audit** — `npm ci && npm audit --audit-level=moderate`. Fails on any moderate-or-higher vulnerability. Blocks Dependabot PRs that would regress security.
2. **Test & build** — `npm ci && npm test && npm run build`. Runs only after the security audit passes (`needs: security-audit`).

Dependabot is enabled for the root npm package; the `pnpm.overrides` block in `package.json` pins Vite to a specific major to keep transitive resolutions stable.

---

## 19. Self-Hosting

### Production deploy

Production deploys must use the base `docker-compose.yml` only, *without* the dev override (which exposes PostgREST and the email service to the host):

```bash
docker compose -f docker-compose.yml up -d --build
```

The frontend container terminates HTTP on port 80. Run a TLS-terminating reverse proxy (Caddy, Nginx, Cloudflare Tunnel, …) in front of it; the included Nginx configuration assumes upstream-terminated TLS (the `Strict-Transport-Security` header is harmless over HTTP but only effective when HTTPS is actually present).

### Required environment

Listed in `.env.example`. The non-obvious ones:

| Variable             | Notes                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `PGRST_JWT_SECRET`   | ≥ 32 chars. Generated with `openssl rand -base64 48`. Shared with the email service for *verification only*. |
| `EMAIL_DB_PASSWORD`  | Password for the `email_svc` Postgres role. Created on first run by `07_email_service_role.sh`.  |
| `COOKIE_SECRET`      | ≥ 32 chars. Used by `@fastify/cookie` to sign the 5-minute reset cookie.                         |
| `APP_BASE_URL`       | Public origin. No trailing slash. Used to build links in email templates.                        |
| `SMTP_*`             | Standard SMTP (works with AWS SES on port 587 STARTTLS, Mailgun, Postmark, etc.).                |
| `AWS_SES_*`          | Optional. When `AWS_SES_CONFIGURATION_SET` is set, `X-SES-Configuration-Set` is added to outgoing mail; `AWS_SES_FROM_ARN` enables cross-account / delegated sending. |

### Database initialisation

Postgres runs every script in `docker/db/init/` exactly once on first startup:

| File                              | Role                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `00_extensions.sql`               | `pgcrypto`, `pgjwt`, optional `pgtap`                                                                                 |
| `01_schema.sql`                   | Schemas, roles, base tables, the initial `bookmarks_with_tags` view, table grants                                     |
| `03_rls.sql`                      | `current_user_id()` (VOLATILE — see comment), RLS enable + policies on every table                                    |
| `04_indexes.sql`                  | Performance indexes                                                                                                   |
| `05_thumbnail_images.sql`         | `api.thumbnail_images`, FK from bookmarks, view rebuild, RLS                                                          |
| `06_key_versioning.sql`           | `key_version` columns, `rotation_status()`, view rebuild with `key_version` / `thumbnail_key_version`, first definition of `change_password` (replaced by 08) |
| `06_set_jwt_secret.sh`            | `ALTER DATABASE ... SET app.settings.jwt_secret` (fallback path for direct connections; PostgREST also injects this via `PGRST_APP_SETTINGS_JWT_SECRET`) |
| `07_email_service_role.sh`        | Creates the `email_svc` login role with the password from `EMAIL_DB_PASSWORD`                                         |
| `08_email_tokens.sql`             | `email_tokens`, `email_send_log`, `security_audit_log`, all SECURITY DEFINER helpers, `check_token_version` pre-request hook, **canonical `_sign_jwt` (4-arg), `sign_up`, `sign_in`, and `change_password`** with JWT-claim upgrade (`tv`, `email_verified`) |
| `09_drop_legacy_delete.sql`       | Idempotent `DROP FUNCTION IF EXISTS api.delete_account(TEXT)` — safety net for older volumes where the legacy RPC was previously created |
| `10_password_change_notification_log.sql` | `auth.security_audit_log` enum extension for password-change notification events (must run in its own transaction; `ALTER TYPE ... ADD VALUE` cannot share a transaction with the values it adds) |
| `11_jwt_audience.sql`             | Re-defines `_sign_jwt` to mint `aud=["email-svc","metadata-svc"]` so one session token authenticates both sibling backends |
| `12_encrypted_column_size_caps.sql` | `CHECK` constraints capping the length of every `*_enc` column |
| `12_post_verify_jwt.sql`          | `auth.mint_post_verify_jwt` — 5-minute post-verification window backing `POST /api/email/refresh-after-verify` |
| `13_key_version_stamp.sql`        | `BEFORE INSERT` triggers stamping `key_version` from the caller's JWT on all three encrypted tables, plus `auth.backfill_key_version()` repairing rows mislabelled by the previous constant default (issue #135) |

Re-running 08 against a database with the older `auth.reset_password_destroy_data` signature is safe — the script `DROP FUNCTION IF EXISTS` first because PostgreSQL refuses to rename input parameters via `CREATE OR REPLACE FUNCTION`.

### Backups

`db_data` is the only stateful volume. A Postgres dump (`pg_dump`) of the `auth` and `api` schemas captures everything; nothing meaningful is held outside the database. The encryption keys are not on the server, so a backup taken without the user passwords is still useless to an attacker.
