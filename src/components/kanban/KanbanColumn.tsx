import { Droppable, Draggable } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { TicketCard } from "../tickets/TicketCard";
import { cn } from "../../lib/utils";
import type { Ticket, WorkflowColumn } from "../../types";

interface KanbanColumnProps {
  column: WorkflowColumn;
  tickets: Ticket[];
  onTicketClick?: (ticket: Ticket) => void;
  onAddTicket?: (columnId: string) => void;
}

export function KanbanColumn({ column, tickets, onTicketClick, onAddTicket }: KanbanColumnProps) {
  return (
    <div className="flex flex-col w-72 shrink-0 bg-surface-100/60 rounded-xl ring-1 ring-surface-200/80 dark:bg-surface-900/60 dark:ring-surface-800/80">
      <div className="flex items-center justify-between px-3.5 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: column.color ?? "#94a3b8" }}
            aria-hidden="true"
          />
          <h3 className="text-sm font-semibold text-surface-800 truncate dark:text-surface-100">{column.name}</h3>
          <span className="text-xs text-surface-500 bg-white ring-1 ring-surface-200 rounded-full px-1.5 py-0.5 dark:text-surface-400 dark:bg-surface-800 dark:ring-surface-700">
            {tickets.length}
          </span>
        </div>
        {onAddTicket && (
          <button
            type="button"
            onClick={() => onAddTicket(column.id)}
            className="text-surface-400 hover:text-surface-700 p-1 rounded-md hover:bg-white transition-colors dark:text-surface-500 dark:hover:text-surface-200 dark:hover:bg-surface-800"
            aria-label={`Add ticket to ${column.name}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex-1 px-2 pb-2 space-y-2 min-h-[80px] transition-colors rounded-b-xl",
              snapshot.isDraggingOver && "bg-blue-50/60 dark:bg-blue-950/40",
            )}
          >
            {tickets.map((ticket, index) => (
              <Draggable key={ticket.id} draggableId={ticket.id} index={index}>
                {(prov, snap) => (
                  <div ref={prov.innerRef} {...prov.draggableProps} style={prov.draggableProps.style}>
                    <TicketCard
                      ticket={ticket}
                      onClick={() => onTicketClick?.(ticket)}
                      dragHandleProps={prov.dragHandleProps}
                      isDragging={snap.isDragging}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            {tickets.length === 0 && !snapshot.isDraggingOver && (
              <p className="text-xs text-surface-400 text-center py-6 italic dark:text-surface-500">No tickets</p>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}
