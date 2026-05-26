// SQLite schema for the Kanban. Run once during install via
// `sqlBatch(SCHEMA_STATEMENTS)`. All statements are idempotent
// (`CREATE TABLE IF NOT EXISTS`), so re-running them on an existing
// DB is safe and used by the "ensure schema" check on every boot.
//
// Mirrors the Firestore document shapes but flattens to relational
// tables: comments live in their own table (referenced by ticket_id),
// checklist and attachments stay as JSON columns on tickets since
// they're tightly coupled to one ticket.
//
// Columns use snake_case in SQL to match SQLite convention; the
// rowToX/xToInsert helpers in each service file translate to the
// camelCase TypeScript domain types.

import { DEFAULT_ISSUE_TYPE } from "../../lib/issueTypes";
import { getDefaultWorkflow } from "../firebase/workflow";
import { sqlBatch, sqlExec, sqlQuery } from "./client";

export const SCHEMA_STATEMENTS: Array<{ sql: string; params?: unknown[] }> = [
  // -- users -----------------------------------------------------------
  {
    sql: `CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      created_by TEXT
    )`,
  },

  // -- sprints ---------------------------------------------------------
  {
    sql: `CREATE TABLE IF NOT EXISTS sprints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      goal TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER
    )`,
  },
  { sql: `CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status)` },

  // -- tickets ---------------------------------------------------------
  {
    sql: `CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'task',
      sprint_id TEXT,
      status TEXT,
      epic_id TEXT,
      created_by TEXT,
      assignee_id TEXT,
      "order" REAL,
      checklist TEXT,
      attachments TEXT,
      comment_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  },
  { sql: `CREATE INDEX IF NOT EXISTS idx_tickets_sprint ON tickets(sprint_id)` },
  { sql: `CREATE INDEX IF NOT EXISTS idx_tickets_epic ON tickets(epic_id)` },
  { sql: `CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)` },
  { sql: `CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC)` },

  // -- comments --------------------------------------------------------
  {
    sql: `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL,
      reply_to TEXT,
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )`,
  },
  { sql: `CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_id)` },

  // -- config (workflow JSON + future single-row config rows) ----------
  {
    sql: `CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  },
];

// Initialises a fresh SQLite: creates all tables + indexes + seeds the
// default workflow JSON if not present. Idempotent — safe to call on
// every boot to handle schema additions.
export async function ensureSchema(): Promise<void> {
  await sqlBatch(SCHEMA_STATEMENTS);
  await seedDefaultWorkflowIfMissing();
}

async function seedDefaultWorkflowIfMissing(): Promise<void> {
  const existing = await sqlQuery<{ value: string }>(
    "SELECT value FROM config WHERE key = ?",
    ["workflow"],
  );
  if (existing.rows.length > 0) return;
  const wf = getDefaultWorkflow();
  await sqlExec("INSERT INTO config (key, value) VALUES (?, ?)", [
    "workflow",
    JSON.stringify(wf),
  ]);
}

// Type catalog re-exported for use by SQLite services that need the
// default issue type when no value is provided client-side. Mirrors
// the Firebase service's behaviour.
export { DEFAULT_ISSUE_TYPE };
