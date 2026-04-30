import { Crown } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Ticket } from "../../types";

// Stable soft-tinted palette: each epic id deterministically picks one entry
// so distinct epics stand out from each other on the board. Light + dark
// variants kept inline because Tailwind cannot generate dynamic class names.
const EPIC_PALETTE = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
];

function hash(value: string): number {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function classesFor(id: string | null | undefined): string {
  if (!id) return "bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300";
  return EPIC_PALETTE[hash(id) % EPIC_PALETTE.length];
}

interface EpicChipProps {
  epic: Ticket | null | undefined;
  onClick?: (epic: Ticket) => void;
  className?: string;
}

// Compact label showing the parent epic on a ticket card or in the modal.
// `onClick` lets the chip act as a shortcut to open the epic itself.
export function EpicChip({ epic, onClick, className }: EpicChipProps) {
  if (!epic) return null;
  const interactive = typeof onClick === "function";
  const sharedClasses = cn(
    "chip inline-flex items-center gap-1 max-w-[160px]",
    classesFor(epic.id),
    interactive && "hover:opacity-80 transition-opacity",
    className,
  );
  const tooltip = `Epic: ${epic.title}`;

  if (interactive) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(epic);
        }}
        className={sharedClasses}
        title={tooltip}
      >
        <Crown className="h-3 w-3 shrink-0" />
        <span className="truncate">{epic.title}</span>
      </button>
    );
  }

  return (
    <span className={sharedClasses} title={tooltip}>
      <Crown className="h-3 w-3 shrink-0" />
      <span className="truncate">{epic.title}</span>
    </span>
  );
}
