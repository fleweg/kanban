import { useEffect, useState } from "react";
import { subscribeToTeams } from "../services/teams";
import type { Team } from "../types";

export interface UseTeamsResult {
  teams: Team[];
  loading: boolean;
  error: Error | null;
}

export function useTeams(): UseTeamsResult {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = subscribeToTeams(
      (data) => {
        setTeams(data);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return { teams, loading, error };
}
