// Backend dispatcher for the attachments service.
//
// In flexweg-sqlite mode this resolves to a "disabled" shim — uploads
// throw and the Attachments tab UI shows a "not available" banner.

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/attachments";
import * as sqlite from "./flexweg-sqlite/attachments";

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const MAX_ATTACHMENT_SIZE_BYTES = impl.MAX_ATTACHMENT_SIZE_BYTES;
export const validateAttachment = impl.validateAttachment;
export const uploadAttachment = impl.uploadAttachment;
export const deleteAttachment = impl.deleteAttachment;
export const deleteAllAttachmentsForTicket = impl.deleteAllAttachmentsForTicket;

export type { UploadHandle } from "./firebase/attachments";
