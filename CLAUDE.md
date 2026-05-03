# Better Bookmarks 2 — Claude Context

## Project Overview
A self-hosted React bookmark manager with a dark glassmorphic design, backed by PostgreSQL + PostgREST with client-side AES-256-GCM end-to-end encryption. The server stores only ciphertext and never holds an encryption key.

**Stack:** React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + lucide-react icons  
**Key deps:** react-hook-form, react-dnd, next-themes, sonner (toasts), motion (animations), Radix UI components, react-router v7  
**Test stack:** Vitest 4 + jsdom + @testing-library/react + @testing-library/jest-dom

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
npm test            # single run (CI / before committing)
npm run test:watch  # watch mode during development
```

**Test file locations — mirror the source tree:**
| Source | Test |
|---|---|
| `src/lib/foo.ts` | `src/lib/foo.test.ts` |
| `src/app/hooks/useBar.ts` | `src/app/hooks/useBar.test.ts` |
| `src/app/contexts/BazContext.tsx` | `src/app/contexts/BazContext.test.tsx` |

**What to test:**
- `src/lib/crypto.ts` — round-trip encrypt/decrypt, random IVs, exportKey/importKey, HMAC determinism
- `src/lib/auth.ts` — fetch mocks for signIn success/failure, signUp duplicate email
- `src/app/contexts/AuthContext.tsx` — login sets state, logout clears both token and key, no persistence to storage
- `src/lib/bookmarks.ts` — createBookmark sends `user_id` + encrypted fields; updateBookmark sends PATCH to correct URL
- `src/lib/tags.ts` — createTag sends `user_id` + `name_enc` + correct `name_hmac`; setBookmarkTags diffs correctly
- `src/app/hooks/useBookmarks.ts` — pagination params, loadMore offset, hasMore logic, client-side search/filter/AND logic

**Why this matters:** The missing `user_id` bug in `createBookmark` and `createTag` that caused the RLS violation in production was not caught because these tests were not written first. Tests for request body content would have failed immediately and exposed the omission before any manual testing was needed.

---

## Architecture & Routing

```
src/
├── main.tsx                          # React 19 entry; mounts AuthProvider + router
├── app/
│   ├── router.tsx                    # Two routes: / (App) and /login (AuthPage)
│   ├── App.tsx                       # Root layout: search/filter state, infinite scroll, bookmark grid
│   ├── AuthPage.tsx                  # Animated sign in / sign up (desktop overlay, mobile tabs)
│   ├── contexts/AuthContext.tsx      # In-memory auth state: token, userId, email, cryptoKey
│   ├── hooks/useBookmarks.ts         # Pagination, search/filter, thumbnail cache, loadMore
│   └── components/                   # UI components (see Component Inventory below)
└── lib/
    ├── api.ts          # apiFetch wrapper, in-memory JWT, error sanitization
    ├── auth.ts         # signIn / signUp / changePassword / deleteAccount RPCs
    ├── bookmarks.ts    # getBookmarks / createBookmark / updateBookmark / deleteBookmark / reencryptBookmark
    ├── tags.ts         # getTags / createTag / deleteTag / reencryptTag / setBookmarkTags
    ├── thumbnails.ts   # compressImage / uploadThumbnail / fetchThumbnailObjectUrl / reencryptThumbnail
    ├── crypto.ts       # deriveKey / encrypt / decrypt / encryptBinary / decryptBinary / computeHmac
    ├── export.ts       # exportBookmarks / exportToCsv / triggerDownload
    ├── csv.ts          # parseCsvText / validateCsvFile (RFC 4180, no deps)
    └── importJson.ts   # parseJsonExport / validateJsonFile
```

**Routing:** React Router v7. `/` requires auth (redirects to `/login` if no session). `/login` redirects to `/` if already authenticated.

**Dev proxy:** Vite proxies `/api/*` → `http://localhost:3000` (strips `/api` prefix). PostgREST must run on port 3000 locally. Production uses the Nginx reverse proxy in `docker/frontend/nginx.conf`.

---

## Security Model — CRITICAL INVARIANTS

Never break these. They are the core of the zero-knowledge architecture.

- **Encryption key** — derived via `deriveKey(password, email)` (PBKDF2-SHA256, 600k iterations, non-extractable). Stored only in `AuthContext` state. **Never written to localStorage, sessionStorage, cookies, or sent over the network.**
- **JWT** — stored only in a module-level variable in `api.ts`. **Never written to any persistent storage.** Both key and token are wiped on logout.
- **Encrypted fields** — `title_enc`, `url_enc`, `thumbnail_url_enc`, `name_enc`, `data_enc`, `original_name_enc`. Always call `encrypt(key, value)` before sending and `decrypt(key, value)` after receiving. Never send plaintext to the API.
- **HMAC tag deduplication** — `name_hmac = HMAC-SHA256(userId, tagName)`. The DB enforces `UNIQUE(user_id, name_hmac)` for tags without ever seeing the plaintext name. Always include `name_hmac` when creating a tag.
- **`user_id` in mutations** — always include `user_id` in POST bodies for `bookmarks`, `tags`, and `thumbnail_images`. RLS enforces ownership but PostgREST needs the field in the body.
- **Password change = key rotation** — changing password requires re-encrypting ALL bookmarks, tags, and thumbnails with the new key before calling the `change_password` RPC. The order matters: re-encrypt data first, then update credentials.
- **API error sanitization** — only 400/401/409 relay PostgREST messages. All other errors get a generic message. Do not change this without understanding the schema leakage risk.

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
| `/api/email/request-delete` | POST | Sends a confirmation email with a 15-min token |
| `/api/email/confirm-delete` | POST | Token + password confirmed; SECURITY DEFINER cascade delete |

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
| `src/app/components/DeleteAccountModal.tsx` | Password-confirmed hard account delete |
| `src/app/components/ui/` | Full Radix UI primitive set (shadcn-style wrappers) |

---

## Styling Conventions
- Use Tailwind utility classes exclusively — no custom CSS unless unavoidable
- Radix UI primitives are available via `src/app/components/ui/`
- Icons exclusively from `lucide-react`
- No emoji in UI unless explicitly requested
