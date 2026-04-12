import '@testing-library/jest-dom';
import { webcrypto } from 'node:crypto';

// jsdom does not ship a SubtleCrypto implementation; use Node's built-in.
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
  writable: true,
});

// Radix UI components (Popover, DropdownMenu, Dialog) use ResizeObserver
// internally for positioning — jsdom doesn't provide it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// App uses IntersectionObserver for the infinite-scroll sentinel.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}

// cmdk (used inside TagMultiSelect) calls scrollIntoView in a layout effect —
// jsdom does not implement it on element prototypes.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Radix UI reads window.matchMedia for some responsive behaviours.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
