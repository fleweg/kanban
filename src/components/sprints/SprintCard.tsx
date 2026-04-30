import { CheckCircle2, CircleDot } from "lucide-react";
import { Badge } from "../ui/Badge";
import { formatDate } from "../../lib/utils";
import type { Sprint } from "../../types";

interface SprintCardProps {
  sprint: Sprint;
  ticketCount: number;
  completedCount: number;
}

export function SprintCard({ sprint, ticketCount, completedCount }: SprintCardProps) {
  const isActive = sprint.status === "active";
  const Icon = isActive ? CircleDot : CheckCircle2;
  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className={isActive ? "h-4 w-4 text-blue-500" : "h-4 w-4 text-emerald-500"} />
            <h3 className="text-sm font-semibold text-surface-900 truncate dark:text-surface-50">{sprint.name}</h3>
          </div>
          {sprint.goal && <p className="text-sm text-surface-500 mt-1.5 line-clamp-2 dark:text-surface-400">{sprint.goal}</p>}
        </div>
        <Badge
          className={
            isActive
              ? "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-700/50"
              : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50"
          }
        >
          {isActive ? "Active" : "Completed"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs text-surface-500 pt-2 border-t border-surface-100 dark:text-surface-400 dark:border-surface-800">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-400 dark:text-surface-500">Started</p>
          <p className="text-surface-800 font-medium mt-0.5 dark:text-surface-100">{formatDate(sprint.startedAt)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-400 dark:text-surface-500">
            {isActive ? "Tickets" : "Ended"}
          </p>
          <p className="text-surface-800 font-medium mt-0.5 dark:text-surface-100">
            {isActive ? `${completedCount}/${ticketCount}` : formatDate(sprint.endedAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
