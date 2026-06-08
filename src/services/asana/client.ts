// Browser-side client for the Asana REST API. Asana's API supports
// CORS (verified — preflight + Authorization header echo `access-
// control-allow-origin: <origin>`), so we can fetch directly from the
// SPA. No proxy involved.
//
// Threat model for the PAT: it ships to the browser, same exposure as
// the Flexweg API key (config/asana on Firestore, `config["asana"]`
// JSON in SQLite). Documented compromise — read CLAUDE.md → "API key
// handling" before reusing this for anything public-facing.

import { getAsanaConfig } from "../asanaConfig";

const ASANA_BASE = "https://app.asana.com/api/1.0";

// Two-level PAT cache.
//   - `cachedUserToken` is the active user's personal PAT (set by
//     AuthContext via setActiveUserAsanaToken whenever the live user
//     record's `asanaAccessToken` changes, and cleared on signout).
//   - `cachedGlobalToken` is the team-wide default PAT from
//     `config/asana`, lazily loaded the first time we need it.
//
// Resolution order in readToken():
//   1. cachedUserToken (when truthy)
//   2. cachedGlobalToken (fallback when the user hasn't set their own)
//   3. null  → caller raises AsanaApiError("connector disabled or PAT
//              not configured")
//
// `undefined` means "not yet resolved" — distinct from `null` which is
// "we looked but there's no token".
let cachedUserToken: string | null | undefined;
let cachedGlobalToken: string | null | undefined;

// Bust the global cache. Called from the Settings page right after a
// save so the next API call picks up the new team-wide default.
export function invalidateAsanaTokenCache(): void {
  cachedGlobalToken = undefined;
}

// Set/clear the active user's personal PAT. Called from AuthContext
// whenever `record.asanaAccessToken` changes (login, self-update via
// Profile modal, signout). Pass `null` to clear — the global default
// then takes over on the next call.
export function setActiveUserAsanaToken(token: string | null): void {
  cachedUserToken = token && token.trim() ? token.trim() : null;
}

async function readGlobalToken(): Promise<string | null> {
  if (cachedGlobalToken !== undefined) return cachedGlobalToken;
  const cfg = await getAsanaConfig();
  cachedGlobalToken = cfg?.enabled && cfg.accessToken ? cfg.accessToken : null;
  return cachedGlobalToken;
}

async function readToken(): Promise<string | null> {
  // Prefer the per-user PAT — that's how comments / status writes get
  // attributed to the real user on the Asana side. Only fall back to
  // the global PAT when the user hasn't configured their own.
  if (cachedUserToken) return cachedUserToken;
  return readGlobalToken();
}

// Raised on any non-2xx response. The `.status` field lets callers
// distinguish "PAT invalid" (401) from "rate limited" (429) from the
// generic "task not found" (404).
export class AsanaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "AsanaApiError";
  }
}

interface AsanaCallOptions {
  // Override the PAT for one call (used by Settings's "Test connection"
  // button before the new token is saved).
  tokenOverride?: string;
  // Bypass the empty-token short-circuit. Used by Settings's "Test
  // connection" to ensure the call goes out even if the cached config
  // still says enabled=false.
  allowDisabled?: boolean;
}

