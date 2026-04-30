import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { RichTextEditor } from "../ui/RichTextEditor";
import { checklistProgress, cn, PRIORITIES, formatDateTime } from "../../lib/utils";
import { createTicket, deleteTicket, updateTicket } from "../../services/tickets";
import { useAppData } from "../../context/AppDataContext";
import { useAuth } from "../../context/AuthContext";
import { UserAvatar } from "../users/UserAvatar";
import { UserPicker } from "../users/UserPicker";
import { CommentList } from "../comments/CommentList";
import { TypeIcon } from "../issueTypes/TypeIcon";
import { TypePicker } from "../issueTypes/TypePicker";
import { EpicPicker } from "../epics/EpicPicker";
import { Checklist } from "./Checklist";
import { DEFAULT_ISSUE_TYPE, EPIC_TYPE } from "../../lib/issueTypes";
import type { IssueType, Priority, Ticket, UserRecord, Workflow } from "../../types";

type TabId = "details" | "properties" | "checklist" | "comments";

interface TicketFormState {
  title: string;
  description: string;
  priority: Priority;
  assigneeId: string | null;
  type: IssueType;
  epicId: string | null;
  status: string | null;
}

const blank: TicketFormState = {
  title: "",
  description: "",
  priority: "medium",
  assigneeId: null,
  type: DEFAULT_ISSUE_TYPE,
  epicId: null,
  status: null,
};

interface TicketModalProps {
  open: boolean;
  onClose: () => void;
  ticket?: Ticket | null;
  defaultSprintId?: string | null;
  defaultStatus?: string | null;
  defaultType?: IssueType;
  workflow?: Workflow;
}

export function TicketModal({
  open,
  onClose,
  ticket,
  defaultSprintId = null,
  defaultStatus = null,
  defaultType = DEFAULT_ISSUE_TYPE,
  workflow,
}: TicketModalProps) {
  const { user } = useAuth();
  const { tickets, getUserById } = useAppData();
  const isEdit = Boolean(ticket?.id);
  const [form, setForm] = useState<TicketFormState>(blank);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("details");

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
    setActiveTab("details");
  }, [open, ticket, defaultStatus, defaultType]);

  const isEpicForm = form.type === EPIC_TYPE;

  // If the user changes the type to "epic" mid-edit, clear the irrelevant
  // fields so the create/update payload is consistent with the data model.
  useEffect(() => {
    if (isEpicForm && (form.epicId || form.status)) {
      setForm((f) => ({ ...f, epicId: null, status: null }));
    }
  }, [isEpicForm, form.epicId, form.status]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Title is required.");
      setActiveTab("details");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit && ticket) {
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
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!isEdit || !ticket) return;
    if (!window.confirm("Delete this ticket? This action cannot be undone.")) return;
    setSubmitting(true);
    try {
      await deleteTicket(ticket.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const creator = isEdit && ticket ? getUserById(ticket.createdBy) : null;
  const commentCount = ticket?.commentCount ?? 0;
  // Read the live ticket from context so the Checklist tab badge stays in
  // sync with mutations the Checklist itself persists. Falls back to the
  // prop snapshot if the live row hasn't propagated yet.
  const liveTicket = ticket?.id ? tickets.find((t) => t.id === ticket.id) ?? ticket : null;
  const { done: checklistDone, total: checklistTotal } = checklistProgress(liveTicket?.checklist);
  const modalTitle = isEdit
    ? isEpicForm
      ? "Edit epic"
      : "Edit ticket"
    : isEpicForm
      ? "New epic"
      : "New ticket";
  const submitLabel = isEdit ? "Save changes" : isEpicForm ? "Create epic" : "Create ticket";
  const showStatusField = !isEpicForm && isEdit && Boolean(ticket?.sprintId) && (workflow?.columns?.length ?? 0) > 0;

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
        isEdit && ticket ? (
          <CreatedBySubtitle creator={creator} ticket={ticket} />
        ) : isEpicForm ? (
          "Group multiple tickets under a higher-level container."
        ) : (
          "Add a new item to the backlog or current sprint."
        )
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
      {isEdit && (
        <Tabs
          activeTab={activeTab}
          onChange={setActiveTab}
          commentCount={commentCount}
          checklistDone={checklistDone}
          checklistTotal={checklistTotal}
        />
      )}

      {/* All form fields share a single <form> so the footer Save button can
          submit from any tab. Inactive panes are hidden via display:none, not
          unmounted, so state and focus stay intact across tab switches. */}
      <form id="ticket-form" onSubmit={handleSubmit} className="space-y-4">
        <div className={cn(isEdit && activeTab !== "details" && "hidden", "space-y-4")}>
          <DetailsPane form={form} setForm={setForm} />
        </div>

        <div className={cn(isEdit && activeTab !== "properties" && "hidden")}>
          <PropertiesPane
            form={form}
            setForm={setForm}
            isEpicForm={isEpicForm}
            showStatusField={showStatusField}
            workflow={workflow}
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
            {error}
          </div>
        )}
      </form>

      {/* Checklist and Comments live outside the form: they persist their
          changes directly to Firestore (no Save-button round trip). */}
      {isEdit && ticket && (
        <div className={cn(activeTab !== "checklist" && "hidden", "mt-4")}>
          <Checklist ticket={ticket} />
        </div>
      )}

      {isEdit && ticket && (
        <div className={cn(activeTab !== "comments" && "hidden", "mt-4")}>
          <CommentList ticketId={ticket.id} />
        </div>
      )}
    </Modal>
  );
}

