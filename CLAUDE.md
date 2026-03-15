# Better Bookmarks 2 — Claude Context

## Project Overview
A React bookmark management app with a dark glassmorphic design. Currently in prototype/demo stage with static dummy data.

**Stack:** React 18 + TypeScript + Vite + Tailwind CSS v4 + lucide-react icons
**Key deps:** react-hook-form, react-dnd, next-themes, sonner (toasts), motion (animations), Radix UI components

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
