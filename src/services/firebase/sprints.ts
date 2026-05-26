import {
  addDoc,
  collection,
  deleteDoc,
  doc,
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
import type { Sprint, SprintStatus } from "../../types";

const sprintsCollection = () => collection(getDb(), collections.sprints);
const ticketsCollection = () => collection(getDb(), collections.tickets);
const sprintDoc = (id: string) => doc(getDb(), collections.sprints, id);

export const SPRINT_STATUS: { active: SprintStatus; completed: SprintStatus } = {
  active: "active",
  completed: "completed",
};

export function subscribeToSprints(
  onChange: (sprints: Sprint[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(sprintsCollection(), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      const sprints = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Sprint);
      onChange(sprints);
    },
    onError,
  );
}

export async function createSprint({ name, goal = "" }: { name: string; goal?: string }) {
  // Guard rail: only one active sprint at a time.
  const activeSnap = await getDocs(query(sprintsCollection(), where("status", "==", SPRINT_STATUS.active)));
  if (!activeSnap.empty) {
    throw new Error("An active sprint already exists. End it before starting a new one.");
  }

  return addDoc(sprintsCollection(), {
    name: name.trim(),
    goal: goal.trim(),
    status: SPRINT_STATUS.active,
    createdAt: serverTimestamp(),
    startedAt: serverTimestamp(),
    endedAt: null,
  });
}

export async function updateSprint(id: string, data: Partial<Omit<Sprint, "id">>): Promise<void> {
  return updateDoc(sprintDoc(id), data);
}

export async function deleteSprint(id: string): Promise<void> {
  return deleteDoc(sprintDoc(id));
}

/**
 * End the active sprint and migrate non-completed tickets to a freshly created next sprint
 * keeping their current status. Tickets in the "completed" column stay archived in the ended sprint.
 */
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

  const db = getDb();
  const activeSprintRef = doc(db, collections.sprints, activeSprintId);

  const nextSprintDocRef = await addDoc(sprintsCollection(), {
    name: nextSprintName.trim(),
    goal: nextSprintGoal.trim(),
    status: SPRINT_STATUS.active,
    createdAt: serverTimestamp(),
    startedAt: serverTimestamp(),
    endedAt: null,
  });

  const sprintTicketsSnap = await getDocs(query(ticketsCollection(), where("sprintId", "==", activeSprintId)));
  const batch = writeBatch(db);

  sprintTicketsSnap.forEach((ticketSnap) => {
    const data = ticketSnap.data();
    if (data.status !== completedColumnId) {
      batch.update(ticketSnap.ref, {
        sprintId: nextSprintDocRef.id,
        updatedAt: serverTimestamp(),
      });
    }
  });

  batch.update(activeSprintRef, {
    status: SPRINT_STATUS.completed,
    endedAt: serverTimestamp(),
  });

  await batch.commit();

  return nextSprintDocRef.id;
}

/**
 * End the active sprint without starting a new one. Unfinished tickets are sent back to the backlog.
 */
export async function endSprintToBacklog({
  activeSprintId,
  completedColumnId,
}: {
  activeSprintId: string;
  completedColumnId: string;
}): Promise<void> {
  if (!activeSprintId) throw new Error("No active sprint to end.");

  const db = getDb();
  const activeSprintRef = doc(db, collections.sprints, activeSprintId);
  const sprintTicketsSnap = await getDocs(query(ticketsCollection(), where("sprintId", "==", activeSprintId)));

  const batch = writeBatch(db);

  sprintTicketsSnap.forEach((ticketSnap) => {
    const data = ticketSnap.data();
    if (data.status !== completedColumnId) {
      batch.update(ticketSnap.ref, {
        sprintId: null,
        status: null,
        updatedAt: serverTimestamp(),
      });
    }
  });

  batch.update(activeSprintRef, {
    status: SPRINT_STATUS.completed,
    endedAt: serverTimestamp(),
  });

  await batch.commit();
}
