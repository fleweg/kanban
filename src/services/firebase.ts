import { initializeApp, getApps, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";

function readConfig(): FirebaseOptions {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
}

export function getAdminEmail(): string {
  const v = import.meta.env.VITE_ADMIN_EMAIL;
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

const ENV_KEY_BY_FIELD: Record<string, string> = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "VITE_FIREBASE_APP_ID",
};

export function getMissingFirebaseEnvVars(): string[] {
  const config = readConfig() as Record<string, string | undefined>;
  return Object.entries(config)
    .filter(([, v]) => !v)
    .map(([k]) => ENV_KEY_BY_FIELD[k])
    .filter((v): v is string => Boolean(v));
}

let cachedDb: Firestore | null = null;
let cachedAuth: Auth | null = null;

function getApp(): FirebaseApp {
  const missing = getMissingFirebaseEnvVars();
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase env variables: ${missing.join(", ")}. Copy .env.example to .env and fill in your project credentials.`,
    );
  }
  return getApps()[0] ?? initializeApp(readConfig());
}

export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(getApp());
  return cachedDb;
}

export function getAuthClient(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getApp());
  return cachedAuth;
}

export const collections = {
  tickets: "tickets",
  sprints: "sprints",
  config: "config",
  users: "users",
} as const;

export const configDocs = {
  workflow: "workflow",
} as const;
