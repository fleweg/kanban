import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { ExternalLink, Link2, Trash2, Unlink } from "lucide-react";
import { Modal } from "../ui/Modal";
import { RichTextEditor } from "../ui/RichTextEditor";
import { autoProgressForStatus, checklistProgress, cn, PRIORITIES, formatDateTime } from "../../lib/utils";
import { createTicket, deleteTicket, moveTicketToTeam, updateTicket } from "../../services/tickets";
import { useAppData } from "../../context/AppDataContext";
import { useAuth } from "../../context/AuthContext";
import { UserAvatar } from "../users/UserAvatar";
import { UserPicker } from "../users/UserPicker";
import { CommentList } from "../comments/CommentList";
import { AsanaCommentList } from "../comments/AsanaCommentList";
import { LinkAsanaModal } from "./LinkAsanaModal";
import { useAsanaConfig } from "../../hooks/useAsanaConfig";
import { syncAsanaStatusForTicket } from "../../lib/asanaStatusSync";
import { TypeIcon } from "../issueTypes/TypeIcon";
import { TypePicker } from "../issueTypes/TypePicker";
import { EpicPicker } from "../epics/EpicPicker";
import { DependenciesPicker } from "./DependenciesPicker";
import { Checklist } from "./Checklist";
import { Attachments } from "./Attachments";
import { DEFAULT_ISSUE_TYPE, EPIC_TYPE } from "../../lib/issueTypes";
import { GENERAL_TEAM_ID } from "../../lib/teams";
import {
  cascadeFromChangedTicket,
  computeShiftFromDependencies,
} from "../../lib/dependencies";
import type { IssueType, Priority, Team, Ticket, UserRecord, Workflow } from "../../types";

type TabId = "details" | "properties" | "checklist" | "attachments" | "comments";

interface TicketFormState {
  title: string;
  description: string;
  priority: Priority;
  assigneeId: string | null;
  type: IssueType;
  epicId: string | null;
  status: string | null;
  teamId: string;
  // ISO yyyy-mm-dd strings used by the native date inputs. Empty
  // string === unset. Converted to/from ms at the boundary.
  startDate: string;
  dueDate: string;
  progress: number;
  dependencies: string[];
  asanaGid: string | null;
  asanaPermalinkUrl: string | null;
}

const blank: TicketFormState = {
  title: "",
  description: "",
  priority: "medium",
  assigneeId: null,
  type: DEFAULT_ISSUE_TYPE,
  epicId: null,
  status: null,
  teamId: GENERAL_TEAM_ID,
  startDate: "",
  dueDate: "",
  progress: 0,
  dependencies: [],
  asanaGid: null,
  asanaPermalinkUrl: null,
};

