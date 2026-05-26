// Auth glue for the Flexweg SQLite backend. Exposes the same shape
// as services/firebase/auth.ts so the top-level dispatcher
// (services/auth.ts) can swap impls based on backend.
//
// Identity comes from the Flexweg SQLite Auth API (see userAuth.ts).
// At boot, we restore the session by calling /auth/me; the user token
// itself lives in localStorage (managed by client.ts). On 401 from
// any CRUD request, the cached session is cleared and subscribers
// see `null` so the UI can redirect to the login screen.

import type { User as FirebaseUser } from "firebase/auth";
import { clearUserToken, readUserToken, setOnUnauthorized } from "./client";
import {
  fetchCurrentUser,
  loginUser,
  logoutUser,
  type FlexwegSqliteUser,
} from "./userAuth";

type FirebaseUserLike = Pick<FirebaseUser, "uid" | "email" | "displayName">;

// Converts the Flexweg user shape to the subset of FirebaseUser the
// rest of the app reads (uid / email / displayName). We cast through
// `unknown` because FirebaseUser has many more required fields
// (metadata, providerData, etc.) that are never accessed outside the
// auth layer.
function toFirebaseShape(u: FlexwegSqliteUser): FirebaseUser {
  const view: FirebaseUserLike = {
    uid: String(u.id),
    email: u.email,
    displayName: u.displayName,
  };
  return view as unknown as FirebaseUser;
}

const subscribers = new Set<(user: FirebaseUser | null) => void>();
let cachedUser: FirebaseUser | null = null;
let restoredOnce = false;
let restoreInflight: Promise<void> | null = null;

function emit(): void {
  // Snapshot to allow callbacks to mutate the set during iteration.
  for (const cb of Array.from(subscribers)) {
    try {
      cb(cachedUser);
    } catch (err) {
      console.error("subscribeToAuth listener threw", err);
    }
  }
}

// Restores the session from localStorage by calling /auth/me. Called
// lazily on the first subscribe — there's no point hitting the API
// before the app starts caring about auth state.
async function restoreSession(): Promise<void> {
  if (restoreInflight) return restoreInflight;
  restoreInflight = (async () => {
    try {
      if (!readUserToken()) {
        cachedUser = null;
      } else {
        const u = await fetchCurrentUser();
        cachedUser = u ? toFirebaseShape(u) : null;
      }
    } catch {
      cachedUser = null;
    } finally {
      restoredOnce = true;
      restoreInflight = null;
      emit();
    }
  })();
  return restoreInflight;
}

// Wire the global 401 hook from client.ts: any CRUD request that
// fails with 401 (expired session, revoked, etc.) triggers a global
// sign-out so the UI returns to the login page on the next render.
setOnUnauthorized(() => {
  clearUserToken();
  cachedUser = null;
  restoredOnce = true;
  emit();
});

export function subscribeToAuth(onChange: (user: FirebaseUser | null) => void): () => void {
  subscribers.add(onChange);
  if (!restoredOnce && !restoreInflight) {
    // First subscriber kicks off the /auth/me restore. Their callback
    // will be invoked from `emit()` when restoreSession resolves.
    restoreSession();
  } else if (restoredOnce) {
    // Already restored — emit current state on the next tick to
    // match Firebase's behaviour (callback never fires synchronously).
    const snapshot = cachedUser;
    setTimeout(() => onChange(snapshot), 0);
  }
  // (If restoreInflight is pending and !restoredOnce, the in-flight
  // restore will emit to everyone — including this new subscriber.)
  return () => {
    subscribers.delete(onChange);
  };
}

export async function signIn(email: string, password: string): Promise<FirebaseUser> {
  const res = await loginUser({ email, password });
  cachedUser = toFirebaseShape(res.user);
  restoredOnce = true;
  emit();
  return cachedUser;
}

export async function signOut(): Promise<void> {
  await logoutUser();
  cachedUser = null;
  emit();
}

export async function sendResetEmail(): Promise<void> {
  // SQLite mode has no email-based reset. Admin reset is available
  // via the Users page. Surface a clear error so the login form's
  // "Forgot password?" link can show a helpful message.
  throw new Error(
    "Password reset by email is not available. Ask an admin to reset your password from the Users page.",
  );
}

// Maps API errors to user-friendly messages. The Flexweg auth
// endpoints return `{ error, message }` envelopes — we surface the
// HTTP status code as a heuristic since `SqliteApiError` exposes it.
export function describeAuthError(err: unknown): string {
  const e = err as { status?: number; message?: string } | null;
  if (!e) return "Authentication error.";
  if (e.status === 401) return "Invalid email or password.";
  if (e.status === 403) return "Your account has been disabled.";
  if (e.status === 409) return "An account with this email already exists.";
  if (e.status === 429) return "Too many attempts. Try again in a few minutes.";
  if (e.status === 400) return e.message ?? "Invalid input.";
  return e.message ?? "Authentication error.";
}
