import { useMemo, useState } from "react";
import { DragDropContext } from "@hello-pangea/dnd";
import { KanbanColumn } from "./KanbanColumn";
import { TicketModal } from "../tickets/TicketModal";
import { changeTicketStatus } from "../../services/tickets";

export function KanbanBoard({ workflow, tickets, sprintId }) {
  const [editingTicket, setEditingTicket] = useState(null);
  const [creatingInColumn, setCreatingInColumn] = useState(null);

  const ticketsByColumn = useMemo(() => {
    const map = Object.fromEntries(workflow.columns.map((c) => [c.id, []]));
    for (const t of tickets) {
      const colId = t.status && map[t.status] ? t.status : workflow.columns[0].id;
      map[colId].push(t);
    }
    return map;
  }, [workflow, tickets]);

  async function handleDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    if (destination.droppableId === source.droppableId) return;

    // Optimistic UX: Firestore listener will reconcile order/state.
    try {
      await changeTicketStatus(draggableId, destination.droppableId);
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
