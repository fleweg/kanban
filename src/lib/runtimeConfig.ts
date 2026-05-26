// Runtime configuration resolver. Picks the data backend + its credentials
// from one of two sources, in order:
//
//   1. window.__FLEXWEG_CONFIG__ — set synchronously by /config.js
//      before the bundle loads. This is how a "drop dist/ on Flexweg
//      and configure via the in-app form" deployment works: the
//      SetupForm uploads a populated config.js to Flexweg on success,
//      and the next reload reads it from the global.
//
//   2. import.meta.env.VITE_FIREBASE_* + VITE_ADMIN_EMAIL — populated
//      by Vite at build time from the developer's local .env, OR
//      served by Vite during `npm run dev`. This covers the legacy /
//      dev path where the developer already has credentials in .env
//      and never sees the SetupForm.
//
// Both code paths converge on the same FlexwegRuntimeConfig shape;
// the rest of the codebase only ever reads through `getRuntimeConfig()`
// and stays oblivious to which source provided the values.

import type { FirebaseOptions } from "firebase/app";

declare global {
  interface Window {
    // Set by /config.js before the main bundle loads. May be null
    // when the app is freshly deployed without baked-in env values.
    __FLEXWEG_CONFIG__?: FlexwegRuntimeConfig | LegacyFirebaseConfig | null;
  }
}

// The backend discriminator. "firebase" keeps the original Firestore +
// Firebase Auth path. "flexweg-sqlite" routes all data ops to the
// Flexweg SQLite Files API instead — no Firestore, no Firebase Auth,
// no external account required besides the Flexweg one the user
// already has for hosting.
export type BackendKind = "firebase" | "flexweg-sqlite";

export interface FirebaseRuntimeConfig {
  backend: "firebase";
  firebase: FirebaseOptions;
  // The bootstrap admin email. This Kanban detects bootstrap-admin
  // status via a plain string match against this value (see
  // services/firebase.ts.getAdminEmail() + context/AuthContext.tsx),
  // so it MUST be present for admin features (Users page, role
  // management) to light up.
  adminEmail: string;
}

export interface SqliteRuntimeConfig {
  backend: "flexweg-sqlite";
  flexweg: {
    // Base URL of the Flexweg site that hosts the SQLite file. Used to
    // build public asset URLs for attachments (same convention as the
    // Firebase mode's Flexweg attachments config).
    siteUrl: string;
    // Base URL of the Flexweg API, e.g. "https://www.flexweg.com/api/v1".
    apiBaseUrl: string;
    // Scoped Sqlite token issued by /api/v1/sqlite/auth/install. Limited
    // to one path + one storage folder + no other Flexweg permissions.
    // Stored in the browser is acceptable because of the strict scoping
    // (compared to a master API key which must NEVER be exposed).
    sqliteToken: string;
    // The path of the SQLite file inside the user's Flexweg site,
    // e.g. "kanban/db.sqlite". Used by /api/v1/sqlite/* for sanity
    // checks (the token is also bound to this path server-side).
    sqlitePath: string;
  };
}

export type FlexwegRuntimeConfig = FirebaseRuntimeConfig | SqliteRuntimeConfig;

// Backward-compat shape: pre-backend-choice config.js files just had
// { firebase, adminEmail } at the top level. We treat them as
// FirebaseRuntimeConfig on read.
interface LegacyFirebaseConfig {
  firebase: FirebaseOptions;
  adminEmail: string;
}

const FIREBASE_FIELDS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
] as const;

type FirebaseField = (typeof FIREBASE_FIELDS)[number];

// Maps a Firebase config field name to the env var that supplies it.
// Used both for build-time resolution and for the SetupForm's
// "missing fields" diagnostic.
export const ENV_KEY_BY_FIELD: Record<FirebaseField, string> = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "VITE_FIREBASE_APP_ID",
};

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function looksLikeSqliteShape(raw: unknown): raw is SqliteRuntimeConfig {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Partial<SqliteRuntimeConfig>;
  if (r.backend !== "flexweg-sqlite") return false;
  const f = r.flexweg;
  return (
    !!f &&
    typeof f === "object" &&
    nonEmpty(f.siteUrl) &&
    nonEmpty(f.apiBaseUrl) &&
    nonEmpty(f.sqliteToken) &&
    nonEmpty(f.sqlitePath)
  );
}

