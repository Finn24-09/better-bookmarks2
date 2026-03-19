import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface TagFilterProps {
  tags: string[];
}

export function TagFilter({ tags }: TagFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const baseTags = tags.slice(0, 5);
  const extraTags = tags.slice(5);
  const hasMoreTags = tags.length > 5;
  const n = extraTags.length;

  // Only opacity — no scale — so tags occupy their full natural height the moment
  // they're added to the DOM, giving the outer layout FLIP an accurate "after" height.
  const tagVariants = {
    initial: { opacity: 0 },
    animate: (i: number) => ({
      opacity: 1,
      transition: { duration: 0.15, delay: i * 0.02 },       // enter: first → last
    }),
    exit: (i: number) => ({
      opacity: 0,
      transition: { duration: 0.12, delay: (n - 1 - i) * 0.015 }, // exit: last → first
    }),
  };

  return (
    // layout — smooth height FLIP on the outer card
    <motion.div
      layout
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 overflow-hidden"
    >
      {/* layout="position" — corrects for the parent's scaleY so the header stays still */}
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

      {/* layout="position" — corrects the flex container so tag buttons don't jump */}
      <motion.div layout="position" className="flex flex-wrap gap-2">
        <button className="px-4 py-2 bg-white/10 backdrop-blur-xl border border-white/20 rounded-full text-white transition-all duration-300 hover:bg-white/20 hover:scale-105 active:scale-95">
          All
        </button>

        {baseTags.map((tag) => (
          <button
            key={tag}
            className="px-4 py-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-full text-white/70 transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:text-white hover:scale-105 active:scale-95"
          >
            {tag}
          </button>
        ))}

        {/* mode="popLayout" — exits are popped out of flow immediately, so the parent
            FLIP and the exit fade can run concurrently without one cutting the other off */}
        <AnimatePresence initial={false}>
          {isExpanded &&
            extraTags.map((tag, i) => (
              <motion.button
                key={tag}
                custom={i}
                variants={tagVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="px-4 py-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-full text-white/70 transition-colors duration-300 hover:bg-white/10 hover:border-white/20 hover:text-white active:scale-95"
              >
                {tag}
              </motion.button>
            ))}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
