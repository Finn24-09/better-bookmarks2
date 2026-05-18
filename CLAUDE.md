# Better Bookmarks 2 — Claude Context

## Project Overview
A self-hosted React bookmark manager with a dark glassmorphic design, backed by PostgreSQL + PostgREST with client-side AES-256-GCM end-to-end encryption. The server stores only ciphertext and never holds an encryption key. Two Fastify-based sibling microservices sit alongside PostgREST: an email service handles password-reset, email verification, deletion confirmation, and password-change notifications, and a metadata-fetcher service performs server-side `<title>` extraction for the auto-fill button on the bookmark form (stateless, network-isolated, sees the URL transiently and never persists it).

**Frontend stack:** React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + lucide-react icons
**Frontend deps:** react-hook-form, react-dnd, next-themes, sonner (toasts), motion (animations), Radix UI components, react-router v7
**Frontend test stack:** Vitest 4 + jsdom + @testing-library/react + @testing-library/jest-dom

**Email service stack:** Node.js 22 + Fastify 5 + TypeScript + Pino (with secret redaction) + jose (JWT) + nodemailer + pg + zod
**Email service test stack:** Vitest 4

**Metadata-fetcher stack:** Node.js 22 + Fastify 5 + TypeScript + Pino + jose + zod + htmlparser2 + prom-client. Stateless: no DB role, no cache. Attached to a dedicated `metadata_net` Docker network so SSRF inside the container cannot reach `db` or `postgrest` on L3.
**Metadata-fetcher test stack:** Vitest 4

**Repo layout:**
```
.
├── src/                          # React frontend (this is the project root npm package)
├── services/email/               # Fastify email microservice (separate npm package)
├── services/metadata-fetcher/    # Fastify metadata-fetcher microservice (separate npm package)
├── docker/db/                    # PostgREST database init SQL + Dockerfile
├── docker/frontend/              # Nginx reverse proxy + frontend Dockerfile
└── .github/workflows/            # CI (audit, test, build) for all three packages
```

---

## Commit & Branching Workflow — MANDATORY

This applies to **every** commit Claude creates in this repo.

### One commit = one logical change
Group related edits into **meaningful packages**. A commit should represent a single coherent intent (one bug fix, one feature slice, one refactor) and stay reviewable on its own. If a change spans multiple unrelated concerns, split it into multiple commits.

**Do NOT:**
- Bundle unrelated fixes ("fix bug + bump dep + rename file")
- Commit work-in-progress or half-implemented features
- Commit generated files, secrets, or `.env` contents
- Use `git add -A` / `git add .` blindly — stage specific files

### Commit message format
```
<short summary in imperative mood — under 70 chars>

<body: one or more paragraphs explaining WHAT changed and WHY>
<reference issues / PRs / security tickets if relevant>
```

**Summary line rules:**
- Imperative mood: `Fix RLS user_id leak`, not `Fixed` / `Fixes`
- Use prefixes that match the change: `Fix`, `Add`, `Update`, `Refactor`, `Remove`, `Bump`, `Test`
- No trailing period; under ~70 characters

**Body rules:**
- Wrap at ~72 columns
- Explain the *why* (motivation, root cause, threat model) — the diff already shows the *what*
- Call out any security-relevant impact, invariant changes, or breaking behavior
- Cite the failure mode you're preventing for security/bug fixes (e.g. "without this, bearer JWT leaks into stdout")

Look at recent `git log` for examples of the project's voice — commits like `Email-service redact secrets from pino log output` or `Fix url unsafe password generation` are the model.

### Branch naming
Use slash-namespaced, kebab-case branches:
- `fix/<short-topic>` — bug fixes
- `feat/<short-topic>` — new features
- `chore/<short-topic>` — tooling, deps, non-functional cleanups
- `docs/<short-topic>` — documentation only

Always work on a branch off `main`. Never commit directly to `main`. Open a PR for any non-trivial change so CI runs and review is possible.

### Before committing, always:
1. Run `npm test` (and `npm test` inside `services/email/` if you touched the email service) — all green
2. Run `npm run build` if you touched build-relevant files
3. Verify `git status` and `git diff --staged` — no stray files, no debug logging, no secrets
4. Confirm the change matches the security invariants below

