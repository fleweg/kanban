import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Modal } from "../components/ui/Modal";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import {
  countTeamImpact,
  createTeam,
  deleteTeam,
  updateTeam,
} from "../services/teams";
import {
  DEFAULT_TEAM_COLOR,
  GENERAL_TEAM_ID,
  TEAM_COLORS,
  getTeamColorClasses,
  getTeamSwatchClass,
} from "../lib/teams";
import { cn } from "../lib/utils";
import type { Team } from "../types";

interface TeamStats {
  tickets: number;
  sprints: number;
  members: number;
}

export function TeamsPage() {
  const { teams, tickets, sprints, users, loading } = useAppData();
  const { isAdmin } = useAuth();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo<Record<string, TeamStats>>(() => {
    const map: Record<string, TeamStats> = {};
    for (const t of teams) map[t.id] = { tickets: 0, sprints: 0, members: 0 };
    for (const ticket of tickets) {
      if (map[ticket.teamId]) map[ticket.teamId].tickets++;
    }
    for (const s of sprints) {
      if (map[s.teamId]) map[s.teamId].sprints++;
    }
    for (const u of users) {
      for (const id of u.teamIds ?? []) {
        if (map[id]) map[id].members++;
      }
    }
    return map;
  }, [teams, tickets, sprints, users]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Teams"
        description={
          isAdmin
            ? "Create teams, rename them, or move tickets back to the default team."
            : "Read-only list of teams. Ask an admin to create or rename teams."
        }
        actions={
          isAdmin && (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New team
            </button>
          )
        }
      />

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Loading…</p>
      ) : teams.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No teams yet"
          description="Create the first team to split work between groups."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map((team) => {
            const s = stats[team.id] ?? { tickets: 0, sprints: 0, members: 0 };
            const isGeneral = team.id === GENERAL_TEAM_ID;
            return (
              <div key={team.id} className="card p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2.5">
                    <span className={cn("h-3 w-3 rounded-full shrink-0", getTeamSwatchClass(team.color))} />
                    <h3 className="text-sm font-semibold text-surface-900 truncate dark:text-surface-50">{team.name}</h3>
                  </div>
                  {isGeneral && (
                    <span className={cn("chip", getTeamColorClasses(team.color))}>Default</span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-surface-500 pt-2 border-t border-surface-100 dark:text-surface-400 dark:border-surface-800">
                  <Stat label="Tickets" value={s.tickets} />
                  <Stat label="Sprints" value={s.sprints} />
                  <Stat label="Members" value={s.members} />
                </div>
                {isAdmin && (
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      className="btn-secondary text-xs px-2 py-1"
                      onClick={() => setEditing(team)}
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                    {!isGeneral && (
                      <button
                        type="button"
                        className="btn-danger text-xs px-2 py-1"
                        onClick={() => setDeletingTeam(team)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <TeamFormModal
          open={creating}
          onClose={() => setCreating(false)}
          onSubmitError={setError}
        />
      )}
      {editing && (
        <TeamFormModal
          open={Boolean(editing)}
          team={editing}
          onClose={() => setEditing(null)}
          onSubmitError={setError}
        />
      )}
      {deletingTeam && (
        <DeleteTeamModal
          team={deletingTeam}
          open={Boolean(deletingTeam)}
          onClose={() => setDeletingTeam(null)}
          onError={setError}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-surface-400 dark:text-surface-500">{label}</p>
      <p className="text-surface-800 font-medium mt-0.5 dark:text-surface-100">{value}</p>
    </div>
  );
}

interface TeamFormModalProps {
  open: boolean;
  team?: Team;
  onClose: () => void;
  onSubmitError: (msg: string) => void;
}

function TeamFormModal({ open, team, onClose, onSubmitError }: TeamFormModalProps) {
  const [name, setName] = useState(team?.name ?? "");
  const [color, setColor] = useState<string>(team?.color ?? DEFAULT_TEAM_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(team);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      onSubmitError("Team name is required.");
      return;
    }
    setSubmitting(true);
    try {
      if (team) await updateTeam(team.id, { name, color });
      else await createTeam({ name, color });
      onClose();
    } catch (err) {
      onSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${team?.name}` : "New team"}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="team-form" className="btn-primary" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <form id="team-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="team-name">Name</label>
          <input
            id="team-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="e.g. Tech, Marketing"
          />
        </div>
        <div>
          <span className="label">Color</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {TEAM_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setColor(c.id)}
                className={cn(
                  "h-7 w-7 rounded-full ring-2 transition-all",
                  c.swatch,
                  color === c.id
                    ? "ring-surface-900 dark:ring-surface-100 scale-110"
                    : "ring-transparent hover:scale-105",
                )}
                aria-label={`Color ${c.id}`}
              />
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}

interface DeleteTeamModalProps {
  team: Team;
  open: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
}

function DeleteTeamModal({ team, open, onClose, onError }: DeleteTeamModalProps) {
  const [impact, setImpact] = useState<{ tickets: number; sprints: number; members: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    countTeamImpact(team.id)
      .then((r) => {
        if (!cancelled) setImpact(r);
      })
      .catch((err) => {
        if (!cancelled) onError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, team.id, onError]);

  async function handleDelete() {
    setSubmitting(true);
    try {
      await deleteTeam(team.id);
      onClose();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delete ${team.name}?`}
      description="The team will be removed and its content moved to the default team."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={handleDelete} disabled={submitting}>
            {submitting ? "Deleting…" : `Move to General & delete`}
          </button>
        </>
      }
    >
      {impact === null ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Computing impact…</p>
      ) : (
        <div className="text-sm space-y-2 text-surface-700 dark:text-surface-300">
          <p>The following will be moved to the General team:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong>{impact.tickets}</strong> ticket{impact.tickets === 1 ? "" : "s"}
              <span className="text-surface-500"> — any sprint assignment will be cleared.</span>
            </li>
            <li>
              <strong>{impact.sprints}</strong> sprint{impact.sprints === 1 ? "" : "s"} (history preserved)
            </li>
            <li>
              <strong>{impact.members}</strong> team member{impact.members === 1 ? "" : "s"}
              <span className="text-surface-500"> — they keep their other team memberships.</span>
            </li>
          </ul>
        </div>
      )}
    </Modal>
  );
}
