import { createContext, useCallback, useContext, useMemo } from "react";
import { useTickets } from "../hooks/useTickets";
import { useSprints } from "../hooks/useSprints";
import { useWorkflow } from "../hooks/useWorkflow";
import { useUsers } from "../hooks/useUsers";

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

  const value = useMemo(
    () => ({
      tickets,
      sprints,
      activeSprint,
      completedSprints,
      workflow,
      users,
      getUserById,
      loading: ticketsLoading || sprintsLoading || workflowLoading || usersLoading,
      error: ticketsError || sprintsError || workflowError || usersError,
      backlogTickets: tickets.filter((t) => !t.sprintId),
      activeSprintTickets: activeSprint
        ? tickets.filter((t) => t.sprintId === activeSprint.id)
        : [],
    }),
    [
      tickets,
      sprints,
      activeSprint,
      completedSprints,
      workflow,
      users,
      getUserById,
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
