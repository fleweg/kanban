// SQLite implementation of the teams service. Teams partition the
// kanban into independent backlogs + sprint timelines. The general
// team always exists and is non-deletable.

import { Timestamp } from "firebase/firestore";
import { sqlBatch, sqlExec, sqlQuery } from "./client";
import { notifyPotentialChange, subscribeWithPolling } from "./subscriptions";
import {
  DEFAULT_TEAM_COLOR,
  GENERAL_TEAM_ID,
  GENERAL_TEAM_NAME,
} from "../../lib/teams";
import type { Team } from "../../types";

interface TeamRow {
  id: string;
  name: string;
  color: string | null;
  created_at: number;
}

function rowToTeam(r: TeamRow): Team {
  return {
    id: r.id,
    name: r.name,
    color: r.color ?? undefined,
    createdAt: Timestamp.fromMillis(r.created_at),
  };
}

export function subscribeToTeams(
  onChange: (teams: Team[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeWithPolling(
    async () => {
      const { rows } = await sqlQuery<TeamRow>(
        "SELECT * FROM teams ORDER BY (id = 'general') DESC, name ASC",
        [],
      );
      return rows.map(rowToTeam);
    },
    onChange,
    onError,
  );
}

export async function createTeam(input: { name: string; color?: string }): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("Team name is required.");
  const id = `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await sqlExec(
    "INSERT INTO teams (id, name, color, created_at) VALUES (?, ?, ?, ?)",
    [id, name, input.color ?? DEFAULT_TEAM_COLOR, Date.now()],
  );
  notifyPotentialChange();
  return id;
}

export async function updateTeam(
  id: string,
  patch: { name?: string; color?: string },
): Promise<void> {
  if (id === GENERAL_TEAM_ID && patch.name && patch.name.trim() !== GENERAL_TEAM_NAME) {
    // Renaming the bootstrap team is allowed, but we keep the id stable
    // so existing data keeps resolving correctly.
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("Team name is required.");
    sets.push("name = ?");
    params.push(name);
  }
  if (patch.color !== undefined) {
    sets.push("color = ?");
    params.push(patch.color);
  }
  if (sets.length === 0) return;
  params.push(id);
  await sqlExec(`UPDATE teams SET ${sets.join(", ")} WHERE id = ?`, params);
  notifyPotentialChange();
}

// Returns the impact of deleting a team so the caller can show a
// confirmation dialog before actually wiping it.
export async function countTeamImpact(
  id: string,
): Promise<{ tickets: number; sprints: number; members: number }> {
  const [t, s, m] = await Promise.all([
    sqlQuery<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE team_id = ?", [id]),
    sqlQuery<{ n: number }>("SELECT COUNT(*) AS n FROM sprints WHERE team_id = ?", [id]),
    sqlQuery<{ n: number }>("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?", [id]),
  ]);
  return {
    tickets: t.rows[0]?.n ?? 0,
    sprints: s.rows[0]?.n ?? 0,
    members: m.rows[0]?.n ?? 0,
  };
}

// Deletes a team and reassigns its tickets + sprints to the general
// team. Refuses to delete the general team. Memberships are cascaded
// via the FK so each user loses their row for the team — they all
// retain general by virtue of ensureSelfUserRecord enrolling them.
export async function deleteTeam(id: string): Promise<void> {
  if (id === GENERAL_TEAM_ID) {
    throw new Error("The general team cannot be deleted.");
  }
  await sqlBatch([
    { sql: "UPDATE tickets SET team_id = ? WHERE team_id = ?", params: [GENERAL_TEAM_ID, id] },
    { sql: "UPDATE sprints SET team_id = ? WHERE team_id = ?", params: [GENERAL_TEAM_ID, id] },
    { sql: "DELETE FROM teams WHERE id = ?", params: [id] },
  ]);
  notifyPotentialChange();
}
