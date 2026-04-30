import { useEffect, useState } from "react";
import { ensureWorkflowExists, getDefaultWorkflow, subscribeToWorkflow } from "../services/workflow";
import type { Workflow } from "../types";

export interface UseWorkflowResult {
  workflow: Workflow;
  loading: boolean;
  error: Error | null;
}

export function useWorkflow(): UseWorkflowResult {
  const [workflow, setWorkflow] = useState<Workflow>(() => getDefaultWorkflow());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureWorkflowExists().catch((err: Error) => {
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
