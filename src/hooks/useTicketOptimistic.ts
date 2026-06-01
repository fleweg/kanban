import { useCallback, useEffect, useMemo, useState } from "react";
import type { Ticket } from "../types";

// Optimistic-update helper for drag-and-drop in SQLite mode (and any
// other backend whose data path has a visible roundtrip — e.g. the
// polling subscription's 4-second tick).
//
// The pattern: the caller registers an override (status / order) the
// moment the user drops a card, BEFORE awaiting the server mutation.
// `effectiveTickets` reflects the override immediately so the UI
// doesn't snap back to the pre-drop position. Once the server-side
// data catches up (next poll, next snapshot), the override is auto-
// cleared by the `[tickets]` effect since the prop already reflects
// the change.
//
// On mutation failure, the caller can `clearOverride(id)` to revert
// to the server's view immediately.

export interface TicketOverride {
  status?: string | null;
  order?: number;
  progress?: number;
}

export interface UseTicketOptimistic {
  effectiveTickets: Ticket[];
  setOverride: (id: string, override: TicketOverride) => void;
  clearOverride: (id: string) => void;
}

export function useTicketOptimistic(tickets: Ticket[]): UseTicketOptimistic {
  const [overrides, setOverrides] = useState<Map<string, TicketOverride>>(() => new Map());

  // Auto-clear overrides the server has already converged on. Compare
  // each override against the freshly-arrived ticket; if every defined
  // field of the override matches, drop it.
  useEffect(() => {
    setOverrides((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const [id, override] of prev) {
        const t = tickets.find((x) => x.id === id);
        if (!t) continue;
        const statusOk = override.status === undefined || t.status === override.status;
        const orderOk = override.order === undefined || t.order === override.order;
        const progressOk = override.progress === undefined || t.progress === override.progress;
        if (statusOk && orderOk && progressOk) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tickets]);

  const effectiveTickets = useMemo(() => {
    if (overrides.size === 0) return tickets;
    return tickets.map((t) => {
      const o = overrides.get(t.id);
      return o ? { ...t, ...o } : t;
    });
  }, [tickets, overrides]);

  const setOverride = useCallback((id: string, override: TicketOverride) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, override);
      return next;
    });
  }, []);

  const clearOverride = useCallback((id: string) => {
    setOverrides((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return { effectiveTickets, setOverride, clearOverride };
}
