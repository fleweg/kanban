import { useEffect, useState } from "react";
import { subscribeToTickets } from "../services/tickets";

export function useTickets() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
