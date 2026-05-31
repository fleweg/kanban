// Backend dispatcher for the users service.

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/users";
import * as sqlite from "./flexweg-sqlite/users";

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const USER_ROLES = impl.USER_ROLES;
export const subscribeToUsers = impl.subscribeToUsers;
export const getUserRecord = impl.getUserRecord;
export const ensureSelfUserRecord = impl.ensureSelfUserRecord;
export const setUserRole = impl.setUserRole;
export const setUserDisabled = impl.setUserDisabled;
export const setUserTeams = impl.setUserTeams;
export const deleteUserRecord = impl.deleteUserRecord;
