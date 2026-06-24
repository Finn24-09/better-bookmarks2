import { useState, useEffect } from "react";

/**
 * Returns true once the window is scrolled past `threshold` px (default: one
 * viewport height). Used to reveal a scroll-to-top control only when there is
 * a screenful of content above the fold worth returning to.
 *
 * The scroll/resize handler is registered passive (we never preventDefault) and
 * rAF-throttled so high-frequency scroll events coalesce to at most one state
 * evaluation per frame.
 */
export function useShowOnScroll(threshold?: number): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let ticking = false;
    let rafId = 0;

    const evaluate = () => {
      ticking = false;
      const limit = threshold ?? window.innerHeight;
      // setShow with a precomputed primitive — React bails out of the re-render
      // when the value is unchanged (Object.is), so no functional updater is
      // needed (keeps clear of the no-side-effects-in-setState invariant).
      setShow(window.scrollY > limit);
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafId = window.requestAnimationFrame(evaluate);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    evaluate(); // initialise on mount / when the threshold changes

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      // Removing the listeners stops new frames being scheduled, but a frame
      // already requested before unmount would still fire and call setShow on
      // an unmounted component. Cancelling it mirrors the IntersectionObserver
      // disconnect() discipline in App.tsx.
      window.cancelAnimationFrame(rafId);
    };
  }, [threshold]);

  return show;
}
