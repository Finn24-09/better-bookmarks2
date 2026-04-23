import { GitFork } from "lucide-react";

export function FloatingFooter() {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-full px-5 py-2.5 flex items-center gap-3 shadow-xl">
        <span className="text-white/60 text-xs">v{__APP_VERSION__}</span>
        <div className="w-px h-4 bg-white/20" />
        <a
          href="https://github.com/finn24-09"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-white/60 hover:text-white/90 transition-colors duration-300"
        >
          <GitFork className="w-4 h-4" />
          <span className="text-xs">@finn24-09</span>
        </a>
      </div>
    </div>
  );
}