function msToDateInput(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputToMs(s: string): number | null {
  if (!s) return null;
  // <input type="date"> emits yyyy-mm-dd. Parse as local midnight to
  // avoid timezone drift across DST boundaries.
  const [y, m, d] = s.split("-").map((v) => Number.parseInt(v, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

function clampProgress(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

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
  const { tickets, getUserById, teams, currentTeamId } = useAppData();
  const asanaConfig = useAsanaConfig();
  const isEdit = Boolean(ticket?.id);
  const [form, setForm] = useState<TicketFormState>(blank);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("details");
  const [linkAsanaOpen, setLinkAsanaOpen] = useState(false);

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
        teamId: ticket.teamId ?? GENERAL_TEAM_ID,
        startDate: msToDateInput(ticket.startDate),
        dueDate: msToDateInput(ticket.dueDate),
        progress: ticket.progress ?? 0,
        dependencies: Array.isArray(ticket.dependencies) ? [...ticket.dependencies] : [],
        asanaGid: ticket.asanaGid ?? null,
        asanaPermalinkUrl: ticket.asanaPermalinkUrl ?? null,
      });
    } else {
      setForm({
        ...blank,
        type: defaultType,
        status: defaultStatus,
        teamId: currentTeamId,
      });
    }
    setError(null);
    setActiveTab("details");
  }, [open, ticket, defaultStatus, defaultType, currentTeamId]);

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
        // Team change is destructive — sprints are team-scoped, so we
        // drop sprintId/status when re-homing the ticket. Warn the user
        // when they're losing an active-sprint slot.
        const teamChanged = form.teamId !== ticket.teamId;
        if (teamChanged && ticket.sprintId) {
          const confirmMsg =
            "Moving this ticket to another team will remove it from its current sprint. Continue?";
          if (!window.confirm(confirmMsg)) {
            setSubmitting(false);
            return;
          }
        }
        if (teamChanged) {
          await moveTicketToTeam(ticket.id, form.teamId);
        }
        // Status may have just changed via the Status select. If the
        // new status triggers an auto-progress (first/completed column),
        // override the form's progress to keep the rule consistent.
        const finalStatus = teamChanged ? null : isEpicForm ? null : form.status ?? null;
        const autoProg = autoProgressForStatus(finalStatus, workflow);
        const finalProgress = isEpicForm
          ? undefined
          : autoProg !== null
            ? autoProg
            : clampProgress(form.progress);

        // Apply the dep-driven self-shift before writing: if this
        // ticket now violates one of its deps' dueDate, slide its
        // own start/due forward to honour the constraint.
        let startMs = dateInputToMs(form.startDate);
        let dueMs = dateInputToMs(form.dueDate);
        const newDeps = isEpicForm ? [] : form.dependencies;
        if (!isEpicForm && newDeps.length > 0) {
          const hypothetical: Ticket = {
            ...ticket,
            startDate: startMs,
            dueDate: dueMs,
            dependencies: newDeps,
          };
          const byId = new Map(tickets.map((t) => [t.id, t.id === ticket.id ? hypothetical : t]));
          const shift = computeShiftFromDependencies(hypothetical, byId);
          if (shift) {
            startMs = shift.startDate ?? startMs;
            if (shift.dueDate !== undefined) dueMs = shift.dueDate;
          }
        }

        await updateTicket(ticket.id, {
          title: form.title,
          description: form.description,
          priority: form.priority,
          // moveTicketToTeam already nulls status; skip status here when
          // we just changed team to avoid clobbering the null write.
          status: finalStatus,
          assigneeId: form.assigneeId ?? null,
          type: form.type,
          epicId: isEpicForm ? null : form.epicId ?? null,
          startDate: startMs,
          dueDate: dueMs,
          dependencies: isEpicForm ? [] : newDeps,
          asanaGid: form.asanaGid,
          asanaPermalinkUrl: form.asanaPermalinkUrl,
          ...(finalProgress !== undefined ? { progress: finalProgress } : {}),
        });

        // Status custom-field sync on Asana — fire-and-forget so a
        // network blip doesn't roll back the local save. Only writes
        // when the column actually changed and the connector has a
        // mapping for it.
        if (
          form.asanaGid &&
          finalStatus &&
          finalStatus !== ticket.status &&
          asanaConfig
        ) {
          syncAsanaStatusForTicket(form.asanaGid, finalStatus, asanaConfig).catch(
            (e) => console.warn("Asana status sync failed:", e),
          );
        }

        // Cascade: if THIS ticket's dueDate changed and other tickets
        // depend on it, shift them too. We feed the cascade helper
        // the override we just wrote so it sees the post-update state.
        const dueChanged = ticket.dueDate !== dueMs;
        if (dueChanged) {
          const patches = cascadeFromChangedTicket(tickets, ticket.id, {
            startDate: startMs,
            dueDate: dueMs,
            dependencies: newDeps,
          });
          await Promise.all(patches.map((p) => updateTicket(p.id, p.patch)));
        }
      } else {
        const createStatus = isEpicForm
          ? null
          : defaultSprintId
            ? defaultStatus ?? workflow?.columns?.[0]?.id ?? null
            : null;
        const createAutoProg = autoProgressForStatus(createStatus, workflow);

        // Same self-shift logic at creation: if the user picked deps
        // and dates that clash with them, slide forward.
        let startMs = dateInputToMs(form.startDate);
        let dueMs = dateInputToMs(form.dueDate);
        const newDeps = isEpicForm ? [] : form.dependencies;
        if (!isEpicForm && newDeps.length > 0) {
          const hypothetical = {
            id: "__new__",
            dependencies: newDeps,
            startDate: startMs,
            dueDate: dueMs,
            type: form.type,
          } as unknown as Ticket;
          const byId = new Map<string, Ticket>(tickets.map((t) => [t.id, t]));
          byId.set("__new__", hypothetical);
          const shift = computeShiftFromDependencies(hypothetical, byId);
          if (shift) {
            startMs = shift.startDate ?? startMs;
            if (shift.dueDate !== undefined) dueMs = shift.dueDate;
          }
        }

        await createTicket({
          title: form.title,
          description: form.description,
          priority: form.priority,
          sprintId: isEpicForm ? null : defaultSprintId,
          status: createStatus,
          createdBy: user?.uid ?? null,
          assigneeId: form.assigneeId ?? null,
          type: form.type,
          epicId: isEpicForm ? null : form.epicId ?? null,
          teamId: form.teamId,
          startDate: startMs,
          dueDate: dueMs,
          progress: isEpicForm ? 0 : createAutoProg ?? clampProgress(form.progress),
          dependencies: newDeps,
          asanaGid: form.asanaGid,
          asanaPermalinkUrl: form.asanaPermalinkUrl,
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
  const attachmentCount = liveTicket?.attachments?.length ?? 0;
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
          attachmentCount={attachmentCount}
        />
      )}

      {/* All form fields share a single <form> so the footer Save button can
          submit from any tab. Inactive panes are hidden via display:none, not
          unmounted, so state and focus stay intact across tab switches. */}
      <form id="ticket-form" onSubmit={handleSubmit} className="space-y-4">
        {/* `key` forces a clean unmount + remount of DetailsPane (and the
            TipTap RichTextEditor inside it) when the modal switches from
            one ticket to another without closing first. Without this,
            TipTap mutates the DOM while React still holds a stale VDOM
            of the previous ticket's description → "Node.insertBefore:
            Child to insert before is not a child of this node" at the
            next reconciliation. */}
        <div
          key={ticket?.id ?? "new"}
          className={cn(isEdit && activeTab !== "details" && "hidden", "space-y-4")}
        >
          <AsanaBar
            enabled={Boolean(asanaConfig?.enabled)}
            linkedGid={form.asanaGid}
            permalinkUrl={form.asanaPermalinkUrl}
            onLinkClick={() => setLinkAsanaOpen(true)}
            onUnlink={() =>
              setForm((f) => ({ ...f, asanaGid: null, asanaPermalinkUrl: null }))
            }
          />
          <DetailsPane form={form} setForm={setForm} />
        </div>

        <div className={cn(isEdit && activeTab !== "properties" && "hidden")}>
          <PropertiesPane
            form={form}
            setForm={setForm}
            isEpicForm={isEpicForm}
            showStatusField={showStatusField}
            workflow={workflow}
            teams={teams}
            ticketId={ticket?.id ?? null}
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
        <div className={cn(activeTab !== "attachments" && "hidden", "mt-4")}>
          <Attachments ticket={ticket} />
        </div>
      )}

      {isEdit && ticket && (
        <div className={cn(activeTab !== "comments" && "hidden", "mt-4")}>
          {form.asanaGid ? (
            <AsanaCommentList asanaGid={form.asanaGid} permalinkUrl={form.asanaPermalinkUrl} />
          ) : (
            <CommentList ticketId={ticket.id} />
          )}
        </div>
      )}

      <LinkAsanaModal
        open={linkAsanaOpen}
        onClose={() => setLinkAsanaOpen(false)}
        defaultApplyDescription={!isEdit || !form.description.trim()}
        defaultOverwriteTitle={!isEdit || !form.title.trim()}
        onLink={(result, applyDescription, overwriteTitle) => {
          setForm((f) => ({
            ...f,
            asanaGid: result.gid,
            asanaPermalinkUrl: result.permalinkUrl,
            title: overwriteTitle ? result.task.name : f.title,
            description: applyDescription ? result.descriptionHtml : f.description,
          }));
          setLinkAsanaOpen(false);
        }}
      />
    </Modal>
  );
}

