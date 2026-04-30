import { useEffect, useState } from "react";
import { subscribeToTickets } from "../services/tickets";
import type { Ticket } from "../types";

export interface UseTicketsResult {
  tickets: Ticket[];
  loading: boolean;
  error: Error | null;
}

export function useTickets(): UseTicketsResult {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = subscribeToTickets(
      (data) => {
        setTickets(data);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return { tickets, loading, error };
}
