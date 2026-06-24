import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShowOnScroll } from './useShowOnScroll';

function setScroll(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
}

function setHeight(h: number) {
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true });
}

beforeEach(() => {
  setScroll(0);
  setHeight(768);
  // Run rAF synchronously so a dispatched scroll flushes the state update
  // within the surrounding act(). Return a non-zero handle so the
  // cancel-on-unmount assertion has something to cancel.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useShowOnScroll', () => {
  it('returns false initially when not scrolled', () => {
    const { result } = renderHook(() => useShowOnScroll());
    expect(result.current).toBe(false);
  });

  it('returns true after scrolling past one viewport', () => {
    const { result } = renderHook(() => useShowOnScroll());
    act(() => {
      setScroll(800); // > innerHeight (768)
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(true);
  });

  it('returns false again when scrolled back under the threshold', () => {
    const { result } = renderHook(() => useShowOnScroll());
    act(() => {
      setScroll(800);
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(true);

    act(() => {
      setScroll(100);
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(false);
  });

  it('respects a custom numeric threshold', () => {
    const { result } = renderHook(() => useShowOnScroll(300));
    act(() => {
      setScroll(350); // > 300, but below the default innerHeight (768)
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(true);
  });

  it('removes scroll and resize listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useShowOnScroll());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('cancels a pending animation frame on unmount', () => {
    const { unmount } = renderHook(() => useShowOnScroll());
    act(() => {
      setScroll(800);
      window.dispatchEvent(new Event('scroll')); // assigns the rAF handle
    });
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
