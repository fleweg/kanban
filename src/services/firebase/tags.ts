// Firestore-backed implementation of the tags service. Global
// (not team-scoped) — the same vocabulary is reused across projects.
//
// Rules posture (see README):
//   - read  / create / update : any active user (low friction — like
//     Trello labels)
//   - delete : admin only (deletion cascades through every ticket's
//     tagIds, which is a destructive change)
//
// Tag deletion cascades by querying `tickets` for `array-contains` the
// id and writing a single batch with arrayRemove on each. Capped at
// 500 ops per batch (Firestore limit) — for the kanban's scale this
// is comfortable headroom.

import {
  addDoc,
  arrayRemove,
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
import type { Tag } from "../../types";

const tagsCollection = () => collection(getDb(), collections.tags);
const tagDoc = (id: string) => doc(getDb(), collections.tags, id);

export function subscribeToTags(
  onChange: (tags: Tag[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(tagsCollection(), orderBy("name", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      const tags = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Tag);
      onChange(tags);
    },
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
  const ref = await addDoc(tagsCollection(), {
    name,
    color: input.color,
    createdBy: input.createdBy ?? null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateTag(
  id: string,
  input: Partial<Pick<Tag, "name" | "color">>,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (typeof input.name === "string") patch.name = input.name.trim();
  if (typeof input.color === "string") patch.color = input.color;
  if (Object.keys(patch).length === 0) return;
  await updateDoc(tagDoc(id), patch);
}

// Admin-only on the rules side. Cascades a `tagIds` strip across every
// ticket that referenced this tag, so the UI doesn't show "?" badges
// for orphaned ids.
export async function deleteTag(id: string): Promise<void> {
  const db = getDb();
  const ticketsRef = collection(db, collections.tickets);
  const snap = await getDocs(query(ticketsRef, where("tagIds", "array-contains", id)));
  if (!snap.empty) {
    const batch = writeBatch(db);
    snap.forEach((d) =>
      batch.update(d.ref, {
        tagIds: arrayRemove(id),
        updatedAt: serverTimestamp(),
      }),
    );
    await batch.commit();
  }
  await deleteDoc(tagDoc(id));
}
