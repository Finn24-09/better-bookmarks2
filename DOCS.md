# Better Bookmarks 2 — Technical Documentation

Audience: developers maintaining or extending this app, and administrators doing a deep-dive self-host. For a quick-start overview, see [README.md](README.md).

---

## 1. Overview

Better Bookmarks 2 is a self-hosted bookmark manager built with React 19, TypeScript, and Vite. All user data is AES-256-GCM encrypted in the browser before transmission; the backend (PostgREST + PostgreSQL) stores only ciphertext and never holds an encryption key.

**Stack:** React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + Radix UI  
**Backend:** PostgREST proxied at `/api`, backed by PostgreSQL with Row Level Security  
**Tests:** Vitest 4 + jsdom + @testing-library/react  
**CI:** GitHub Actions — security audit then test + build on every push/PR to `main`

---

## 2. Architecture

### Request flow

```
Browser (React)
    │
    │  /api/* requests
    ▼
Vite dev proxy  (strips /api prefix)
    │             OR
    │          Nginx/Caddy reverse proxy (production)
    ▼
PostgREST  :3000
    │
    ▼
PostgreSQL  (RLS enforced per user)
```

In production the Vite proxy is replaced by your web server's reverse proxy rule. The frontend static assets are served from `dist/` and have no awareness of the environment — all configuration lives in the backend.

### Routing

React Router v7 manages two routes:

| Path    | Component      | Behaviour                                                    |
| ------- | -------------- | ------------------------------------------------------------ |
| `/`     | `App.tsx`      | Requires authentication; redirects to `/auth` if no session  |
| `/auth` | `AuthPage.tsx` | Sign in / sign up; redirects to `/` if already authenticated |

The `AuthContext` provides the in-memory session. `router.tsx` wraps both routes with `AuthProvider`.

---

## 2. Security Model

### Key derivation

The encryption key is derived once at sign-in and sign-up using PBKDF2:

| Parameter   | Value                                   |
| ----------- | --------------------------------------- |
| Algorithm   | PBKDF2                                  |
| Hash        | SHA-256                                 |
| Iterations  | 600,000                                 |
| Salt        | UTF-8 bytes of the user's email address |
| Key length  | 256 bits                                |
| Key usage   | `encrypt`, `decrypt` (AES-GCM)          |
| Extractable | `false`                                 |

Because the key is non-extractable, the Web Crypto engine will not return the raw key bytes via `exportKey`. An XSS attacker cannot extract the key from memory using standard Web Crypto APIs.

### AES-256-GCM encryption (text fields)

Each encrypt call generates a fresh 12-byte random IV using `crypto.getRandomValues`. The output is `base64(iv || ciphertext)`. Decryption splits the first 12 bytes as the IV and the remainder as ciphertext.

### Binary encryption (thumbnails)

The same AES-256-GCM scheme applies to binary data. Large files are handled by encoding the concatenated `iv || ciphertext` bytes as base64. The caller is responsible for providing and storing the raw bytes; `crypto.ts` handles the symmetric transform only.

### HMAC-SHA256 tag deduplication

When you create a tag, the app computes `HMAC-SHA256(key = userId, data = tagName)` and stores the result as `name_hmac`. PostgreSQL enforces a UNIQUE constraint on `(user_id, name_hmac)`. This gives the database a stable, collision-resistant token for deduplication without exposing the plaintext tag name.

### JWT lifecycle

The JWT returned by `sign_in` or `sign_up` is stored in a module-level variable inside `api.ts`. It is:

- Injected into the `Authorization: Bearer <token>` header on every `apiFetch` call.
- Wiped (set to `null`) on logout.
- Never written to `localStorage`, `sessionStorage`, cookies, or any persistent storage.

A page reload clears both the JWT and the crypto key, requiring the user to sign in again.

### Crypto key lifecycle

The `CryptoKey` object is stored in `AuthContext` state. It is:

