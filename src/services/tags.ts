// Backend dispatcher for the tags service. Global vocabulary stored
// in Firestore `tags` (Firebase mode) or the SQLite `tags` table
// (Flexweg SQLite mode). Picks the implementation at module-load time
// from `getBackendKind()` — same convention as the other services.

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/tags";
import * as sqlite from "./flexweg-sqlite/tags";

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const subscribeToTags = impl.subscribeToTags;
export const createTag = impl.createTag;
export const updateTag = impl.updateTag;
export const deleteTag = impl.deleteTag;