---

## Security & Coding Best Practices — MANDATORY

When creating new features or modifying existing ones, hold the line on these. The repo's security posture is the product — regressions here are not acceptable.

### Cryptography & secrets
- **Never** persist the encryption key, JWT, password, or password-derived material to localStorage, sessionStorage, cookies, IndexedDB, or any log line
- All field-level secrets pass through `encrypt(key, value)` / `decrypt(key, value)` from `src/lib/crypto.ts` — never send plaintext to the API
- HMAC tag dedup uses `name_hmac = HMAC-SHA256(userId, tagName)` — always include it on tag create
- Use `crypto.getRandomValues` / WebCrypto APIs — never `Math.random()` for anything security-relevant
- PBKDF2 parameters (SHA-256, 600 000 iterations, non-extractable derived key) are fixed; do not lower them

### Backend security (email service & DB)
- All routes that take user input validate with **zod schemas** — no `any` types crossing the trust boundary
- Use parameterized queries via `pg`'s `$1, $2` placeholders — never string-concatenate SQL
- Apply per-route rate limits in `services/email/src/rateLimit.ts`; treat Nginx limits as defence-in-depth, not the only line
- GitHub Actions in `.github/workflows/` use moving major-version tags (`@v6`, `@v1`, etc.) — accept the trade-off of receiving upstream regressions immediately in exchange for not having to bump SHAs manually
- Default-deny `permissions:` on workflows; elevate per-job only when needed
- Pino logger redacts via `LOG_REDACT_PATHS` and the custom `reqSerializer` — keep both in sync; query strings can leak tokens through `req.url`
- Fastify error handler returns generic messages on 5xx; never leak internal error details
- Body size cap (`bodyLimit: 64 * 1024`) is defence-in-depth — keep it
- `trustProxy: 1` (one Nginx hop) — do not set `true`; that lets clients forge X-Forwarded-For
- Database access from the email service uses a **dedicated low-privilege role** (see `docker/db/init/07_email_service_role.sh`) — never use the PostgREST role
- All `*_enc` columns are application-encrypted; the DB role must never have the key

### API & error handling
- Sanitize PostgREST errors at the frontend boundary (`src/lib/api.ts`) — only 400/401/409 may relay upstream messages; everything else gets a generic message to avoid schema leakage
- Validate, then act — never trust client input on the server, never trust server data without expecting it could be tampered with on the way back
- Always include `user_id` in POST bodies for `bookmarks`, `tags`, `thumbnail_images` — RLS enforces ownership but PostgREST needs the column

### General code quality
- TypeScript: prefer narrow types and discriminated unions over `any` / `unknown` casts; type all exported symbols
- React: use hooks idiomatically — no derived state stored in `useState` if it can be computed; cleanup `useEffect` side effects (timers, observers, object URLs)
- No `console.log` left in committed code; use Pino on the server, structured errors on the client (sonner toast for user-facing)
- No emoji in UI strings, comments, or commit messages unless the user explicitly asks
- Prefer editing existing files; create new files only when a new module is genuinely warranted
- Follow the project's existing patterns — look at neighboring code before inventing a new convention
- No unused exports, dead code, or orphaned tests
- Comments explain the **why** (especially security invariants) — not the *what*; the code already shows the what

### Dependencies
- `npm audit --audit-level=moderate` is a CI gate (both packages). Fix vulnerabilities, don't suppress them
- Dependabot PRs already cover patch/minor updates — keep them flowing through review
- Do not add a dependency to solve something the standard library / WebCrypto already does (see `src/lib/csv.ts` — RFC 4180 parser, no deps)

---

## Test-Driven Development — MANDATORY

This project is developed test-first. This is a hard rule, not a suggestion.

**Before implementing any new feature or fixing any bug:**
1. Write a failing test that captures the expected behaviour
2. Run `npm test` and confirm it fails for the right reason
3. Implement the minimum code to make it pass
4. Run `npm test` again — all tests must be green before moving on

