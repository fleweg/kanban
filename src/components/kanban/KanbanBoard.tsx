import { useMemo, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { KanbanColumn } from "./KanbanColumn";
import { TicketModal } from "../tickets/TicketModal";
import { reorderTicket } from "../../services/tickets";
import { compareTickets, computeNewOrder } from "../../lib/utils";
import type { Ticket, Workflow } from "../../types";

interface KanbanBoardProps {
  workflow: Workflow;
  tickets: Ticket[];
  sprintId: string;
}

export function KanbanBoard({ workflow, tickets, sprintId }: KanbanBoardProps) {
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [creatingInColumn, setCreatingInColumn] = useState<string | null>(null);

  const ticketsByColumn = useMemo(() => {
    const map: Record<string, Ticket[]> = Object.fromEntries(workflow.columns.map((c) => [c.id, []]));
    for (const t of tickets) {
      const colId = t.status && map[t.status] ? t.status : workflow.columns[0].id;
      map[colId].push(t);
    }
    // Each column is sorted by ticket order so drag-reorder is reflected.
    for (const colId of Object.keys(map)) map[colId].sort(compareTickets);
    return map;
  }, [workflow, tickets]);

  async function handleDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const destCol = ticketsByColumn[destination.droppableId] ?? [];
    const newOrder = computeNewOrder(destCol, draggableId, destination.index);
    const crossingColumn = destination.droppableId !== source.droppableId;

    try {
      await reorderTicket(draggableId, {
        order: newOrder,
        ...(crossingColumn ? { status: destination.droppableId } : {}),
      });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0">
          {workflow.columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tickets={ticketsByColumn[column.id] ?? []}
              onTicketClick={setEditingTicket}
              onAddTicket={(colId) => setCreatingInColumn(colId)}
            />
          ))}
        </div>
      </DragDropContext>

      <TicketModal
        open={Boolean(editingTicket)}
        onClose={() => setEditingTicket(null)}
        ticket={editingTicket}
        workflow={workflow}
      />

      <TicketModal
        open={Boolean(creatingInColumn)}
        onClose={() => setCreatingInColumn(null)}
        defaultSprintId={sprintId}
        defaultStatus={creatingInColumn}
        workflow={workflow}
      />
    </>
  );
}
