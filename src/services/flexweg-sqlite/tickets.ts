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
  created_by: string | null;
  assignee_id: string | null;
  order: number | null;
  checklist: string | null;
  attachments: string | null;
  comment_count: number;
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
    createdBy: r.created_by,
    assigneeId: r.assignee_id,
    order: r.order ?? undefined,
    checklist: parseJsonArray<ChecklistItem>(r.checklist),
    attachments: parseJsonArray<Attachment>(r.attachments),
    commentCount: r.comment_count ?? 0,
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
}: CreateTicketInput): Promise<{ id: string }> {
  const isEpicType = type === EPIC_TYPE;
  const id = genId();
  const now = Date.now();
  await sqlExec(
    `INSERT INTO tickets (
      id, title, description, priority, type,
      sprint_id, status, epic_id,
      created_by, assignee_id, "order",
      comment_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      title.trim(),
      description.trim(),
      priority,
      type,
      isEpicType ? null : sprintId,
      isEpicType ? null : status,
      isEpicType ? null : epicId,
      createdBy,
      assigneeId,
      now, // order
      now, // created_at
      now, // updated_at
    ],
  );
  notifyPotentialChange();
  return { id };
}

export async function reorderTicket(
  id: string,
  { order, status }: { order: number; status?: string },
): Promise<void> {
  if (status !== undefined) {
    await sqlExec(
      `UPDATE tickets SET "order" = ?, status = ?, updated_at = ? WHERE id = ?`,
      [order, status, Date.now(), id],
    );
  } else {
    await sqlExec(
      `UPDATE tickets SET "order" = ?, updated_at = ? WHERE id = ?`,
      [order, Date.now(), id],
    );
  }
  notifyPotentialChange();
}

export type UpdateTicketInput = Partial<
  Pick<Ticket, "title" | "description" | "priority" | "status" | "sprintId" | "assigneeId" | "type" | "epicId">
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
};

export async function updateTicket(id: string, data: UpdateTicketInput): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(data) as Array<[keyof UpdateTicketInput, unknown]>) {
    const col = COLUMN_BY_FIELD[key];
    if (!col) continue;
    sets.push(`${col} = ?`);
    params.push(value ?? null);
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
