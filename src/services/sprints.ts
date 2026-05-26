// Backend dispatcher for the sprints service. See services/tickets.ts
// for the rationale; same pattern, picks the impl at module-load time.

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/sprints";
import * as sqlite from "./flexweg-sqlite/sprints";

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const SPRINT_STATUS = impl.SPRINT_STATUS;
export const subscribeToSprints = impl.subscribeToSprints;
export const createSprint = impl.createSprint;
export const updateSprint = impl.updateSprint;
export const deleteSprint = impl.deleteSprint;
export const endSprintAndStartNext = impl.endSprintAndStartNext;
export const endSprintToBacklog = impl.endSprintToBacklog;
