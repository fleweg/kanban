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
import { sqlBatch, sqlExec, sqlQuery } from "./client";
import { notifyPotentialChange, subscribeWithPolling } from "./subscriptions";
import { ensureSchema } from "./schema";
import {
  deleteUser as apiDeleteUser,
  fetchCurrentUser,
  listUsers as apiListUsers,
  updateUser as apiUpdateUser,
} from "./userAuth";
import { GENERAL_TEAM_ID } from "../../lib/teams";
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
  display_name: string | null;
  avatar_path: string | null;
  avatar_url: string | null;
  asana_access_token: string | null;
  created_at: number;
  created_by: string | null;
}

function rowToUser(r: UserRow, teamIds: string[]): UserRecord {
  return {
    id: r.uid,
    email: r.email,
    role: r.role as UserRole,
    disabled: !!r.disabled,
    teamIds: teamIds.length > 0 ? teamIds : [GENERAL_TEAM_ID],
    displayName: r.display_name,
    avatarPath: r.avatar_path,
    avatarUrl: r.avatar_url,
    asanaAccessToken: r.asana_access_token,
    createdAt: Timestamp.fromMillis(r.created_at),
    createdBy: r.created_by ?? undefined,
  };
}

async function fetchTeamMembershipsByUid(): Promise<Map<string, string[]>> {
  const { rows } = await sqlQuery<{ team_id: string; uid: string }>(
    "SELECT team_id, uid FROM team_members",
    [],
  );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const arr = map.get(r.uid) ?? [];
    arr.push(r.team_id);
    map.set(r.uid, arr);
  }
  return map;
}

async function fetchTeamIdsFor(uid: string): Promise<string[]> {
  const { rows } = await sqlQuery<{ team_id: string }>(
    "SELECT team_id FROM team_members WHERE uid = ?",
    [uid],
  );
  return rows.map((r) => r.team_id);
}

