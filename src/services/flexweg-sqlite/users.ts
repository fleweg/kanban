// SQLite implementation of the users service. The Flexweg SQLite Auth
// API is the source of truth for who can log in — bcrypt-hashed
// passwords live in MySQL on Flexweg, and `/auth/users` lists every
// registered user. We keep a denormalized **cache** in the local
// SQLite `users` table so the UI (assignee picker, avatars) can still
// be served to non-admin users (the auth API's `/auth/users` is
// admin-only).
//
// Cache population:
//   - Every successful login UPSERTs the current user (via
//     ensureSelfUserRecord, called from AuthContext on subscribeToAuth
//     emit).
//   - Admin mutations (setUserRole / setUserDisabled / deleteUser)
//     call the API AND update the cache row so the change is visible
//     immediately to the calling admin.
//
// The "first user becomes admin" logic has moved to the server side
// (see SqliteAuthService::registerUser). We no longer derive role
// client-side — we trust whatever the auth API tells us.

import { Timestamp } from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";
import { sqlExec, sqlQuery } from "./client";
import { notifyPotentialChange, subscribeWithPolling } from "./subscriptions";
import {
  deleteUser as apiDeleteUser,
  fetchCurrentUser,
  listUsers as apiListUsers,
  updateUser as apiUpdateUser,
} from "./userAuth";
import type { UserRecord, UserRole } from "../../types";

export const USER_ROLES: { admin: UserRole; user: UserRole } = {
  admin: "admin",
  user: "user",
};

interface UserRow {
  uid: string;
  email: string;
  role: string;
  disabled: number;
  created_at: number;
  created_by: string | null;
}

function rowToUser(r: UserRow): UserRecord {
  return {
    id: r.uid,
    email: r.email,
    role: r.role as UserRole,
    disabled: !!r.disabled,
    createdAt: Timestamp.fromMillis(r.created_at),
    createdBy: r.created_by ?? undefined,
  };
}

export function subscribeToUsers(
  onChange: (users: UserRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeWithPolling(
    async () => {
      const { rows } = await sqlQuery<UserRow>(
        "SELECT * FROM users ORDER BY email ASC",
        [],
      );
      return rows.map(rowToUser);
    },
    onChange,
    onError,
  );
}

export async function getUserRecord(uid: string): Promise<UserRecord | null> {
  const { rows } = await sqlQuery<UserRow>(
    "SELECT * FROM users WHERE uid = ?",
    [uid],
  );
  return rows.length > 0 ? rowToUser(rows[0]) : null;
}

// Called by AuthContext on every login. The auth API has already
// vouched for this user — we just UPSERT them into the local cache
// so the assignee picker / avatars find them. If the same uid logs
// in from a different device, the row is updated with the latest
// email + role.
export async function ensureSelfUserRecord(authUser: FirebaseUser): Promise<UserRecord> {
  // Fetch fresh role from /auth/me so the cache reflects any admin
  // change that happened between sessions. Best-effort — if the call
  // fails, fall back to a cached-only upsert.
  let role: UserRole = USER_ROLES.user;
  let disabled = false;
  try {
    const me = await fetchCurrentUser();
    if (me) {
      role = me.role;
      disabled = me.disabled;
    }
  } catch {
    // Network blip / partial outage. Use the existing cached row if any.
    const existing = await getUserRecord(authUser.uid);
    if (existing) {
      role = existing.role;
      disabled = existing.disabled;
    }
  }

  const now = Date.now();
  const email = (authUser.email ?? "").toLowerCase();
  // SQLite >= 3.24 ON CONFLICT — atomic upsert.
  await sqlExec(
    `INSERT INTO users (uid, email, role, disabled, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       email = excluded.email,
       role = excluded.role,
       disabled = excluded.disabled`,
    [authUser.uid, email, role, disabled ? 1 : 0, now, authUser.uid],
  );
  notifyPotentialChange();
  return {
    id: authUser.uid,
    email,
    role,
    disabled,
    createdAt: Timestamp.fromMillis(now),
    createdBy: authUser.uid,
  };
}

function uidToApiId(uid: string): number {
  const n = parseInt(uid, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Cannot map uid "${uid}" to a numeric Flexweg user id.`);
  }
  return n;
}

// Admin-only — calls the auth API first (source of truth), then
// updates the local cache so the admin sees the change without
// waiting for the next /auth/me round trip from each user.
export async function setUserRole(uid: string, role: UserRole): Promise<void> {
  if (role !== USER_ROLES.admin && role !== USER_ROLES.user) {
    throw new Error("Invalid role.");
  }
  await apiUpdateUser(uidToApiId(uid), { role });
  await sqlExec("UPDATE users SET role = ? WHERE uid = ?", [role, uid]);
  notifyPotentialChange();
}

export async function setUserDisabled(uid: string, disabled: boolean): Promise<void> {
  await apiUpdateUser(uidToApiId(uid), { disabled });
  await sqlExec("UPDATE users SET disabled = ? WHERE uid = ?", [disabled ? 1 : 0, uid]);
  notifyPotentialChange();
}

export async function deleteUserRecord(uid: string): Promise<void> {
  await apiDeleteUser(uidToApiId(uid));
  await sqlExec("DELETE FROM users WHERE uid = ?", [uid]);
  notifyPotentialChange();
}

// Admin convenience: pull every registered user from the auth API
// into the local cache (one INSERT/UPSERT per row). Used by the
// admin Users page to surface team members who haven't logged in yet.
export async function syncUsersFromApi(): Promise<UserRecord[]> {
  const remote = await apiListUsers();
  const now = Date.now();
  for (const u of remote) {
    await sqlExec(
      `INSERT INTO users (uid, email, role, disabled, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         email = excluded.email,
         role = excluded.role,
         disabled = excluded.disabled`,
      [String(u.id), u.email.toLowerCase(), u.role, u.disabled ? 1 : 0, now, String(u.id)],
    );
  }
  notifyPotentialChange();
  // Read back from the cache so we get the canonical UserRecord shape.
  const { rows } = await sqlQuery<UserRow>(
    "SELECT * FROM users ORDER BY email ASC",
    [],
  );
  return rows.map(rowToUser);
}
