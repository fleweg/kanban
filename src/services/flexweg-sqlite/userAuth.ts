// User-level authentication against the Flexweg SQLite API
// (`/api/v1/sqlite/auth/{register,login,logout,me,change-password,users,...}`).
//
// All endpoints require the scoped Sqlite token in `X-Sqlite-Token`
// (provided by the SqliteClientConfig in the runtime config). Auth'd
// endpoints additionally require `X-Sqlite-User-Token` — the opaque
// session token returned by /login, persisted in localStorage by the
// `client.ts` helpers.

import { callSqlite, clearUserToken, writeUserToken } from "./client";

// The user shape returned by the auth endpoints. /register and /login
// omit the timestamps; /me and /users include them.
export interface FlexwegSqliteUser {
  id: number;
  email: string;
  displayName: string | null;
  role: "admin" | "user";
  disabled: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface LoginResponse {
  success: true;
  userToken: string;
  expiresAt: string;
  user: FlexwegSqliteUser;
}

// Registers a new account on the current SQLite database.
//
// The server requires admin authorization on /auth/register — the
// scoped Sqlite token in `config.js` is public, so anyone who can
// read it would otherwise be able to seed accounts in the user pool.
// Two callers:
//
//   1. **Bootstrap** (SetupForm) — pass `masterApiKey`. The first user
//      in the empty pool gets role "admin" automatically.
//   2. **Admin onboarding** (admin Users page) — omit `masterApiKey`.
//      The caller must already be logged in as an admin; their
//      `X-Sqlite-User-Token` (read from localStorage) carries the
//      authorization.
//
// Throws SqliteApiError on duplicate email (409), invalid password
// (400), or missing authorization (401 / 403).
export async function registerUser(input: {
  email: string;
  password: string;
  displayName?: string;
  masterApiKey?: string;
}): Promise<FlexwegSqliteUser> {
  const isBootstrap = Boolean(input.masterApiKey);
  const res = await callSqlite<{ success: true; user: FlexwegSqliteUser }>(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify({
        email: input.email.trim().toLowerCase(),
        password: input.password,
        displayName: input.displayName?.trim() || undefined,
      }),
    },
    undefined,
    isBootstrap
      ? // Bootstrap: master key carries the authorization. No user
        // session exists yet, so don't bother sending one.
        { masterApiKey: input.masterApiKey, skipUserToken: true }
      : // Onboarding: the currently logged-in admin's session token
        // (default) is what authorizes the call server-side.
        {},
  );
  return res.user;
}

// Authenticates against /auth/login. On success, persists the
// returned `userToken` in localStorage and returns the full response
// (caller can read `user` + `expiresAt` from it).
export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<LoginResponse> {
  const res = await callSqlite<LoginResponse>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({
        email: input.email.trim().toLowerCase(),
        password: input.password,
      }),
    },
    undefined,
    { skipUserToken: true },
  );
  writeUserToken(res.userToken);
  return res;
}

// Logs out by revoking the session server-side and clearing the
// local token. Server failures are logged but never block — the
// local token is wiped regardless so the UI can return to the
// login screen.
export async function logoutUser(): Promise<void> {
  try {
    await callSqlite("/auth/logout", { method: "POST" });
  } catch (err) {
    console.warn("Flexweg SQLite logout failed (continuing local cleanup)", err);
  }
  clearUserToken();
}

// Fetches the currently authenticated user via /auth/me. Returns null
// when no user token is set or when the token is invalid/expired
// (401). Other errors propagate.
export async function fetchCurrentUser(): Promise<FlexwegSqliteUser | null> {
  try {
    const res = await callSqlite<{ success: true; user: FlexwegSqliteUser }>(
      "/auth/me",
      { method: "GET" },
    );
    return res.user;
  } catch (err) {
    // 401 from /me means the local token is stale — wipe it so we
    // don't keep sending an invalid token on subsequent calls. The
    // global onUnauthorized hook in client.ts also fires.
    const e = err as { status?: number };
    if (e?.status === 401) {
      clearUserToken();
      return null;
    }
    throw err;
  }
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await callSqlite(
    "/auth/change-password",
    {
      method: "POST",
      body: JSON.stringify({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      }),
    },
  );
}

// -- Admin endpoints ---------------------------------------------------

export async function listUsers(): Promise<FlexwegSqliteUser[]> {
  const res = await callSqlite<{ success: true; users: FlexwegSqliteUser[] }>(
    "/auth/users",
    { method: "GET" },
  );
  return res.users;
}

export async function updateUser(
  id: number,
  input: { role?: "admin" | "user"; disabled?: boolean; displayName?: string | null },
): Promise<FlexwegSqliteUser> {
  const res = await callSqlite<{ success: true; user: FlexwegSqliteUser }>(
    `/auth/users/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return res.user;
}

export async function adminResetPassword(id: number, newPassword: string): Promise<void> {
  await callSqlite(
    `/auth/users/${id}/reset-password`,
    {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    },
  );
}

export async function deleteUser(id: number): Promise<void> {
  await callSqlite(`/auth/users/${id}`, { method: "DELETE" });
}
