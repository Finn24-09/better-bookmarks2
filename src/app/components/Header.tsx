import { User } from "lucide-react";

export function Header() {
  return (
    <div className="sticky top-0 z-50 py-4 md:py-5 bg-white/5 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 flex items-center justify-between">
        <h1 className="text-white drop-shadow-lg">Better Bookmarks 2</h1>
        <button className="w-12 h-12 bg-white/5 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center hover:bg-white/10 hover:border-white/20 hover:scale-110 transition-all duration-300 active:scale-95">
          <User className="w-6 h-6 text-white/80" />
        </button>
      </div>
    </div>
  );
}
