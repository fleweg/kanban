// SQLite implementation of the workflow service. The workflow JSON
// is stored as a single row in the `config` table keyed by "workflow".
// validateWorkflow / getDefaultWorkflow are re-exported from the
// firebase impl since they're pure utilities with no I/O.

import { sqlExec, sqlQuery } from "./client";
import { notifyPotentialChange, subscribeWithPolling } from "./subscriptions";
import {
  getDefaultWorkflow,
  validateWorkflow,
} from "../firebase/workflow";
import type { Workflow } from "../../types";

export { getDefaultWorkflow, validateWorkflow };

async function fetchWorkflow(): Promise<Workflow> {
  const { rows } = await sqlQuery<{ value: string }>(
    "SELECT value FROM config WHERE key = ?",
    ["workflow"],
  );
  if (rows.length === 0) return getDefaultWorkflow();
  try {
    return JSON.parse(rows[0].value) as Workflow;
  } catch {
    return getDefaultWorkflow();
  }
}

export function subscribeToWorkflow(
  onChange: (workflow: Workflow) => void,
  onError?: (err: Error) => void,
): () => void {
  return subscribeWithPolling(fetchWorkflow, onChange, onError);
}

export async function ensureWorkflowExists(): Promise<void> {
  const { rows } = await sqlQuery<{ key: string }>(
    "SELECT key FROM config WHERE key = ?",
    ["workflow"],
  );
  if (rows.length > 0) return;
  await sqlExec(
    "INSERT INTO config (key, value) VALUES (?, ?)",
    ["workflow", JSON.stringify(getDefaultWorkflow())],
  );
  notifyPotentialChange();
}

export async function saveWorkflow(workflow: Workflow): Promise<void> {
  validateWorkflow(workflow);
  // INSERT ... ON CONFLICT (key) DO UPDATE — SQLite >= 3.24 (any
  // recent build supports this). Equivalent of Firestore's setDoc.
  await sqlExec(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ["workflow", JSON.stringify(workflow)],
  );
  notifyPotentialChange();
}
