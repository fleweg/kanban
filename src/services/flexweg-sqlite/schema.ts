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
import { GENERAL_TEAM_ID, GENERAL_TEAM_NAME } from "../../lib/teams";
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
      display_name TEXT,
      avatar_path TEXT,
      avatar_url TEXT,
      asana_access_token TEXT,
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
      team_id TEXT NOT NULL DEFAULT 'general',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER
    )`,
  },
  { sql: `CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status)` },
  { sql: `CREATE INDEX IF NOT EXISTS idx_sprints_team ON sprints(team_id)` },

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
      team_id TEXT NOT NULL DEFAULT 'general',
      created_by TEXT,
      assignee_id TEXT,
      "order" REAL,
      start_date INTEGER,
      due_date INTEGER,
      progress INTEGER NOT NULL DEFAULT 0,
      dependencies TEXT,
      checklist TEXT,
      attachments TEXT,
      asana_gid TEXT,
      asana_permalink_url TEXT,
      comment_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  },
  { sql: `CREATE INDEX IF NOT EXISTS idx_tickets_sprint ON tickets(sprint_id)` },
  { sql: `CREATE INDEX IF NOT EXISTS idx_tickets_epic ON tickets(epic_id)` },
  { sql: `CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)` },
  { sql: `CREATE INDEX IF NOT EXISTS idx_tickets_team ON tickets(team_id)` },
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

  // -- tags ------------------------------------------------------------
  {
    sql: `CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      created_by TEXT
    )`,
  },
  { sql: `CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)` },

  // -- teams -----------------------------------------------------------
  {
    sql: `CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      created_at INTEGER NOT NULL
    )`,
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      uid TEXT NOT NULL,
      PRIMARY KEY (team_id, uid),
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,
  },
  { sql: `CREATE INDEX IF NOT EXISTS idx_team_members_uid ON team_members(uid)` },

  // -- config (workflow JSON + future single-row config rows) ----------
  {
    sql: `CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  },
];

