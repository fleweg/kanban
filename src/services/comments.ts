// Backend dispatcher for the comments service.

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/comments";
import * as sqlite from "./flexweg-sqlite/comments";

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const subscribeToComments = impl.subscribeToComments;
export const addComment = impl.addComment;
export const updateComment = impl.updateComment;
export const softDeleteComment = impl.softDeleteComment;
