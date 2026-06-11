import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag, LayoutGrid, Plus } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { KanbanBoard } from "../components/kanban/KanbanBoard";
import { SprintModal } from "../components/sprints/SprintModal";
import { EndSprintModal } from "../components/sprints/EndSprintModal";
import { TicketModal } from "../components/tickets/TicketModal";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { displayNameOf, formatDate } from "../lib/utils";

// "all" = no filter, "me" = the currently signed-in user's tickets,
// anything else is a user uid (rendered to "Tickets assigned to X").
type AssigneeFilter = "all" | "me" | string;

export function ActiveSprintPage() {
  const { t } = useTranslation();
  const { activeSprint, activeSprintTickets, workflow, users, loading } = useAppData();
  const { user } = useAuth();
  const [startingSprint, setStartingSprint] = useState(false);
  const [endingSprint, setEndingSprint] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState(false);
  // Ephemeral assignee filter — Jira-style. No persistence: the
  // filter resets on reload / route change. Most users want a quick
  // "show me my work" toggle, not a sticky setting.
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");

  const unfinishedCount = useMemo(() => {
    if (!activeSprint || !workflow?.completedColumnId) return 0;
    return activeSprintTickets.filter((t) => t.status !== workflow.completedColumnId).length;
  }, [activeSprint, activeSprintTickets, workflow]);

  // Filtered tickets fed to the Kanban board. "me" maps to the
  // signed-in user's uid; explicit uids match directly; "all" passes
  // the slice through unchanged.
  const filteredTickets = useMemo(() => {
    if (assigneeFilter === "all") return activeSprintTickets;
    const targetUid = assigneeFilter === "me" ? user?.uid ?? null : assigneeFilter;
    if (!targetUid) return activeSprintTickets;
    return activeSprintTickets.filter((tk) => tk.assigneeId === targetUid);
  }, [assigneeFilter, activeSprintTickets, user?.uid]);

  // Only active users in the dropdown — disabled accounts shouldn't
  // be assignment targets in the first place.
  const activeUsers = useMemo(() => users.filter((u) => !u.disabled), [users]);

  if (loading) {
    return <p className="p-8 text-sm text-surface-500 dark:text-surface-400">Loading…</p>;
  }

  if (!activeSprint) {
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <PageHeader title="Active sprint" description="No sprint is currently running." />
        <EmptyState
          icon={LayoutGrid}
          title="No active sprint"
          description="Start a new sprint to begin tracking work on the Kanban board."
          action={
            <button type="button" className="btn-primary" onClick={() => setStartingSprint(true)}>
              <Plus className="h-4 w-4" />
              Start a sprint
            </button>
          }
        />
        <SprintModal open={startingSprint} onClose={() => setStartingSprint(false)} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <PageHeader
        title={activeSprint.name}
        description={activeSprint.goal || "Active sprint board."}
        actions={
          <>
            <Badge
              className="bg-blue-50 text-blue-700 ring-blue-200 whitespace-nowrap dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-700/50"
              dot
              dotColor="#3b82f6"
            >
              {/* Compact label on phones; full sentence kicks in at sm+. */}
              <span className="sm:hidden">Active</span>
              <span className="hidden sm:inline">Active · started {formatDate(activeSprint.startedAt)}</span>
            </Badge>
            <select
              // Full-width on mobile so the dropdown is comfortable to
              // tap; capped at 180 from sm+ so it stays compact next to
              // the action buttons on desktop.
              className="input h-9 w-full sm:w-auto sm:max-w-[180px] text-xs"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value as AssigneeFilter)}
              title={t("sprint.filter.title")}
            >
              <option value="all">{t("sprint.filter.all")}</option>
              {user && <option value="me">{t("sprint.filter.me")}</option>}
              {activeUsers.length > 0 && <option disabled>──────────</option>}
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {displayNameOf(u)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary whitespace-nowrap"
              onClick={() => setCreatingTicket(true)}
            >
              <Plus className="h-4 w-4" />
              {/* Tighter label on mobile so the button stays one line. */}
              <span className="sm:hidden">New</span>
              <span className="hidden sm:inline">New ticket</span>
            </button>
            <button
              type="button"
              className="btn-primary whitespace-nowrap"
              onClick={() => setEndingSprint(true)}
            >
              <Flag className="h-4 w-4" />
              <span className="sm:hidden">End</span>
              <span className="hidden sm:inline">End sprint</span>
            </button>
          </>
        }
      />

      {activeSprintTickets.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No tickets in this sprint"
          description="Add tickets directly or move them in from the backlog."
          action={
            <button type="button" className="btn-primary" onClick={() => setCreatingTicket(true)}>
              <Plus className="h-4 w-4" />
              New ticket
            </button>
          }
        />
      ) : filteredTickets.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={t("sprint.filter.emptyTitle")}
          description={t("sprint.filter.emptyDescription")}
          action={
            <button type="button" className="btn-secondary" onClick={() => setAssigneeFilter("all")}>
              {t("sprint.filter.clear")}
            </button>
          }
        />
      ) : (
        <KanbanBoard workflow={workflow} tickets={filteredTickets} sprintId={activeSprint.id} />
      )}

      <EndSprintModal
        open={endingSprint}
        onClose={() => setEndingSprint(false)}
        activeSprint={activeSprint}
        workflow={workflow}
        unfinishedCount={unfinishedCount}
      />

      <TicketModal
        open={creatingTicket}
        onClose={() => setCreatingTicket(false)}
        defaultSprintId={activeSprint.id}
        defaultStatus={workflow.columns[0]?.id}
        workflow={workflow}
      />
    </div>
  );
}
