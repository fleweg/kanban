import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { collections, configDocs, getDb } from "./firebase";
import defaultWorkflow from "../config/defaultWorkflow.json";

const workflowDocRef = () => doc(getDb(), collections.config, configDocs.workflow);

export function getDefaultWorkflow() {
  // Deep clone so callers never mutate the imported JSON module.
  return JSON.parse(JSON.stringify(defaultWorkflow));
}

export function subscribeToWorkflow(onChange, onError) {
  return onSnapshot(
    workflowDocRef(),
    (snap) => {
      if (snap.exists()) {
        onChange(snap.data());
      } else {
        onChange(getDefaultWorkflow());
      }
    },
    onError,
  );
}

export async function ensureWorkflowExists() {
  const ref = workflowDocRef();
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, getDefaultWorkflow());
  }
}

export async function saveWorkflow(workflow) {
  validateWorkflow(workflow);
  await setDoc(workflowDocRef(), workflow);
}

export function validateWorkflow(workflow) {
  if (!workflow || !Array.isArray(workflow.columns) || workflow.columns.length === 0) {
    throw new Error("Workflow must have at least one column.");
  }

  const ids = new Set();
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
