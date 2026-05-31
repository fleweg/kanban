import { useMemo } from "react";
import { Inbox } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Badge } from "../ui/Badge";
import { TypeIcon } from "../issueTypes/TypeIcon";
import { UnassignedAvatar, UserAvatar } from "../users/UserAvatar";
import { useAppData } from "../../context/AppDataContext";
import { formatDate } from "../../lib/utils";
import type { Sprint, Ticket } from "../../types";

interface SprintDetailModalProps {
  open: boolean;
  sprint: Sprint | null;
  onClose: () => void;
  onTicketClick: (ticket: Ticket) => void;
}

export function SprintDetailModal({ open, sprint, onClose, onTicketClick }: SprintDetailModalProps) {
  const { tickets, workflow, getUserById } = useAppData();

  const sprintTickets = useMemo(() => {
    if (!sprint) return [] as Ticket[];
    return tickets.filter((t) => t.sprintId === sprint.id);
  }, [tickets, sprint]);

  if (!sprint) return null;

  const completedColumnId = workflow?.completedColumnId;
  const columnName = (status: string | null) =>
    workflow?.columns.find((c) => c.id === status)?.name ?? "—";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={sprint.name}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {sprint.goal && <span className="truncate">{sprint.goal}</span>}
          <span className="text-xs text-surface-400 dark:text-surface-500">
            {formatDate(sprint.startedAt)} → {formatDate(sprint.endedAt)}
          </span>
        </span>
      }
    >
      {sprintTickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Inbox className="h-8 w-8 text-surface-300 dark:text-surface-600" />
          <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
            No tickets remained on this sprint.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-surface-100 dark:divide-surface-800">
          {sprintTickets.map((ticket) => {
            const assignee = getUserById(ticket.assigneeId);
            const isDone = ticket.status === completedColumnId;
            return (
              <li key={ticket.id}>
                <button
                  type="button"
                  onClick={() => onTicketClick(ticket)}
                  className="w-full text-left flex items-center gap-3 py-2.5 px-1 rounded-lg hover:bg-surface-50 transition-colors dark:hover:bg-surface-800/60"
                >
                  <TypeIcon type={ticket.type} size="sm" />
                  <span className="flex-1 min-w-0 text-sm font-medium text-surface-900 truncate dark:text-surface-50">
                    {ticket.title}
                  </span>
                  <Badge
                    className={
                      isDone
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50"
                        : "bg-surface-100 text-surface-700 ring-surface-200 dark:bg-surface-800 dark:text-surface-200 dark:ring-surface-700"
                    }
                  >
                    {columnName(ticket.status)}
                  </Badge>
                  {assignee ? <UserAvatar user={assignee} size="sm" /> : <UnassignedAvatar size="sm" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
