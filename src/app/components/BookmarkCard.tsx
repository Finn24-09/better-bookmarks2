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
    <div className="group relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02] hover:shadow-2xl hover:shadow-purple-500/20">
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gradient-to-br from-purple-900/20 to-slate-900/20 overflow-hidden">
        {thumbnail && !imgError ? (
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Action Buttons - Visible on mobile, overlay on hover for desktop */}
        <div className="absolute top-3 right-3 flex gap-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300">
          <button onClick={onEdit} className="w-10 h-10 bg-white/10 border border-white/20 rounded-full flex items-center justify-center hover:bg-white/20 hover:scale-110 transition-all duration-300 active:scale-95">
            <Pencil className="w-4 h-4 text-white" />
          </button>
        </div>

        {/* Play Icon Overlay - Center on desktop hover */}
        <div className="absolute inset-0 items-center justify-center hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
          <button
            aria-label="Open bookmark"
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            className="w-16 h-16 bg-white/10 border border-white/20 rounded-full flex items-center justify-center hover:bg-white/20 hover:scale-110 transition-all duration-300 pointer-events-auto"
          >
            <Play className="w-8 h-8 text-white fill-white ml-1" />
          </button>
        </div>

        {/* Play Icon - Always visible on mobile, bottom-right */}
        <div className="absolute bottom-3 right-3 md:hidden">
          <button
            aria-label="Open bookmark"
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            className="w-12 h-12 bg-white/10 border border-white/20 rounded-full flex items-center justify-center active:scale-95 transition-transform duration-300"
          >
            <Play className="w-6 h-6 text-white fill-white ml-0.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Title */}
        <h3 className="line-clamp-2 min-h-[3rem] text-white/90 transition-colors duration-300 group-hover:text-white">
          {title}
        </h3>

        {/* URL */}
        <div className="flex items-center gap-2 text-white/50 transition-colors duration-300 group-hover:text-white/70">
          <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate text-sm">{url}</span>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
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
    </div>
  );
}
