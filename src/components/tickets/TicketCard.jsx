import { GripVertical, MoreHorizontal } from "lucide-react";
import { cn, getPriority } from "../../lib/utils";
import { useAppData } from "../../context/AppDataContext";
import { UnassignedAvatar, UserAvatar } from "../users/UserAvatar";

export function TicketCard({ ticket, onClick, dragHandleProps, isDragging, compact }) {
  const priority = getPriority(ticket.priority);
  const { getUserById } = useAppData();
  const assignee = getUserById(ticket.assigneeId);

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
          <p className="text-sm font-medium text-surface-900 leading-snug line-clamp-2 dark:text-surface-50">
            {ticket.title}
          </p>
          {ticket.description && !compact && (
            <p className="text-xs text-surface-500 mt-1 line-clamp-2 dark:text-surface-400">{ticket.description}</p>
          )}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className={cn("chip", priority.color)}>{priority.label}</span>
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
