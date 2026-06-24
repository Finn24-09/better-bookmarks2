import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ScrollToTopButton } from './ScrollToTopButton';

function setScroll(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
}

function setHeight(h: number) {
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true });
}

beforeEach(() => {
  setScroll(0);
  setHeight(768);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(window, 'scrollTo');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function scrollDownPastViewport() {
  act(() => {
    setScroll(800); // > innerHeight (768)
    window.dispatchEvent(new Event('scroll'));
  });
}

// Query the button by DOM, not by accessible role: when the button is `inert`
// it is removed from the accessibility tree, so getByRole cannot (and should
// not) find it. The shown-state tests below intentionally use getByRole, which
// asserts the button IS accessible once visible.
function getButton(): HTMLButtonElement {
  const btn = document.querySelector('button[aria-label="Scroll to top"]');
  if (!btn) throw new Error('Scroll-to-top button not found');
  return btn as HTMLButtonElement;
}

describe('ScrollToTopButton', () => {
  it('renders a button labelled "Scroll to top"', () => {
    render(<ScrollToTopButton />);
    expect(getButton()).toBeInTheDocument();
  });

  it('is inert (hidden) by default before scrolling', () => {
    render(<ScrollToTopButton />);
    expect(getButton()).toHaveAttribute('inert');
  });

  it('becomes interactive (inert removed) after scrolling past one viewport', () => {
    render(<ScrollToTopButton />);
    scrollDownPastViewport();
    const button = screen.getByRole('button', { name: /scroll to top/i });
    expect(button).not.toHaveAttribute('inert');
  });

  it('becomes inert again after scrolling back below the viewport', () => {
    render(<ScrollToTopButton />);
    scrollDownPastViewport();
    expect(getButton()).not.toHaveAttribute('inert'); // shown

    act(() => {
      setScroll(100); // back above the fold
      window.dispatchEvent(new Event('scroll'));
    });
    expect(getButton()).toHaveAttribute('inert'); // hidden again
  });

  it('scrolls smoothly to the top on click', () => {
    render(<ScrollToTopButton />);
    scrollDownPastViewport();
    fireEvent.click(screen.getByRole('button', { name: /scroll to top/i }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('scrolls instantly under prefers-reduced-motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }) as MediaQueryList);

    render(<ScrollToTopButton />);
    scrollDownPastViewport();
    fireEvent.click(screen.getByRole('button', { name: /scroll to top/i }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
  });
});
