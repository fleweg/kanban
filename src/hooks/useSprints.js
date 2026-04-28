import { useEffect, useMemo, useState } from "react";
import { SPRINT_STATUS, subscribeToSprints } from "../services/sprints";

export function useSprints() {
  const [sprints, setSprints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = subscribeToSprints(
      (data) => {
        setSprints(data);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  const activeSprint = useMemo(
    () => sprints.find((s) => s.status === SPRINT_STATUS.active) ?? null,
    [sprints],
  );

  const completedSprints = useMemo(
    () => sprints.filter((s) => s.status === SPRINT_STATUS.completed),
    [sprints],
  );

  return { sprints, activeSprint, completedSprints, loading, error };
}
