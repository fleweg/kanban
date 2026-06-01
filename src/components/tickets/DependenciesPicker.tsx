import { useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useAppData } from "../../context/AppDataContext";
import { TypeIcon } from "../issueTypes/TypeIcon";
import { dependenciesAreCyclic } from "../../lib/dependencies";
import { cn } from "../../lib/utils";
import { getTeamColorClasses } from "../../lib/teams";
import type { Ticket } from "../../types";

interface DependenciesPickerProps {
  // The ticket being edited. Null when creating a new ticket — in
  // that case any other ticket is a valid dep candidate (no cycle
  // risk yet since the new id doesn't exist in the graph).
  ownerId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}

// Type-ahead picker for the "Depends on" field. Renders the current
// dependencies as chips and an input that filters live across:
//   - tickets in any team (cross-team deps are allowed)
//   - non-completed only (status !== workflow.completedColumnId)
//   - excludes self + already-selected + cycle-creating candidates
export function DependenciesPicker({ ownerId, value, onChange }: DependenciesPickerProps) {
  const { tickets, workflow, getTeamById } = useAppData();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputId = useId();
  // Track which option is "active" for keyboard nav.
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(() => {
    const m = new Map<string, Ticket>();
    for (const t of tickets) m.set(t.id, t);
    return m;
  }, [tickets]);

  const completedColId = workflow?.completedColumnId;

  // Candidate list: all tickets, minus completed / self / selected /
  // cycle-creators. The match-by-query happens on top of this.
  const candidates = useMemo(() => {
    const selected = new Set(value);
    return tickets.filter((t) => {
      if (ownerId && t.id === ownerId) return false;
      if (selected.has(t.id)) return false;
      // Hide tickets in the workflow's completion column.
      if (completedColId && t.status === completedColId) return false;
      if (ownerId && dependenciesAreCyclic(tickets, ownerId, t.id)) return false;
      return true;
    });
  }, [tickets, value, ownerId, completedColId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates.slice(0, 8); // top of list when empty
    return candidates
      .filter((t) => t.title.toLowerCase().includes(q))
      .slice(0, 12);
  }, [candidates, query]);

  function addDep(id: string) {
    if (!id || value.includes(id)) return;
    onChange([...value, id]);
    setQuery("");
    setActiveIdx(0);
  }

  function removeDep(id: string) {
    onChange(value.filter((d) => d !== id));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const target = filtered[activeIdx];
      if (target) {
        e.preventDefault();
        addDep(target.id);
      }
    } else if (e.key === "Escape") {
      setFocused(false);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Backspace" && query === "" && value.length > 0) {
      // Quick remove: backspace on empty input pops the last dep.
      removeDep(value[value.length - 1]);
    }
  }

  // Hide the dropdown when focus leaves the whole picker. Tiny
  // setTimeout so mousedown on a dropdown item can still register
  // before blur triggers a re-render that unmounts it.
  function onBlur() {
    setTimeout(() => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(document.activeElement)) {
        setFocused(false);
      }
    }, 0);
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg ring-1 ring-surface-200 dark:ring-surface-700 bg-white dark:bg-surface-800 px-2 py-1.5 focus-within:ring-2 focus-within:ring-blue-400 dark:focus-within:ring-blue-500">
        {value.map((id) => {
          const t = byId.get(id);
          if (!t) {
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 rounded-md bg-surface-100 px-2 py-1 text-xs text-surface-500 dark:bg-surface-800 dark:text-surface-400"
              >
                <span className="italic">deleted</span>
                <button
                  type="button"
                  onClick={() => removeDep(id)}
                  className="text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
                  aria-label="Remove deleted dependency"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          }
          const team = getTeamById(t.teamId);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 rounded-md bg-surface-100 ring-1 ring-surface-200 px-2 py-0.5 text-xs text-surface-700 dark:bg-surface-700 dark:ring-surface-600 dark:text-surface-100"
            >
              <TypeIcon type={t.type} size="sm" />
              <span className="truncate max-w-[180px]">{t.title}</span>
              {team && (
                <span className={cn("chip text-[10px] py-0", getTeamColorClasses(team.color))}>
                  {team.name}
                </span>
              )}
              <button
                type="button"
                onClick={() => removeDep(id)}
                className="text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
                aria-label={`Remove dependency on ${t.title}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <input
          id={inputId}
          type="text"
          className="flex-1 min-w-[120px] bg-transparent outline-none border-0 text-sm placeholder:text-surface-400 dark:text-surface-100"
          placeholder={value.length === 0 ? "Search a ticket to depend on…" : "Add another…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
      </div>

      {focused && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg bg-white shadow-pop ring-1 ring-surface-200 dark:bg-surface-800 dark:ring-surface-700"
        >
          {filtered.map((t, i) => {
            const team = getTeamById(t.teamId);
            const active = i === activeIdx;
            return (
              <li
                key={t.id}
                role="option"
                aria-selected={active}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm cursor-pointer",
                  active
                    ? "bg-blue-50 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100"
                    : "text-surface-800 dark:text-surface-100 hover:bg-surface-50 dark:hover:bg-surface-700/60",
                )}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  // Use mousedown not click so the input doesn't blur
                  // first and tear down the dropdown before the
                  // selection registers.
                  e.preventDefault();
                  addDep(t.id);
                }}
              >
                <TypeIcon type={t.type} size="sm" />
                <span className="flex-1 truncate">{t.title}</span>
                {team && (
                  <span className={cn("chip text-[10px] py-0", getTeamColorClasses(team.color))}>
                    {team.name}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {focused && query.trim() !== "" && filtered.length === 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg bg-white shadow-pop ring-1 ring-surface-200 px-3 py-2 text-sm text-surface-500 dark:bg-surface-800 dark:ring-surface-700 dark:text-surface-400">
          No match. Completed tickets are excluded.
        </div>
      )}

      {value.length === 0 && !focused && (
        <p className="mt-2 text-xs text-surface-500 dark:text-surface-400">
          No dependencies. A ticket with dependencies cannot start before its sources finish — its dates are shifted automatically.
        </p>
      )}
    </div>
  );
}
