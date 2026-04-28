import { createContext, useCallback, useContext, useMemo } from "react";
import { useTickets } from "../hooks/useTickets";
import { useSprints } from "../hooks/useSprints";
import { useWorkflow } from "../hooks/useWorkflow";
import { useUsers } from "../hooks/useUsers";
import { EPIC_TYPE } from "../lib/issueTypes";

const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const { tickets, loading: ticketsLoading, error: ticketsError } = useTickets();
  const { sprints, activeSprint, completedSprints, loading: sprintsLoading, error: sprintsError } = useSprints();
  const { workflow, loading: workflowLoading, error: workflowError } = useWorkflow();
  const { users, loading: usersLoading, error: usersError } = useUsers();

  const usersById = useMemo(() => {
    const map = new Map();
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users]);

  const getUserById = useCallback((uid) => (uid ? usersById.get(uid) ?? null : null), [usersById]);

  // Split tickets into epics and "regular" issues. Epics are project-level
  // containers and never appear on the board / backlog list.
  const { epics, nonEpicTickets, epicsById } = useMemo(() => {
    const eps = [];
    const others = [];
    for (const t of tickets) {
      if (t.type === EPIC_TYPE) eps.push(t);
      else others.push(t);
    }
    const map = new Map();
    for (const e of eps) map.set(e.id, e);
    return { epics: eps, nonEpicTickets: others, epicsById: map };
  }, [tickets]);

  const getEpicById = useCallback((id) => (id ? epicsById.get(id) ?? null : null), [epicsById]);

  const value = useMemo(
    () => ({
      tickets,
      sprints,
      activeSprint,
      completedSprints,
      workflow,
      users,
      epics,
      getUserById,
      getEpicById,
      loading: ticketsLoading || sprintsLoading || workflowLoading || usersLoading,
      error: ticketsError || sprintsError || workflowError || usersError,
      // Backlog and active-sprint lists exclude epics.
      backlogTickets: nonEpicTickets.filter((t) => !t.sprintId),
      activeSprintTickets: activeSprint
        ? nonEpicTickets.filter((t) => t.sprintId === activeSprint.id)
        : [],
    }),
    [
      tickets,
      sprints,
      activeSprint,
      completedSprints,
      workflow,
      users,
      epics,
      nonEpicTickets,
      getUserById,
      getEpicById,
      ticketsLoading,
      sprintsLoading,
      workflowLoading,
      usersLoading,
      ticketsError,
      sprintsError,
      workflowError,
      usersError,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used inside <AppDataProvider>");
  return ctx;
}
