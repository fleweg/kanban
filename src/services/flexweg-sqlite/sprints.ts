// SQLite implementation of the sprints service. Mirrors
// services/firebase/sprints.ts signatures.

import { Timestamp } from "firebase/firestore";
import { sqlBatch, sqlExec, sqlQuery } from "./client";
import { notifyPotentialChange, subscribeWithPolling } from "./subscriptions";
import type { Sprint, SprintStatus } from "../../types";

export const SPRINT_STATUS: { active: SprintStatus; completed: SprintStatus } = {
  active: "active",
  completed: "completed",
};

interface SprintRow {
  id: string;
  name: string;
  goal: string;
  status: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

function rowToSprint(r: SprintRow): Sprint {
  return {
    id: r.id,
    name: r.name,
    goal: r.goal ?? "",
    status: r.status as SprintStatus,
    createdAt: Timestamp.fromMillis(r.created_at),
    startedAt: r.started_at ? Timestamp.fromMillis(r.started_at) : undefined,
    endedAt: r.ended_at ? Timestamp.fromMillis(r.ended_at) : null,
  };
}

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchAllSprints(): Promise<Sprint[]> {
  const { rows } = await sqlQuery<SprintRow>(
    "SELECT * FROM sprints ORDER BY created_at DESC",
    [],
  );
  return rows.map(rowToSprint);
}

export function subscribeToSprints(
  onChange: (sprints: Sprint[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeWithPolling(fetchAllSprints, onChange, onError);
}

export async function createSprint({ name, goal = "" }: { name: string; goal?: string }): Promise<{ id: string }> {
  // Guard rail: only one active sprint at a time. Done as a check
  // before the insert — not atomic, but the cost of two concurrent
  // creations is two active sprints (recoverable from the UI), and
  // the alternative (full transaction) doesn't add real safety here.
  const active = await sqlQuery<{ id: string }>(
    "SELECT id FROM sprints WHERE status = ? LIMIT 1",
    [SPRINT_STATUS.active],
  );
  if (active.rows.length > 0) {
    throw new Error("An active sprint already exists. End it before starting a new one.");
  }
  const id = genId();
  const now = Date.now();
  await sqlExec(
    `INSERT INTO sprints (id, name, goal, status, created_at, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [id, name.trim(), goal.trim(), SPRINT_STATUS.active, now, now],
  );
  notifyPotentialChange();
  return { id };
}

const SPRINT_COLUMN: Record<string, string> = {
  name: "name",
  goal: "goal",
  status: "status",
  startedAt: "started_at",
  endedAt: "ended_at",
};

export async function updateSprint(id: string, data: Partial<Omit<Sprint, "id">>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(data)) {
    const col = SPRINT_COLUMN[key];
    if (!col) continue;
    sets.push(`${col} = ?`);
    // Timestamps in domain may be Timestamp instances; convert to ms.
    if (value && typeof value === "object" && "toMillis" in value && typeof (value as Timestamp).toMillis === "function") {
      params.push((value as Timestamp).toMillis());
    } else {
      params.push(value ?? null);
    }
  }
  if (sets.length === 0) return;
  params.push(id);
  await sqlExec(`UPDATE sprints SET ${sets.join(", ")} WHERE id = ?`, params);
  notifyPotentialChange();
}

export async function deleteSprint(id: string): Promise<void> {
  await sqlExec("DELETE FROM sprints WHERE id = ?", [id]);
  notifyPotentialChange();
}

export async function endSprintAndStartNext({
  activeSprintId,
  nextSprintName,
  nextSprintGoal = "",
  completedColumnId,
}: {
  activeSprintId: string;
  nextSprintName: string;
  nextSprintGoal?: string;
  completedColumnId: string;
}): Promise<string> {
  if (!activeSprintId) throw new Error("No active sprint to end.");
  if (!nextSprintName?.trim()) throw new Error("A name for the next sprint is required.");

  const nextId = genId();
  const now = Date.now();
  await sqlBatch([
    // Create the next sprint.
    {
      sql: `INSERT INTO sprints (id, name, goal, status, created_at, started_at, ended_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      params: [nextId, nextSprintName.trim(), nextSprintGoal.trim(), SPRINT_STATUS.active, now, now],
    },
    // Migrate non-completed tickets to the new sprint.
    {
      sql: `UPDATE tickets SET sprint_id = ?, updated_at = ?
            WHERE sprint_id = ? AND (status IS NULL OR status != ?)`,
      params: [nextId, now, activeSprintId, completedColumnId],
    },
    // Mark the old sprint as completed.
    {
      sql: `UPDATE sprints SET status = ?, ended_at = ? WHERE id = ?`,
      params: [SPRINT_STATUS.completed, now, activeSprintId],
    },
  ]);
  notifyPotentialChange();
  return nextId;
}

export async function endSprintToBacklog({
  activeSprintId,
  completedColumnId,
}: {
  activeSprintId: string;
  completedColumnId: string;
}): Promise<void> {
  if (!activeSprintId) throw new Error("No active sprint to end.");
  const now = Date.now();
  await sqlBatch([
    {
      sql: `UPDATE tickets SET sprint_id = NULL, status = NULL, updated_at = ?
            WHERE sprint_id = ? AND (status IS NULL OR status != ?)`,
      params: [now, activeSprintId, completedColumnId],
    },
    {
      sql: `UPDATE sprints SET status = ?, ended_at = ? WHERE id = ?`,
      params: [SPRINT_STATUS.completed, now, activeSprintId],
    },
  ]);
  notifyPotentialChange();
}
