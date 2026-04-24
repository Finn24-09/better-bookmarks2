import { Plus } from "lucide-react";

interface AddBookmarkButtonProps {
  onClick?: () => void;
}

export function AddBookmarkButton({ onClick }: AddBookmarkButtonProps) {
  return (
    <button onClick={onClick} aria-label="Add bookmark" className="w-14 h-14 md:w-16 md:h-16 bg-linear-to-br from-purple-600 to-purple-800 backdrop-blur-xl border border-white/20 rounded-full flex items-center justify-center hover:scale-110 hover:shadow-2xl hover:shadow-purple-500/50 transition-all duration-300 active:scale-95 shadow-xl">
      <Plus className="w-7 h-7 md:w-8 md:h-8 text-white" strokeWidth={2.5} />
    </button>
  );
}
