import { ArrowUp } from "lucide-react";
import { useShowOnScroll } from "../hooks/useShowOnScroll";

/**
 * Glassmorphic "scroll to top" control. Self-contained: owns its grid-aligned
 * fixed wrapper (the left-edge mirror of the AddBookmark FAB) and its own
 * visibility logic, so it drops into App.tsx with no props.
 *
 * Revealed once the user has scrolled past one viewport. Hidden state uses the
 * `inert` attribute alone — it removes the control from both the focus order and
 * the accessibility tree, so a separate aria-hidden would be redundant.
 */
export function ScrollToTopButton() {
  const show = useShowOnScroll();

  const handleClick = () => {
    // Read prefers-reduced-motion at click time. Use 'instant' (not 'auto'):
    // 'auto' defers to the CSS scroll-behavior property and would still animate
    // if the page ever set scroll-behavior: smooth globally.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "instant" : "smooth" });
  };

  // The wrapper mirrors the AddBookmark FAB wrapper in App.tsx but with
  // justify-start. It deliberately omits the right-scrollbar-width padding
  // compensation the Add FAB needs: scroll-lock only shifts the right edge, so
  // a left-aligned control is unaffected.
  return (
    <div className="fixed bottom-20 left-0 right-0 z-40 pointer-events-none">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="flex justify-start">
          <button
            type="button"
            aria-label="Scroll to top"
            inert={!show}
            onClick={handleClick}
            className={`pointer-events-auto w-14 h-14 md:w-16 md:h-16 bg-white/5 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center text-white/80 shadow-xl transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:scale-110 active:scale-95 ${
              show ? "opacity-100 scale-100" : "opacity-0 scale-95"
            }`}
          >
            <ArrowUp className="w-7 h-7 md:w-8 md:h-8" strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
