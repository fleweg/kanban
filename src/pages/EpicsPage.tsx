import { useMemo, useState } from "react";
import { Crown, Plus } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { TicketModal } from "../components/tickets/TicketModal";
import { UnassignedAvatar, UserAvatar } from "../components/users/UserAvatar";
import { useAppData } from "../context/AppDataContext";
import { EPIC_TYPE } from "../lib/issueTypes";
import { htmlToPlainText } from "../lib/utils";
import type { Ticket } from "../types";

interface EpicStats {
  total: number;
  completed: number;
}

export function EpicsPage() {
  const { currentTeamEpics, currentTeamTickets, workflow, getUserById, loading } = useAppData();
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [creating, setCreating] = useState(false);

  // Aggregate child counts per epic. A child is any ticket whose `epicId`
  // points back to this epic. "Completed" counts only those whose `status`
  // matches the workflow's completion column.
  const stats = useMemo(() => {
    const map: Record<string, EpicStats> = {};
    for (const t of currentTeamTickets) {
      if (!t.epicId || t.type === EPIC_TYPE) continue;
      if (!map[t.epicId]) map[t.epicId] = { total: 0, completed: 0 };
      map[t.epicId].total += 1;
      if (t.status && t.status === workflow?.completedColumnId) map[t.epicId].completed += 1;
    }
    return map;
  }, [currentTeamTickets, workflow]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Epics"
        description="Group related tickets under a higher-level container. Epics live across sprints."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New epic
          </button>
        }
      />

      {loading ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Loading…</p>
      ) : currentTeamEpics.length === 0 ? (
        <EmptyState
          icon={Crown}
          title="No epics yet"
          description="Create an epic to group multiple tickets under a shared theme."
          action={
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New epic
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {currentTeamEpics.map((epic) => {
            const s: EpicStats = stats[epic.id] ?? { total: 0, completed: 0 };
            const pct = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
            const assignee = getUserById(epic.assigneeId);
            return (
              <button
                key={epic.id}
                type="button"
                onClick={() => setEditing(epic)}
                className="card p-5 flex flex-col gap-3 text-left hover:shadow-card-hover hover:ring-surface-300 dark:hover:ring-surface-600 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Crown className="h-4 w-4 text-violet-500 shrink-0" />
                      <h3 className="text-sm font-semibold text-surface-900 truncate dark:text-surface-50">
                        {epic.title}
                      </h3>
                    </div>
                    {(() => {
                      const preview = htmlToPlainText(epic.description);
                      return preview ? (
                        <p className="text-sm text-surface-500 mt-1.5 line-clamp-2 dark:text-surface-400">
                          {preview}
                        </p>
                      ) : null;
                    })()}
                  </div>
                  {assignee ? <UserAvatar user={assignee} size="md" /> : <UnassignedAvatar size="md" />}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-surface-500 dark:text-surface-400">
                      {s.completed} / {s.total} {s.total === 1 ? "ticket" : "tickets"}
                    </span>
                    <span className="font-medium text-surface-700 dark:text-surface-200">{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-100 overflow-hidden dark:bg-surface-800">
                    <div
                      className="h-full bg-violet-500 transition-all"
                      style={{ width: `${pct}%` }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <TicketModal
        open={creating}
        onClose={() => setCreating(false)}
        defaultType={EPIC_TYPE}
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
