import {
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { collections, getDb } from "../firebaseClient";
import type { TicketComment } from "../../types";

const ticketDoc = (ticketId: string) => doc(getDb(), collections.tickets, ticketId);
const commentsCollection = (ticketId: string) =>
  collection(getDb(), collections.tickets, ticketId, "comments");
const commentDoc = (ticketId: string, commentId: string) =>
  doc(getDb(), collections.tickets, ticketId, "comments", commentId);

export function subscribeToComments(
  ticketId: string,
  onChange: (comments: TicketComment[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(commentsCollection(ticketId), orderBy("createdAt", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TicketComment);
      onChange(comments);
    },
    onError,
  );
}

// Atomically writes the comment + increments the ticket's commentCount.
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

  const db = getDb();
  const newRef = doc(commentsCollection(ticketId));
  const batch = writeBatch(db);
  batch.set(newRef, {
    body: trimmed,
    authorId,
    replyTo: replyTo ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    edited: false,
    deleted: false,
  });
  batch.update(ticketDoc(ticketId), { commentCount: increment(1) });
  await batch.commit();
  return newRef.id;
}

export async function updateComment(ticketId: string, commentId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comment cannot be empty.");
  return updateDoc(commentDoc(ticketId, commentId), {
    body: trimmed,
    edited: true,
    updatedAt: serverTimestamp(),
  });
}

// Soft delete: replaces the body with an empty placeholder so replies pointing
// to this comment still render in context. Decrements commentCount on the ticket.
export async function softDeleteComment(ticketId: string, commentId: string): Promise<void> {
  const db = getDb();
  const batch = writeBatch(db);
  batch.update(commentDoc(ticketId, commentId), {
    body: "",
    deleted: true,
    updatedAt: serverTimestamp(),
  });
  batch.update(ticketDoc(ticketId), { commentCount: increment(-1) });
  await batch.commit();
}
