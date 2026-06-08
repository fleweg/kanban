import {
  addDoc,
  arrayRemove,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { collections, getDb } from "../firebaseClient";
import { DEFAULT_ISSUE_TYPE, EPIC_TYPE } from "../../lib/issueTypes";
import { GENERAL_TEAM_ID } from "../../lib/teams";
import { deleteAllAttachmentsForTicket } from "./attachments";
import type { Attachment, ChecklistItem, IssueType, Priority, Ticket } from "../../types";

const ticketsCollection = () => collection(getDb(), collections.tickets);
const ticketDoc = (id: string) => doc(getDb(), collections.tickets, id);

export function subscribeToTickets(
  onChange: (tickets: Ticket[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(ticketsCollection(), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      const tickets = snap.docs.map((d) => {
        const data = d.data();
        // Legacy fallback: pre-teams tickets have no teamId field.
        return { id: d.id, teamId: GENERAL_TEAM_ID, ...data } as Ticket;
      });
      onChange(tickets);
    },
    onError,
  );
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
  asanaGid = null,
  asanaPermalinkUrl = null,
}: CreateTicketInput) {
  // Epics are project-level containers — they never live in a sprint or in a
  // workflow column, and they cannot belong to another epic.
  const isEpicType = type === EPIC_TYPE;
  return addDoc(ticketsCollection(), {
    title: title.trim(),
    description: description.trim(),
    priority,
    sprintId: isEpicType ? null : sprintId,
    status: isEpicType ? null : status,
    createdBy,
    assigneeId,
    type,
    epicId: isEpicType ? null : epicId,
    teamId,
    startDate,
    dueDate,
    progress,
    dependencies,
    asanaGid: asanaGid ?? null,
    asanaPermalinkUrl: asanaPermalinkUrl ?? null,
    // Initial order = now, so newly created tickets land at the top of their
    // list (descending sort). Drag-reorder writes new midpoint values later.
    order: Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Used by drag-and-drop handlers. Updates the order and optionally the column
// (status) atomically — relevant for cross-column drops on the Kanban board.
// Also accepts an optional progress (used by the caller when a status change
// snaps the auto-progress rule — see autoProgressForStatus in lib/utils).
export async function reorderTicket(
  id: string,
  { order, status, progress }: { order: number; status?: string; progress?: number },
): Promise<void> {
  const data: Record<string, unknown> = { order, updatedAt: serverTimestamp() };
  if (status !== undefined) data.status = status;
  if (progress !== undefined) data.progress = progress;
  return updateDoc(ticketDoc(id), data);
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
    | "asanaGid"
    | "asanaPermalinkUrl"
  >
>;

export async function updateTicket(id: string, data: UpdateTicketInput): Promise<void> {
  return updateDoc(ticketDoc(id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTicket(id: string): Promise<void> {
  // Best-effort cleanup of Flexweg-hosted attachments before removing the
  // doc — otherwise we'd leave orphaned blobs counting against the site's
  // file quota. Read the attachments off the doc first since the cleanup
  // helper walks the array (we don't list-from-Flexweg, that'd be a
  // separate paginated API call). Failures are logged inside the helper —
  // they never block the Firestore deletion.
  const snap = await getDoc(ticketDoc(id));
  const attachments = (snap.data()?.attachments ?? []) as Attachment[];
  await deleteAllAttachmentsForTicket(id, attachments);

  // Cleanup: remove this id from any other ticket's `dependencies`.
  // We use array-contains to find candidates server-side, then a
  // single batch with arrayRemove() per doc.
  const db = getDb();
  const depSnap = await getDocs(
    query(ticketsCollection(), where("dependencies", "array-contains", id)),
  );
  if (!depSnap.empty) {
    const batch = writeBatch(db);
    depSnap.forEach((d) =>
      batch.update(d.ref, {
        dependencies: arrayRemove(id),
        updatedAt: serverTimestamp(),
      }),
    );
    await batch.commit();
  }

  return deleteDoc(ticketDoc(id));
}

export async function moveTicketToSprint(id: string, sprintId: string, status: string | null): Promise<void> {
  return updateTicket(id, { sprintId, status });
}

export async function moveTicketToBacklog(id: string): Promise<void> {
  return updateTicket(id, { sprintId: null, status: null });
}

// Sprints are team-scoped, so changing team also drops any sprint
// assignment to keep the ticket coherent with its new home.
export async function moveTicketToTeam(id: string, teamId: string): Promise<void> {
  return updateDoc(ticketDoc(id), {
    teamId,
    sprintId: null,
    status: null,
    updatedAt: serverTimestamp(),
  });
}

export async function changeTicketStatus(id: string, status: string): Promise<void> {
  return updateTicket(id, { status });
}

// Replaces the whole checklist array. Add/toggle/edit/remove/reorder all
// rebuild the array on the client and call this single setter — keeps
// concurrent writes from different fields from clobbering each other.
export async function updateChecklist(id: string, checklist: ChecklistItem[]): Promise<void> {
  return updateDoc(ticketDoc(id), {
    checklist,
    updatedAt: serverTimestamp(),
  });
}
