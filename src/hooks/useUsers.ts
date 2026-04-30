import { useEffect, useState } from "react";
import { subscribeToUsers } from "../services/users";
import type { UserRecord } from "../types";

export interface UseUsersResult {
  users: UserRecord[];
  loading: boolean;
  error: Error | null;
}

export function useUsers(): UseUsersResult {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = subscribeToUsers(
      (data) => {
        setUsers(data);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return { users, loading, error };
}
