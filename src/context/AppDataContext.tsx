import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTickets } from "../hooks/useTickets";
import { useSprints } from "../hooks/useSprints";
import { useWorkflow } from "../hooks/useWorkflow";
import { useUsers } from "../hooks/useUsers";
import { useTeams } from "../hooks/useTeams";
import { useAuth } from "./AuthContext";
import { runTeamsBootMigration } from "../services/teams";
import { ensureSchema } from "../services/flexweg-sqlite/schema";
import { getBackendKind } from "../lib/runtimeConfig";
import { EPIC_TYPE } from "../lib/issueTypes";
import { GENERAL_TEAM_ID } from "../lib/teams";
import type { Sprint, Team, Ticket, UserRecord, Workflow } from "../types";

const CURRENT_TEAM_STORAGE_KEY = "kanbanCurrentTeam";

function readPersistedTeamId(): string {
  if (typeof window === "undefined") return GENERAL_TEAM_ID;
  try {
    return window.localStorage.getItem(CURRENT_TEAM_STORAGE_KEY) ?? GENERAL_TEAM_ID;
  } catch {
    return GENERAL_TEAM_ID;
  }
}

function persistTeamId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CURRENT_TEAM_STORAGE_KEY, id);
  } catch {
    // ignore (private mode, quota, etc.)
  }
}

interface AppDataValue {
  tickets: Ticket[];
  sprints: Sprint[];
  // Global active-sprint list (every team's active sprint).
  activeSprints: Sprint[];
  // Alias to currentTeamActiveSprint for backward compatibility with
  // pages/components written before the teams feature. Prefer
  // currentTeamActiveSprint in new code.
  activeSprint: Sprint | null;
  completedSprints: Sprint[];
  workflow: Workflow;
  users: UserRecord[];
  teams: Team[];
  epics: Ticket[];
  getUserById: (uid: string | null | undefined) => UserRecord | null;
  getEpicById: (id: string | null | undefined) => Ticket | null;
  getTeamById: (id: string | null | undefined) => Team | null;
  loading: boolean;
  error: Error | null;

  // Current-team scoped slices. The "current team" is persisted in
  // localStorage and changed via setCurrentTeamId from the TeamSwitcher.
  currentTeamId: string;
  setCurrentTeamId: (id: string) => void;
  myTeams: Team[];
  currentTeam: Team | null;
  currentTeamTickets: Ticket[];
  currentTeamEpics: Ticket[];
  currentTeamSprints: Sprint[];
  currentTeamActiveSprint: Sprint | null;
  currentTeamCompletedSprints: Sprint[];
  backlogTickets: Ticket[];
  activeSprintTickets: Ticket[];
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { tickets, loading: ticketsLoading, error: ticketsError } = useTickets();
  const { sprints, loading: sprintsLoading, error: sprintsError } = useSprints();
  const { workflow, loading: workflowLoading, error: workflowError } = useWorkflow();
  const { users, loading: usersLoading, error: usersError } = useUsers();
  const { teams, loading: teamsLoading, error: teamsError } = useTeams();
  const { record, isAdmin } = useAuth();

  // Fire the one-shot boot migration (Firebase only; SQLite handled it
  // in ensureSchema). Guarded internally by a Firestore flag doc.
  useEffect(() => {
    runTeamsBootMigration().catch((err) =>
      // eslint-disable-next-line no-console
      console.warn("Teams boot migration failed (will retry next boot):", err),
    );
  }, []);

  // SQLite mode only — re-run schema migrations on every authenticated
  // boot. The full `ensureSchema()` is idempotent (CREATE TABLE IF NOT
  // EXISTS, ALTER TABLE ADD COLUMN only when the column is missing,
  // seeds guarded by existence checks, team backfill guarded by a
  // config flag) so it's safe to call on every mount.
  //
  // This is what picks up post-install ALTER TABLE migrations on
  // deployments that ran the SetupForm BEFORE a new column was added
  // (avatar columns, asana_access_token, etc.). Previously these never
  // ran outside the install flow → existing installs would 400 on
  // the first write to a new column.
  useEffect(() => {
    if (getBackendKind() !== "flexweg-sqlite") return;
    ensureSchema().catch((err) =>
      // eslint-disable-next-line no-console
      console.warn("SQLite schema migration failed (will retry next boot):", err),
    );
  }, []);

  const usersById = useMemo(() => {
    const map = new Map<string, UserRecord>();
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users]);

  const getUserById = useCallback(
    (uid: string | null | undefined): UserRecord | null => (uid ? usersById.get(uid) ?? null : null),
    [usersById],
  );

  const teamsById = useMemo(() => {
    const map = new Map<string, Team>();
    for (const t of teams) map.set(t.id, t);
    return map;
  }, [teams]);

  const getTeamById = useCallback(
    (id: string | null | undefined): Team | null => (id ? teamsById.get(id) ?? null : null),
    [teamsById],
  );

