// SQLite implementation of the Flexweg API config store. The master
// Flexweg API key is persisted in the local SQLite `config` table
// (key="flexweg") so the attachments service can use it to upload to
// `/api/v1/files/*`.
//
// Threat model: the key is readable by any authenticated SQLite user
// via devtools — same exposure as Firebase mode (Firestore-stored
// key visible to all active users). Acceptable for an internal team
// tool; do not reuse this pattern on a public-facing app.

import { sqlExec, sqlQuery } from "./client";
import type { FlexwegConfig } from "../flexwegConfig";

// `FlexwegConfig` is type-only — keeps the runtime import graph
// acyclic with the top-level dispatcher.

export const DEFAULT_FLEXWEG_API_BASE_URL = "https://www.flexweg.com/api/v1";

const CONFIG_KEY = "flexweg";

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export async function getFlexwegConfig(): Promise<FlexwegConfig | null> {
  const { rows } = await sqlQuery<{ value: string }>(
    "SELECT value FROM config WHERE key = ?",
    [CONFIG_KEY],
  );
  if (rows.length === 0) return null;
  let data: Partial<FlexwegConfig>;
  try {
    data = JSON.parse(rows[0].value) as Partial<FlexwegConfig>;
  } catch {
    return null;
  }
  if (!data.apiKey || !data.siteUrl) return null;
  return {
    apiKey: data.apiKey,
    siteUrl: stripTrailingSlash(data.siteUrl),
    apiBaseUrl: stripTrailingSlash(data.apiBaseUrl ?? DEFAULT_FLEXWEG_API_BASE_URL),
  };
}

export async function setFlexwegConfig(next: FlexwegConfig): Promise<void> {
  const payload = JSON.stringify({
    apiKey: next.apiKey,
    siteUrl: stripTrailingSlash(next.siteUrl),
    apiBaseUrl: stripTrailingSlash(next.apiBaseUrl || DEFAULT_FLEXWEG_API_BASE_URL),
  });
  await sqlExec(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [CONFIG_KEY, payload],
  );
}