**Test commands:**
```bash
npm test            # frontend single run (CI / before committing)
npm run test:watch  # frontend watch mode

cd services/email && npm test                       # email service single run
cd services/email && npm run test:watch             # email service watch mode

cd services/metadata-fetcher && npm test            # metadata-fetcher single run
cd services/metadata-fetcher && npm run test:watch  # metadata-fetcher watch mode
```

**Test file locations — mirror the source tree:**
| Source | Test |
|---|---|
| `src/lib/foo.ts` | `src/lib/foo.test.ts` |
| `src/app/hooks/useBar.ts` | `src/app/hooks/useBar.test.ts` |
| `src/app/contexts/BazContext.tsx` | `src/app/contexts/BazContext.test.tsx` |
| `services/email/src/routes/foo.ts` | `services/email/src/routes/foo.test.ts` |

**What to test (frontend):**
- `src/lib/crypto.ts` — round-trip encrypt/decrypt, random IVs, exportKey/importKey, HMAC determinism
- `src/lib/auth.ts` — fetch mocks for signIn success/failure, signUp duplicate email
- `src/lib/email.ts` — request flows, error mapping, auth-bearer header presence
- `src/app/contexts/AuthContext.tsx` — login sets state, logout clears both token and key, no persistence to storage
- `src/lib/bookmarks.ts` — createBookmark sends `user_id` + encrypted fields; updateBookmark sends PATCH to correct URL
- `src/lib/tags.ts` — createTag sends `user_id` + `name_enc` + correct `name_hmac`; setBookmarkTags diffs correctly
- `src/app/hooks/useBookmarks.ts` — pagination params, loadMore offset, hasMore logic, client-side search/filter/AND logic

**What to test (email service):**
- Each route handler: input validation (zod), auth (JWT verify), rate-limit config, success path, error sanitization
- `tokenUtils.ts` — token generation entropy, HMAC consistency, expiry checks
- `logRedact.ts` / `logSerializers.ts` — query strings and authorization headers never reach pino raw
- `mailer.ts` — error paths surface, no PII in error messages
- Templates — HTML escaping (`escape.ts`) for all user-controlled data

**Why this matters:** The missing `user_id` bug in `createBookmark` and `createTag` that caused the RLS violation in production was not caught because these tests were not written first. Tests for request body content would have failed immediately and exposed the omission before any manual testing was needed.

---

## Architecture & Routing

### Frontend
```
src/
├── main.tsx                          # React 19 entry; mounts AuthProvider + router
├── app/
│   ├── router.tsx                    # Routes: / (App), /login (AuthPage), /reset-password
│   ├── App.tsx                       # Root layout: search/filter state, infinite scroll, bookmark grid
│   ├── AuthPage.tsx                  # Animated sign in / sign up (desktop overlay, mobile tabs)
│   ├── contexts/AuthContext.tsx      # In-memory auth state: token, userId, email, cryptoKey
│   ├── hooks/useBookmarks.ts         # Pagination, search/filter, thumbnail cache, loadMore
│   └── components/                   # UI components (see Component Inventory below)
└── lib/
    ├── api.ts          # apiFetch wrapper, in-memory JWT, error sanitization
    ├── auth.ts         # signIn / signUp / changePassword / rotationStatus / deleteAccount RPCs
    ├── email.ts        # Email-service client: reset, verify, resend, delete, password-change notify
    ├── bookmarks.ts    # getBookmarks / createBookmark / updateBookmark / deleteBookmark / reencryptBookmark
    ├── tags.ts         # getTags / createTag / deleteTag / reencryptTag / setBookmarkTags
    ├── thumbnails.ts   # compressImage / uploadThumbnail / fetchThumbnailObjectUrl / reencryptThumbnail
    ├── crypto.ts       # deriveKey / encrypt / decrypt / encryptBinary / decryptBinary / computeHmac
    ├── export.ts       # exportBookmarks / exportToCsv / triggerDownload
    ├── csv.ts          # parseCsvText / validateCsvFile (RFC 4180, no deps)
    └── importJson.ts   # parseJsonExport / validateJsonFile
```

**Routing:** React Router v7. `/` requires auth (redirects to `/login` if no session). `/login` redirects to `/` if already authenticated. `/reset-password` consumes the token from the email link and lets the user set a new password (which triggers full re-encryption).

