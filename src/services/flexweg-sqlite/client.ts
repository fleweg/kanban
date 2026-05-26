// Low-level HTTP wrapper around Flexweg's /api/v1/sqlite/* endpoints.
// Every service file in this directory goes through `query`, `exec`,
// `batch`, or `version` here — there are no other call sites that
// directly fetch the Flexweg API.
//
// The runtime config supplies the API base URL and the scoped Sqlite
// token. The token is bound server-side to a single SQLite file path
// (one storage folder, one path), so even though it ends up in the
// browser it can't reach anything outside its scope.

import { getRuntimeConfig } from "../../lib/runtimeConfig";

export interface SqliteClientConfig {
  apiBaseUrl: string;
  sqliteToken: string;
}

// Storage key for the per-user session token issued by /auth/login.
// Sent as X-Sqlite-User-Token on every CRUD request to satisfy the
// scoped token's `requires_user_auth` flag.
const USER_TOKEN_STORAGE_KEY = "flexweg-kanban-user-token";

export function readUserToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(USER_TOKEN_STORAGE_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function writeUserToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_TOKEN_STORAGE_KEY, token);
}

export function clearUserToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(USER_TOKEN_STORAGE_KEY);
}

// Read the SQLite credentials from the runtime config. Throws when
// called from the Firebase backend, which would be a routing bug
// (the dispatcher should have skipped flexweg-sqlite/* entirely).
function readClientConfig(): SqliteClientConfig {
  const cfg = getRuntimeConfig();
  if (!cfg || cfg.backend !== "flexweg-sqlite") {
    throw new Error(
      "Flexweg SQLite client called outside flexweg-sqlite backend mode. This is a dispatcher bug.",
    );
  }
  return {
    apiBaseUrl: cfg.flexweg.apiBaseUrl,
    sqliteToken: cfg.flexweg.sqliteToken,
  };
}

// Raised on any non-2xx HTTP response from the SQLite API. `status`
// is the HTTP code; `body` is the (truncated) response body for
// debugging.
export class SqliteApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "SqliteApiError";
  }
}

// Hook invoked when a SQLite API call returns 401 (auth required or
// session expired). Allows AuthContext to react globally by clearing
// the cached identity and showing the login page. Default: no-op so
// that early boot calls (before AuthContext mounts) don't crash.
let onUnauthorized: () => void = () => {};

export function setOnUnauthorized(handler: () => void): void {
  onUnauthorized = handler;
}

interface CallOptions {
  // If true, the user token is NOT sent (used by /auth/login itself
  // and the bootstrap path of /auth/register where no session exists
  // yet).
  skipUserToken?: boolean;
  // Override the user token instead of reading from storage. Used by
  // the post-login flow that immediately calls /auth/me with the
  // freshly issued token before it's persisted.
  userToken?: string;
  // Master Flexweg API key. Forwarded as `X-API-Key`. Used by
  // /auth/register's bootstrap path during SetupForm (no admin
  // session exists yet so the master key is the only way the server
  // can verify the caller is authorized to seed the user pool).
  masterApiKey?: string;
}

export async function callSqlite<T>(
  path: string,
  init: RequestInit,
  cfg?: SqliteClientConfig,
  options: CallOptions = {},
): Promise<T> {
  const c = cfg ?? readClientConfig();
  const url = `${c.apiBaseUrl}/sqlite${path}`;
  const headers = new Headers(init.headers);
  headers.set("X-Sqlite-Token", c.sqliteToken);
  if (options.masterApiKey) {
    headers.set("X-API-Key", options.masterApiKey);
  }
  if (!options.skipUserToken) {
    const userTok = options.userToken ?? readUserToken();
    if (userTok) headers.set("X-Sqlite-User-Token", userTok);
  }
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 401 on a user-token-protected endpoint means the session is
    // missing or expired. Surface it globally so the app can redirect
    // to login. Don't trigger on /auth/login itself (the client just
    // failed to authenticate — handled at the call site).
    if (res.status === 401 && !path.startsWith("/auth/login") && !path.startsWith("/auth/register")) {
      try {
        onUnauthorized();
      } catch {
        // Defensive: a misbehaving handler must never break the
        // error-propagation path.
      }
    }
    throw new SqliteApiError(
      `Flexweg SQLite ${path} failed (${res.status})${body ? `: ${body.slice(0, 240)}` : ""}`,
      res.status,
      body,
    );
  }
  // 204 No Content — return empty object. Otherwise parse JSON.
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