interface TabsProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
  commentCount: number;
  checklistDone: number;
  checklistTotal: number;
}

function Tabs({ activeTab, onChange, commentCount, checklistDone, checklistTotal }: TabsProps) {
  const items: { id: TabId; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "properties", label: "Properties" },
    {
      id: "checklist",
      label: checklistTotal > 0 ? `Checklist (${checklistDone}/${checklistTotal})` : "Checklist",
    },
    { id: "comments", label: commentCount > 0 ? `Comments (${commentCount})` : "Comments" },
  ];
  return (
    <div className="flex gap-4 -mx-6 px-6 mb-5 border-b border-surface-200 overflow-x-auto dark:border-surface-700">
      {items.map((it) => {
        const active = activeTab === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={cn(
              "py-2 -mb-px border-b-2 text-sm font-medium transition-colors whitespace-nowrap",
              active
                ? "border-surface-900 text-surface-900 dark:border-surface-50 dark:text-surface-50"
                : "border-transparent text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

interface DetailsPaneProps {
  form: TicketFormState;
  setForm: Dispatch<SetStateAction<TicketFormState>>;
}

function DetailsPane({ form, setForm }: DetailsPaneProps) {
  return (
    <>
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
        <label className="label">Description</label>
        <RichTextEditor
          value={form.description}
          onChange={(html) => setForm((f) => ({ ...f, description: html }))}
          placeholder="Add context, acceptance criteria, links…"
        />
      </div>
    </>
  );
}

interface PropertiesPaneProps {
  form: TicketFormState;
  setForm: Dispatch<SetStateAction<TicketFormState>>;
  isEpicForm: boolean;
  showStatusField: boolean;
  workflow?: Workflow;
}

function PropertiesPane({ form, setForm, isEpicForm, showStatusField, workflow }: PropertiesPaneProps) {
  return (
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
          onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
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

      {showStatusField && workflow && (
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
  );
}

interface CreatedBySubtitleProps {
  creator: UserRecord | null;
  ticket: Ticket;
}

// Renders inside the Modal's `description` slot (a `<p>`), so it must use
// inline elements only — UserAvatar already renders a span.
function CreatedBySubtitle({ creator, ticket }: CreatedBySubtitleProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {creator && <UserAvatar user={creator} size="xs" />}
      <span>
        {creator ? (
          <>
            Created by <span className="text-surface-700 dark:text-surface-200">{creator.email}</span>
          </>
        ) : (
          <>Created</>
        )}
        {ticket.createdAt && <> &middot; {formatDateTime(ticket.createdAt)}</>}
      </span>
    </span>
  );
}