**Dev proxy:** Vite proxies `/api/*` → `http://localhost:3000` (strips `/api` prefix). PostgREST and the email service must run on the locally configured ports. Production uses the Nginx reverse proxy in `docker/frontend/nginx.conf` which routes `/api/email/*` → email service and the rest → PostgREST.

### Email service (`services/email/`)
```
services/email/src/
├── index.ts                  # Fastify bootstrap: cookie, rate-limit, error handler, route registration, /health, cleanup loop
├── config.ts                 # Env-var schema (zod), parsed once at boot
├── db.ts                     # pg Pool — uses dedicated low-privilege role
├── jwt.ts                    # jose-based JWT verify (matches PostgREST audience claim)
├── mailer.ts                 # nodemailer SMTP wrapper
├── rateLimit.ts              # Per-route rate-limit configs
├── health.ts                 # Cached DB health (30s loop) — /health does NOT hit DB per-request
├── logRedact.ts              # LOG_REDACT_PATHS for pino's redact option
├── logSerializers.ts         # Custom req serializer — scrubs token/code from req.url
├── tokenUtils.ts             # Email-token generation, HMAC, expiry
├── routes/
│   ├── requestReset.ts       # POST /request-reset — issue reset token + email
│   ├── confirmReset.ts       # POST /confirm-reset — validate token + apply password change RPC
│   ├── resetPassword.ts      # POST /reset-password — alternate flow
│   ├── verifyEmail.ts        # POST /verify-email — validate token, mark email verified
│   ├── resendVerification.ts # POST /resend-verification — auth required
│   ├── requestDelete.ts      # POST /request-delete — auth required, sends confirmation email
│   ├── confirmDelete.ts      # POST /confirm-delete — token + password, SECURITY DEFINER cascade
│   ├── notifyPasswordChange.ts # POST /notify-password-change — fire-and-forget audit email
│   └── refreshAfterVerify.ts # POST /refresh-after-verify — mints fresh JWT via auth.mint_post_verify_jwt (5-min window)
└── templates/
    ├── _shared.ts            # Common HTML envelope
    ├── escape.ts             # HTML-entity escape for all user-controlled data
    ├── layout.ts             # Outer layout
    ├── verifyEmail.ts
    ├── resetPassword.ts
    ├── deleteConfirmation.ts
    └── passwordChanged.ts
```

---

## Security Model — CRITICAL INVARIANTS

Never break these. They are the core of the zero-knowledge architecture.

