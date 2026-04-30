import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { collections, getDb } from "./firebase";
import { DEFAULT_ISSUE_TYPE, EPIC_TYPE } from "../lib/issueTypes";

const ticketsCollection = () => collection(getDb(), collections.tickets);
const ticketDoc = (id) => doc(getDb(), collections.tickets, id);

export function subscribeToTickets(onChange, onError) {
  const q = query(ticketsCollection(), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      const tickets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onChange(tickets);
    },
    onError,
  );
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
}) {
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
    // Initial order = now, so newly created tickets land at the top of their
    // list (descending sort). Drag-reorder writes new midpoint values later.
    order: Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Used by drag-and-drop handlers. Updates the order and optionally the column
// (status) atomically — relevant for cross-column drops on the Kanban board.
export async function reorderTicket(id, { order, status }) {
  const data = { order, updatedAt: serverTimestamp() };
  if (status !== undefined) data.status = status;
  return updateDoc(ticketDoc(id), data);
}

export async function updateTicket(id, data) {
  return updateDoc(ticketDoc(id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTicket(id) {
  return deleteDoc(ticketDoc(id));
}

export async function moveTicketToSprint(id, sprintId, status) {
  return updateTicket(id, { sprintId, status });
}

export async function moveTicketToBacklog(id) {
  return updateTicket(id, { sprintId: null, status: null });
}

export async function changeTicketStatus(id, status) {
  return updateTicket(id, { status });
}

// Replaces the whole checklist array. Add/toggle/edit/remove/reorder all
// rebuild the array on the client and call this single setter — keeps
// concurrent writes from different fields from clobbering each other.
export async function updateChecklist(id, checklist) {
  return updateDoc(ticketDoc(id), {
    checklist,
    updatedAt: serverTimestamp(),
  });
}
