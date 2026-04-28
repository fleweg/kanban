import { useState } from "react";
import { ArrowRight, Inbox, Plus } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { TicketCard } from "../components/tickets/TicketCard";
import { TicketModal } from "../components/tickets/TicketModal";
import { EmptyState } from "../components/ui/EmptyState";
import { useAppData } from "../context/AppDataContext";
import { moveTicketToSprint } from "../services/tickets";

export function BacklogPage() {
  const { backlogTickets, activeSprint, workflow, loading } = useAppData();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  async function moveToSprint(ticket) {
    if (!activeSprint) return;
    const initialStatus = workflow?.columns?.[0]?.id ?? null;
    await moveTicketToSprint(ticket.id, activeSprint.id, initialStatus);
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Backlog"
        description="All tickets that aren't part of an active sprint."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New ticket
          </button>
        }
      />

      {loading ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Loading…</p>
      ) : backlogTickets.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Backlog is empty"
          description="Create a new ticket to get started."
          action={
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New ticket
            </button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {backlogTickets.map((ticket) => (
            <div key={ticket.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <TicketCard ticket={ticket} onClick={() => setEditing(ticket)} />
              </div>
              {activeSprint && (
                <button
                  type="button"
                  onClick={() => moveToSprint(ticket)}
                  className="btn-secondary shrink-0"
                  title={`Move to ${activeSprint.name}`}
                >
                  <ArrowRight className="h-4 w-4" />
                  <span className="hidden sm:inline">To sprint</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <TicketModal
        open={creating}
        onClose={() => setCreating(false)}
        defaultSprintId={null}
        workflow={workflow}
      />
      <TicketModal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        ticket={editing}
        workflow={workflow}
      />
    </div>
  );
}
