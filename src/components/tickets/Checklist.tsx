import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CheckSquare, Plus, Trash2 } from "lucide-react";
import { cn, checklistProgress } from "../../lib/utils";
import { updateChecklist } from "../../services/tickets";
import { useAppData } from "../../context/AppDataContext";
import type { ChecklistItem, Ticket } from "../../types";

// Generates a stable id for a new checklist item. crypto.randomUUID is
// available in every browser we target; the fallback handles ancient ones.
function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Checklist({ ticket }: { ticket: Ticket }) {
  // The parent passes a snapshot of the ticket taken when the modal opened —
  // it does not update on Firestore snapshots. Read the live ticket from the
  // app data context so checklist edits show up immediately without forcing
  // the modal's form effect to re-sync (which would clobber in-progress edits
  // to the title / description / etc.).
  const { tickets } = useAppData();
  const liveTicket = tickets.find((t) => t.id === ticket.id) ?? ticket;
  const items: ChecklistItem[] = Array.isArray(liveTicket.checklist) ? liveTicket.checklist : [];
  const { done, total } = checklistProgress(items);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);

  async function commit(next: ChecklistItem[]) {
    setBusy(true);
    try {
      await updateChecklist(ticket.id, next);
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    const text = draft.trim();
    if (!text) return;
    const next: ChecklistItem[] = [...items, { id: newId(), text, done: false, createdAt: Date.now() }];
    setDraft("");
    await commit(next);
  }

  async function toggle(id: string) {
    const next = items.map((it) => (it.id === id ? { ...it, done: !it.done } : it));
    await commit(next);
  }

  async function remove(id: string) {
    if (editingId === id) {
      setEditingId(null);
      setEditText("");
    }
    await commit(items.filter((it) => it.id !== id));
  }

  function startEdit(item: ChecklistItem) {
    setEditingId(item.id);
    setEditText(item.text);
  }

  async function saveEdit() {
    if (!editingId) return;
    const text = editText.trim();
    if (!text) {
      // Empty edit = delete (matches Jira/Trello behavior).
      await remove(editingId);
      return;
    }
    const next = items.map((it) => (it.id === editingId ? { ...it, text } : it));
    setEditingId(null);
    setEditText("");
    await commit(next);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
  }

  async function move(id: string, direction: "up" | "down") {
    const idx = items.findIndex((it) => it.id === id);
    if (idx < 0) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[idx], next[target]] = [next[target], next[idx]];
    await commit(next);
  }

  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-surface-700 dark:text-surface-200">
          <CheckSquare className="h-4 w-4" />
          Checklist
        </div>
        {total > 0 && (
          <>
            <span className="text-xs tabular-nums text-surface-500 dark:text-surface-400">
              {done}/{total}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-surface-200 overflow-hidden dark:bg-surface-700">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  done === total ? "bg-emerald-500" : "bg-blue-500",
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </>
        )}
      </div>

      {items.length > 0 && (
        <ul className="space-y-1 mb-2">
          {items.map((item, idx) => (
            <ChecklistRow
              key={item.id}
              item={item}
              isFirst={idx === 0}
              isLast={idx === items.length - 1}
              isEditing={editingId === item.id}
              editText={editText}
              setEditText={setEditText}
              onToggle={() => toggle(item.id)}
              onStartEdit={() => startEdit(item)}
              onSaveEdit={saveEdit}
              onCancelEdit={cancelEdit}
              onRemove={() => remove(item.id)}
              onMoveUp={() => move(item.id, "up")}
              onMoveDown={() => move(item.id, "down")}
              disabled={busy}
            />
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-surface-400 dark:text-surface-500" />
        <input
          className="input flex-1"
          placeholder="Add an item…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Stop the event from bubbling to the surrounding ticket form.
              e.preventDefault();
              addItem();
            }
          }}
          disabled={busy}
        />
      </div>
    </div>
  );
}

interface ChecklistRowProps {
  item: ChecklistItem;
  isFirst: boolean;
  isLast: boolean;
  isEditing: boolean;
  editText: string;
  setEditText: (next: string) => void;
  onToggle: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  disabled: boolean;
}

function ChecklistRow({
  item,
  isFirst,
  isLast,
  isEditing,
  editText,
  setEditText,
  onToggle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  disabled,
}: ChecklistRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  return (
    <li className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-50 dark:hover:bg-surface-800/60">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-surface-300 text-blue-600 focus:ring-blue-500 dark:border-surface-600 dark:bg-surface-700"
        checked={!!item.done}
        onChange={onToggle}
        disabled={disabled || isEditing}
      />
      {isEditing ? (
        <input
          ref={inputRef}
          className="input flex-1 py-1"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={onSaveEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSaveEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancelEdit();
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={onStartEdit}
          className={cn(
            "flex-1 text-left text-sm py-1 truncate",
            item.done
              ? "line-through text-surface-400 dark:text-surface-500"
              : "text-surface-800 dark:text-surface-100",
          )}
          title="Click to edit"
        >
          {item.text}
        </button>
      )}
      {!isEditing && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst || disabled}
            className="p-1 rounded text-surface-500 hover:bg-surface-200 disabled:opacity-30 disabled:hover:bg-transparent dark:text-surface-400 dark:hover:bg-surface-700"
            aria-label="Move up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast || disabled}
            className="p-1 rounded text-surface-500 hover:bg-surface-200 disabled:opacity-30 disabled:hover:bg-transparent dark:text-surface-400 dark:hover:bg-surface-700"
            aria-label="Move down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="p-1 rounded text-surface-500 hover:bg-red-50 hover:text-red-600 dark:text-surface-400 dark:hover:bg-red-900/30 dark:hover:text-red-400"
            aria-label="Delete item"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}
