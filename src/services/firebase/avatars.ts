// Firebase-mode implementation of the avatar service. Uploads the
// resized JPEG to Flexweg via the shared helper, then writes
// `{avatarPath, avatarUrl}` onto `users/{uid}` in Firestore.
//
// Permissions: this service is only ever called by the user for
// themselves. Firestore rules allow self-update of `users/{uid}` as
// long as `role`, `disabled`, and `email` stay the same — see
// README "Firestore security rules".

import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { collections, getDb } from "../firebaseClient";
import {
  deleteAvatarOnFlexweg,
  uploadAvatarToFlexweg,
  type UploadedAvatar,
} from "../avatars/flexwegAvatarFiles";

const userDoc = (uid: string) => doc(getDb(), collections.users, uid);

export async function uploadSelfAvatar(uid: string, file: File): Promise<UploadedAvatar> {
  const meta = await uploadAvatarToFlexweg(uid, file);
  await updateDoc(userDoc(uid), {
    avatarPath: meta.path,
    avatarUrl: meta.url,
    updatedAt: serverTimestamp(),
  });
  return meta;
}

export async function removeSelfAvatar(
  uid: string,
  currentPath: string | null | undefined,
): Promise<void> {
  // Delete the file FIRST so a Firestore-rules-denied write doesn't
  // leave the Flexweg side untouched. The user can retry if the
  // record clear fails — the file will simply be re-uploaded.
  await deleteAvatarOnFlexweg(currentPath);
  await updateDoc(userDoc(uid), {
    avatarPath: null,
    avatarUrl: null,
    updatedAt: serverTimestamp(),
  });
}
