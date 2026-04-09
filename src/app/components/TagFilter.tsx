import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./ui/utils";
import type { Tag } from "../../lib/tags";

interface TagFilterProps {
  tags: Tag[];
  selected: string | null;   // tag id, or null for "All"
  onSelect: (id: string | null) => void;
}

export function TagFilter({ tags, selected, onSelect }: TagFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const baseTags = tags.slice(0, 5);
  const extraTags = tags.slice(5);
  const hasMoreTags = tags.length > 5;
  const n = extraTags.length;

  const tagVariants = {
    initial: { opacity: 0 },
    animate: (i: number) => ({
      opacity: 1,
      transition: { duration: 0.15, delay: i * 0.02 },
    }),
    exit: (i: number) => ({
      opacity: 0,
      transition: { duration: 0.12, delay: (n - 1 - i) * 0.015 },
    }),
  };

  const pillBase =
    "px-4 py-2 backdrop-blur-xl border rounded-full transition-all duration-300 hover:scale-105 active:scale-95 text-sm";
  const pillActive =
    "bg-white/20 border-white/40 text-white";
  const pillInactive =
    "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20 hover:text-white";

  return (
    <motion.div
      layout
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 overflow-hidden"
    >
      <motion.div layout="position" className="flex items-center justify-between mb-3">
        <h3 className="text-white/90 text-sm">Filter by Tags</h3>
        {hasMoreTags && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-white/60 hover:text-white/90 transition-colors duration-300 text-sm"
          >
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="flex items-center"
            >
              <ChevronDown className="w-4 h-4" />
            </motion.span>
            {isExpanded ? "Show Less" : "Show More"}
          </button>
        )}
      </motion.div>

      <motion.div layout="position" className="flex flex-wrap gap-2">
        <button
          onClick={() => onSelect(null)}
          className={cn(pillBase, selected === null ? pillActive : pillInactive)}
        >
          All
        </button>

        {baseTags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => onSelect(selected === tag.id ? null : tag.id)}
            className={cn(pillBase, selected === tag.id ? pillActive : pillInactive)}
          >
            {tag.name}
          </button>
        ))}

        <AnimatePresence initial={false}>
          {isExpanded &&
            extraTags.map((tag, i) => (
              <motion.button
                key={tag.id}
                custom={i}
                variants={tagVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onClick={() => onSelect(selected === tag.id ? null : tag.id)}
                className={cn(pillBase, selected === tag.id ? pillActive : pillInactive)}
              >
                {tag.name}
              </motion.button>
            ))}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