- Created at sign-in / sign-up via `deriveKey`.
- Available to all components via `useAuth()`.
- Cleared on logout when `AuthContext` resets its state.
- Never serialized or sent over the network.

### API error sanitization

`apiFetch` maps HTTP status codes to client-visible messages as follows:

| Status     | Behaviour                                                                  |
| ---------- | -------------------------------------------------------------------------- |
| `400`      | Relays the PostgREST error message (validation errors are safe to surface) |
| `401`      | Relays the PostgREST error message (e.g. "invalid credentials")            |
| `409`      | Relays the PostgREST error message (e.g. "duplicate key" for tag HMAC)     |
| All others | Returns a generic error string — PostgREST internals are not exposed       |

---

## 3. Data Model

The frontend interacts with the following PostgREST-exposed tables, views, and RPCs. Column names reflect the encrypted-field naming convention used in API request/response bodies.

### `bookmarks`

| Column              | Type         | Notes                                                 |
| ------------------- | ------------ | ----------------------------------------------------- |
| `id`                | UUID         | Primary key, server-generated                         |
| `user_id`           | UUID         | Foreign key to auth user; RLS filters by this         |
| `title_enc`         | text         | AES-256-GCM encrypted, base64 encoded                 |
| `url_enc`           | text         | AES-256-GCM encrypted, base64 encoded                 |
| `thumbnail_url_enc` | text \| null | Encrypted thumbnail URL, or null if using file upload |
| `thumbnail_file_id` | UUID \| null | FK to `thumbnail_images`, or null if using URL        |
| `created_at`        | timestamptz  | Server-generated                                      |
| `updated_at`        | timestamptz  | Server-generated                                      |

### `bookmarks_with_tags` (view)

Extends `bookmarks` with a `tag_ids` array column (UUID[]) listing the IDs of all associated tags. The frontend reads this view for bookmark listing.

### `tags`

| Column       | Type        | Notes                                                |
| ------------ | ----------- | ---------------------------------------------------- |
| `id`         | UUID        | Primary key                                          |
| `user_id`    | UUID        | RLS-scoped                                           |
| `name_enc`   | text        | AES-256-GCM encrypted tag name                       |
| `name_hmac`  | text        | HMAC-SHA256(userId, plaintext name); UNIQUE per user |
| `created_at` | timestamptz | Server-generated                                     |

### `bookmark_tags`

Junction table linking bookmarks to tags.

| Column        | Type |
| ------------- | ---- |
| `bookmark_id` | UUID |
| `tag_id`      | UUID |

### `thumbnail_images`

| Column              | Type | Notes                                             |
| ------------------- | ---- | ------------------------------------------------- |
| `id`                | UUID | Primary key                                       |
| `user_id`           | UUID | RLS-scoped                                        |
| `data_enc`          | text | AES-256-GCM encrypted image bytes, base64 encoded |
| `original_name_enc` | text | Encrypted original filename                       |

### RPCs

| RPC                                           | Description                                                           |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `sign_in(email, password)`                    | Returns a JWT on success                                              |
| `sign_up(email, password)`                    | Creates an account, returns a JWT                                     |
| `change_password(old_password, new_password)` | Updates credentials; called after client-side re-encryption completes |
| `delete_account(password)`                    | Hard-deletes the account and all associated data                      |

---

## 4. API Layer (`src/lib/api.ts`)

### `apiFetch<T>(path, options?): Promise<T>`

A thin wrapper around `fetch` that:

1. Prepends `/api` to the path.
2. Injects `Authorization: Bearer <token>` if a token is available.
3. Sets `Content-Type: application/json` on mutating requests.
4. Deserializes the JSON response body.
5. Applies the error sanitization rules described in the Security Model section.

### `apiFetchCount(path, options?): Promise<{ data: T[]; count: number }>`

Used for paginated requests. Sends `Prefer: count=exact` and reads the `Content-Range` header to extract the total row count alongside the response body. Used by `getBookmarks` for infinite scroll.

### Error handling reference