- **Encryption key** — derived via `deriveKey(password, email)` (PBKDF2-SHA256, 600k iterations, non-extractable). Stored only in `AuthContext` state. **Never written to localStorage, sessionStorage, cookies, or sent over the network.**
- **JWT** — stored only in a module-level variable in `api.ts`. **Never written to any persistent storage.** Both key and token are wiped on logout.
- **Encrypted fields** — `title_enc`, `url_enc`, `thumbnail_url_enc`, `name_enc`, `data_enc`, `original_name_enc`. Always call `encrypt(key, value)` before sending and `decrypt(key, value)` after receiving. Never send plaintext to the API.
- **HMAC tag deduplication** — `name_hmac = HMAC-SHA256(userId, tagName)`. The DB enforces `UNIQUE(user_id, name_hmac)` for tags without ever seeing the plaintext name. Always include `name_hmac` when creating a tag.
- **`user_id` in mutations** — always include `user_id` in POST bodies for `bookmarks`, `tags`, and `thumbnail_images`. RLS enforces ownership but PostgREST needs the field in the body.
- **Password change = key rotation** — changing password requires re-encrypting ALL bookmarks, tags, and thumbnails with the new key before calling the `change_password` RPC. The order matters: re-encrypt data first, then update credentials. The `RecoveryModal` handles the partial-rotation recovery path when the previous attempt was interrupted.
- **API error sanitization** — only 400/401/409 relay PostgREST messages. All other errors get a generic message. Do not change this without understanding the schema leakage risk.
- **Email-service log redaction** — `LOG_REDACT_PATHS` (object paths) and `reqSerializer` (URL query strings) together prevent bearer JWTs, session cookies, and reset tokens from reaching stdout. Both must stay in sync.
- **JWT audience pinning** — `api._sign_jwt` mints `aud=["email-svc","metadata-svc"]` (array). The email service verifies `audience: 'email-svc'`, the metadata-fetcher verifies `audience: 'metadata-svc'`; jose 6's set-membership semantics make a single token valid for both. PostgREST does not enforce `PGRST_JWT_AUD` so the extra claim is silently accepted. See `docker/db/init/11_jwt_audience.sql`.
- **Metadata-fetcher SSRF posture** — `services/metadata-fetcher/` accepts user-supplied URLs and fetches them server-side. The URL is the most sensitive datum flowing through; it is never logged (pino redact + `reqSerializer` + the `errorSanitizer` walking `err.cause` chains) and never persisted. The full layered defence (hostname canonicalisation, IP deny-list incl. cloud-metadata, dial-by-IP DNS pinning, 2 MiB body cap (env-overridable up to 8 MiB via `MAX_BODY_BYTES`), 5s timeout, content-type allowlist, gzip rejection, redirect re-resolution, HTTPS-downgrade rejection, closed-set outbound headers) lives in `services/metadata-fetcher/src/ssrfGuard.ts` + `fetcher.ts`. The container has no DB role and is on a dedicated egress network with no L3 path to `db` or `postgrest`. The frontend treats auto-fill as non-essential — every failure mode leaves the bookmark form fully usable for manual entry.
- **Metadata-fetcher email-verified gate** — `services/metadata-fetcher/src/jwt.ts` requires `email_verified === true` in the JWT (strict equality, not truthy) before serving `POST /title`. This is the documented carve-out from the "enforce against DB, never claim" invariant in `08_email_tokens.sql:505-510`: the fetcher has no DB role and cannot read `auth.users` from `metadata_net`. The staleness gap on a fresh `false → true` transition is closed by `POST /api/email/refresh-after-verify`, which mints a fresh JWT via `auth.mint_post_verify_jwt` (5-minute DB-side window — NOT a general refresh primitive). Adding a DB lookup here would regress the network-isolation cap; do not propose it. See `docker/db/init/12_post_verify_jwt.sql` for the full rationale.

---

## Data Model

The frontend talks to these PostgREST-exposed resources:

| Resource | Method | Notes |
|---|---|---|
| `bookmarks` | POST / PATCH / DELETE | Encrypted fields: `title_enc`, `url_enc`, `thumbnail_url_enc` |
| `bookmarks_with_tags` | GET | View; includes `tag_ids UUID[]` array |
| `tags` | GET / POST / PATCH / DELETE | Encrypted: `name_enc`; HMAC: `name_hmac` |
| `bookmark_tags` | POST / DELETE | Junction table: `bookmark_id`, `tag_id` |
| `thumbnail_images` | GET / POST / PATCH / DELETE | Encrypted binary: `data_enc`, `original_name_enc` |
| `/rpc/sign_in` | POST | Returns `{ token, user_id }` |
| `/rpc/sign_up` | POST | Returns `{ token, user_id }` |
| `/rpc/change_password` | POST | Call only after all re-encryption is done |
| `/rpc/rotation_status` | POST | Returns `{ key_version, has_stale_records }` — called on every login |

The frontend talks to the email service via `/api/email/*`:

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/email/request-reset` | none | Sends password-reset email; rate-limited |
| `POST /api/email/confirm-reset` | none | Token + new password → applies change |
| `POST /api/email/verify-email` | none | Token from verification email |
| `POST /api/email/resend-verification` | bearer | Cooldown enforced |
| `POST /api/email/request-delete` | bearer | Sends 15-min token via email |
| `POST /api/email/confirm-delete` | bearer | Token + password → SECURITY DEFINER cascade delete |
| `POST /api/email/notify-password-change` | bearer | Fire-and-forget audit email |
| `POST /api/email/refresh-after-verify` | bearer (any) | Returns `{ token, email_verified: true }` for the user immediately after `mark_email_verified` (5-min DB-side window). The frontend swaps the in-memory JWT so the metadata-fetcher gate accepts the next call without re-sign-in. See `docker/db/init/12_post_verify_jwt.sql`. |

The frontend talks to the metadata-fetcher via a single route at `/api/title/`:

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/title/` | bearer + `email_verified=true` claim | `{ url }` → `{ title: string \| null }`. Server-side `<title>` fetch with full SSRF / DoS / log-leakage hardening. The verified-email gate raises per-mailbox cost on fresh-account abuse: a VPN farm needs a real, deliverable inbox per account before it can drive the only outbound-fetching endpoint. The claim is strictly `=== true`; missing claim → 401, false / coerced shapes → 403. The 403 body is byte-identical across users so it cannot enumerate accounts. The staleness gap on a `false → true` transition is closed by `POST /api/email/refresh-after-verify`. Internal `/health` and `/metrics` are blocked from external reach by Nginx wildcard 404 under `/api/title/`. |

