import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { PRIORITIES, formatDateTime } from "../../lib/utils";
import { createTicket, deleteTicket, updateTicket } from "../../services/tickets";
import { useAppData } from "../../context/AppDataContext";
import { useAuth } from "../../context/AuthContext";
import { UserAvatar } from "../users/UserAvatar";
import { UserPicker } from "../users/UserPicker";
import { CommentList } from "../comments/CommentList";
import { TypeIcon } from "../issueTypes/TypeIcon";
import { TypePicker } from "../issueTypes/TypePicker";
import { EpicPicker } from "../epics/EpicPicker";
import { DEFAULT_ISSUE_TYPE, EPIC_TYPE } from "../../lib/issueTypes";

const blank = {
  title: "",
  description: "",
  priority: "medium",
  assigneeId: null,
  type: DEFAULT_ISSUE_TYPE,
  epicId: null,
  status: null,
};

export function TicketModal({
  open,
  onClose,
  ticket,
  defaultSprintId = null,
  defaultStatus = null,
  defaultType = DEFAULT_ISSUE_TYPE,
  workflow,
}) {
  const { user } = useAuth();
  const { getUserById } = useAppData();
  const isEdit = Boolean(ticket?.id);
  const [form, setForm] = useState(blank);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    if (ticket) {
      setForm({
        title: ticket.title ?? "",
        description: ticket.description ?? "",
        priority: ticket.priority ?? "medium",
        status: ticket.status ?? null,
        assigneeId: ticket.assigneeId ?? null,
        type: ticket.type ?? DEFAULT_ISSUE_TYPE,
        epicId: ticket.epicId ?? null,
      });
    } else {
      setForm({ ...blank, type: defaultType, status: defaultStatus });
    }
    setError(null);
  }, [open, ticket, defaultStatus, defaultType]);

  const isEpicForm = form.type === EPIC_TYPE;

  // If the user changes the type to "epic" mid-edit, clear the irrelevant
  // fields so the create/update payload is consistent with the data model.
  useEffect(() => {
    if (isEpicForm && (form.epicId || form.status)) {
      setForm((f) => ({ ...f, epicId: null, status: null }));
    }
  }, [isEpicForm, form.epicId, form.status]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await updateTicket(ticket.id, {
          title: form.title,
          description: form.description,
          priority: form.priority,
          status: isEpicForm ? null : form.status ?? null,
          assigneeId: form.assigneeId ?? null,
          type: form.type,
          epicId: isEpicForm ? null : form.epicId ?? null,
        });
      } else {
        await createTicket({
          title: form.title,
          description: form.description,
          priority: form.priority,
          sprintId: isEpicForm ? null : defaultSprintId,
          status: isEpicForm
            ? null
            : defaultSprintId
              ? defaultStatus ?? workflow?.columns?.[0]?.id ?? null
              : null,
          createdBy: user?.uid ?? null,
          assigneeId: form.assigneeId ?? null,
          type: form.type,
          epicId: isEpicForm ? null : form.epicId ?? null,
        });
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!window.confirm("Delete this ticket? This action cannot be undone.")) return;
    setSubmitting(true);
    try {
      await deleteTicket(ticket.id);
      onClose();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const creator = isEdit ? getUserById(ticket.createdBy) : null;
  const modalTitle = isEdit
    ? isEpicForm
      ? "Edit epic"
      : "Edit ticket"
    : isEpicForm
      ? "New epic"
      : "New ticket";
  const submitLabel = isEdit ? "Save changes" : isEpicForm ? "Create epic" : "Create ticket";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <TypeIcon type={form.type} size="md" />
          {modalTitle}
        </span>
      }
      description={
        isEdit
          ? "Update details."
          : isEpicForm
            ? "Group multiple tickets under a higher-level container."
            : "Add a new item to the backlog or current sprint."
      }
      size={isEdit ? "xl" : "lg"}
      footer={
        <>
          {isEdit && (
            <button
              type="button"
              className="btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700 mr-auto dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
              onClick={handleDelete}
              disabled={submitting}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="ticket-form" className="btn-primary" disabled={submitting}>
            {submitting ? "Saving…" : submitLabel}
          </button>
        </>
      }
    >
      <form id="ticket-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="ticket-title">
            Title
          </label>
          <input
            id="ticket-title"
            className="input"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="What needs to be done?"
            autoFocus
          />
        </div>

        <div>
          <label className="label" htmlFor="ticket-description">
            Description
          </label>
          <textarea
            id="ticket-description"
            className="input min-h-[110px] resize-y"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Add context, acceptance criteria, links…"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="ticket-type">
              Type
            </label>
            <TypePicker value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} />
          </div>

          <div>
            <label className="label" htmlFor="ticket-priority">
              Priority
            </label>
            <select
              id="ticket-priority"
              className="input"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="ticket-assignee">
              Assignee
            </label>
            <UserPicker
              value={form.assigneeId}
              onChange={(v) => setForm((f) => ({ ...f, assigneeId: v }))}
            />
          </div>

          {!isEpicForm && (
            <div>
              <label className="label" htmlFor="ticket-epic">
                Epic
              </label>
              <EpicPicker value={form.epicId} onChange={(v) => setForm((f) => ({ ...f, epicId: v }))} />
            </div>
          )}

          {!isEpicForm && isEdit && ticket?.sprintId && workflow?.columns?.length > 0 && (
            <div>
              <label className="label" htmlFor="ticket-status">
                Status
              </label>
              <select
                id="ticket-status"
                className="input"
                value={form.status ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                {workflow.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {isEdit && (
          <div className="flex items-center gap-2 pt-2 text-xs text-surface-500 dark:text-surface-400">
            {creator ? (
              <>
                <UserAvatar user={creator} size="xs" />
                <span>
                  Created by <span className="text-surface-700 dark:text-surface-200">{creator.email}</span>
                  {ticket.createdAt && <> &middot; {formatDateTime(ticket.createdAt)}</>}
                </span>
              </>
            ) : (
              <span>
                Created
                {ticket.createdAt && <> {formatDateTime(ticket.createdAt)}</>}
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
            {error}
          </div>
        )}
      </form>

      {isEdit && (
        <div className="mt-6 pt-5 border-t border-surface-200 dark:border-surface-700">
          <CommentList ticketId={ticket.id} />
        </div>
      )}
    </Modal>
  );
}
