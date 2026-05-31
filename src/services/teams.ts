// Backend dispatcher for the teams service. See services/tickets.ts
// for the rationale; same pattern, picks the impl at module-load time.

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/teams";
import * as sqlite from "./flexweg-sqlite/teams";

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const subscribeToTeams = impl.subscribeToTeams;
export const createTeam = impl.createTeam;
export const updateTeam = impl.updateTeam;
export const countTeamImpact = impl.countTeamImpact;
export const deleteTeam = impl.deleteTeam;

// Firebase exposes the bootstrap+backfill as ensureGeneralTeamAndBackfill;
// SQLite already runs the equivalent inside ensureSchema. We export a
// uniform "runBootMigration" entry point that resolves to either:
//   - Firebase: ensureGeneralTeamAndBackfill
//   - SQLite: no-op (the work happened in ensureSchema)
export async function runTeamsBootMigration(): Promise<void> {
  if ("ensureGeneralTeamAndBackfill" in impl) {
    await (impl as { ensureGeneralTeamAndBackfill: () => Promise<void> }).ensureGeneralTeamAndBackfill();
  }
}