See the error sanitization table in the Security Model section. Callers receive either the relayed PostgREST message (for `400`/`401`/`409`) or a generic string for all other failure statuses.

---

## 5. Encryption Library (`src/lib/crypto.ts`)

All functions use the browser's native `window.crypto.subtle` Web Crypto API. There are no third-party cryptography dependencies.

| Function        | Signature                                                     | Description                                                                                                 |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `deriveKey`     | `(password: string, email: string) => Promise<CryptoKey>`     | PBKDF2-SHA256, 600k iterations, email as salt. Returns a non-extractable AES-GCM key.                       |
| `encrypt`       | `(key: CryptoKey, plaintext: string) => Promise<string>`      | Encrypts a UTF-8 string. Returns `base64(iv \|\| ciphertext)`. IV is 12 random bytes.                       |
| `decrypt`       | `(key: CryptoKey, ciphertext: string) => Promise<string>`     | Decrypts a `base64(iv \|\| ciphertext)` string. Returns the original UTF-8 string.                          |
| `encryptBinary` | `(key: CryptoKey, data: Uint8Array) => Promise<string>`       | Encrypts raw bytes. Returns `base64(iv \|\| ciphertext)`.                                                   |
| `decryptBinary` | `(key: CryptoKey, ciphertext: string) => Promise<Uint8Array>` | Decrypts a binary-encrypted value back to raw bytes.                                                        |
| `bytesToBase64` | `(bytes: Uint8Array) => string`                               | Utility: encodes a byte array to a base64 string.                                                           |
| `computeHmac`   | `(userId: string, value: string) => Promise<string>`          | HMAC-SHA256 keyed on `userId`, data is the UTF-8 `value`. Returns a hex string. Used for tag deduplication. |

---

## 6. Authentication (`src/lib/auth.ts` + `AuthContext`)

### Sign-up flow

1. Call `sign_up(email, password)` RPC via `apiFetch`.
2. On success, call `deriveKey(password, email)` to produce the `CryptoKey`.
3. Store the JWT (returned by the RPC) in the `api.ts` module variable.
4. Set `AuthContext` state: `{ token, userId, email, cryptoKey }`.

### Sign-in flow

Identical to sign-up except the RPC is `sign_in`.

### Change password flow

This is the most complex operation in the app because the encryption key changes:

1. Derive the new key: `deriveKey(newPassword, email)`.
2. Fetch all bookmarks (all pages, bypassing pagination).
3. For each bookmark: decrypt all encrypted fields with the old key, re-encrypt with the new key, PATCH the record.
4. Fetch all tags. For each tag: decrypt `name_enc` with the old key, re-encrypt with the new key, PATCH the record.
5. For each bookmark that has a `thumbnail_file_id`: fetch the encrypted thumbnail bytes, decrypt with the old key, re-encrypt with the new key, PATCH the thumbnail record.
6. Call `change_password(oldPassword, newPassword)` RPC to update credentials in the database.
7. Update `AuthContext` with the new `cryptoKey`.

If any step fails, the operation is aborted. Because data is re-encrypted in place (PATCH calls) before the credential change, a partial failure leaves some records encrypted with the new key. The app relies on step atomicity within each individual re-encrypt call.

### Logout flow

1. Set `api.ts` token variable to `null`.
2. Reset `AuthContext` state to `null` / unauthenticated.
3. Redirect to `/auth`.

The `CryptoKey` and JWT are garbage-collected when their references are dropped.

### `AuthContext` shape

```typescript
interface AuthState {
  token: string; // JWT, in memory only
  userId: string; // User UUID from PostgREST
  email: string; // Used as PBKDF2 salt on key re-derive
  cryptoKey: CryptoKey; // Non-extractable AES-256-GCM key, in memory only
}
```

`useAuth()` returns `AuthState | null`. Components redirect to `/auth` when this is `null`.

---

## 7. Bookmarks (`src/lib/bookmarks.ts`)

### `getBookmarks(options): Promise<{ bookmarks: Bookmark[]; count: number }>`

