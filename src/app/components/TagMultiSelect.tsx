import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
  CommandEmpty,
} from "./ui/command";
import { cn } from "./ui/utils";

interface TagMultiSelectProps {
  available: string[];
  selected: string[];
  onChange: (tags: string[]) => void;
}

export function TagMultiSelect({ available, selected, onChange }: TagMultiSelectProps) {
  const [open, setOpen] = useState(false);

  function toggle(tag: string) {
    onChange(
      selected.includes(tag)
        ? selected.filter((t) => t !== tag)
        : [...selected, tag]
    );
  }

  return (
    <div className="w-full space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl px-4
                       flex items-center justify-between text-sm text-white/90
                       hover:bg-white/10 hover:border-white/20
                       focus:outline-none focus:border-white/30 focus:bg-white/10
                       transition-all duration-300"
          >
            <span className={cn(selected.length === 0 && "text-white/40")}>
              {selected.length === 0
                ? "Select tags…"
                : `${selected.length} tag${selected.length !== 1 ? "s" : ""} selected`}
            </span>
            <ChevronDown
              className={cn(
                "w-4 h-4 text-white/40 transition-transform duration-300",
                open && "rotate-180"
              )}
            />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          avoidCollisions
          collisionPadding={16}
          className="w-[var(--radix-popover-trigger-width)] p-0
                     bg-slate-900/95 backdrop-blur-xl border border-white/15
                     rounded-2xl shadow-2xl shadow-purple-500/20 overflow-hidden"
        >
          <Command
            filter={(value, search) =>
              value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
            className="bg-transparent [&_[data-slot=command-input-wrapper]]:border-white/10 [&_[data-slot=command-input-wrapper]_svg]:text-white"
          >
            <CommandInput
              placeholder="Search tags…"
              className="text-white/90 placeholder:text-white/40 text-sm"
            />
            <CommandList
              className="max-h-[200px] overflow-y-auto overscroll-contain touch-pan-y p-1"
              onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY; }}
            >
              <CommandEmpty className="py-6 text-center text-sm text-white/40">
                No tags found.
              </CommandEmpty>
              <CommandGroup>
                {available.map((tag) => {
                  const isSelected = selected.includes(tag);
                  return (
                    <CommandItem
                      key={tag}
                      value={tag}
                      onSelect={() => toggle(tag)}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl mx-1 cursor-pointer
                                 text-sm text-white/70
                                 data-[selected=true]:bg-white/10 data-[selected=true]:text-white/90
                                 hover:bg-white/10 hover:text-white/90
                                 transition-colors duration-150"
                    >
                      <div
                        className={cn(
                          "w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all duration-150",
                          isSelected
                            ? "bg-gradient-to-br from-purple-600 to-purple-800 border-purple-500"
                            : "border-white/20"
                        )}
                      >
                        {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      {tag}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1
                         bg-purple-600/20 border border-purple-500/30
                         rounded-full text-xs text-white/80 transition-all duration-200"
            >
              {tag}
              <button
                type="button"
                onClick={() => toggle(tag)}
                aria-label={`Remove ${tag}`}
                className="w-4 h-4 rounded-full flex items-center justify-center
                           hover:bg-white/20 transition-colors duration-150 shrink-0"
              >
                <X className="w-2.5 h-2.5 text-white/60" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
