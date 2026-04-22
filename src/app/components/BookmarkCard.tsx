import { useState, useEffect } from "react";
import { ExternalLink, Play, Pencil, Bookmark as BookmarkIcon } from "lucide-react";

interface BookmarkCardProps {
  thumbnail?: string | null;
  title: string;
  url: string;
  tags: string[];
  onEdit?: () => void;
}

export function BookmarkCard({ thumbnail, title, url, tags, onEdit }: BookmarkCardProps) {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [thumbnail]);

  return (
    <div className="group bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02] hover:shadow-2xl hover:shadow-purple-500/20 flex flex-col">
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gradient-to-br from-purple-900/20 to-slate-900/20 overflow-hidden flex-shrink-0">
        {thumbnail && !imgError && /^(https?:|blob:)/i.test(thumbnail) ? (
          <img
            src={thumbnail}
            alt={title}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900/40 to-slate-900/40">
            <BookmarkIcon className="w-8 h-8 text-white/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      </div>

      {/* Content */}
      <div className="p-4 pb-3 space-y-3 flex-1">
        <h3 className="line-clamp-2 min-h-[3rem] text-white/90 transition-colors duration-300 group-hover:text-white">
          {title}
        </h3>

        <div className="flex items-center gap-2 text-white/50 transition-colors duration-300 group-hover:text-white/70">
          <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate text-sm">{url}</span>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 bg-white/5 backdrop-blur-xl border border-white/10 rounded-full text-xs text-white/60 transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:text-white/80"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action bar — lives on the card's solid dark background, always contrasted */}
      <div className="px-4 py-3 border-t border-white/10 flex items-center justify-end gap-2">
        <button
          onClick={onEdit}
          aria-label="Edit bookmark"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-xs text-white/60 hover:bg-white/10 hover:border-white/20 hover:text-white hover:scale-105 active:scale-95 transition-all duration-300"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </button>
        <button
          aria-label="Open bookmark"
          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-br from-purple-600/30 to-purple-800/30 border border-purple-500/30 rounded-full text-xs text-white/80 hover:from-purple-600/50 hover:to-purple-800/50 hover:border-purple-500/50 hover:text-white hover:scale-105 active:scale-95 transition-all duration-300"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          Open
        </button>
      </div>
    </div>
  );
}