| Option   | Type      | Description                                             |
| -------- | --------- | ------------------------------------------------------- |
| `key`    | CryptoKey | Decryption key                                          |
| `userId` | string    | Filters by `user_id` (PostgREST RLS also enforces this) |
| `offset` | number    | Pagination offset                                       |
| `limit`  | number    | Page size (default 20)                                  |

Reads from the `bookmarks_with_tags` view. Decrypts `title_enc`, `url_enc`, and `thumbnail_url_enc` for each row before returning. The `tag_ids` array is returned as-is; callers join against the tag list separately.

### `createBookmark(fields, key, userId): Promise<Bookmark>`

Encrypts `title`, `url`, and optionally `thumbnail_url` with `key`, then POSTs to `/api/bookmarks`. Always includes `user_id` in the request body (required for RLS). Returns the created record after decrypting the response.

For thumbnail file uploads, the caller first calls `uploadThumbnail` to obtain a `thumbnail_file_id`, then passes that ID instead of a URL.

### `updateBookmark(id, fields, key): Promise<Bookmark>`

Encrypts only the provided fields and PATCHes `/api/bookmarks?id=eq.<id>`. Partial updates are supported.

### `deleteBookmark(id): Promise<void>`

DELETEs `/api/bookmarks?id=eq.<id>`. PostgREST cascades the deletion to `bookmark_tags`. Thumbnail file records are deleted separately if `thumbnail_file_id` is set.

### `reencryptBookmark(bookmark, oldKey, newKey): Promise<void>`

Used during password change. Decrypts all encrypted fields with `oldKey` and PATCHes the record with values re-encrypted under `newKey`. Does not change `tag_ids`.

---

## 8. Tags (`src/lib/tags.ts`)

### `getTags(key, userId): Promise<Tag[]>`

Fetches all tags for the user, decrypts `name_enc` for each, and returns the full list. Called once on load and after any tag mutation.

### `createTag(name, key, userId): Promise<Tag>`

1. Encrypts `name` with `key` to produce `name_enc`.
2. Computes `HMAC-SHA256(userId, name)` to produce `name_hmac`.
3. POSTs `{ user_id, name_enc, name_hmac }` to `/api/tags`.
4. On `409 Conflict` the tag already exists (UNIQUE constraint on `name_hmac`).

### `deleteTag(id): Promise<void>`

DELETEs `/api/tags?id=eq.<id>`. The `bookmark_tags` junction rows are cascade-deleted by the database.

### `reencryptTag(tag, oldKey, newKey): Promise<void>`

Decrypts `name_enc` with `oldKey`, re-encrypts with `newKey`, PATCHes the record. The `name_hmac` value does not change because it is keyed on `userId`, not on the encryption key.

### `setBookmarkTags(bookmarkId, desiredTagIds, currentTagIds): Promise<void>`

Implements a diff-and-sync strategy:

1. Compute `toAdd = desiredTagIds.filter(id => !currentTagIds.includes(id))`.
2. Compute `toRemove = currentTagIds.filter(id => !desiredTagIds.includes(id))`.
3. POST each `{ bookmark_id, tag_id }` in `toAdd` to `/api/bookmark_tags`.
4. DELETE each stale row from `/api/bookmark_tags` with the appropriate filter.

This avoids re-inserting unchanged associations and minimises write amplification.

---

## 9. Thumbnails (`src/lib/thumbnails.ts`)

### `compressImage(file: File): Promise<Uint8Array>`

Uses the Canvas API to draw the image and export it as JPEG:

- Maximum dimensions: 480 × 270 px (maintains aspect ratio, does not upscale).
- JPEG quality: `0.75`.
- Returns raw JPEG bytes as `Uint8Array`.

### `uploadThumbnail(file: File, key: CryptoKey, userId: string): Promise<string>`

1. Calls `compressImage(file)` to get compressed bytes.
2. Calls `encryptBinary(key, bytes)` to produce encrypted base64.
3. Encrypts the original filename.
4. POSTs `{ user_id, data_enc, original_name_enc }` to `/api/thumbnail_images`.
5. Returns the created record's `id` (a UUID), which is stored as `thumbnail_file_id` on the bookmark.

