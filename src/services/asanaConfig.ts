// Backend dispatcher for the Asana connector config store. Same shape
// as flexwegConfig: Firebase mode persists in Firestore at
// `config/asana` (admin-write, all-active-users-read); SQLite mode in
// the local `config` table under the key "asana".
//
// The PAT shipped to the browser is a documented compromise — same
// threat model as the Flexweg API key. See CLAUDE.md → "API key
// handling". Acceptable for internal-team use only.

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/asanaConfig";
import * as sqlite from "./flexweg-sqlite/asanaConfig";

// Maps a Kanban workflow column id → an Asana custom-field enum value
// GID. When a ticket linked to Asana crosses into a column whose id is
// in this map, the connector PUTs the matching enum value onto the
// task's custom field.
export type AsanaStatusMap = Record<string, string>;

export interface AsanaConfig {
  // When false, the connector is dormant: no UI surfaces, no polling,
  // no writes. The PAT may still be persisted (so re-enabling is
  // friction-free), but nothing reads it.
  enabled: boolean;
  // Personal Access Token. Created in Asana → Settings → Apps →
  // Developer apps → Personal access tokens. One per user — comments
  // posted back to Asana appear as the PAT's owner.
  accessToken: string;
  // GID of the single-select custom field used to mirror the Kanban
  // column on the Asana side. Optional — when empty, status sync is
  // off and the connector is read-mostly (link, fetch task, post/poll
  // comments). When set, it must reference a custom field of type
  // "enum" on the Asana project(s) holding the linked tasks.
  statusFieldGid?: string;
  // Mapping `workflowColumnId → enum value GID`. Only columns whose id
  // appears here trigger a write. Empty map (or absent column) = no-op.
  statusMap?: AsanaStatusMap;
}

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const getAsanaConfig = impl.getAsanaConfig;
export const setAsanaConfig = impl.setAsanaConfig;
