import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

function readConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
}

export function getAdminEmail() {
  const v = import.meta.env.VITE_ADMIN_EMAIL;
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

const ENV_KEY_BY_FIELD = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "VITE_FIREBASE_APP_ID",
};

export function getMissingFirebaseEnvVars() {
  const config = readConfig();
  return Object.entries(config)
    .filter(([, v]) => !v)
    .map(([k]) => ENV_KEY_BY_FIELD[k]);
}

let cachedDb = null;
let cachedAuth = null;

function getApp() {
  const missing = getMissingFirebaseEnvVars();
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase env variables: ${missing.join(", ")}. Copy .env.example to .env and fill in your project credentials.`,
    );
  }
  return getApps()[0] ?? initializeApp(readConfig());
}

export function getDb() {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(getApp());
  return cachedDb;
}

export function getAuthClient() {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getApp());
  return cachedAuth;
}

export const collections = {
  tickets: "tickets",
  sprints: "sprints",
  config: "config",
  users: "users",
};

export const configDocs = {
  workflow: "workflow",
};
