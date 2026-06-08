// SQLite implementation of the Asana connector config store. Persists
// the PAT + status-sync mapping in the local SQLite `config` table
// (key="asana"). Same admin-write / all-users-read posture as the
// other config rows — enforced server-side by the SQLite Auth API.

import { sqlExec, sqlQuery } from "./client";
import type { AsanaConfig } from "../asanaConfig";

const CONFIG_KEY = "asana";

export async function getAsanaConfig(): Promise<AsanaConfig | null> {
  const { rows } = await sqlQuery<{ value: string }>(
    "SELECT value FROM config WHERE key = ?",
    [CONFIG_KEY],
  );
  if (rows.length === 0) return null;
  let data: Partial<AsanaConfig>;
  try {
    data = JSON.parse(rows[0].value) as Partial<AsanaConfig>;
  } catch {
    return null;
  }
  return {
    enabled: data.enabled === true,
    accessToken: typeof data.accessToken === "string" ? data.accessToken : "",
    statusFieldGid:
      typeof data.statusFieldGid === "string" && data.statusFieldGid.trim()
        ? data.statusFieldGid.trim()
        : undefined,
    statusMap: data.statusMap && typeof data.statusMap === "object" ? data.statusMap : undefined,
  };
}

export async function setAsanaConfig(next: AsanaConfig): Promise<void> {
  const payload = JSON.stringify({
    enabled: next.enabled,
    accessToken: next.accessToken,
    statusFieldGid: next.statusFieldGid ?? null,
    statusMap: next.statusMap ?? null,
  });
  await sqlExec(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [CONFIG_KEY, payload],
  );
}