### `uploadThumbnailFromBytes(bytes: Uint8Array, key: CryptoKey, userId: string, name: string): Promise<string>`

Same as `uploadThumbnail` but accepts pre-compressed bytes directly. Used during JSON import where thumbnails arrive as base64 data URIs.

### `fetchThumbnailObjectUrl(thumbnailFileId: string, key: CryptoKey): Promise<string>`

1. GETs `/api/thumbnail_images?id=eq.<id>` and reads `data_enc`.
2. Calls `decryptBinary(key, data_enc)` to recover the JPEG bytes.
3. Creates a `Blob` and returns `URL.createObjectURL(blob)`.

**Important:** the caller must call `URL.revokeObjectURL(url)` when the URL is no longer needed to release the memory. `useBookmarks` manages this via a `thumbCache` ref that revokes all object URLs on unmount.

### `reencryptThumbnail(thumbnailFileId, oldKey, newKey, userId): Promise<void>`

Fetches `data_enc`, decrypts with `oldKey`, re-encrypts with `newKey`, PATCHes the record.

---

## 10. Import / Export

### CSV import (`src/lib/csv.ts`)

#### Format

| Column          | Required | Type   | Rules                                        |
| --------------- | -------- | ------ | -------------------------------------------- |
| `title`         | Yes      | string | Non-empty                                    |
| `url`           | Yes      | string | Must be a valid URL                          |
| `tags`          | No       | string | Pipe-separated tag names, e.g. `work\|tools` |
| `thumbnail url` | No       | string | Must be a valid URL if present               |

#### Limits and security

- Max file size: 5 MB.
- Max rows: 500.
- The parser is RFC 4180 compliant and has zero dependencies — no `eval`, no third-party CSV library.
- All URL values are validated before use; invalid URLs are rejected with a row-level error.

### JSON import (`src/lib/importJson.ts`)

#### Schema (version 1)

