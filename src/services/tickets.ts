// Backend dispatcher for the tickets service. Picks the implementation
// based on the active runtime backend at module-load time. The choice
// is fixed for the lifetime of the page — switching backend requires
// a reload (the Settings page handles that).
//
// Adding a new backend = drop a sibling file under
// `src/services/<backend>/tickets.ts` exposing the same function
// signatures, then add a branch in the switch below.

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/tickets";
import * as sqlite from "./flexweg-sqlite/tickets";

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const subscribeToTickets = impl.subscribeToTickets;
export const createTicket = impl.createTicket;
export const reorderTicket = impl.reorderTicket;
export const updateTicket = impl.updateTicket;
export const deleteTicket = impl.deleteTicket;
export const moveTicketToSprint = impl.moveTicketToSprint;
export const moveTicketToBacklog = impl.moveTicketToBacklog;
export const moveTicketToTeam = impl.moveTicketToTeam;
export const changeTicketStatus = impl.changeTicketStatus;
export const updateChecklist = impl.updateChecklist;

export type { CreateTicketInput, UpdateTicketInput } from "./firebase/tickets";