// Initialises a fresh SQLite: creates all tables + indexes + seeds the
// default workflow JSON + general team if not present. Idempotent —
// safe to call on every boot to handle schema additions. Also runs the
// one-shot team backfill for pre-teams deployments.
export async function ensureSchema(): Promise<void> {
  await sqlBatch(SCHEMA_STATEMENTS);
  await seedDefaultWorkflowIfMissing();
  await seedGeneralTeamIfMissing();
  await ensureTeamIdColumn("tickets");
  await ensureTeamIdColumn("sprints");
  await ensureGanttColumns();
  await ensureAsanaColumns();
  await ensureAvatarColumns();
  await ensureAsanaUserTokenColumn();
  await ensureDisplayNameColumn();
  await ensureTagIdsColumn();
  await runTeamBackfillOnce();
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

async function seedGeneralTeamIfMissing(): Promise<void> {
  await sqlExec(
    "INSERT OR IGNORE INTO teams (id, name, color, created_at) VALUES (?, ?, ?, ?)",
    [GENERAL_TEAM_ID, GENERAL_TEAM_NAME, "slate", Date.now()],
  );
}

// PRAGMA table_info returns one row per column. Older pre-teams
// SQLite files lack the team_id column on tickets/sprints; this
// adds it lazily so we don't lose data on schema bump.
async function ensureTeamIdColumn(table: "tickets" | "sprints"): Promise<void> {
  const { rows } = await sqlQuery<{ name: string }>(`PRAGMA table_info(${table})`);
  if (rows.some((r) => r.name === "team_id")) return;
  await sqlExec(
    `ALTER TABLE ${table} ADD COLUMN team_id TEXT NOT NULL DEFAULT '${GENERAL_TEAM_ID}'`,
  );
}

// Adds the tag_ids JSON column on tickets lazily so SQLite deployments
// installed before this feature pick it up on next boot. The column
// stores a JSON-encoded string array (same pattern as `dependencies`).
// Idempotent.
async function ensureTagIdsColumn(): Promise<void> {
  const { rows } = await sqlQuery<{ name: string }>(`PRAGMA table_info(tickets)`);
  const have = new Set(rows.map((r) => r.name));
  if (!have.has("tag_ids")) {
    await sqlExec(`ALTER TABLE tickets ADD COLUMN tag_ids TEXT`);
  }
}

// Adds the optional display_name column lazily so SQLite deployments
// installed before this feature pick it up on next boot. Idempotent.
async function ensureDisplayNameColumn(): Promise<void> {
  const { rows } = await sqlQuery<{ name: string }>(`PRAGMA table_info(users)`);
  const have = new Set(rows.map((r) => r.name));
  if (!have.has("display_name")) {
    await sqlExec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
  }
}

// Adds the per-user Asana PAT column lazily so SQLite deployments
// installed before this feature pick it up on next boot. Idempotent.
async function ensureAsanaUserTokenColumn(): Promise<void> {
  const { rows } = await sqlQuery<{ name: string }>(`PRAGMA table_info(users)`);
  const have = new Set(rows.map((r) => r.name));
  if (!have.has("asana_access_token")) {
    await sqlExec(`ALTER TABLE users ADD COLUMN asana_access_token TEXT`);
  }
}

// Adds the avatar columns lazily on existing users tables so the
// migration is idempotent — re-running ensureSchema() on a deployment
// installed before this feature won't fail.
async function ensureAvatarColumns(): Promise<void> {
  const { rows } = await sqlQuery<{ name: string }>(`PRAGMA table_info(users)`);
  const have = new Set(rows.map((r) => r.name));
  if (!have.has("avatar_path")) {
    await sqlExec(`ALTER TABLE users ADD COLUMN avatar_path TEXT`);
  }
  if (!have.has("avatar_url")) {
    await sqlExec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`);
  }
}

// Adds the Asana-connector columns lazily on existing tickets tables.
async function ensureAsanaColumns(): Promise<void> {
  const { rows } = await sqlQuery<{ name: string }>(`PRAGMA table_info(tickets)`);
  const have = new Set(rows.map((r) => r.name));
  if (!have.has("asana_gid")) {
    await sqlExec(`ALTER TABLE tickets ADD COLUMN asana_gid TEXT`);
  }
  if (!have.has("asana_permalink_url")) {
    await sqlExec(`ALTER TABLE tickets ADD COLUMN asana_permalink_url TEXT`);
  }
}

// Adds the Gantt-related columns lazily on existing tickets tables.
async function ensureGanttColumns(): Promise<void> {
  const { rows } = await sqlQuery<{ name: string }>(`PRAGMA table_info(tickets)`);
  const have = new Set(rows.map((r) => r.name));
  if (!have.has("start_date")) {
    await sqlExec(`ALTER TABLE tickets ADD COLUMN start_date INTEGER`);
  }
  if (!have.has("due_date")) {
    await sqlExec(`ALTER TABLE tickets ADD COLUMN due_date INTEGER`);
  }
  if (!have.has("progress")) {
    await sqlExec(`ALTER TABLE tickets ADD COLUMN progress INTEGER NOT NULL DEFAULT 0`);
  }
  if (!have.has("dependencies")) {
    await sqlExec(`ALTER TABLE tickets ADD COLUMN dependencies TEXT`);
  }
}

// One-shot backfill: assigns the general team to every legacy row
// without a teamId, and enrolls every existing user as a member of
// the general team. Guarded by a config flag so it only runs once
// per deployment.
async function runTeamBackfillOnce(): Promise<void> {
  const { rows } = await sqlQuery<{ value: string }>(
    "SELECT value FROM config WHERE key = ?",
    ["team_backfill_done_at"],
  );
  if (rows.length > 0) return;
  await sqlBatch([
    {
      sql: `UPDATE tickets SET team_id = ? WHERE team_id IS NULL OR team_id = ''`,
      params: [GENERAL_TEAM_ID],
    },
    {
      sql: `UPDATE sprints SET team_id = ? WHERE team_id IS NULL OR team_id = ''`,
      params: [GENERAL_TEAM_ID],
    },
    {
      sql: `INSERT OR IGNORE INTO team_members (team_id, uid) SELECT ?, uid FROM users`,
      params: [GENERAL_TEAM_ID],
    },
    {
      sql: `INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`,
      params: ["team_backfill_done_at", String(Date.now())],
    },
  ]);
}

// Type catalog re-exported for use by SQLite services that need the
// default issue type when no value is provided client-side. Mirrors
// the Firebase service's behaviour.
export { DEFAULT_ISSUE_TYPE };
