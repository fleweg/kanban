// SQLite implementation of the tags service. Mirrors the Firebase
// shape — global tags, name-sorted, with a cascade strip on delete.
//
// The cascade on delete walks every ticket whose `tag_ids` JSON
// payload contains the id substring (cheap LIKE filter on the small
// `tickets` table), parses the array, removes the id, and writes
// back. Same pattern as `dependencies` cleanup in tickets.ts.

import { Timestamp } from "firebase/firestore";
import { sqlExec, sqlQuery } from "./client";
import { notifyPotentialChange, subscribeWithPolling } from "./subscriptions";
import type { Tag } from "../../types";

interface TagRow {
  id: string;
  name: string;
  color: string;
  created_at: number;
  created_by: string | null;
}

function rowToTag(r: TagRow): Tag {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    createdAt: Timestamp.fromMillis(r.created_at),
    createdBy: r.created_by,
  };
}

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `tag_${crypto.randomUUID()}`;
  }
  return `tag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function subscribeToTags(
  onChange: (tags: Tag[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeWithPolling(
    async () => {
      const { rows } = await sqlQuery<TagRow>(
        "SELECT * FROM tags ORDER BY name COLLATE NOCASE ASC",
        [],
      );
      return rows.map(rowToTag);
    },
    onChange,
    onError,
  );
}

export async function createTag(input: {
  name: string;
  color: string;
  createdBy?: string | null;
}): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("Tag name is required.");
  const id = genId();
  await sqlExec(
    `INSERT INTO tags (id, name, color, created_at, created_by) VALUES (?, ?, ?, ?, ?)`,
    [id, name, input.color, Date.now(), input.createdBy ?? null],
  );
  notifyPotentialChange();
  return id;
}

export async function updateTag(
  id: string,
  input: Partial<Pick<Tag, "name" | "color">>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof input.name === "string") {
    sets.push("name = ?");
    params.push(input.name.trim());
  }
  if (typeof input.color === "string") {
    sets.push("color = ?");
    params.push(input.color);
  }
  if (sets.length === 0) return;
  params.push(id);
  await sqlExec(`UPDATE tags SET ${sets.join(", ")} WHERE id = ?`, params);
  notifyPotentialChange();
}

// Cascade-strip the deleted tag from every ticket's tag_ids JSON
// array, then drop the tag row. Same shape as the dependencies
// cleanup in tickets.deleteTicket.
export async function deleteTag(id: string): Promise<void> {
  const { rows } = await sqlQuery<{ id: string; tag_ids: string | null }>(
    `SELECT id, tag_ids FROM tickets WHERE tag_ids LIKE ?`,
    [`%"${id}"%`],
  );
  for (const r of rows) {
    let list: string[];
    try {
      list = JSON.parse(r.tag_ids ?? "[]");
      if (!Array.isArray(list)) continue;
    } catch {
      continue;
    }
    const next = list.filter((t) => t !== id);
    if (next.length !== list.length) {
      await sqlExec(
        `UPDATE tickets SET tag_ids = ?, updated_at = ? WHERE id = ?`,
        [next.length === 0 ? null : JSON.stringify(next), Date.now(), r.id],
      );
    }
  }
  await sqlExec(`DELETE FROM tags WHERE id = ?`, [id]);
  notifyPotentialChange();
}