interface AsanaBarProps {
  enabled: boolean;
  linkedGid: string | null;
  permalinkUrl: string | null;
  onLinkClick: () => void;
  onUnlink: () => void;
}

// Shown below the title field on the Details pane. Two states:
// not linked (button to open the LinkAsanaModal), or linked (chip with
// gid + permalink + unlink button). Connector disabled = component
// renders nothing at all.
function AsanaBar({ enabled, linkedGid, permalinkUrl, onLinkClick, onUnlink }: AsanaBarProps) {
  if (!enabled) return null;
  if (linkedGid) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs text-blue-800 ring-1 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:ring-blue-700/40">
        <Link2 className="h-3.5 w-3.5" />
        <span className="font-medium">Linked to Asana task {linkedGid}</span>
        {permalinkUrl && (
          <a
            href={permalinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            <ExternalLink className="h-3 w-3" />
            Open
          </a>
        )}
        <button
          type="button"
          onClick={onUnlink}
          className="ml-auto inline-flex items-center gap-1 text-red-600 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
          title="Unlink — drops Asana association but does not delete the Asana task."
        >
          <Unlink className="h-3 w-3" />
          Unlink
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onLinkClick}
      className="btn-secondary text-xs"
    >
      <Link2 className="h-3.5 w-3.5" />
      Link from Asana
    </button>
  );
}

