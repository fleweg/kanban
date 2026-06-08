import type { DraggableProvidedDragHandleProps } from "@hello-pangea/dnd";
import { CheckSquare, Clock, GripVertical, Link2, MessageSquare, Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, checklistProgress, formatAge, formatAgeCompact, getPriority, htmlToPlainText } from "../../lib/utils";
import { useAppData } from "../../context/AppDataContext";
import { UnassignedAvatar, UserAvatar } from "../users/UserAvatar";
import { TypeIcon } from "../issueTypes/TypeIcon";
import { EpicChip } from "../epics/EpicChip";
import type { Ticket } from "../../types";

interface TicketCardProps {
  ticket: Ticket;
  onClick?: () => void;
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
  isDragging?: boolean;
  compact?: boolean;
  onEpicClick?: (epic: Ticket) => void;
}

export function TicketCard({ ticket, onClick, dragHandleProps, isDragging, compact, onEpicClick }: TicketCardProps) {
  const { t } = useTranslation();
  const priority = getPriority(ticket.priority);
  const { getUserById, getEpicById } = useAppData();
  const assignee = getUserById(ticket.assigneeId);
  const epic = getEpicById(ticket.epicId);
  const commentCount = ticket.commentCount ?? 0;
  const attachmentCount = ticket.attachments?.length ?? 0;
  const { done: checklistDone, total: checklistTotal } = checklistProgress(ticket.checklist);
  const checklistComplete = checklistTotal > 0 && checklistDone === checklistTotal;
  // The description is now HTML (TipTap output) but legacy tickets contain
  // plain text. htmlToPlainText handles both — strips tags or returns the
  // text untouched, then collapses whitespace.
  const descriptionPreview = htmlToPlainText(ticket.description);
  const progress = ticket.progress ?? 0;
  // Show the progress bar only when it carries information: anything
  // between 1 and 99. 0% and 100% are already encoded by the column
  // the card sits in (first / completed), so the extra bar is noise.
  const showProgress = progress > 0 && progress < 100;

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
          {descriptionPreview && !compact && (
            <p className="text-xs text-surface-500 mt-1 line-clamp-2 dark:text-surface-400">{descriptionPreview}</p>
          )}
          {epic && (
            <div className="mt-2">
              <EpicChip epic={epic} onClick={onEpicClick} />
            </div>
          )}
          {showProgress && (
            <div
              className="mt-2 flex items-center gap-2"
              title={`${progress}% complete`}
            >
              <div className="flex-1 h-1 rounded-full bg-surface-100 overflow-hidden dark:bg-surface-700">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-surface-500 dark:text-surface-400">{progress}%</span>
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
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
            {attachmentCount > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-surface-500 dark:text-surface-400"
                title={`${attachmentCount} attachment${attachmentCount > 1 ? "s" : ""}`}
              >
                <Paperclip className="h-3 w-3" />
                {attachmentCount}
              </span>
            )}
            {(ticket.dependencies?.length ?? 0) > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-surface-500 dark:text-surface-400"
                title={`Depends on ${ticket.dependencies?.length} ticket${(ticket.dependencies?.length ?? 0) > 1 ? "s" : ""}`}
              >
                <Link2 className="h-3 w-3" />
                {ticket.dependencies?.length}
              </span>
            )}
            {ticket.asanaGid && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-blue-700 dark:text-blue-300"
                title={`Linked to Asana task ${ticket.asanaGid}`}
                onClick={(e) => {
                  if (!ticket.asanaPermalinkUrl) return;
                  e.stopPropagation();
                  window.open(ticket.asanaPermalinkUrl, "_blank", "noopener,noreferrer");
                }}
              >
                <Link2 className="h-3 w-3" />
                Asana
              </span>
            )}
            {ticket.createdAt && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-surface-500 tabular-nums dark:text-surface-400"
                title={t("tickets.createdAgo", { age: formatAge(ticket.createdAt) })}
              >
                <Clock className="h-3 w-3" />
                {formatAgeCompact(ticket.createdAt)}
              </span>
            )}
          </div>
        </div>
        {/* Top-right slot — used to render a dead "…" icon, now hosts
            the assignee avatar (or the unassigned placeholder). Keeps
            the bottom meta row uncluttered and surfaces who's on the
            ticket without needing to scan to the bottom-right. */}
        {assignee ? (
          <UserAvatar user={assignee} size="sm" />
        ) : (
          <UnassignedAvatar size="sm" />
        )}
      </div>
    </div>
  );
}