Database init is in `docker/db/init/`:
| File | Purpose |
|---|---|
| `00_extensions.sql` | pgcrypto, pgjwt, etc. |
| `01_schema.sql` | Tables, views, RPCs |
| `03_rls.sql` | Row-Level Security policies |
| `04_indexes.sql` | Performance indexes |
| `05_thumbnail_images.sql` | Thumbnail table + RLS |
| `06_key_versioning.sql` | `key_version` columns + rotation tracking |
| `06_set_jwt_secret.sh` | Reads JWT secret from env at init |
| `07_email_service_role.sh` | Creates dedicated low-priv role for email service |
| `08_email_tokens.sql` | Token table + `auth.cleanup_email_tokens()` function |
| `09_drop_legacy_delete.sql` | Removes pre-email-service delete RPC |
| `10_password_change_notification_log.sql` | Audit trail for password changes |
| `11_jwt_audience.sql` | Pins `aud` claim verification |

Bookmark listing always reads from `bookmarks_with_tags`, not `bookmarks` directly.

---

## Key Library Behaviours

### `useBookmarks` hook
- **Unfiltered:** fetches paginated (page size 20), infinite scroll via IntersectionObserver sentinel.
- **Filtered (search or tag active):** fetches ALL bookmarks, filters client-side with AND logic (search AND tag). Infinite scroll disabled.
- Thumbnail object URLs are cached in a `thumbCache` ref; all URLs are revoked on unmount.

### `setBookmarkTags`
Diffs desired vs current tag IDs. Only POSTs new associations and DELETEs removed ones. Never re-inserts unchanged tags.

### CSV import limits
Max 5 MB, max 500 rows. Required columns: `title`, `url`. Optional: `tags` (pipe-separated), `thumbnail url`.

### JSON import/export limits
Import: max 100 MB, max 5000 bookmarks. Export: paginated 100/page, thumbnail concurrency capped at 3, cancellable via AbortSignal.

### Password reset flow
1. User on `/login` opens `ForgotPasswordModal` → `requestPasswordReset(email)` → email service issues token + sends email
2. Email link opens `/reset-password?token=…` → `ResetPasswordModal` validates the token, accepts new password
3. Frontend re-encrypts all bookmarks/tags/thumbnails with the new key, then calls `confirm-reset` to finalize
4. If interrupted mid-rotation, on next login `rotationStatus` returns `has_stale_records: true` and `RecoveryModal` walks the user through completing the rotation

---

## Design System

### Visual Theme
- **Background:** `bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950`
- **Glass base:** `bg-white/5 backdrop-blur-xl border border-white/10`
- **Glass hover:** `bg-white/10 border-white/20`
- **Glass active:** `bg-white/20`
- **Primary button:** `bg-gradient-to-br from-purple-600 to-purple-800`
- **Text scale:** `text-white` → `/90` → `/70` → `/60` → `/40` (placeholder)
- **All transitions:** `transition-all duration-300`
- **Hover scale:** `hover:scale-110` / `active:scale-95`
- **Border radius:** `rounded-2xl` for cards/inputs, `rounded-full` for buttons/tags/pills

### Layout Rules — CRITICAL
Always use `max-w-7xl mx-auto px-4 md:px-6 lg:px-8` — padding AND max-width on the **same** element. Never put the padding on an outer wrapper and max-width on an inner element; this causes misalignment at wide viewports.

