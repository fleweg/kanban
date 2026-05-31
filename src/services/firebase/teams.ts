import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { collections, configDocs, getDb } from "../firebaseClient";
import {
  DEFAULT_TEAM_COLOR,
  GENERAL_TEAM_ID,
  GENERAL_TEAM_NAME,
} from "../../lib/teams";
import type { Team } from "../../types";

const teamsCollection = () => collection(getDb(), collections.teams);
const teamDoc = (id: string) => doc(getDb(), collections.teams, id);

export function subscribeToTeams(
  onChange: (teams: Team[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(teamsCollection(), orderBy("name", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      const teams = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Team);
      // Pin general at the top regardless of alphabetical order.
      teams.sort((a, b) => {
        if (a.id === GENERAL_TEAM_ID) return -1;
        if (b.id === GENERAL_TEAM_ID) return 1;
        return a.name.localeCompare(b.name);
      });
      onChange(teams);
    },
    onError,
  );
}

export async function createTeam(input: { name: string; color?: string }): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("Team name is required.");
  const id = `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(teamDoc(id), {
    name,
    color: input.color ?? DEFAULT_TEAM_COLOR,
    createdAt: serverTimestamp(),
  });
  return id;
}

export async function updateTeam(
  id: string,
  patch: { name?: string; color?: string },
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("Team name is required.");
    data.name = name;
  }
  if (patch.color !== undefined) data.color = patch.color;
  if (Object.keys(data).length === 0) return;
  return updateDoc(teamDoc(id), data);
}

export async function countTeamImpact(
  id: string,
): Promise<{ tickets: number; sprints: number; members: number }> {
  const db = getDb();
  const [ticketsSnap, sprintsSnap, usersSnap] = await Promise.all([
    getDocs(query(collection(db, collections.tickets), where("teamId", "==", id))),
    getDocs(query(collection(db, collections.sprints), where("teamId", "==", id))),
    getDocs(query(collection(db, collections.users), where("teamIds", "array-contains", id))),
  ]);
  return {
    tickets: ticketsSnap.size,
    sprints: sprintsSnap.size,
    members: usersSnap.size,
  };
}

export async function deleteTeam(id: string): Promise<void> {
  if (id === GENERAL_TEAM_ID) {
    throw new Error("The general team cannot be deleted.");
  }
  const db = getDb();
  const [ticketsSnap, sprintsSnap, usersSnap] = await Promise.all([
    getDocs(query(collection(db, collections.tickets), where("teamId", "==", id))),
    getDocs(query(collection(db, collections.sprints), where("teamId", "==", id))),
    getDocs(query(collection(db, collections.users), where("teamIds", "array-contains", id))),
  ]);
  const batch = writeBatch(db);
  ticketsSnap.forEach((d) =>
    batch.update(d.ref, { teamId: GENERAL_TEAM_ID, sprintId: null, status: null }),
  );
  sprintsSnap.forEach((d) => batch.update(d.ref, { teamId: GENERAL_TEAM_ID }));
  usersSnap.forEach((d) => {
    const teamIds: string[] = Array.isArray(d.data().teamIds) ? d.data().teamIds : [];
    const next = teamIds.filter((t) => t !== id);
    if (!next.includes(GENERAL_TEAM_ID)) next.push(GENERAL_TEAM_ID);
    batch.update(d.ref, { teamIds: next });
  });
  batch.delete(teamDoc(id));
  await batch.commit();
}

// First-boot bootstrap: ensures the general team exists and runs the
// one-shot legacy backfill (teamId on tickets/sprints, teamIds on
// users). Idempotent via a config/migrations doc.
export async function ensureGeneralTeamAndBackfill(): Promise<void> {
  const db = getDb();
  const migDoc = doc(db, collections.config, configDocs.migrations);
  const migSnap = await getDoc(migDoc);
  if (migSnap.exists() && (migSnap.data() as { teamBackfillAt?: unknown }).teamBackfillAt) {
    return;
  }

  await setDoc(
    teamDoc(GENERAL_TEAM_ID),
    {
      name: GENERAL_TEAM_NAME,
      color: "slate",
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );

  const [ticketsSnap, sprintsSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, collections.tickets)),
    getDocs(collection(db, collections.sprints)),
    getDocs(collection(db, collections.users)),
  ]);

  // Chunk in 400-op batches so we stay below Firestore's 500-op limit
  // per batch with headroom for the final flag write.
  let batch = writeBatch(db);
  let count = 0;
  const flushIfFull = async () => {
    if (count < 400) return;
    await batch.commit();
    batch = writeBatch(db);
    count = 0;
  };

  for (const d of ticketsSnap.docs) {
    if (!d.data().teamId) {
      batch.update(d.ref, { teamId: GENERAL_TEAM_ID });
      count++;
      await flushIfFull();
    }
  }
  for (const d of sprintsSnap.docs) {
    if (!d.data().teamId) {
      batch.update(d.ref, { teamId: GENERAL_TEAM_ID });
      count++;
      await flushIfFull();
    }
  }
  for (const d of usersSnap.docs) {
    if (!Array.isArray(d.data().teamIds)) {
      batch.update(d.ref, { teamIds: [GENERAL_TEAM_ID] });
      count++;
      await flushIfFull();
    }
  }

  batch.set(migDoc, { teamBackfillAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}
