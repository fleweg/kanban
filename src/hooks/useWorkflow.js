import { useEffect, useState } from "react";
import { ensureWorkflowExists, getDefaultWorkflow, subscribeToWorkflow } from "../services/workflow";

export function useWorkflow() {
  const [workflow, setWorkflow] = useState(getDefaultWorkflow());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    ensureWorkflowExists().catch((err) => {
      if (!cancelled) setError(err);
    });

    const unsub = subscribeToWorkflow(
      (data) => {
        if (cancelled) return;
        setWorkflow(data);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return { workflow, loading, error };
}
