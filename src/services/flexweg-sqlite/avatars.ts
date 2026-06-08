// SQLite-mode implementation of the avatar service. Uploads via the
// shared Flexweg helper, then writes `avatar_path` / `avatar_url` on
// the local users cache row.
//
// The SQLite layer has no row-level auth: any signed-in user can
// `UPDATE users` on any row. The client-side discipline is the
// safeguard — `uploadSelfAvatar(uid)` is always called with the
// currently authenticated user's uid (see ProfileModal). The Flexweg
// SQLite Auth API still gates access at the request level, so an
// attacker can't bypass auth entirely.

import { sqlExec } from "./client";
import { notifyPotentialChange } from "./subscriptions";
import {
  deleteAvatarOnFlexweg,
  uploadAvatarToFlexweg,
  type UploadedAvatar,
} from "../avatars/flexwegAvatarFiles";

export async function uploadSelfAvatar(uid: string, file: File): Promise<UploadedAvatar> {
  const meta = await uploadAvatarToFlexweg(uid, file);
  await sqlExec(
    "UPDATE users SET avatar_path = ?, avatar_url = ? WHERE uid = ?",
    [meta.path, meta.url, uid],
  );
  notifyPotentialChange();
  return meta;
}

export async function removeSelfAvatar(
  uid: string,
  currentPath: string | null | undefined,
): Promise<void> {
  await deleteAvatarOnFlexweg(currentPath);
  await sqlExec(
    "UPDATE users SET avatar_path = NULL, avatar_url = NULL WHERE uid = ?",
    [uid],
  );
  notifyPotentialChange();
}
