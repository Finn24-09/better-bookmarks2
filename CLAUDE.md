# Better Bookmarks 2 — Claude Context

## Project Overview
A React bookmark management app with a dark glassmorphic design, backed by PostgreSQL + PostgREST with client-side E2E encryption.

**Stack:** React 18 + TypeScript + Vite + Tailwind CSS v4 + lucide-react icons
**Key deps:** react-hook-form, react-dnd, next-themes, sonner (toasts), motion (animations), Radix UI components
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
npm test          # single run (CI / before committing)
npm run test:watch  # watch mode during development
```

**Test file locations — mirror the source tree:**
| Source | Test |
|---|---|
| `src/lib/foo.ts` | `src/lib/foo.test.ts` |
| `src/app/hooks/useBar.ts` | `src/app/hooks/useBar.test.ts` |
| `src/app/contexts/BazContext.tsx` | `src/app/contexts/BazContext.test.tsx` |

**What to test (from the project plan):**
- `src/lib/crypto.ts` — round-trip encrypt/decrypt, random IVs, exportKey/importKey, HMAC determinism
- `src/lib/auth.ts` — fetch mocks for signIn success/failure, signUp duplicate email
- `src/app/contexts/AuthContext.tsx` — login sets state + storage, logout clears both, session restore on remount
- `src/lib/bookmarks.ts` — createBookmark sends `user_id` + encrypted fields; updateBookmark sends PATCH to correct URL
- `src/lib/tags.ts` — createTag sends `user_id` + `name_enc` + correct `name_hmac`; setBookmarkTags diffs correctly
- `src/app/hooks/useBookmarks.ts` — pagination params, loadMore offset, hasMore logic, client-side search/filter/AND logic

**Why this matters:** The missing `user_id` bug in `createBookmark` and `createTag` that caused the RLS violation in production was not caught because these tests were not written first. Tests for request body content would have failed immediately and exposed the omission before any manual testing was needed.

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
| `src/app/App.tsx` | Root — layout shell, dummy data, grid |
| `src/app/components/Header.tsx` | Sticky glassmorphic header, title + user icon |
| `src/app/components/SearchBar.tsx` | Full-width glassmorphic search input |
| `src/app/components/TagFilter.tsx` | Collapsible tag pill panel (shows 5, expand for all) |
| `src/app/components/BookmarkCard.tsx` | Glassmorphic card: aspect-video thumbnail, title, URL, tags |
| `src/app/components/AddBookmarkButton.tsx` | Purple gradient FAB with Plus icon |
| `src/app/components/FloatingFooter.tsx` | Fixed centered pill: version + GitHub link |
| `src/app/components/figma/ImageWithFallback.tsx` | `<img>` with SVG error state fallback |
| `src/styles/theme.css` | CSS custom properties for light/dark theme + Tailwind theme export |

---

## Styling Conventions
- Use Tailwind utility classes exclusively — no custom CSS unless unavoidable
- Radix UI primitives are available via `src/app/components/ui/`
- Icons exclusively from `lucide-react`
- No emoji in UI unless explicitly requested