interface TabsProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
  commentCount: number;
  checklistDone: number;
  checklistTotal: number;
  attachmentCount: number;
}

function Tabs({
  activeTab,
  onChange,
  commentCount,
  checklistDone,
  checklistTotal,
  attachmentCount,
}: TabsProps) {
  const items: { id: TabId; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "properties", label: "Properties" },
    {
      id: "checklist",
      label: checklistTotal > 0 ? `Checklist (${checklistDone}/${checklistTotal})` : "Checklist",
    },
    {
      id: "attachments",
      label: attachmentCount > 0 ? `Attachments (${attachmentCount})` : "Attachments",
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
  teams: Team[];
  ticketId: string | null;
}

function PropertiesPane({ form, setForm, isEpicForm, showStatusField, workflow, teams, ticketId }: PropertiesPaneProps) {
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

      <div>
        <label className="label" htmlFor="ticket-team">
          Team
        </label>
        <select
          id="ticket-team"
          className="input"
          value={form.teamId}
          onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value }))}
        >
          {teams.map((tm) => (
            <option key={tm.id} value={tm.id}>
              {tm.name}
            </option>
          ))}
        </select>
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

      {!isEpicForm && (
        <>
          <div>
            <label className="label" htmlFor="ticket-start">
              Start date
            </label>
            <input
              id="ticket-start"
              type="date"
              className="input"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="ticket-due">
              Due date
            </label>
            <input
              id="ticket-due"
              type="date"
              className="input"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label flex items-center justify-between" htmlFor="ticket-progress">
              <span>Progress</span>
              <span className="tabular-nums text-surface-700 dark:text-surface-200">{form.progress}%</span>
            </label>
            <input
              id="ticket-progress"
              type="range"
              min={0}
              max={100}
              step={5}
              className="w-full"
              value={form.progress}
              onChange={(e) => setForm((f) => ({ ...f, progress: Number(e.target.value) }))}
            />
          </div>
          <div className="sm:col-span-2">
            <span className="label">Depends on</span>
            <DependenciesPicker
              ownerId={ticketId}
              value={form.dependencies}
              onChange={(next) => setForm((f) => ({ ...f, dependencies: next }))}
            />
          </div>
        </>
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
