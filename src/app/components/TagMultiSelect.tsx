import { useState } from "react";
import { Check, ChevronDown, X, Plus } from "lucide-react";
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
import type { Tag } from "../../lib/tags";

interface TagMultiSelectProps {
  available: Tag[];
  selected: string[];           // tag IDs
  onChange: (tagIds: string[]) => void;
  onCreateTag?: (name: string) => Promise<Tag>;
}

export function TagMultiSelect({
  available,
  selected,
  onChange,
  onCreateTag,
}: TagMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id]);
  }

  const filtered = available.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );

  const showCreate =
    onCreateTag &&
    search.trim() !== "" &&
    !available.some((t) => t.name.toLowerCase() === search.trim().toLowerCase());

  const handleCreate = async () => {
    if (!onCreateTag || !search.trim()) return;
    setCreating(true);
    try {
      const newTag = await onCreateTag(search.trim());
      onChange([...selected, newTag.id]);
      setSearch("");
    } finally {
      setCreating(false);
    }
  };

  const selectedTags = available.filter((t) => selected.includes(t.id));

  return (
    <div className="w-full space-y-2">
      <Popover open={open} onOpenChange={setOpen} modal>
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
                open && "rotate-180",
              )}
            />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          avoidCollisions
          collisionPadding={16}
          className="w-(--radix-popover-trigger-width) p-0
                     bg-slate-900/95 backdrop-blur-xl border border-white/15
                     rounded-2xl shadow-2xl shadow-purple-500/20 overflow-hidden"
        >
          <Command
            shouldFilter={false}
            className="bg-transparent **:data-[slot=command-input-wrapper]:border-white/10 [&_[data-slot=command-input-wrapper]_svg]:text-white"
          >
            <CommandInput
              placeholder="Search tags…"
              value={search}
              onValueChange={setSearch}
              className="text-white/90 placeholder:text-white/40 text-sm"
            />
            <CommandList
              className="max-h-50 overflow-y-auto overscroll-contain touch-pan-y p-1"
              onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY; }}
            >
              {filtered.length === 0 && !showCreate && (
                <CommandEmpty className="py-6 text-center text-sm text-white/40">
                  No tags found.
                </CommandEmpty>
              )}
              <CommandGroup>
                {filtered.map((tag) => {
                  const isSelected = selected.includes(tag.id);
                  return (
                    <CommandItem
                      key={tag.id}
                      value={tag.id}
                      onSelect={() => toggle(tag.id)}
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
                            ? "bg-linear-to-br from-purple-600 to-purple-800 border-purple-500"
                            : "border-white/20",
                        )}
                      >
                        {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      {tag.name}
                    </CommandItem>
                  );
                })}

                {/* Inline "Create tag" option */}
                {showCreate && (
                  <CommandItem
                    value={`__create__${search}`}
                    onSelect={handleCreate}
                    disabled={creating}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl mx-1 cursor-pointer
                               text-sm text-purple-300
                               data-[selected=true]:bg-purple-500/10 data-[selected=true]:text-purple-200
                               hover:bg-purple-500/10 hover:text-purple-200
                               transition-colors duration-150"
                  >
                    <Plus className="w-4 h-4 shrink-0 text-purple-300" />
                    {creating ? `Creating "${search.trim()}"…` : `Create "${search.trim()}"`}
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1
                         bg-purple-600/20 border border-purple-500/30
                         rounded-full text-xs text-white/80 transition-all duration-200"
            >
              {tag.name}
              <button
                type="button"
                onClick={() => toggle(tag.id)}
                aria-label={`Remove ${tag.name}`}
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
