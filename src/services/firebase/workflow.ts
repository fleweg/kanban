import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { collections, configDocs, getDb } from "../firebaseClient";
import defaultWorkflow from "../../config/defaultWorkflow.json";
import type { Workflow } from "../../types";

const workflowDocRef = () => doc(getDb(), collections.config, configDocs.workflow);

export function getDefaultWorkflow(): Workflow {
  // Deep clone so callers never mutate the imported JSON module.
  return JSON.parse(JSON.stringify(defaultWorkflow));
}

export function subscribeToWorkflow(
  onChange: (workflow: Workflow) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    workflowDocRef(),
    (snap) => {
      if (snap.exists()) {
        onChange(snap.data() as Workflow);
      } else {
        onChange(getDefaultWorkflow());
      }
    },
    onError,
  );
}

export async function ensureWorkflowExists(): Promise<void> {
  const ref = workflowDocRef();
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, getDefaultWorkflow());
  }
}

export async function saveWorkflow(workflow: Workflow): Promise<void> {
  validateWorkflow(workflow);
  await setDoc(workflowDocRef(), workflow);
}

export function validateWorkflow(workflow: Workflow | null | undefined): asserts workflow is Workflow {
  if (!workflow || !Array.isArray(workflow.columns) || workflow.columns.length === 0) {
    throw new Error("Workflow must have at least one column.");
  }

  const ids = new Set<string>();
  for (const col of workflow.columns) {
    if (!col.id || typeof col.id !== "string") throw new Error("Each column needs a string id.");
    if (!col.name || typeof col.name !== "string") throw new Error("Each column needs a name.");
    if (ids.has(col.id)) throw new Error(`Duplicate column id: ${col.id}`);
    ids.add(col.id);
  }

  if (!workflow.completedColumnId) {
    throw new Error("workflow.completedColumnId is required.");
  }
  if (!ids.has(workflow.completedColumnId)) {
    throw new Error("completedColumnId must match one of the column ids.");
  }
}