  const { epics, nonEpicTickets, epicsById } = useMemo(() => {
    const eps: Ticket[] = [];
    const others: Ticket[] = [];
    for (const t of tickets) {
      if (t.type === EPIC_TYPE) eps.push(t);
      else others.push(t);
    }
    const map = new Map<string, Ticket>();
    for (const e of eps) map.set(e.id, e);
    return { epics: eps, nonEpicTickets: others, epicsById: map };
  }, [tickets]);

  const getEpicById = useCallback(
    (id: string | null | undefined): Ticket | null => (id ? epicsById.get(id) ?? null : null),
    [epicsById],
  );

  // Admin sees every team; regular users see only the teams they
  // belong to. We always include general as a safety net so the
  // switcher is never empty.
  const myTeams = useMemo(() => {
    if (isAdmin) return teams;
    const membership = new Set<string>(record?.teamIds ?? []);
    membership.add(GENERAL_TEAM_ID);
    return teams.filter((t) => membership.has(t.id));
  }, [teams, isAdmin, record]);

  const [currentTeamId, setCurrentTeamIdState] = useState<string>(readPersistedTeamId);

  // If the persisted team is one the user doesn't have access to (e.g.
  // they were removed), fall back to the first available team.
  useEffect(() => {
    if (myTeams.length === 0) return;
    if (!myTeams.some((t) => t.id === currentTeamId)) {
      const fallback = myTeams.find((t) => t.id === GENERAL_TEAM_ID) ?? myTeams[0];
      setCurrentTeamIdState(fallback.id);
      persistTeamId(fallback.id);
    }
  }, [myTeams, currentTeamId]);

  const setCurrentTeamId = useCallback((id: string) => {
    setCurrentTeamIdState(id);
    persistTeamId(id);
  }, []);

  const activeSprints = useMemo(
    () => sprints.filter((s) => s.status === "active"),
    [sprints],
  );
  const completedSprints = useMemo(
    () => sprints.filter((s) => s.status === "completed"),
    [sprints],
  );

  const currentTeam = useMemo(() => teamsById.get(currentTeamId) ?? null, [teamsById, currentTeamId]);
  const currentTeamTickets = useMemo(
    () => tickets.filter((t) => t.teamId === currentTeamId),
    [tickets, currentTeamId],
  );
  const currentTeamEpics = useMemo(
    () => epics.filter((t) => t.teamId === currentTeamId),
    [epics, currentTeamId],
  );
  const currentTeamSprints = useMemo(
    () => sprints.filter((s) => s.teamId === currentTeamId),
    [sprints, currentTeamId],
  );
  const currentTeamActiveSprint = useMemo(
    () => currentTeamSprints.find((s) => s.status === "active") ?? null,
    [currentTeamSprints],
  );
  const currentTeamCompletedSprints = useMemo(
    () => currentTeamSprints.filter((s) => s.status === "completed"),
    [currentTeamSprints],
  );

  const currentTeamNonEpics = useMemo(
    () => nonEpicTickets.filter((t) => t.teamId === currentTeamId),
    [nonEpicTickets, currentTeamId],
  );
  const backlogTickets = useMemo(
    () => currentTeamNonEpics.filter((t) => !t.sprintId),
    [currentTeamNonEpics],
  );
  const activeSprintTickets = useMemo(
    () =>
      currentTeamActiveSprint
        ? currentTeamNonEpics.filter((t) => t.sprintId === currentTeamActiveSprint.id)
        : [],
    [currentTeamNonEpics, currentTeamActiveSprint],
  );

  const value = useMemo<AppDataValue>(
    () => ({
      tickets,
      sprints,
      activeSprints,
      activeSprint: currentTeamActiveSprint,
      completedSprints,
      workflow,
      users,
      teams,
      epics,
      getUserById,
      getEpicById,
      getTeamById,
      loading:
        ticketsLoading ||
        sprintsLoading ||
        workflowLoading ||
        usersLoading ||
        teamsLoading,
      error:
        ticketsError ||
        sprintsError ||
        workflowError ||
        usersError ||
        teamsError,
      currentTeamId,
      setCurrentTeamId,
      myTeams,
      currentTeam,
      currentTeamTickets,
      currentTeamEpics,
      currentTeamSprints,
      currentTeamActiveSprint,
      currentTeamCompletedSprints,
      backlogTickets,
      activeSprintTickets,
    }),
    [
      tickets,
      sprints,
      activeSprints,
      completedSprints,
      workflow,
      users,
      teams,
      epics,
      getUserById,
      getEpicById,
      getTeamById,
      ticketsLoading,
      sprintsLoading,
      workflowLoading,
      usersLoading,
      teamsLoading,
      ticketsError,
      sprintsError,
      workflowError,
      usersError,
      teamsError,
      currentTeamId,
      setCurrentTeamId,
      myTeams,
      currentTeam,
      currentTeamTickets,
      currentTeamEpics,
      currentTeamSprints,
      currentTeamActiveSprint,
      currentTeamCompletedSprints,
      backlogTickets,
      activeSprintTickets,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used inside <AppDataProvider>");
  return ctx;
}
