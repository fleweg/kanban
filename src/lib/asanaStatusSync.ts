// Tiny pure helper that pushes a Kanban column change up to Asana
// via the custom-field update endpoint. Used by KanbanBoard drag,
// BacklogPage.moveToSprint, and TicketModal submit.
//
// Strategy: read the statusFieldGid + statusMap from the AsanaConfig
// already loaded in memory. If the column id is not in the map (or
// the connector is disabled / unconfigured), no-op silently. Errors
// are swallowed by the caller — a network blip should never block a
// local mutation.

import { updateCustomFieldEnum } from "../services/asana/client";
import type { AsanaConfig } from "../services/asanaConfig";

export async function syncAsanaStatusForTicket(
  asanaGid: string | null | undefined,
  newColumnId: string | null | undefined,
  config: AsanaConfig | null | undefined,
): Promise<void> {
  if (!asanaGid || !newColumnId) return;
  if (!config?.enabled) return;
  if (!config.statusFieldGid) return;
  const enumGid = config.statusMap?.[newColumnId];
  if (!enumGid) return;
  await updateCustomFieldEnum(asanaGid, config.statusFieldGid, enumGid);
}
