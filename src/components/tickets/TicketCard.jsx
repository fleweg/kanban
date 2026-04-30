import { CheckSquare, GripVertical, MessageSquare, MoreHorizontal } from "lucide-react";
import { cn, checklistProgress, getPriority } from "../../lib/utils";
import { useAppData } from "../../context/AppDataContext";
import { UnassignedAvatar, UserAvatar } from "../users/UserAvatar";
import { TypeIcon } from "../issueTypes/TypeIcon";
import { EpicChip } from "../epics/EpicChip";

export function TicketCard({ ticket, onClick, dragHandleProps, isDragging, compact, onEpicClick }) {
  const priority = getPriority(ticket.priority);
  const { getUserById, getEpicById } = useAppData();
  const assignee = getUserById(ticket.assigneeId);
  const epic = getEpicById(ticket.epicId);
  const commentCount = ticket.commentCount ?? 0;
  const { done: checklistDone, total: checklistTotal } = checklistProgress(ticket.checklist);
  const checklistComplete = checklistTotal > 0 && checklistDone === checklistTotal;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative cursor-pointer rounded-lg bg-white p-3 ring-1 ring-surface-200 shadow-card transition-all hover:shadow-card-hover hover:ring-surface-300",
        "dark:bg-surface-800 dark:ring-surface-700 dark:hover:ring-surface-600",
        isDragging && "shadow-pop ring-blue-300 rotate-[0.5deg] dark:ring-blue-500",
        compact && "p-2.5",
      )}
    >
      <div className="flex items-start gap-2">
        {dragHandleProps && (
          <span
            {...dragHandleProps}
            className="text-surface-300 hover:text-surface-500 -ml-1 mt-0.5 cursor-grab active:cursor-grabbing dark:text-surface-600 dark:hover:text-surface-400"
            onClick={(e) => e.stopPropagation()}
            aria-label="Drag handle"
          >
            <GripVertical className="h-4 w-4" />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5">
            <span className="mt-0.5">
              <TypeIcon type={ticket.type} size="sm" />
            </span>
            <p className="text-sm font-medium text-surface-900 leading-snug line-clamp-2 dark:text-surface-50">
              {ticket.title}
            </p>
          </div>
          {ticket.description && !compact && (
            <p className="text-xs text-surface-500 mt-1 line-clamp-2 dark:text-surface-400">{ticket.description}</p>
          )}
          {epic && (
            <div className="mt-2">
              <EpicChip epic={epic} onClick={onEpicClick} />
            </div>
          )}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn("chip", priority.color)}>{priority.label}</span>
              {commentCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] text-surface-500 dark:text-surface-400"
                  title={`${commentCount} comment${commentCount > 1 ? "s" : ""}`}
                >
                  <MessageSquare className="h-3 w-3" />
                  {commentCount}
                </span>
              )}
              {checklistTotal > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[11px] tabular-nums",
                    checklistComplete
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-surface-500 dark:text-surface-400",
                  )}
                  title={`Checklist · ${checklistDone}/${checklistTotal} done`}
                >
                  <CheckSquare className="h-3 w-3" />
                  {checklistDone}/{checklistTotal}
                </span>
              )}
            </div>
            {assignee ? (
              <UserAvatar user={assignee} size="sm" />
            ) : (
              <UnassignedAvatar size="sm" />
            )}
          </div>
        </div>
        <span className="text-surface-300 group-hover:text-surface-500 transition-colors dark:text-surface-600 dark:group-hover:text-surface-400">
          <MoreHorizontal className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}
