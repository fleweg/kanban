// SQLite implementation of the tickets service. Mirrors the function
// signatures of services/firebase/tickets.ts so the top-level
// dispatcher can swap impls based on backend.
//
// Domain types use camelCase; the SQLite columns use snake_case (see
// schema.ts). rowToTicket / ticketToRow do the translation. JSON
// columns (checklist, attachments) are parsed/stringified at the
// boundary.

import { Timestamp } from "firebase/firestore";
import { sqlBatch, sqlExec, sqlQuery } from "./client";
import { notifyPotentialChange, subscribeWithPolling } from "./subscriptions";
import { deleteAllAttachmentsForTicket } from "./attachments";
import { DEFAULT_ISSUE_TYPE, EPIC_TYPE } from "../../lib/issueTypes";
import { GENERAL_TEAM_ID } from "../../lib/teams";
import type { Attachment, ChecklistItem, IssueType, Priority, Ticket } from "../../types";

interface TicketRow {
  id: string;
  title: string;
  description: string;
  priority: string;
  type: string;
  sprint_id: string | null;
  status: string | null;
  epic_id: string | null;
  team_id: string | null;
  created_by: string | null;
  assignee_id: string | null;
  order: number | null;
  start_date: number | null;
  due_date: number | null;
  progress: number | null;
  dependencies: string | null;
  tag_ids: string | null;
  checklist: string | null;
  attachments: string | null;
  comment_count: number;
  asana_gid: string | null;
  asana_permalink_url: string | null;
  created_at: number;
  updated_at: number;
}

function parseJsonArray<T>(s: string | null | undefined): T[] | undefined {
  if (!s) return undefined;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : undefined;
  } catch {
    return undefined;
  }
}

function rowToTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? "",
    priority: r.priority as Priority,
    type: r.type as IssueType,
    sprintId: r.sprint_id,
    status: r.status,
    epicId: r.epic_id,
    teamId: r.team_id ?? GENERAL_TEAM_ID,
    createdBy: r.created_by,
    assigneeId: r.assignee_id,
    order: r.order ?? undefined,
    startDate: r.start_date,
    dueDate: r.due_date,
    progress: r.progress ?? 0,
    dependencies: parseJsonArray<string>(r.dependencies),
    tagIds: parseJsonArray<string>(r.tag_ids),
    checklist: parseJsonArray<ChecklistItem>(r.checklist),
    attachments: parseJsonArray<Attachment>(r.attachments),
    commentCount: r.comment_count ?? 0,
    asanaGid: r.asana_gid,
    asanaPermalinkUrl: r.asana_permalink_url,
    createdAt: Timestamp.fromMillis(r.created_at),
    updatedAt: Timestamp.fromMillis(r.updated_at),
  };
}

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchAllTickets(): Promise<Ticket[]> {
  // Match Firestore's `orderBy("createdAt", "desc")` so consumers see
  // the same ordering whichever backend is active.
  const { rows } = await sqlQuery<TicketRow>(
    "SELECT * FROM tickets ORDER BY created_at DESC",
    [],
  );
  return rows.map(rowToTicket);
}

