// Backend dispatcher for the workflow service.

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/workflow";
import * as sqlite from "./flexweg-sqlite/workflow";

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const getDefaultWorkflow = impl.getDefaultWorkflow;
export const subscribeToWorkflow = impl.subscribeToWorkflow;
export const ensureWorkflowExists = impl.ensureWorkflowExists;
export const saveWorkflow = impl.saveWorkflow;

// `validateWorkflow` is a pure validator with no I/O, so both backends
// share the firebase impl. Re-exporting from the source preserves the
// `asserts workflow is Workflow` annotation that callers rely on
// (which would otherwise be erased by a dispatcher indirection).
export { validateWorkflow } from "./firebase/workflow";
