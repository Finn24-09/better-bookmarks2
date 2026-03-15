import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface TagFilterProps {
  tags: string[];
}

export function TagFilter({ tags }: TagFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const visibleTags = isExpanded ? tags : tags.slice(0, 5);
  const hasMoreTags = tags.length > 5;

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white/90 text-sm">Filter by Tags</h3>
        {hasMoreTags && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-white/60 hover:text-white/90 transition-colors duration-300 text-sm"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-4 h-4" />
                Show Less
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                Show More
              </>
            )}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="px-4 py-2 bg-white/10 backdrop-blur-xl border border-white/20 rounded-full text-white transition-all duration-300 hover:bg-white/20 hover:scale-105 active:scale-95">
          All
        </button>
        {visibleTags.map((tag) => (
          <button
            key={tag}
            className="px-4 py-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-full text-white/70 transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:text-white hover:scale-105 active:scale-95"
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
}