- **Main content spacing:** `space-y-6 md:space-y-8`, `pt-6 md:pt-8 pb-8`
- **Bookmark grid:** `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6`

### Z-Index Stack
| Layer | Value |
|---|---|
| Header (sticky) | `z-50` |
| Fixed FABs / FloatingFooter | `z-40` |
| Content overlays | `z-10` |

### Fixed/Floating Element Patterns
**FloatingFooter** (centered bottom):
```
fixed bottom-6 left-1/2 -translate-x-1/2 z-40
```

**FAB aligned to grid right edge** (use this pattern for any fixed button that must stay within the grid):
```tsx
<div className="fixed bottom-20 left-0 right-0 z-40 pointer-events-none">
  <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
    <div className="flex justify-end">
      <div className="pointer-events-auto">
        <YourButton />
      </div>
    </div>
  </div>
</div>
```
`bottom-20` (80px) gives ~20px clearance above the FloatingFooter pill.

---

## Component Inventory

| File | Purpose |
|---|---|
| `src/app/App.tsx` | Root — layout shell, search/filter state, infinite scroll, bookmark grid |
| `src/app/AuthPage.tsx` | Sign in / sign up — animated desktop overlay + mobile tab switcher |
| `src/app/components/Header.tsx` | Sticky glassmorphic header, title + user account menu |
| `src/app/components/SearchBar.tsx` | Full-width glassmorphic search input (controlled) |
| `src/app/components/TagFilter.tsx` | Collapsible tag pill panel (shows 5, expand for all) |
| `src/app/components/BookmarkCard.tsx` | Glassmorphic card: aspect-video thumbnail, title, URL, tags, edit/delete |
| `src/app/components/AddBookmarkButton.tsx` | Purple gradient FAB fixed to grid right edge |
| `src/app/components/FloatingFooter.tsx` | Fixed centered pill: version + GitHub link |
| `src/app/components/BookmarkFormModal.tsx` | Add / edit bookmark form (react-hook-form + TagMultiSelect) |
| `src/app/components/TagMultiSelect.tsx` | Multi-select tag input with create-on-type |
| `src/app/components/ImportBookmarksModal.tsx` | CSV + JSON import UI with validation feedback |
| `src/app/components/ExportBookmarksModal.tsx` | JSON + CSV export with progress bar and cancel |
| `src/app/components/ChangePasswordModal.tsx` | Password change — triggers full re-encryption pipeline |
| `src/app/components/DeleteAccountModal.tsx` | Password-confirmed hard account delete via email service |
| `src/app/components/ForgotPasswordModal.tsx` | Request password reset — calls email service |
| `src/app/components/ResetPasswordModal.tsx` | Consume reset-link token, set new password, re-encrypt data |
| `src/app/components/RecoveryModal.tsx` | Resume an interrupted key rotation when `rotationStatus.has_stale_records` is true |
| `src/app/components/EmailVerificationBanner.tsx` | Top-of-app banner with resend-verification action |
| `src/app/components/PasswordStrengthHints.tsx` | Live password complexity hints used by sign-up + password-change forms |
| `src/app/components/ui/` | Full Radix UI primitive set (shadcn-style wrappers) |

---

## Continuous Integration

`.github/workflows/ci.yml` runs four jobs on every push to `main` and every PR:
1. **webapp-security-audit** — `npm audit --audit-level=moderate` (frontend)
2. **webapp-test-and-build** — `npm test` then `npm run build` (gated on audit)
3. **email-security-audit** — same audit gate for `services/email/`
4. **email-test-and-build** — `npm test` + `npm run build` for `services/email/`

All Action versions are pinned to commit SHAs. `permissions: contents: read` is the default; jobs that need more elevate locally. Concurrency cancels superseded runs on the same ref.

A separate `claude.yml` workflow handles on-demand PR review via `@claude` mentions (comment-only mode — see commit `597ad56d`).

---

## Styling Conventions
- Use Tailwind utility classes exclusively — no custom CSS unless unavoidable
- Radix UI primitives are available via `src/app/components/ui/`
- Icons exclusively from `lucide-react`
- No emoji in UI unless explicitly requested
