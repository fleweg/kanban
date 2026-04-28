import { useMemo, useState } from "react";
import { Layers, Plus } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { SprintCard } from "../components/sprints/SprintCard";
import { SprintModal } from "../components/sprints/SprintModal";
import { EmptyState } from "../components/ui/EmptyState";
import { useAppData } from "../context/AppDataContext";

export function SprintsPage() {
  const { sprints, tickets, activeSprint, workflow, loading } = useAppData();
  const [opening, setOpening] = useState(false);

  const ticketStatsBySprint = useMemo(() => {
    const map = {};
    for (const t of tickets) {
      if (!t.sprintId) continue;
      if (!map[t.sprintId]) map[t.sprintId] = { total: 0, completed: 0 };
      map[t.sprintId].total += 1;
      if (t.status === workflow?.completedColumnId) map[t.sprintId].completed += 1;
    }
    return map;
  }, [tickets, workflow]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Sprints"
        description="Review past sprints and start new ones."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setOpening(true)}
            disabled={Boolean(activeSprint)}
            title={activeSprint ? "End the active sprint before starting a new one." : undefined}
          >
            <Plus className="h-4 w-4" />
            New sprint
          </button>
        }
      />

      {loading ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Loading…</p>
      ) : sprints.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No sprints yet"
          description="Start your first sprint to plan and execute work."
          action={
            <button type="button" className="btn-primary" onClick={() => setOpening(true)}>
              <Plus className="h-4 w-4" />
              New sprint
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sprints.map((sprint) => {
            const stats = ticketStatsBySprint[sprint.id] ?? { total: 0, completed: 0 };
            return (
              <SprintCard
                key={sprint.id}
                sprint={sprint}
                ticketCount={stats.total}
                completedCount={stats.completed}
              />
            );
          })}
        </div>
      )}

      <SprintModal open={opening} onClose={() => setOpening(false)} />
    </div>
  );
}
