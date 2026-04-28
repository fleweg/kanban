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
import { collections, getDb } from "./firebase";

export const USER_ROLES = {
  admin: "admin",
  user: "user",
};

const usersCollection = () => collection(getDb(), collections.users);
const userDoc = (uid) => doc(getDb(), collections.users, uid);

export function subscribeToUsers(onChange, onError) {
  const q = query(usersCollection(), orderBy("email", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onChange(users);
    },
    onError,
  );
}

export async function getUserRecord(uid) {
  const snap = await getDoc(userDoc(uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Self-create record on first login. Rules enforce role === "user" and disabled === false.
export async function ensureSelfUserRecord(authUser) {
  const ref = userDoc(authUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  const data = {
    email: (authUser.email ?? "").toLowerCase(),
    role: USER_ROLES.user,
    disabled: false,
    createdAt: serverTimestamp(),
    createdBy: authUser.uid,
  };
  await setDoc(ref, data);
  return { id: authUser.uid, ...data };
}

export async function setUserRole(uid, role) {
  if (role !== USER_ROLES.admin && role !== USER_ROLES.user) {
    throw new Error("Invalid role.");
  }
  return updateDoc(userDoc(uid), { role });
}

export async function setUserDisabled(uid, disabled) {
  return updateDoc(userDoc(uid), { disabled: Boolean(disabled) });
}

// Removes the Firestore record only. The Firebase Auth account must be deleted
// manually from the Firebase Console (client SDK cannot delete other users).
export async function deleteUserRecord(uid) {
  return deleteDoc(userDoc(uid));
}