async function callAsana<T>(
  path: string,
  init: RequestInit = {},
  options: AsanaCallOptions = {},
): Promise<T> {
  let token = options.tokenOverride ?? (await readToken());
  if (!token && !options.allowDisabled) {
    throw new AsanaApiError(
      "Asana connector disabled or PAT not configured.",
      401,
      "",
    );
  }
  // If we got past the check above with options.allowDisabled but
  // still no token, surface a clearer error than fetch's "Bearer ".
  if (!token) {
    throw new AsanaApiError("Asana PAT is missing.", 401, "");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${ASANA_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AsanaApiError(
      `Asana ${path} failed (${res.status})${body ? `: ${body.slice(0, 240)}` : ""}`,
      res.status,
      body,
    );
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

// ----- Domain shapes ----------------------------------------------------

export interface AsanaUserRef {
  gid: string;
  name?: string;
  email?: string;
  resource_type?: string;
}

export interface AsanaProjectRef {
  gid: string;
  name?: string;
}

export interface AsanaTask {
  gid: string;
  name: string;
  html_notes?: string;
  notes?: string;
  permalink_url?: string;
  created_by?: AsanaUserRef;
  assignee?: AsanaUserRef | null;
  due_on?: string | null;
  projects?: AsanaProjectRef[];
  completed?: boolean;
}

export interface AsanaStory {
  gid: string;
  type?: string;
  // Asana's resource_subtype distinguishes user comments
  // ("comment_added") from system events. We filter on `type` so this
  // is just for diagnostics.
  resource_subtype?: string;
  created_at?: string;
  created_by?: AsanaUserRef;
  text?: string;
  html_text?: string;
}

interface NextPage {
  offset: string | null;
}

interface AsanaListResponse<T> {
  data: T[];
  next_page?: NextPage | null;
}

interface AsanaItemResponse<T> {
  data: T;
}

// ----- Endpoints --------------------------------------------------------

const TASK_OPT_FIELDS = [
  "name",
  "html_notes",
  "notes",
  "permalink_url",
  "created_by.name",
  "created_by.email",
  "assignee.name",
  "assignee.email",
  "due_on",
  "projects.name",
  "completed",
].join(",");

export async function getTask(gid: string, options?: AsanaCallOptions): Promise<AsanaTask> {
  const res = await callAsana<AsanaItemResponse<AsanaTask>>(
    `/tasks/${encodeURIComponent(gid)}?opt_fields=${encodeURIComponent(TASK_OPT_FIELDS)}`,
    { method: "GET" },
    options,
  );
  return res.data;
}

// `GET /users/me` — used by Settings → Test connection. Returns the
// authenticated user when the PAT is valid; 401 otherwise.
export async function getMe(tokenOverride: string): Promise<AsanaUserRef> {
  const res = await callAsana<AsanaItemResponse<AsanaUserRef>>(
    "/users/me",
    { method: "GET" },
    { tokenOverride, allowDisabled: true },
  );
  return res.data;
}

const STORY_OPT_FIELDS = [
  "type",
  "resource_subtype",
  "created_at",
  "created_by.name",
  "created_by.email",
  "text",
  "html_text",
].join(",");

// Lists every story on the task, following pagination until exhausted.
// Filter on `type === "comment"` at the call site to get only user
// comments (system stories are intermixed).
export async function listStories(gid: string): Promise<AsanaStory[]> {
  const all: AsanaStory[] = [];
  let offset: string | null = null;
  // Defensive cap: 50 pages × 100 items = 5000 stories — more than
  // any sane task and we want to bail before runaway pagination.
  for (let i = 0; i < 50; i++) {
    const params = new URLSearchParams({
      opt_fields: STORY_OPT_FIELDS,
      limit: "100",
    });
    if (offset) params.set("offset", offset);
    const res: AsanaListResponse<AsanaStory> = await callAsana(
      `/tasks/${encodeURIComponent(gid)}/stories?${params.toString()}`,
      { method: "GET" },
    );
    all.push(...res.data);
    offset = res.next_page?.offset ?? null;
    if (!offset) break;
  }
  return all;
}

// Posts a comment story on the task. By default sends plain text via
// the `text` field — Asana then renders newlines and links natively.
// When `htmlBody` is supplied (rich-text path), it is wrapped in
// <body>…</body> and sent via `html_text` instead. Asana's html_text
// only accepts a restricted tag set (strong, em, u, s, code, pre, ol,
// ul, li, blockquote, h1, h2, hr, a, img) — anything else is stripped
// or, in the worst case, makes Asana fall back to literal rendering.
// Never mix the two fields in one call.
export async function postStory(
  gid: string,
  content: { text: string } | { htmlBody: string },
): Promise<AsanaStory> {
  const data =
    "text" in content
      ? { text: content.text }
      : { html_text: `<body>${content.htmlBody}</body>` };
  const res = await callAsana<AsanaItemResponse<AsanaStory>>(
    `/tasks/${encodeURIComponent(gid)}/stories`,
    {
      method: "POST",
      body: JSON.stringify({ data }),
    },
  );
  return res.data;
}

// Updates a single custom field on the task to the supplied enum value
// GID. Used by the optional status-sync path: when a linked ticket
// crosses a Kanban column whose id is in `statusMap`, this fires with
// `fieldGid = statusFieldGid` and `enumGid = statusMap[columnId]`.
export async function updateCustomFieldEnum(
  gid: string,
  fieldGid: string,
  enumGid: string,
): Promise<AsanaTask> {
  const res = await callAsana<AsanaItemResponse<AsanaTask>>(
    `/tasks/${encodeURIComponent(gid)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        data: {
          custom_fields: { [fieldGid]: enumGid },
        },
      }),
    },
  );
  return res.data;
}

// Parses either a task GID (pure digits) or a full Asana task URL into
// a normalized GID. Accepts:
//   - "1234567890123"
//   - "https://app.asana.com/0/12345/67890"
//   - "https://app.asana.com/1/0/project/12345/task/67890/f"
//   - "https://app.asana.com/0/0/67890" (older format)
// Returns null when the input is not parseable.
export function parseAsanaTaskInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  try {
    const url = new URL(s);
    if (!/asana\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // Walk from the end: the task GID is the last all-digits segment.
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(parts[i])) return parts[i];
    }
    return null;
  } catch {
    return null;
  }
}