```json
{
  "version": 1,
  "exportedAt": "2024-01-01T00:00:00.000Z",
  "totalBookmarks": 42,
  "bookmarks": [
    {
      "title": "Example",
      "url": "https://example.com",
      "tags": ["work"],
      "thumbnail": { "type": "url", "value": "https://example.com/thumb.jpg" },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

The `thumbnail` field supports two variants:

- `{ "type": "url", "value": "<url>" }` — stored as `thumbnail_url_enc`.
- `{ "type": "data", "value": "data:image/jpeg;base64,...", "originalName": "thumb.jpg" }` — JPEG magic bytes are validated (`FF D8 FF`) before the binary is re-encrypted and stored as a thumbnail file.

#### Limits

- Max file size: 100 MB.
- Max bookmarks: 5000.

### Export pipeline (`src/lib/export.ts`)

#### JSON export phases

1. Fetch all bookmark pages (100 per page) in sequence.
2. For each bookmark, fetch tags and decrypt tag names.
3. Fetch thumbnails with concurrency capped at 3 simultaneous requests (`Promise.allSettled` batches).
4. Serialize to the v1 JSON schema.
5. Trigger a browser download via `triggerDownload`.

The export accepts an `AbortSignal`. Cancellation is checked between pages and between thumbnail fetch batches.

#### CSV export

The CSV export is lossy: binary thumbnails are omitted; only `thumbnail_url_enc` values (URL-type thumbnails) appear in the output. Formula injection is prevented by prefixing any cell that starts with `=`, `+`, `-`, or `@` with a single quote.

---

## 11. `useBookmarks` Hook (`src/app/hooks/useBookmarks.ts`)

### Parameters

```typescript
useBookmarks(options: {
  search: string;        // current search query (empty string = no filter)
  selectedTagId: string | null; // tag UUID to filter by, or null
}): {
  bookmarks: Bookmark[];
  tags: Tag[];
  count: number;
  hasMore: boolean;
  loading: boolean;
  loadMore: () => void;
  // ... mutation helpers
}
```

### Load strategy

| Condition                                    | Strategy                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `search === ''` and `selectedTagId === null` | Paginated fetch, 20 per page. Infinite scroll appends pages.                          |
| Any filter active                            | Fetch all bookmarks (no limit), then filter client-side. Infinite scroll is disabled. |

The switch to "fetch all" on filter activation avoids the complexity of server-side filtering on encrypted fields (which the server cannot read).

### Infinite scroll

`loadMore` increments the `offset` and appends the next page to the existing list. `hasMore` is `true` when `bookmarks.length < count`. The sentinel element at the bottom of the list is observed by an `IntersectionObserver`; when it enters the viewport, `loadMore` is called. The observer is disconnected when `hasMore` is `false` or a filter is active.

### Thumbnail cache

A `thumbCache` ref maps `thumbnail_file_id` to an object URL string. On first render of a `BookmarkCard`, if the bookmark has a `thumbnail_file_id` and no cached URL, `fetchThumbnailObjectUrl` is called and the result is stored in the cache. On hook unmount, all cached object URLs are revoked via `URL.revokeObjectURL` to release memory.

### Client-side filtering

When a filter is active, bookmarks are filtered in memory after full fetch:

1. **Tag filter**: include only bookmarks whose `tag_ids` array contains `selectedTagId`.
2. **Search filter**: include only bookmarks where `title` or `url` contains the search string (case-insensitive).
3. Both filters are combined with AND logic — a bookmark must satisfy both conditions to appear.

---

## 12. Component Reference

| Component              | File                                          | Purpose                                                                               |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `App`                  | `src/app/App.tsx`                             | Root layout: search/filter state, infinite scroll sentinel, bookmark grid             |
| `AuthPage`             | `src/app/AuthPage.tsx`                        | Animated sign in / sign up page; desktop sliding overlay, mobile tab switcher         |
| `Header`               | `src/app/components/Header.tsx`               | Sticky glassmorphic header with app title and user account menu                       |
| `SearchBar`            | `src/app/components/SearchBar.tsx`            | Full-width glassmorphic search input, controlled by `App` state                       |
| `TagFilter`            | `src/app/components/TagFilter.tsx`            | Collapsible tag pill panel; shows 5 tags by default, expands on click                 |
| `BookmarkCard`         | `src/app/components/BookmarkCard.tsx`         | Glassmorphic card: aspect-video thumbnail, title, URL, tag pills, edit/delete actions |
| `AddBookmarkButton`    | `src/app/components/AddBookmarkButton.tsx`    | Fixed-position FAB aligned to grid right edge; opens `BookmarkFormModal`              |
| `FloatingFooter`       | `src/app/components/FloatingFooter.tsx`       | Fixed centered pill at bottom: app version and GitHub link                            |
| `BookmarkFormModal`    | `src/app/components/BookmarkFormModal.tsx`    | Add and edit bookmark form using react-hook-form; includes `TagMultiSelect`           |
| `ImportBookmarksModal` | `src/app/components/ImportBookmarksModal.tsx` | CSV and JSON import UI with file validation and row-level error display               |
| `ExportBookmarksModal` | `src/app/components/ExportBookmarksModal.tsx` | JSON and CSV export with progress bar and AbortSignal-based cancel                    |
| `ChangePasswordModal`  | `src/app/components/ChangePasswordModal.tsx`  | Password change form; triggers full re-encryption pipeline                            |
| `DeleteAccountModal`   | `src/app/components/DeleteAccountModal.tsx`   | Password-confirmed account hard delete                                                |
| `TagMultiSelect`       | `src/app/components/TagMultiSelect.tsx`       | Multi-select tag input; creates new tags on type, shows existing options              |
| `ui/*`                 | `src/app/components/ui/`                      | Radix UI primitive wrappers (shadcn-style): Dialog, Popover, Button, Input, etc.      |

---

## 13. Development Guide

### Prerequisites

- Node.js 20 or later
- npm 10 or later
- PostgREST running on `http://localhost:3000` with a PostgreSQL database and RLS configured

### Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to `http://localhost:3000`.

### Test commands

```bash
npm test             # single run, used in CI
npm run test:watch   # watch mode for TDD
```

### What each test file covers

Test files mirror the source tree with a `.test.ts` / `.test.tsx` suffix.

| Test file                               | Covers                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/lib/crypto.test.ts`                | Round-trip encrypt/decrypt, random IVs each call, exportKey/importKey, HMAC determinism           |
| `src/lib/auth.test.ts`                  | `fetch` mocks for signIn success/failure, signUp duplicate email handling                         |
| `src/app/contexts/AuthContext.test.tsx` | Login sets state + storage, logout clears both, session restore on remount                        |
| `src/lib/bookmarks.test.ts`             | `createBookmark` sends `user_id` + encrypted fields; `updateBookmark` PATCHes correct URL         |
| `src/lib/tags.test.ts`                  | `createTag` sends `user_id` + `name_enc` + correct `name_hmac`; `setBookmarkTags` diffs correctly |
| `src/app/hooks/useBookmarks.test.ts`    | Pagination params, `loadMore` offset, `hasMore` logic, client-side search/filter AND logic        |

### TDD workflow

This project mandates test-first development. Before implementing any feature or fixing any bug:

1. Write a failing test that captures the expected behaviour.
2. Run `npm test` and confirm it fails for the right reason (not a syntax error or import failure).
3. Implement the minimum code to make the test pass.
4. Run `npm test` again — all tests must be green before committing.

This process exists because a missing `user_id` field in `createBookmark` and `createTag` caused a Row Level Security violation in production that a request-body test would have caught immediately.

### Build

```bash
npm run build
```

Output is in `dist/`. The build fails if TypeScript type-checking fails or if any Vite transform error occurs. CI runs the build after tests — a green CI badge means both passed.

---

## 14. Self-Hosting Guide

### Build

```bash
npm install
npm run build
```

The `dist/` folder contains fully static assets (HTML, JS, CSS). No server-side rendering is involved.

### Serving the app

Deploy `dist/` to any static file server. The single-page app uses client-side routing, so your server must serve `index.html` for all paths that do not match a static file.

#### Nginx example

```nginx
server {
    listen 80;
    server_name bookmarks.example.com;
    root /var/www/better-bookmarks2/dist;
    index index.html;

    # Serve static assets directly
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy /api/* to PostgREST, stripping the /api prefix
    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### Caddy example

```caddyfile
bookmarks.example.com {
    root * /var/www/better-bookmarks2/dist
    file_server
    try_files {path} /index.html

    reverse_proxy /api/* localhost:3000 {
        uri strip_prefix /api
    }
}
```

### PostgREST configuration requirements

- PostgREST must be listening on the port your reverse proxy targets (default `3000`).
- The database must have Row Level Security enabled on all tables (`bookmarks`, `tags`, `bookmark_tags`, `thumbnail_images`). All RLS policies must scope reads and writes to the authenticated user's `user_id`.
- The following RPCs must be defined as PostgreSQL functions exposed by PostgREST: `sign_in`, `sign_up`, `change_password`, `delete_account`.
- The `bookmarks_with_tags` view must be readable by the PostgREST authenticated role.
- The UNIQUE constraint on `(user_id, name_hmac)` in the `tags` table must be in place for tag deduplication to function correctly.

### RLS considerations

Every table must have an RLS policy equivalent to the following pattern:

```sql
-- Example for the bookmarks table
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY bookmarks_user_isolation ON bookmarks
    USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub'::text);
```

The exact claim path depends on your PostgREST JWT configuration. Verify that PostgREST is extracting `sub` from the JWT and setting it as the current user context before enabling RLS.

Without RLS, a compromised JWT could access another user's ciphertext. Even though the data is encrypted, defence in depth requires RLS to be active.