function looksLikeFirebaseShape(raw: unknown): raw is FirebaseRuntimeConfig {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Partial<FirebaseRuntimeConfig>;
  // Accept missing `backend` for backward compatibility with config.js
  // files generated before the backend choice was introduced.
  if (r.backend !== undefined && r.backend !== "firebase") return false;
  const fb = r.firebase;
  if (!fb) return false;
  for (const field of FIREBASE_FIELDS) {
    if (!nonEmpty((fb as Record<string, unknown>)[field])) return false;
  }
  return nonEmpty(r.adminEmail);
}

function readFromGlobal(): FlexwegRuntimeConfig | null {
  if (typeof window === "undefined") return null;
  const raw = window.__FLEXWEG_CONFIG__;
  if (!raw || typeof raw !== "object") return null;
  // Try SQLite first (explicit discriminator); fall back to Firebase
  // shape detection so legacy configs (no `backend` field) keep working.
  if (looksLikeSqliteShape(raw)) return raw;
  if (looksLikeFirebaseShape(raw)) {
    // Normalize: add `backend: "firebase"` so callers can rely on the
    // discriminator even when the source omitted it.
    return { backend: "firebase", firebase: raw.firebase, adminEmail: raw.adminEmail };
  }
  return null;
}

function readFromImportMetaEnv(): FlexwegRuntimeConfig | null {
  const env = import.meta.env;
  const firebase: Partial<FirebaseOptions> = {};
  for (const field of FIREBASE_FIELDS) {
    const v = env[ENV_KEY_BY_FIELD[field]];
    if (!nonEmpty(v)) return null;
    (firebase as Record<string, string>)[field] = v;
  }
  const adminEmail = env.VITE_ADMIN_EMAIL;
  if (!nonEmpty(adminEmail)) return null;
  return {
    backend: "firebase",
    firebase: firebase as FirebaseOptions,
    adminEmail,
  };
}

let cached: FlexwegRuntimeConfig | null | undefined;

export function getRuntimeConfig(): FlexwegRuntimeConfig | null {
  if (cached !== undefined) return cached;
  cached = readFromGlobal() ?? readFromImportMetaEnv();
  return cached;
}

// Test / setup-flow helper: drops the cache so the next call
// re-evaluates the resolver. Used by the SetupForm right after it
// populates window.__FLEXWEG_CONFIG__ so subsequent reads pick up the
// fresh values without a full page reload.
export function resetRuntimeConfigCache(): void {
  cached = undefined;
}

// Convenience: which backend is active?
export function getBackendKind(): BackendKind | null {
  return getRuntimeConfig()?.backend ?? null;
}

// Returns the env var names that would need to be set if we were
// going the .env route. Useful for the "missing fields" diagnostic
// on the pre-setup error screen and in the SetupForm. Only relevant
// for the Firebase backend — SQLite has no .env fallback.
export function getMissingFirebaseFields(): string[] {
  const fromGlobal = readFromGlobal();
  if (fromGlobal && fromGlobal.backend === "firebase") return [];
  const env = import.meta.env;
  return FIREBASE_FIELDS.filter((f) => !nonEmpty(env[ENV_KEY_BY_FIELD[f]])).map(
    (f) => ENV_KEY_BY_FIELD[f],
  );
}

// Serialises a runtime config back into the JS source code for
// /config.js. The SetupForm uploads this string to Flexweg; on the
// next reload it executes synchronously before the bundle and the
// resolver picks the values up via readFromGlobal().
//
// For Firebase mode adminEmail is INCLUDED in the serialised output —
// this Kanban detects bootstrap admin via email match against the
// runtime config (services/firebase.ts.getAdminEmail()), not via a
// Firestore-rules probe. Without it, the signed-in admin would lose
// access to the Users page after reload. The email is otherwise
// non-secret (every Firestore-rule reader can see who created docs
// anyway).
//
// For SQLite mode the scoped sqliteToken is included — it's bound to
// one specific path on one specific storage folder, so its blast
// radius is limited even though it ends up in a browser-readable file.
// The MASTER Flexweg API key is never serialized into config.js.
export function buildConfigJsSource(config: FlexwegRuntimeConfig): string {
  const banner =
    "// Generated by Flexweg Kanban first-run setup. Do not edit by hand —\n" +
    "// re-run the in-app setup form to update.\n";
  return `${banner}window.__FLEXWEG_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`;
}
