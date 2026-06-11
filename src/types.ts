import type { FieldValue, Timestamp } from "firebase/firestore";

// Anything Firestore returns as a date is a Timestamp; anything we *write* as
// "now" is the serverTimestamp() sentinel (a FieldValue). Read sites use
// Timestamp; write payloads use this union so callers can hand off either.
export type FirestoreTime = Timestamp | FieldValue;

export type Priority = "low" | "medium" | "high" | "urgent";

export type IssueType = "task" | "bug" | "story" | "epic";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

// Attachment metadata stored in the ticket doc. The actual bytes live in
// Firebase Storage at `storagePath`; `url` is a tokenized download URL good
// for direct <a>/<img> consumption.
export interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  storagePath: string;
  url: string;
  uploadedAt: number;
  uploadedBy: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  // Epics never have a sprintId/status; regular tickets have null when in the
  // backlog and a sprint id + column id when assigned to the active sprint.
  sprintId: string | null;
  status: string | null;
  createdBy: string | null;
  assigneeId: string | null;
  type: IssueType;
  epicId: string | null;
  // Owning team. Defaults to GENERAL_TEAM_ID for legacy tickets.
  teamId: string;
  // Gantt-related fields. All optional; tickets without dates are
  // excluded from the Gantt page (and surfaced in a banner so the
  // user knows which ones need dating). Stored as epoch milliseconds.
  startDate?: number | null;
  dueDate?: number | null;
  // 0..100. Manual on regular tickets, derived on epics (mean of
  // children at render time). Auto-set to 100 when status reaches
  // the workflow's completedColumnId, and 0 when status reaches the
  // first column; intermediate values are preserved on status moves.
  progress?: number;
  // Finish-to-start dependencies: array of ticket ids that this
  // ticket waits on. When a source's dueDate changes, the cascade
  // helper in lib/dependencies.ts shifts this ticket's startDate +
  // dueDate to preserve duration. Cycles are refused at insertion.
  dependencies?: string[];
  // Free-form tags. Stored as an array of tag ids that reference the
  // `tags` collection (Firebase) / `tags` table (SQLite). Tags are
  // global (not team-scoped) so the same vocabulary can be reused
  // across projects. Deleting a tag cascades a strip from every
  // ticket's `tagIds` (see services/tags.deleteTag).
  tagIds?: string[];
  order?: number;
  checklist?: ChecklistItem[];
  attachments?: Attachment[];
  commentCount?: number;
  // Asana integration. When `asanaGid` is set, this ticket is linked to
  // an Asana task: the native CommentList is swapped for AsanaCommentList
  // (polls /stories), and column-change handlers may push a custom-field
  // update to Asana if status sync is configured. `asanaPermalinkUrl` is
  // the user-facing app.asana.com URL stored at link time so we don't
  // hit Asana for every render.
  asanaGid?: string | null;
  asanaPermalinkUrl?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type SprintStatus = "active" | "completed";

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  status: SprintStatus;
  teamId: string;
  createdAt?: Timestamp;
  startedAt?: Timestamp;
  endedAt?: Timestamp | null;
}

export interface Team {
  id: string;
  name: string;
  color?: string;
  createdAt?: Timestamp;
}

// Lightweight categorisation primitive. Many-to-many with tickets via
// `Ticket.tagIds`. Color is a free-choice hex string (UI offers a
// native `<input type="color">`). Global, not team-scoped — a small
// vocabulary tends to be reused across projects.
export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt?: Timestamp;
  createdBy?: string | null;
}

export interface WorkflowColumn {
  id: string;
  name: string;
  color?: string;
}

export interface Workflow {
  columns: WorkflowColumn[];
  completedColumnId: string;
}

export interface TicketComment {
  id: string;
  body: string;
  authorId: string;
  replyTo: string | null;
  edited: boolean;
  deleted: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type UserRole = "admin" | "user";

export interface UserRecord {
  id: string;
  email: string;
  role: UserRole;
  disabled: boolean;
  teamIds: string[];
  // Optional avatar image hosted on the Flexweg site. `avatarPath` is
  // the storage path inside the site (e.g. `kanban/avatars/{uid}.jpg`)
  // — used by the delete API. `avatarUrl` is the full public URL with
  // a `?v={uploadedAt}` cache-buster appended, so swapping the image
  // forces every browser to refetch instead of showing the cached
  // previous file. When both are absent the UserAvatar falls back to
  // the deterministic-color initials disc.
  avatarPath?: string | null;
  avatarUrl?: string | null;
  // Optional per-user Asana Personal Access Token. When set, the Asana
  // client uses it for every call instead of the team-wide default
  // stored in `config/asana` — so comments posted from the Kanban
  // appear as the user themselves on Asana. Falls back to the global
  // PAT (from AsanaConfig.accessToken) when null/empty. Self-writable
  // through the Profile modal; only displayed when the connector is
  // enabled globally.
  asanaAccessToken?: string | null;
  // Optional human-readable name. Captured at registration time on the
  // SQLite identity page and editable from the Profile modal. When set,
  // it's preferred over the email everywhere the user surfaces in the
  // UI (assignee picker, comment authorship, avatars' tooltip / initials,
  // identity chip in the Topbar/Sidebar). When absent, the email is the
  // fallback — see `displayNameOf` in lib/utils.
  displayName?: string | null;
  createdAt?: Timestamp;
  createdBy?: string;
}

export type Theme = "dark" | "light";
