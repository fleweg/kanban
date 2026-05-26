// SQLite implementation of the comments service. Comments are a
// proper relational table (not embedded JSON on the ticket) so we
// can paginate / filter / index by ticket_id.

import { Timestamp } from "firebase/firestore";
import { sqlBatch, sqlExec, sqlQuery } from "./client";
import { notifyPotentialChange, subscribeWithPolling } from "./subscriptions";
import type { TicketComment } from "../../types";

interface CommentRow {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  reply_to: string | null;
  edited: number;
  deleted: number;
  created_at: number;
  updated_at: number;
}

function rowToComment(r: CommentRow): TicketComment {
  return {
    id: r.id,
    body: r.body,
    authorId: r.author_id,
    replyTo: r.reply_to,
    edited: !!r.edited,
    deleted: !!r.deleted,
    createdAt: Timestamp.fromMillis(r.created_at),
    updatedAt: Timestamp.fromMillis(r.updated_at),
  };
}

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function subscribeToComments(
  ticketId: string,
  onChange: (comments: TicketComment[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeWithPolling(
    async () => {
      const { rows } = await sqlQuery<CommentRow>(
        "SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC",
        [ticketId],
      );
      return rows.map(rowToComment);
    },
    onChange,
    onError,
  );
}

export async function addComment({
  ticketId,
  authorId,
  body,
  replyTo = null,
}: {
  ticketId: string;
  authorId: string;
  body: string;
  replyTo?: string | null;
}): Promise<string> {
  if (!ticketId || !authorId) throw new Error("ticketId and authorId are required.");
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comment cannot be empty.");

  const id = genId();
  const now = Date.now();
  await sqlBatch([
    {
      sql: `INSERT INTO comments
        (id, ticket_id, author_id, body, reply_to, edited, deleted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      params: [id, ticketId, authorId, trimmed, replyTo ?? null, now, now],
    },
    {
      sql: "UPDATE tickets SET comment_count = comment_count + 1, updated_at = ? WHERE id = ?",
      params: [now, ticketId],
    },
  ]);
  notifyPotentialChange();
  return id;
}

export async function updateComment(
  _ticketId: string,
  commentId: string,
  body: string,
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comment cannot be empty.");
  await sqlExec(
    "UPDATE comments SET body = ?, edited = 1, updated_at = ? WHERE id = ?",
    [trimmed, Date.now(), commentId],
  );
  notifyPotentialChange();
}

export async function softDeleteComment(ticketId: string, commentId: string): Promise<void> {
  const now = Date.now();
  await sqlBatch([
    {
      sql: "UPDATE comments SET body = '', deleted = 1, updated_at = ? WHERE id = ?",
      params: [now, commentId],
    },
    {
      sql: "UPDATE tickets SET comment_count = MAX(comment_count - 1, 0), updated_at = ? WHERE id = ?",
      params: [now, ticketId],
    },
  ]);
  notifyPotentialChange();
}
