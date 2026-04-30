import { useMemo, useState } from "react";
import { ArrowRight, Inbox, Plus } from "lucide-react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { PageHeader } from "../components/layout/PageHeader";
import { TicketCard } from "../components/tickets/TicketCard";
import { TicketModal } from "../components/tickets/TicketModal";
import { EmptyState } from "../components/ui/EmptyState";
import { useAppData } from "../context/AppDataContext";
import { moveTicketToSprint, reorderTicket } from "../services/tickets";
import { compareTickets, computeNewOrder } from "../lib/utils";
import type { Ticket } from "../types";

const DROPPABLE_ID = "backlog";

export function BacklogPage() {
  const { backlogTickets, activeSprint, workflow, loading } = useAppData();
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [creating, setCreating] = useState(false);

  const orderedTickets = useMemo(() => [...backlogTickets].sort(compareTickets), [backlogTickets]);

  async function moveToSprint(ticket: Ticket) {
    if (!activeSprint) return;
    const initialStatus = workflow?.columns?.[0]?.id ?? null;
    await moveTicketToSprint(ticket.id, activeSprint.id, initialStatus);
  }

  async function handleDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId !== DROPPABLE_ID) return;
    if (destination.index === source.index) return;
    const newOrder = computeNewOrder(orderedTickets, draggableId, destination.index);
    try {
      await reorderTicket(draggableId, { order: newOrder });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Backlog"
        description="All tickets that aren't part of an active sprint."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New ticket
          </button>
        }
      />

      {loading ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Loading…</p>
      ) : orderedTickets.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Backlog is empty"
          description="Create a new ticket to get started."
          action={
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New ticket
            </button>
          }
        />
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId={DROPPABLE_ID}>
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="space-y-2.5"
              >
                {orderedTickets.map((ticket, index) => (
                  <Draggable key={ticket.id} draggableId={ticket.id} index={index}>
                    {(prov, snap) => (
                      <div
                        ref={prov.innerRef}
                        {...prov.draggableProps}
                        style={prov.draggableProps.style}
                        className="flex items-center gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <TicketCard
                            ticket={ticket}
                            onClick={() => setEditing(ticket)}
                            dragHandleProps={prov.dragHandleProps}
                            isDragging={snap.isDragging}
                          />
                        </div>
                        {activeSprint && (
                          <button
                            type="button"
                            onClick={() => moveToSprint(ticket)}
                            className="btn-secondary shrink-0"
                            title={`Move to ${activeSprint.name}`}
                          >
                            <ArrowRight className="h-4 w-4" />
                            <span className="hidden sm:inline">To sprint</span>
                          </button>
                        )}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      <TicketModal
        open={creating}
        onClose={() => setCreating(false)}
        defaultSprintId={null}
        workflow={workflow}
      />
      <TicketModal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        ticket={editing}
        workflow={workflow}
      />
    </div>
  );
}