export function subscribeToUsers(
  onChange: (users: UserRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeWithPolling(
    async () => {
      const [usersRes, byUid] = await Promise.all([
        sqlQuery<UserRow>("SELECT * FROM users ORDER BY email ASC", []),
        fetchTeamMembershipsByUid(),
      ]);
      return usersRes.rows.map((r) => rowToUser(r, byUid.get(r.uid) ?? []));
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
  if (rows.length === 0) return null;
  const teamIds = await fetchTeamIdsFor(uid);
  return rowToUser(rows[0], teamIds);
}

// Called by AuthContext on every login. The auth API has already
// vouched for this user — we just UPSERT them into the local cache
// so the assignee picker / avatars find them. If the same uid logs
// in from a different device, the row is updated with the latest
// email + role.
export async function ensureSelfUserRecord(authUser: FirebaseUser): Promise<UserRecord> {
  // Run the schema migration BEFORE the upsert. Each AppDataContext
  // boot also runs ensureSchema, but that effect mounts AFTER auth —
  // so on existing deployments installed before a new column was
  // added (display_name, asana_access_token, …), the upsert would
  // 400 with "no such column" because the migration hadn't fired
  // yet at this point. Calling it inline here makes the function
  // self-healing on first login.
  // Idempotent: CREATE TABLE IF NOT EXISTS + ALTER ADD COLUMN guarded
  // by PRAGMA table_info() reads, so re-running this on every login
  // is cheap (~one batch + a few selects).
  try {
    await ensureSchema();
  } catch (err) {
    // Migration failure shouldn't block sign-in entirely — the user
    // can still operate on whatever columns already exist. We log
    // and continue so a transient SQL hiccup doesn't lock everyone out.
    // eslint-disable-next-line no-console
    console.warn("SQLite schema migration before user upsert failed:", err);
  }
  // Fetch fresh role from /auth/me so the cache reflects any admin
  // change that happened between sessions. Best-effort — if the call
  // fails, fall back to a cached-only upsert.
  let role: UserRole = USER_ROLES.user;
  let disabled = false;
  // displayName is sourced from the auth API only (it's the source of
  // truth — admin can edit it via apiUpdateUser too). Null means
  // "let the cache row keep its existing value" so the upsert
  // doesn't clobber an admin-set name with a stale null.
  let displayName: string | null | undefined;
  try {
    const me = await fetchCurrentUser();
    if (me) {
      role = me.role;
      disabled = me.disabled;
      displayName = me.displayName;
    }
  } catch {
    // Network blip / partial outage. Use the existing cached row if any.
    const existing = await getUserRecord(authUser.uid);
    if (existing) {
      role = existing.role;
      disabled = existing.disabled;
      displayName = existing.displayName;
    }
  }

  const now = Date.now();
  const email = (authUser.email ?? "").toLowerCase();
  // SQLite >= 3.24 ON CONFLICT — atomic upsert. We also auto-enroll
  // the user in the general team so they can be picked as an assignee
  // straight away even before an admin curates their memberships.
  // COALESCE on display_name so the upsert PRESERVES an existing
  // cache value when /auth/me returned null (offline / first call) —
  // otherwise a re-login from a node that hasn't synced yet would
  // wipe the locally-set display name.
  await sqlBatch([
    {
      sql: `INSERT INTO users (uid, email, role, disabled, display_name, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uid) DO UPDATE SET
          email = excluded.email,
          role = excluded.role,
          disabled = excluded.disabled,
          display_name = COALESCE(excluded.display_name, users.display_name)`,
      params: [
        authUser.uid,
        email,
        role,
        disabled ? 1 : 0,
        displayName ?? null,
        now,
        authUser.uid,
      ],
    },
    {
      sql: `INSERT OR IGNORE INTO team_members (team_id, uid) VALUES (?, ?)`,
      params: [GENERAL_TEAM_ID, authUser.uid],
    },
  ]);
  notifyPotentialChange();
  // Re-read the row instead of synthesising a return value — that way
  // we pick up locally-stored fields the upsert didn't touch
  // (avatarPath/Url, asanaAccessToken). Falls back to a minimal synth
  // if the read somehow fails so the caller still gets a record.
  const reread = await getUserRecord(authUser.uid);
  if (reread) return reread;
  const teamIds = await fetchTeamIdsFor(authUser.uid);
  return {
    id: authUser.uid,
    email,
    role,
    disabled,
    teamIds,
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
    await sqlBatch([
      {
        sql: `INSERT INTO users (uid, email, role, disabled, display_name, created_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(uid) DO UPDATE SET
            email = excluded.email,
            role = excluded.role,
            disabled = excluded.disabled,
            display_name = COALESCE(excluded.display_name, users.display_name)`,
        params: [
          String(u.id),
          u.email.toLowerCase(),
          u.role,
          u.disabled ? 1 : 0,
          u.displayName ?? null,
          now,
          String(u.id),
        ],
      },
      {
        sql: `INSERT OR IGNORE INTO team_members (team_id, uid) VALUES (?, ?)`,
        params: [GENERAL_TEAM_ID, String(u.id)],
      },
    ]);
  }
  notifyPotentialChange();
  const [usersRes, byUid] = await Promise.all([
    sqlQuery<UserRow>("SELECT * FROM users ORDER BY email ASC", []),
    fetchTeamMembershipsByUid(),
  ]);
  return usersRes.rows.map((r) => rowToUser(r, byUid.get(r.uid) ?? []));
}

// Admin-only: replace the set of teams a user belongs to. Always
// guarantees the user keeps at least general membership so they
// remain visible in the assignee picker.
export async function setUserTeams(uid: string, teamIds: string[]): Promise<void> {
  const set = new Set<string>(teamIds);
  set.add(GENERAL_TEAM_ID);
  const final = Array.from(set);
  const stmts: Array<{ sql: string; params: unknown[] }> = [
    { sql: "DELETE FROM team_members WHERE uid = ?", params: [uid] },
  ];
  for (const teamId of final) {
    stmts.push({
      sql: "INSERT INTO team_members (team_id, uid) VALUES (?, ?)",
      params: [teamId, uid],
    });
  }
  await sqlBatch(stmts);
  notifyPotentialChange();
}

// Self-set the personal Asana PAT. Pass null/empty to clear (fall back
// to the team-wide default token configured in Settings). No row-level
// auth at the SQLite layer — discipline is client-side: always called
// with auth-context's `uid` so a user can only write their own row.
export async function setSelfAsanaToken(
  uid: string,
  token: string | null,
): Promise<void> {
  const normalized = token && token.trim() ? token.trim() : null;
  await sqlExec(
    "UPDATE users SET asana_access_token = ? WHERE uid = ?",
    [normalized, uid],
  );
  notifyPotentialChange();
}

// Self-set the human-readable display name. Source of truth is the
// SQLite Auth API (so admins can override via apiUpdateUser too);
// we mirror to the local users cache so the UI reflects the change
// immediately without waiting for the next /auth/me round trip.
//
// Pass null/empty to clear — the UI then falls back to the email
// via displayNameOf() in lib/utils.
export async function setSelfDisplayName(
  uid: string,
  name: string | null,
): Promise<void> {
  const normalized = name && name.trim() ? name.trim() : null;
  await apiUpdateUser(uidToApiId(uid), { displayName: normalized });
  await sqlExec(
    "UPDATE users SET display_name = ? WHERE uid = ?",
    [normalized, uid],
  );
  notifyPotentialChange();
}
