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
  order?: number;
  checklist?: ChecklistItem[];
  attachments?: Attachment[];
  commentCount?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type SprintStatus = "active" | "completed";

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  status: SprintStatus;
  createdAt?: Timestamp;
  startedAt?: Timestamp;
  endedAt?: Timestamp | null;
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
  createdAt?: Timestamp;
  createdBy?: string;
}

export type Theme = "dark" | "light";
