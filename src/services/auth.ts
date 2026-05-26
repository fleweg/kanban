// Backend dispatcher for the auth service.
//
// Note: in flexweg-sqlite mode, `signIn` and `sendResetEmail` are
// stubs that throw — auth is browser-local and bypasses these calls
// entirely (see context/AuthContext.tsx branching on backend).

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/auth";
import * as sqlite from "./flexweg-sqlite/auth";

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const subscribeToAuth = impl.subscribeToAuth;
export const signIn = impl.signIn;
export const signOut = impl.signOut;
export const sendResetEmail = impl.sendResetEmail;
export const describeAuthError = impl.describeAuthError;