// -- SQL execution -------------------------------------------------------

export interface SqlParams {
  sql: string;
  params?: unknown[];
}

export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number;
  version: number;
}

export interface ExecResult {
  rowsAffected: number;
  lastInsertRowId: number | null;
  version: number;
}

export interface BatchResult {
  results: Array<{ rowsAffected: number; lastInsertRowId: number | null }>;
  version: number;
}

export function sqlQuery<Row = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  cfg?: SqliteClientConfig,
): Promise<QueryResult<Row>> {
  return callSqlite("/query", {
    method: "POST",
    body: JSON.stringify({ sql, params }),
  }, cfg);
}

export function sqlExec(
  sql: string,
  params: unknown[] = [],
  cfg?: SqliteClientConfig,
): Promise<ExecResult> {
  return callSqlite("/exec", {
    method: "POST",
    body: JSON.stringify({ sql, params }),
  }, cfg);
}

export function sqlBatch(
  statements: SqlParams[],
  cfg?: SqliteClientConfig,
): Promise<BatchResult> {
  return callSqlite("/batch", {
    method: "POST",
    body: JSON.stringify({ statements }),
  }, cfg);
}

// -- Metadata ------------------------------------------------------------

export interface VersionInfo {
  version: number;
  lastModified: number;
  sizeBytes: number;
}

export function sqlVersion(cfg?: SqliteClientConfig): Promise<VersionInfo> {
  return callSqlite("/version", { method: "GET" }, cfg);
}

export interface SchemaInfo {
  tables: Array<{ name: string; sql: string }>;
}

export function sqlSchema(cfg?: SqliteClientConfig): Promise<SchemaInfo> {
  return callSqlite("/schema", { method: "GET" }, cfg);
}

export interface VacuumResult {
  sizeBefore: number;
  sizeAfter: number;
  durationMs: number;
}

export function sqlVacuum(cfg?: SqliteClientConfig): Promise<VacuumResult> {
  return callSqlite("/vacuum", { method: "POST" }, cfg);
}

// -- Install (master-key flow, only used during SetupForm) --------------

export interface InstallParams {
  // The master Flexweg API key. Used ONCE during install to exchange
  // for a scoped Sqlite token. Never stored anywhere after.
  masterApiKey: string;
  apiBaseUrl: string;
  // Where the SQLite file should live in the user's site, e.g.
  // "kanban/db.sqlite". The token gets bound to this path.
  path: string;
  // Human-readable name shown in the admin's token list.
  name: string;
  // When true (default on the server side), the issued token
  // requires an X-Sqlite-User-Token on every CRUD request — i.e.
  // proper per-user auth via the Flexweg SQLite Auth API. We send
  // it explicitly so the contract is visible at the call site.
  requireUserAuth?: boolean;
  // Optional list of origins that are allowed to use the token.
  allowedOrigins?: string[];
}

export interface InstallResponse {
  token: string;
  path: string;
  expiresAt: string | null;
}

// Calls /api/v1/sqlite/auth/install with the master API key. Returns
// the scoped Sqlite token that the SetupForm persists in config.js.
// The master key is never persisted by this function — caller is
// responsible for discarding it as soon as this returns.
export async function installSqliteApp(params: InstallParams): Promise<InstallResponse> {
  const url = `${params.apiBaseUrl}/sqlite/auth/install`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": params.masterApiKey,
    },
    body: JSON.stringify({
      path: params.path,
      name: params.name,
      requireUserAuth: params.requireUserAuth ?? true,
      allowedOrigins: params.allowedOrigins,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SqliteApiError(
      `Flexweg SQLite install failed (${res.status})${body ? `: ${body.slice(0, 240)}` : ""}`,
      res.status,
      body,
    );
  }
  return (await res.json()) as InstallResponse;
}
