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
}) {
  return addDoc(ticketsCollection(), {
    title: title.trim(),
    description: description.trim(),
    priority,
    sprintId,
    status,
    createdBy,
    assigneeId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
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
