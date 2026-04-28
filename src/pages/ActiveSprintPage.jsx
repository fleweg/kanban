import { useMemo, useState } from "react";
import { Flag, LayoutGrid, Plus } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { KanbanBoard } from "../components/kanban/KanbanBoard";
import { SprintModal } from "../components/sprints/SprintModal";
import { EndSprintModal } from "../components/sprints/EndSprintModal";
import { TicketModal } from "../components/tickets/TicketModal";
import { useAppData } from "../context/AppDataContext";
import { formatDate } from "../lib/utils";

export function ActiveSprintPage() {
  const { activeSprint, activeSprintTickets, workflow, loading } = useAppData();
  const [startingSprint, setStartingSprint] = useState(false);
  const [endingSprint, setEndingSprint] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState(false);

  const unfinishedCount = useMemo(() => {
    if (!activeSprint || !workflow?.completedColumnId) return 0;
    return activeSprintTickets.filter((t) => t.status !== workflow.completedColumnId).length;
  }, [activeSprint, activeSprintTickets, workflow]);

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
              className="bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-700/50"
              dot
              dotColor="#3b82f6"
            >
              Active · started {formatDate(activeSprint.startedAt)}
            </Badge>
            <button type="button" className="btn-secondary" onClick={() => setCreatingTicket(true)}>
              <Plus className="h-4 w-4" />
              New ticket
            </button>
            <button type="button" className="btn-primary" onClick={() => setEndingSprint(true)}>
              <Flag className="h-4 w-4" />
              End sprint
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
      ) : (
        <KanbanBoard workflow={workflow} tickets={activeSprintTickets} sprintId={activeSprint.id} />
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
