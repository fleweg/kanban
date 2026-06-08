import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";
import { collections, getDb } from "../firebaseClient";
import { GENERAL_TEAM_ID } from "../../lib/teams";
import type { UserRecord, UserRole } from "../../types";

export const USER_ROLES: { admin: UserRole; user: UserRole } = {
  admin: "admin",
  user: "user",
};

const usersCollection = () => collection(getDb(), collections.users);
const userDoc = (uid: string) => doc(getDb(), collections.users, uid);

function withTeamsFallback(data: Record<string, unknown>): Record<string, unknown> {
  // Legacy users predate the teamIds field; default to general so they
  // still appear in the assignee picker without a migration step.
  if (!Array.isArray((data as { teamIds?: unknown }).teamIds)) {
    return { ...data, teamIds: [GENERAL_TEAM_ID] };
  }
  return data;
}

export function subscribeToUsers(
  onChange: (users: UserRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(usersCollection(), orderBy("email", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      const users = snap.docs.map(
        (d) => ({ id: d.id, ...withTeamsFallback(d.data()) }) as UserRecord,
      );
      onChange(users);
    },
    onError,
  );
}

export async function getUserRecord(uid: string): Promise<UserRecord | null> {
  const snap = await getDoc(userDoc(uid));
  return snap.exists()
    ? ({ id: snap.id, ...withTeamsFallback(snap.data()) } as UserRecord)
    : null;
}

// Self-create record on first login. Rules enforce role === "user" and disabled === false.
export async function ensureSelfUserRecord(authUser: FirebaseUser): Promise<UserRecord> {
  const ref = userDoc(authUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const existing = { id: snap.id, ...withTeamsFallback(snap.data()) } as UserRecord;
    // Backfill teamIds on the doc itself if missing so the value
    // becomes visible to admins reading other records via list().
    if (!Array.isArray(snap.data().teamIds)) {
      try {
        await updateDoc(ref, { teamIds: [GENERAL_TEAM_ID] });
      } catch {
        // Rules may forbid update of teamIds without admin; non-fatal.
      }
    }
    return existing;
  }
  const data = {
    email: (authUser.email ?? "").toLowerCase(),
    role: USER_ROLES.user,
    disabled: false,
    teamIds: [GENERAL_TEAM_ID],
    createdAt: serverTimestamp(),
    createdBy: authUser.uid,
  };
  await setDoc(ref, data);
  return { id: authUser.uid, ...data } as unknown as UserRecord;
}

export async function setUserRole(uid: string, role: UserRole): Promise<void> {
  if (role !== USER_ROLES.admin && role !== USER_ROLES.user) {
    throw new Error("Invalid role.");
  }
  return updateDoc(userDoc(uid), { role });
}

export async function setUserDisabled(uid: string, disabled: boolean): Promise<void> {
  return updateDoc(userDoc(uid), { disabled: Boolean(disabled) });
}

// Admin-only — replace the teamIds array. We always keep general in
// the set so the user remains pickable as an assignee everywhere.
export async function setUserTeams(uid: string, teamIds: string[]): Promise<void> {
  const set = new Set<string>(teamIds);
  set.add(GENERAL_TEAM_ID);
  return updateDoc(userDoc(uid), { teamIds: Array.from(set) });
}

// Removes the Firestore record only. The Firebase Auth account must be deleted
// manually from the Firebase Console (client SDK cannot delete other users).
export async function deleteUserRecord(uid: string): Promise<void> {
  return deleteDoc(userDoc(uid));
}

// Self-set the personal Asana PAT on the user record. Pass null/empty
// to clear (fall back to the team-wide default). The Firestore rules
// allow self-update of users/{uid} as long as role/disabled/email
// stay the same — see README → "Firestore security rules". This call
// only touches `asanaAccessToken` so it satisfies the rule.
export async function setSelfAsanaToken(
  uid: string,
  token: string | null,
): Promise<void> {
  const normalized = token && token.trim() ? token.trim() : null;
  return updateDoc(userDoc(uid), { asanaAccessToken: normalized });
}
