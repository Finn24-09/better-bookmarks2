import { Search } from "lucide-react";

export function SearchBar() {
  return (
    <div className="relative w-full">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
      <input
        type="text"
        placeholder="Search bookmarks..."
        className="w-full pl-12 pr-4 py-3.5 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl text-white placeholder:text-white/40 transition-all duration-300 hover:bg-white/10 focus:bg-white/10 focus:border-white/20 focus:outline-none"
      />
    </div>
  );
}
