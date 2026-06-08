// Backend dispatcher for the avatar upload/delete flow.
//
// Both backends share the same upload path: resize to JPEG locally,
// PUT to the Flexweg Files API at `${appFolder}/avatars/{uid}.jpg`,
// then write the new `{path, url}` onto the user record (Firestore in
// Firebase mode, local SQLite cache in SQLite mode).
//
// The Flexweg API key is read through the existing `getFlexwegConfig`
// dispatcher — same threat model as attachments. The PUBLIC URL is a
// bare static asset path so any browser with the URL can fetch it;
// acceptable for internal-team use, documented in CLAUDE.md.

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/avatars";
import * as sqlite from "./flexweg-sqlite/avatars";

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const uploadSelfAvatar = impl.uploadSelfAvatar;
export const removeSelfAvatar = impl.removeSelfAvatar;