export function subscribeToTickets(
  onChange: (tickets: Ticket[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeWithPolling(fetchAllTickets, onChange, onError);
}

export interface CreateTicketInput {
  title: string;
  description?: string;
  priority?: Priority;
  sprintId?: string | null;
  status?: string | null;
  createdBy?: string | null;
  assigneeId?: string | null;
  type?: IssueType;
  epicId?: string | null;
  teamId?: string;
  startDate?: number | null;
  dueDate?: number | null;
  progress?: number;
  dependencies?: string[];
  tagIds?: string[];
  asanaGid?: string | null;
  asanaPermalinkUrl?: string | null;
}

export async function createTicket({
  title,
  description = "",
  priority = "medium",
  sprintId = null,
  status = null,
  createdBy = null,
  assigneeId = null,
  type = DEFAULT_ISSUE_TYPE,
  epicId = null,
  teamId = GENERAL_TEAM_ID,
  startDate = null,
  dueDate = null,
  progress = 0,
  dependencies = [],
  tagIds = [],
  asanaGid = null,
  asanaPermalinkUrl = null,
}: CreateTicketInput): Promise<{ id: string }> {
  const isEpicType = type === EPIC_TYPE;
  const id = genId();
  const now = Date.now();
  await sqlExec(
    `INSERT INTO tickets (
      id, title, description, priority, type,
      sprint_id, status, epic_id, team_id,
      created_by, assignee_id, "order",
      start_date, due_date, progress, dependencies, tag_ids,
      asana_gid, asana_permalink_url,
      comment_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      title.trim(),
      description.trim(),
      priority,
      type,
      isEpicType ? null : sprintId,
      isEpicType ? null : status,
      isEpicType ? null : epicId,
      teamId,
      createdBy,
      assigneeId,
      now, // order
      startDate,
      dueDate,
      progress,
      Array.isArray(dependencies) && dependencies.length > 0
        ? JSON.stringify(dependencies)
        : null,
      Array.isArray(tagIds) && tagIds.length > 0 ? JSON.stringify(tagIds) : null,
      asanaGid,
      asanaPermalinkUrl,
      now, // created_at
      now, // updated_at
    ],
  );
  notifyPotentialChange();
  return { id };
}

export async function reorderTicket(
  id: string,
  { order, status, progress }: { order: number; status?: string; progress?: number },
): Promise<void> {
  // Build a dynamic SET list so we hit the same row in one write —
  // covering both same-column reorder (order only) and cross-column
  // drop (order + status + maybe auto-progress).
  const sets: string[] = [`"order" = ?`, "updated_at = ?"];
  const params: unknown[] = [order, Date.now()];
  if (status !== undefined) {
    sets.push("status = ?");
    params.push(status);
  }
  if (progress !== undefined) {
    sets.push("progress = ?");
    params.push(progress);
  }
  params.push(id);
  await sqlExec(`UPDATE tickets SET ${sets.join(", ")} WHERE id = ?`, params);
  notifyPotentialChange();
}

export type UpdateTicketInput = Partial<
  Pick<
    Ticket,
    | "title"
    | "description"
    | "priority"
    | "status"
    | "sprintId"
    | "assigneeId"
    | "type"
    | "epicId"
    | "startDate"
    | "dueDate"
    | "progress"
    | "dependencies"
    | "tagIds"
    | "asanaGid"
    | "asanaPermalinkUrl"
  >
>;

// Map domain field name → SQL column name. Used to build dynamic
// `SET col = ?, col = ?` clauses from a partial input.
const COLUMN_BY_FIELD: Record<keyof UpdateTicketInput, string> = {
  title: "title",
  description: "description",
  priority: "priority",
  status: "status",
  sprintId: "sprint_id",
  assigneeId: "assignee_id",
  type: "type",
  epicId: "epic_id",
  startDate: "start_date",
  dueDate: "due_date",
  progress: "progress",
  dependencies: "dependencies",
  tagIds: "tag_ids",
  asanaGid: "asana_gid",
  asanaPermalinkUrl: "asana_permalink_url",
};

// Fields whose value is stored as a JSON-encoded string in SQLite.
const JSON_FIELDS = new Set<keyof UpdateTicketInput>(["dependencies", "tagIds"]);

export async function updateTicket(id: string, data: UpdateTicketInput): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(data) as Array<[keyof UpdateTicketInput, unknown]>) {
    const col = COLUMN_BY_FIELD[key];
    if (!col) continue;
    sets.push(`${col} = ?`);
    if (JSON_FIELDS.has(key)) {
      params.push(value == null ? null : JSON.stringify(value));
    } else {
      params.push(value ?? null);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  params.push(Date.now());
  params.push(id);
  await sqlExec(`UPDATE tickets SET ${sets.join(", ")} WHERE id = ?`, params);
  notifyPotentialChange();
}

export async function deleteTicket(id: string): Promise<void> {
  // Comments are ON DELETE CASCADE in the schema. Attachments are
  // cleaned up explicitly via the Flexweg Files API — best-effort,
  // failures are logged but never block the DB deletion.
  const { rows } = await sqlQuery<{ attachments: string | null }>(
    "SELECT attachments FROM tickets WHERE id = ?",
    [id],
  );
  const attachments = parseJsonArray<Attachment>(rows[0]?.attachments);
  await deleteAllAttachmentsForTicket(id, attachments);

  // Strip this id from any other ticket's dependencies array.
  // SQLite doesn't have a portable JSON-array remove, so we fetch all
  // rows whose `dependencies` LIKE '%"<id>"%' and rewrite each.
  const { rows: depRows } = await sqlQuery<{ id: string; dependencies: string | null }>(
    `SELECT id, dependencies FROM tickets WHERE dependencies LIKE ?`,
    [`%"${id}"%`],
  );
  for (const r of depRows) {
    const list = parseJsonArray<string>(r.dependencies) ?? [];
    const next = list.filter((d) => d !== id);
    if (next.length !== list.length) {
      await sqlExec(
        `UPDATE tickets SET dependencies = ?, updated_at = ? WHERE id = ?`,
        [next.length === 0 ? null : JSON.stringify(next), Date.now(), r.id],
      );
    }
  }

  await sqlExec("DELETE FROM tickets WHERE id = ?", [id]);
  notifyPotentialChange();
}

export async function moveTicketToSprint(
  id: string,
  sprintId: string,
  status: string | null,
): Promise<void> {
  await sqlExec(
    "UPDATE tickets SET sprint_id = ?, status = ?, updated_at = ? WHERE id = ?",
    [sprintId, status, Date.now(), id],
  );
  notifyPotentialChange();
}

export async function moveTicketToBacklog(id: string): Promise<void> {
  await sqlExec(
    "UPDATE tickets SET sprint_id = NULL, status = NULL, updated_at = ? WHERE id = ?",
    [Date.now(), id],
  );
  notifyPotentialChange();
}

// Move a ticket to a different team. Sprints are team-scoped, so any
// sprint assignment is dropped — the ticket lands in the destination
// team's backlog.
export async function moveTicketToTeam(id: string, teamId: string): Promise<void> {
  await sqlExec(
    "UPDATE tickets SET team_id = ?, sprint_id = NULL, status = NULL, updated_at = ? WHERE id = ?",
    [teamId, Date.now(), id],
  );
  notifyPotentialChange();
}

export async function changeTicketStatus(id: string, status: string): Promise<void> {
  await sqlExec(
    "UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?",
    [status, Date.now(), id],
  );
  notifyPotentialChange();
}

export async function updateChecklist(id: string, checklist: ChecklistItem[]): Promise<void> {
  await sqlExec(
    "UPDATE tickets SET checklist = ?, updated_at = ? WHERE id = ?",
    [JSON.stringify(checklist), Date.now(), id],
  );
  notifyPotentialChange();
}

// Unused in SQLite mode (no Files-API attachments) but exported for
// dispatcher compatibility with the firebase counterpart. Caller can
// still inspect the array in case attachments were carried over from
// a previous Firebase install via a future migration.
export async function _batchWriteSchema(): Promise<void> {
  await sqlBatch([]);
}
