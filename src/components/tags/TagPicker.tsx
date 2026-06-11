import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAppData } from "../../context/AppDataContext";
import { useAuth } from "../../context/AuthContext";
import { createTag } from "../../services/tags";
import { TagChip } from "./TagChip";

interface TagPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

// Default color assigned to tags created inline from the picker. The
// admin can recolor via the TagsPage once the tag exists. Slate-500
// — neutral enough not to clash on a card, distinctive enough to be
// noticed as "not yet styled".
const INLINE_CREATE_DEFAULT_COLOR = "#64748b";

// Lower-cased, no-punctuation match used for autocomplete. So
// "user-stories" / "User Stories" / "USERSTORIES" all collide on the
// same canonical key.
function canonicalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Autocomplete picker for the multi-tag field on tickets. Type to
// filter the existing tag vocabulary; press Enter (or click) to
// add a match; if nothing matches, the dropdown surfaces a
// "+ Create '<input>'" row that persists a new tag with a default
// color (recolor later via the TagsPage).
export function TagPicker({ value, onChange, disabled }: TagPickerProps) {
  const { t } = useTranslation();
  const { tags, getTagById } = useAppData();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click — same pattern as native datalist UX.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selectedIds = useMemo(() => new Set(value), [value]);

  // Sorted suggestion list: case-insensitive contains match on the
  // query, with already-selected tags filtered out. When the query
  // exactly matches an existing tag by canonical name we hide the
  // "Create" row to avoid duplicates.
  const { suggestions, exactMatch } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const canon = canonicalize(q);
    const list = tags
      .filter((tg) => !selectedIds.has(tg.id))
      .filter((tg) => (q ? tg.name.toLowerCase().includes(q) : true))
      .slice(0, 20);
    const exact = q.length > 0 && tags.some((tg) => canonicalize(tg.name) === canon);
    return { suggestions: list, exactMatch: exact };
  }, [tags, query, selectedIds]);

  function add(id: string) {
    if (selectedIds.has(id)) return;
    onChange([...value, id]);
    setQuery("");
    setHighlight(0);
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  async function createInline() {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const id = await createTag({
        name,
        color: INLINE_CREATE_DEFAULT_COLOR,
        createdBy: user?.uid ?? null,
      });
      add(id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Tag inline-create failed", err);
    } finally {
      setCreating(false);
    }
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, suggestions.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions[highlight]) {
        add(suggestions[highlight].id);
      } else if (query.trim() && !exactMatch) {
        createInline();
      }
    } else if (e.key === "Backspace" && !query && value.length > 0) {
      // Quick-undo: backspace on an empty input pops the last chip.
      remove(value[value.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className="input flex flex-wrap items-center gap-1 min-h-[2.25rem] cursor-text"
        onClick={() => setOpen(true)}
      >
        {value.map((id) => {
          const tag = getTagById(id);
          if (!tag) return null;
          return (
            <TagChip
              key={id}
              tag={tag}
              size="sm"
              removable={!disabled}
              onRemove={() => remove(id)}
            />
          );
        })}
        <input
          type="text"
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={handleKey}
          onFocus={() => setOpen(true)}
          placeholder={value.length === 0 ? t("tags.picker.placeholder") : ""}
          disabled={disabled}
        />
      </div>

      {open && (suggestions.length > 0 || (query.trim() && !exactMatch)) && (
        <ul
          className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-lg ring-1 ring-surface-200 bg-white shadow-card-hover dark:bg-surface-800 dark:ring-surface-700"
          role="listbox"
        >
          {suggestions.map((tg, idx) => {
            const active = idx === highlight;
            return (
              <li key={tg.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => add(tg.id)}
                  className={
                    "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 " +
                    (active
                      ? "bg-surface-100 dark:bg-surface-700"
                      : "hover:bg-surface-50 dark:hover:bg-surface-700/60")
                  }
                >
                  <TagChip tag={tg} size="sm" />
                </button>
              </li>
            );
          })}
          {query.trim() && !exactMatch && (
            <li>
              <button
                type="button"
                onMouseEnter={() => setHighlight(suggestions.length)}
                onClick={createInline}
                disabled={creating}
                className={
                  "w-full text-left px-3 py-1.5 text-xs italic flex items-center gap-1.5 " +
                  (highlight === suggestions.length
                    ? "bg-surface-100 dark:bg-surface-700"
                    : "hover:bg-surface-50 dark:hover:bg-surface-700/60")
                }
              >
                <span className="text-blue-600 dark:text-blue-400">+</span>
                {t("tags.picker.create", { name: query.trim() })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
