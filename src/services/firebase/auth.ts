import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { getAuthClient } from "../firebaseClient";

export function subscribeToAuth(onChange: (user: FirebaseUser | null) => void): () => void {
  return onAuthStateChanged(getAuthClient(), onChange);
}

export async function signIn(email: string, password: string): Promise<FirebaseUser> {
  const cred = await signInWithEmailAndPassword(getAuthClient(), email.trim(), password);
  return cred.user;
}

export async function signOut(): Promise<void> {
  return fbSignOut(getAuthClient());
}

export async function sendResetEmail(email: string): Promise<void> {
  return sendPasswordResetEmail(getAuthClient(), email.trim());
}

// Maps Firebase Auth error codes to user-facing messages.
export function describeAuthError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code ?? "";
  switch (code) {
    case "auth/invalid-email":
      return "Invalid email address.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again later or reset your password.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/network-request-failed":
      return "Network error. Check your connection.";
    default:
      return e?.message ?? "Authentication failed.";
  }
}
