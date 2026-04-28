import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from "firebase/auth";
import { getAuthClient } from "./firebase";

export function subscribeToAuth(onChange) {
  return onAuthStateChanged(getAuthClient(), onChange);
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(getAuthClient(), email.trim(), password);
  return cred.user;
}

export async function signOut() {
  return fbSignOut(getAuthClient());
}

export async function sendResetEmail(email) {
  return sendPasswordResetEmail(getAuthClient(), email.trim());
}

// Maps Firebase Auth error codes to user-facing messages.
export function describeAuthError(err) {
  const code = err?.code ?? "";
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
      return err?.message ?? "Authentication failed.";
  }
}
