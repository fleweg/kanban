// Ticket-to-ticket dependency helpers. The model is plain
// finish-to-start (FS): each ticket carries a `dependencies: string[]`
// of upstream ticket ids. Adding "A depends on B" means A cannot
// start before B's dueDate.
//
// This module is pure (no I/O). Callers feed the current list of
// tickets and consume the resulting Map<id, patch> to dispatch
// `updateTicket` calls.

import { EPIC_TYPE } from "./issueTypes";
import type { Ticket } from "../types";

export interface DatesPatch {
  startDate?: number | null;
  dueDate?: number | null;
}

// Returns true if adding `candidateDepId` to `sourceId`'s
// dependencies would form a cycle. Cycle detection via DFS from the
// candidate dep through ITS OWN dependencies — if we ever reach
// `sourceId`, the new edge closes a loop.
//
// Note: a self-edge (sourceId === candidateDepId) is always a cycle.
export function dependenciesAreCyclic(
  tickets: Ticket[],
  sourceId: string,
  candidateDepId: string,
): boolean {
  if (sourceId === candidateDepId) return true;
  const byId = new Map<string, Ticket>();
  for (const t of tickets) byId.set(t.id, t);

  const seen = new Set<string>();
  const stack = [candidateDepId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === sourceId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = byId.get(id);
    if (!t || !Array.isArray(t.dependencies)) continue;
    for (const d of t.dependencies) stack.push(d);
  }
  return false;
}

// Resolves a ticket's earliest allowed startDate based on its
// dependencies. Returns null when:
//   - the ticket has no deps, OR
//   - every dep is undated (no dueDate),
// in which case there's no constraint to apply.
function earliestAllowedStart(
  ticket: Ticket,
  byId: Map<string, Ticket>,
): number | null {
  const deps = ticket.dependencies;
  if (!Array.isArray(deps) || deps.length === 0) return null;
  let maxDue: number | null = null;
  for (const depId of deps) {
    const dep = byId.get(depId);
    if (!dep || dep.dueDate == null) continue;
    // Per the spec: epics are NOT cascade sources (their dueDate is
    // derived in the UI from children). A ticket can still list an
    // epic in its `dependencies` array — it just contributes nothing
    // to the earliest-start computation.
    if (dep.type === EPIC_TYPE) continue;
    if (maxDue == null || dep.dueDate > maxDue) maxDue = dep.dueDate;
  }
  return maxDue;
}

// Computes the date patch needed on a single ticket to honour its
// `dependencies`. Returns null when the ticket already satisfies the
// constraint (or has no constraint to honour).
//
// Rules:
//   - If startDate is missing and we have an earliestAllowedStart,
//     just set startDate. dueDate stays as-is (caller can extend
//     later).
//   - If startDate < earliestAllowedStart, shift both startDate and
//     dueDate forward by the delta (preserves duration).
//   - If startDate >= earliestAllowedStart, no patch.
export function computeShiftFromDependencies(
  ticket: Ticket,
  byId: Map<string, Ticket>,
): DatesPatch | null {
  if (ticket.type === EPIC_TYPE) return null; // epics don't get cascade-shifted
  const earliest = earliestAllowedStart(ticket, byId);
  if (earliest == null) return null;
  if (ticket.startDate == null) {
    return { startDate: earliest };
  }
  if (ticket.startDate >= earliest) return null;
  const delta = earliest - ticket.startDate;
  const patch: DatesPatch = { startDate: earliest };
  if (ticket.dueDate != null) patch.dueDate = ticket.dueDate + delta;
  return patch;
}

// BFS from a changed source (its dueDate has just changed) through
// the dependents graph, accumulating the date patches needed to keep
// the chain consistent. Returns the patches to apply in topological
// order.
//
// `changedOverride` is optional: when the caller is about to commit
// a change to the source (but the data hasn't propagated through the
// app's subscription yet), they pass the post-change values here so
// the dependents are computed against the future state.
export function cascadeFromChangedTicket(
  tickets: Ticket[],
  changedTicketId: string,
  changedOverride?: Partial<Ticket>,
): Array<{ id: string; patch: DatesPatch }> {
  // Index + reverse-index for dependents.
  const byId = new Map<string, Ticket>();
  const dependentsOf = new Map<string, string[]>();
  for (const t of tickets) {
    const effective = t.id === changedTicketId && changedOverride
      ? ({ ...t, ...changedOverride } as Ticket)
      : t;
    byId.set(t.id, effective);
    if (Array.isArray(effective.dependencies)) {
      for (const d of effective.dependencies) {
        const list = dependentsOf.get(d) ?? [];
        list.push(t.id);
        dependentsOf.set(d, list);
      }
    }
  }

  const out: Array<{ id: string; patch: DatesPatch }> = [];
  // Mutable view: clones of tickets we've patched so far. Downstream
  // calls read this view rather than the original `byId` so a chain
  // A → B → C correctly propagates A's delta through B to C.
  const view = new Map(byId);

  const queue: string[] = [changedTicketId];
  const enqueued = new Set<string>([changedTicketId]);

  while (queue.length > 0) {
    const id = queue.shift()!;
    const dependents = dependentsOf.get(id) ?? [];
    for (const depId of dependents) {
      const ticket = view.get(depId);
      if (!ticket) continue;
      const patch = computeShiftFromDependencies(ticket, view);
      if (!patch) continue;
      out.push({ id: depId, patch });
      // Update the view so further BFS hops see the new dates.
      view.set(depId, { ...ticket, ...patch });
      if (!enqueued.has(depId)) {
        enqueued.add(depId);
        queue.push(depId);
      }
    }
  }

  return out;
}
