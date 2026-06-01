import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3 } from "lucide-react";
import { Gantt, Willow, WillowDark, type IApi, type ILink, type ITask } from "@svar-ui/react-gantt";
import "@svar-ui/react-gantt/style.css";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { TicketModal } from "../components/tickets/TicketModal";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { updateTicket } from "../services/tickets";
import { EPIC_TYPE } from "../lib/issueTypes";
import { getTeamSwatchClass } from "../lib/teams";
import {
  cascadeFromChangedTicket,
  computeShiftFromDependencies,
  dependenciesAreCyclic,
} from "../lib/dependencies";
import { cn } from "../lib/utils";
import type { Ticket, Workflow } from "../types";

type Zoom = "day" | "week" | "month" | "quarter";
type Scope = "team" | "all";

const ZOOM_STORAGE_KEY = "kanbanGanttZoom";
const SCOPE_STORAGE_KEY = "kanbanGanttScope";
const ONLY_EPICS_STORAGE_KEY = "kanbanGanttOnlyEpics";

function readPersistedZoom(): Zoom {
  if (typeof window === "undefined") return "week";
  const v = window.localStorage.getItem(ZOOM_STORAGE_KEY);
  if (v === "day" || v === "week" || v === "month" || v === "quarter") return v;
  return "week";
}

function readPersistedScope(): Scope {
  if (typeof window === "undefined") return "team";
  const v = window.localStorage.getItem(SCOPE_STORAGE_KEY);
  return v === "all" ? "all" : "team";
}

function readPersistedOnlyEpics(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ONLY_EPICS_STORAGE_KEY) === "1";
}

function persist(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode / quota — ignore
  }
}

interface GanttRow extends ITask {
  // Sticks the original kanban id on the SVAR task so we can map back
  // when SVAR emits an update-task event.
  _kanbanId?: string;
  // Domain-side dependency list — carried so buildGanttLinks can emit
  // the SVAR `links` array without holding a second ticket lookup.
  _dependencies?: string[];
}

// SVAR renders `format` as a literal string when it isn't a function
// (see the minified `typeof p.format=="function"?p.format(b,_):p.format`
// branch in @svar-ui/gantt-store). date-fns format strings DON'T get
// parsed — we always pass a function.
const fmtMonthYearLong = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const fmtMonthShort = new Intl.DateTimeFormat(undefined, { month: "short" });

function getWeekOfYear(date: Date): number {
  // ISO-8601 week number. Week starts on Monday; week 1 contains the
  // first Thursday of the year. The classic Mark "Date.getWeek"
  // implementation, kept inline to avoid a new dep.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

// Stable references for SVAR-bound props. Passing a fresh array
// literal on every render makes SVAR reset internal layout state
// (column widths, grid panel size) — keep them outside the component.
// IMPORTANT: every column must have an explicit `width` and NO
// `flexgrow`. SVAR's grid-panel auto-width formula is:
//   columns.every(c => c.width && !c.flexgrow)
//     ? sum of widths
//     : h === "chart" ? compact-width : 440
// When a column has flexgrow, the formula falls back to a hardcoded
// 440, which gets re-applied to the grid panel state on any store
// emit — wiping the user's manual drag-resize. Sticking to explicit
// widths keeps the computed default equal to the user-friendly
// initial 260 even if SVAR resets, AND the resizer drag still works
// on the panel boundary (it just adjusts the gap between grid and
// chart, the column width itself stays at its declared value).
const GANTT_COLUMNS = [
  { id: "text", header: "Name", width: 260 },
];
const GANTT_SUMMARY = { autoProgress: false } as const;

const SCALES = {
  day: [
    { unit: "month", step: 1, format: (d: Date) => fmtMonthYearLong.format(d) },
    { unit: "day", step: 1, format: (d: Date) => String(d.getDate()) },
  ],
  week: [
    { unit: "month", step: 1, format: (d: Date) => fmtMonthYearLong.format(d) },
    { unit: "week", step: 1, format: (d: Date) => `W${getWeekOfYear(d)}` },
  ],
  month: [
    { unit: "year", step: 1, format: (d: Date) => String(d.getFullYear()) },
    { unit: "month", step: 1, format: (d: Date) => fmtMonthShort.format(d) },
  ],
  quarter: [
    { unit: "year", step: 1, format: (d: Date) => String(d.getFullYear()) },
    { unit: "quarter", step: 1, format: (d: Date) => `Q${Math.floor(d.getMonth() / 3) + 1}` },
  ],
} as const;

// Defensive: if a ticket has only one of start/due, fall back to a
// 1-day band so it renders. Returns null when neither is set.
function deriveBand(t: Ticket): { start: Date; end: Date } | null {
  if (t.startDate == null && t.dueDate == null) return null;
  const start = t.startDate ?? t.dueDate;
  const end = t.dueDate ?? t.startDate;
  if (start == null || end == null) return null;
  const startMs = Math.min(start, end);
  const endMs = Math.max(start, end);
  // SVAR requires end > start (positive duration). Add 1 day when the
  // ticket has a single point-date so the bar has visible width.
  return {
    start: new Date(startMs),
    end: new Date(endMs === startMs ? endMs + 86_400_000 : endMs),
  };
}

// Compares two SVAR task rows for the fields we care about — used by
// the incremental sync to skip no-op `update-task` dispatches that
// would needlessly re-render the bar.
function tasksEqual(a: GanttRow, b: GanttRow): boolean {
  return (
    a.text === b.text &&
    a.type === b.type &&
    a.parent === b.parent &&
    a.progress === b.progress &&
    a.start instanceof Date &&
    b.start instanceof Date &&
    a.end instanceof Date &&
    b.end instanceof Date &&
    a.start.getTime() === b.start.getTime() &&
    a.end.getTime() === b.end.getTime() &&
    a.open === b.open
  );
}

// Stable composite id for a finish-to-start link between two tickets.
// SVAR needs each link to have an `id`; using the pair lets us diff
// quickly on the sync side (add/remove without juggling generated ids).
function linkId(source: string, target: string): string {
  return `link:${source}->${target}`;
}

interface GanttLink extends ILink {
  id: string;
  source: string;
  target: string;
  type: "e2s";
}

// Build the SVAR `links` array from tickets' `dependencies` field.
// We only emit a link when BOTH endpoints are present in the visible
// task set — otherwise SVAR would refuse to render an arrow with a
// dangling endpoint.
function buildGanttLinks(tasks: GanttRow[]): GanttLink[] {
  const visible = new Set(tasks.map((t) => String(t.id)));
  const out: GanttLink[] = [];
  // tasks carry our domain `_kanbanId`; their dependencies come from
  // the underlying Ticket, which we read by id.
  // The caller already filtered by team / dates / only-epics — we
  // just need to lookup deps. To keep this helper pure, we expect
  // caller to pass us tickets enriched with `_dependencies` (set
  // when building tasks). See buildGanttTasks below.
  for (const t of tasks as (GanttRow & { _dependencies?: string[] })[]) {
    const deps = t._dependencies;
    if (!Array.isArray(deps)) continue;
    const targetId = String(t.id);
    for (const sourceId of deps) {
      if (!visible.has(sourceId)) continue;
      out.push({
        id: linkId(sourceId, targetId),
        source: sourceId,
        target: targetId,
        type: "e2s",
      });
    }
  }
  return out;
}

function unionBand(children: { start: Date; end: Date }[]): { start: Date; end: Date } | null {
  if (children.length === 0) return null;
  let min = children[0].start.getTime();
  let max = children[0].end.getTime();
  for (const c of children) {
    min = Math.min(min, c.start.getTime());
    max = Math.max(max, c.end.getTime());
  }
  return { start: new Date(min), end: new Date(max) };
}

export function GanttPage() {
  const {
    teams,
    currentTeamId,
    currentTeamTickets,
    currentTeamEpics,
    tickets: allTickets,
    epics: allEpics,
    workflow,
    loading,
  } = useAppData();
  const { isAdmin } = useAuth();
  const { theme } = useTheme();
  const [zoom, setZoomState] = useState<Zoom>(readPersistedZoom);
  const [scope, setScopeState] = useState<Scope>(readPersistedScope);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [showOnlyEpics, setShowOnlyEpicsState] = useState<boolean>(readPersistedOnlyEpics);

  const setZoom = useCallback((v: Zoom) => {
    setZoomState(v);
    persist(ZOOM_STORAGE_KEY, v);
  }, []);
  const setScope = useCallback((v: Scope) => {
    setScopeState(v);
    persist(SCOPE_STORAGE_KEY, v);
  }, []);
  const setShowOnlyEpics = useCallback((v: boolean) => {
    setShowOnlyEpicsState(v);
    persist(ONLY_EPICS_STORAGE_KEY, v ? "1" : "0");
  }, []);

  // SVAR doesn't expose a prop for the initial display mode of the
  // left grid — it always starts at "all" (grid + chart). We dispatch
  // a synthetic click on the menu-left arrow after the first render
  // to fold the grid (display becomes "chart"). The user can still
  // click the menu-right arrow to bring it back.
  const ganttHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tryClose = () => {
      if (cancelled) return;
      const arrow = ganttHostRef.current?.querySelector<HTMLElement>(".wxi-menu-left");
      if (arrow) {
        arrow.click();
        return;
      }
      if (attempts++ < 15) setTimeout(tryClose, 50);
    };
    tryClose();
    return () => {
      cancelled = true;
    };
    // Empty deps: only run once when the Gantt host first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SVAR re-runs `w.init({...})` whenever the `tasks` prop reference
  // changes (its internal effect has `tasks` in its deps), which
  // resets internal layout state — grid panel width, expand state,
  // scroll position. To avoid that we feed SVAR a **stable** initial
  // snapshot of tasks once data is loaded, then push every subsequent
  // change through the imperative API (api.exec("add-task" | ...)).
  //
  // Documented pattern: see the "How to access Gantt API" guide and
  // the add/update/delete-task action references on docs.svar.dev.
  const apiRef = useRef<IApi | null>(null);
  const handleGanttInit = useCallback((api: IApi) => {
    apiRef.current = api;
  }, []);

  // Memoized scales — same shape outside of zoom change. Without this,
  // a re-render after a server update would pass a brand-new array
  // and SVAR would reset its zoom-related state.
  const scalesProp = useMemo(() => [...SCALES[zoom]], [zoom]);

  const isDark = theme === "dark";
  const Theme = isDark ? WillowDark : Willow;

  const scopedTickets = scope === "all" && isAdmin ? allTickets : currentTeamTickets;
  const scopedEpics = scope === "all" && isAdmin ? allEpics : currentTeamEpics;

  // Two outputs: the live tasks array, and the count of tickets we
  // had to exclude because they had no dates (shown as a banner).
  const { tasks, undatedCount } = useMemo(() => {
    return buildGanttTasks({
      tickets: scopedTickets,
      epics: scopedEpics,
      showOnlyEpics,
    });
  }, [scopedTickets, scopedEpics, showOnlyEpics]);

  // The initial snapshot we hand off to <Gantt tasks={...}>. Captured
  // ONCE per "view configuration" (scope + showOnlyEpics + zoom), and
  // kept stable until that config changes — every subsequent ticket
  // edit is reconciled through `api.exec(...)` below. When the view
  // config changes (e.g. user toggles "Only epics") we let SVAR
  // re-init: that's a deliberate full refresh.
  const [initialTasks, setInitialTasks] = useState<GanttRow[] | null>(null);
  const [initialLinks, setInitialLinks] = useState<GanttLink[]>([]);
  const lastSyncedTasksRef = useRef<GanttRow[] | null>(null);
  const lastSyncedLinksRef = useRef<GanttLink[]>([]);
  const viewKey = useMemo(
    () => `${scope}|${showOnlyEpics ? "1" : "0"}|${zoom}`,
    [scope, showOnlyEpics, zoom],
  );
  const lastViewKeyRef = useRef<string | null>(null);

  const links = useMemo(() => buildGanttLinks(tasks), [tasks]);

  useEffect(() => {
    if (loading) return;
    if (lastViewKeyRef.current === viewKey && initialTasks !== null) return;
    // First load OR view config changed → re-seed SVAR with the
    // current task set. The Gantt will receive a new `tasks` prop
    // ref and re-init once.
    setInitialTasks(tasks);
    setInitialLinks(links);
    lastSyncedTasksRef.current = tasks;
    lastSyncedLinksRef.current = links;
    lastViewKeyRef.current = viewKey;
  }, [loading, tasks, links, viewKey, initialTasks]);

  // Incremental sync: when the live `tasks` change (because a ticket
  // was edited) AND the view config hasn't changed, push diffs to
  // SVAR via the imperative API. SVAR keeps its layout state intact.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    if (lastViewKeyRef.current !== viewKey) return; // view-change path uses the seed effect above
    const prev = lastSyncedTasksRef.current ?? [];
    if (prev === tasks) return;
    // Capture the user's current grid width BEFORE the sync — SVAR's
    // internal `ne` useMemo recomputes whenever its `m` (columns
    // reactive subscription) gets a new reference (happens on every
    // store emit), which triggers `H(ne)` resetting the panel width
    // to its default. We can't stop that React-side; instead, restore
    // the width imperatively in a requestAnimationFrame after our
    // dispatches settle.
    const containerBefore = ganttHostRef.current?.querySelector<HTMLElement>(".wx-table-container");
    const widthBefore = containerBefore?.offsetWidth ?? null;

    const prevMap = new Map(prev.map((t) => [t.id, t]));
    const currMap = new Map(tasks.map((t) => [t.id, t]));

    // Mark our dispatches with an `eventSource` matching the action
    // name so SVAR's handler takes its short-circuit branch: it just
    // calls `tasks.update()` without re-running the auto-schedule
    // (date math, summary-kid propagation, ...) — which is what was
    // causing the grid-panel width to reset on every edit.
    // See the `c==="update-task" || c==="add-task" || ...` check in
    // @svar-ui/gantt-store's DataStore handler.

    // Deletes first (so SVAR doesn't briefly hold stale parents).
    for (const id of prevMap.keys()) {
      if (!currMap.has(id)) {
        try {
          api.exec("delete-task", { id: id as string, eventSource: "delete-task", skipUndo: true });
        } catch {
          // tolerated — next view-config change will reseed
        }
      }
    }
    // Adds + updates.
    for (const [id, next] of currMap) {
      const before = prevMap.get(id);
      if (!before) {
        try {
          api.exec("add-task", { task: { ...next }, eventSource: "add-task", skipUndo: true });
        } catch {
          /* ignored */
        }
      } else if (!tasksEqual(before, next)) {
        try {
          api.exec("update-task", {
            id: id as string,
            task: { ...next },
            eventSource: "update-task",
            skipUndo: true,
          });
        } catch {
          /* ignored */
        }
      }
    }

    lastSyncedTasksRef.current = tasks;

    // Diff links too — same diff strategy, by `id` (composite
    // "link:src->target") so add/delete is the natural representation
    // (a dep change is "remove old + add new").
    const prevLinks = lastSyncedLinksRef.current ?? [];
    const prevLinkMap = new Map(prevLinks.map((l) => [l.id, l]));
    const currLinkMap = new Map(links.map((l) => [l.id, l]));
    for (const id of prevLinkMap.keys()) {
      if (!currLinkMap.has(id)) {
        try {
          api.exec("delete-link", {
            id,
            eventSource: "delete-link",
            skipUndo: true,
          });
        } catch {
          /* ignored */
        }
      }
    }
    for (const [id, link] of currLinkMap) {
      if (!prevLinkMap.has(id)) {
        try {
          api.exec("add-link", {
            link: { ...link },
            eventSource: "add-link",
            skipUndo: true,
          });
        } catch {
          /* ignored */
        }
      }
    }
    lastSyncedLinksRef.current = links;

    // After React/SVAR flush, the grid panel has been reset to its
    // default (440 with flexgrow / sum-of-widths otherwise). Restore
    // the pre-sync width via inline style — that wins against React's
    // declared style for as long as React doesn't re-render with a
    // different width prop.
    if (widthBefore != null && widthBefore > 50) {
      requestAnimationFrame(() => {
        const after = ganttHostRef.current?.querySelector<HTMLElement>(".wx-table-container");
        if (!after) return;
        if (Math.abs(after.offsetWidth - widthBefore) > 2) {
          after.style.width = `${widthBefore}px`;
          after.style.flexBasis = `${widthBefore}px`;
          after.style.flexGrow = "0";
          after.style.flexShrink = "0";
        }
      });
    }
  }, [tasks, links, viewKey]);

  // SVAR fires update-task whenever the user drags a bar bound, drags
  // the progress handle, or edits via the inline editor. We persist
  // start/end/progress back to the kanban store. Other deltas
  // (duration, type, text) are ignored — they'd require domain rules
  // we don't want to litigate from drag actions.
  const handleUpdateTask = useCallback(
    (ev: {
      id: string | number;
      task: Partial<ITask>;
      inProgress?: boolean;
      eventSource?: string;
    }) => {
      if (ev.inProgress) return; // ignore intermediate drag ticks
      // Our own external syncs use the action-name as eventSource so
      // SVAR takes its short-circuit path. Ignore them here to break
      // the feedback loop (api.exec → onUpdateTask → updateTicket →
      // backend → another data tick → another api.exec).
      if (
        ev.eventSource === "update-task" ||
        ev.eventSource === "add-task" ||
        ev.eventSource === "delete-task"
      ) {
        return;
      }
      const id = String(ev.id);
      const t = ev.task;
      const patch: Parameters<typeof updateTicket>[1] = {};
      if (t.start instanceof Date) patch.startDate = t.start.getTime();
      if (t.end instanceof Date) patch.dueDate = t.end.getTime();
      if (typeof t.progress === "number") {
        patch.progress = Math.max(0, Math.min(100, Math.round(t.progress)));
      }
      if (Object.keys(patch).length === 0) return;
      // Persist the user's drag, then cascade if dueDate changed —
      // dependents of this ticket must shift to honour the new
      // earliest start.
      updateTicket(id, patch)
        .then(() => {
          if (patch.dueDate == null) return;
          const live = ticketsForLookupRef.current.allTickets;
          const patches = cascadeFromChangedTicket(live, id, patch);
          return Promise.all(patches.map((p) => updateTicket(p.id, p.patch)));
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("Gantt updateTask failed:", err);
        });
    },
    [],
  );

  // Stable ref to the current scoped tickets — used inside the
  // (also stable) onSelectTask handler. Without this the callback
  // would be recreated on every data tick, which can prod SVAR into
  // resetting transient internal state.
  const ticketsForLookupRef = useRef({ scope, allTickets, currentTeamTickets });
  ticketsForLookupRef.current = { scope, allTickets, currentTeamTickets };
  const handleSelectTask = useCallback((ev: { id: string | number }) => {
    const { scope: sc, allTickets: all, currentTeamTickets: team } = ticketsForLookupRef.current;
    const ticket = (sc === "all" ? all : team).find((x) => x.id === String(ev.id));
    if (ticket) setEditing(ticket);
  }, []);

  // SVAR fires `add-link` when the user drags a connector from one
  // bar to another. We write the new dependency into the target
  // ticket's `dependencies` array (FS = the source must finish before
  // the target starts) and run the cascade.
  // Skip our own dispatches (eventSource === "add-link") to avoid the
  // feedback loop, and ignore any link with a non-FS type — we only
  // model finish-to-start in this app.
  const handleAddLink = useCallback(
    (ev: { link: Partial<ILink>; eventSource?: string }) => {
      if (ev.eventSource === "add-link") return;
      const { source, target, type } = ev.link;
      if (!source || !target) return;
      // SVAR fires "e2s" for the user's natural drag (end of source
      // → start of target). Accept just that one for now.
      if (type && type !== "e2s") return;
      const sourceId = String(source);
      const targetId = String(target);
      if (sourceId === targetId) return;

      // Snapshot the current tickets (live ref, captured each call).
      const live = ticketsForLookupRef.current;
      const allTix = live.scope === "all" ? live.allTickets : live.currentTeamTickets;
      // We need the FULL ticket set for cycle detection (cross-team
      // deps are allowed). Re-derive via the unscoped allTickets.
      const fullTickets = live.allTickets;
      if (dependenciesAreCyclic(fullTickets, targetId, sourceId)) {
        // eslint-disable-next-line no-console
        console.warn("Gantt: refused link — would create a cycle", { sourceId, targetId });
        return;
      }
      const target_t = allTix.find((t) => t.id === targetId);
      if (!target_t) return;
      const nextDeps = Array.from(
        new Set([...(target_t.dependencies ?? []), sourceId]),
      );

      // Apply the self-shift up-front so the target's bar moves
      // immediately (instead of waiting for the cascade round-trip
      // after the dep is persisted).
      const hypothetical: Ticket = {
        ...target_t,
        dependencies: nextDeps,
      };
      const byId = new Map<string, Ticket>(
        fullTickets.map((t) => [t.id, t.id === targetId ? hypothetical : t]),
      );
      const selfShift = computeShiftFromDependencies(hypothetical, byId);
      const patch: Parameters<typeof updateTicket>[1] = { dependencies: nextDeps };
      if (selfShift?.startDate != null) patch.startDate = selfShift.startDate;
      if (selfShift?.dueDate != null) patch.dueDate = selfShift.dueDate;

      updateTicket(targetId, patch)
        .then(() => {
          // Cascade from the target if its dueDate moved.
          if (patch.dueDate == null) return;
          const patches = cascadeFromChangedTicket(fullTickets, targetId, patch);
          return Promise.all(patches.map((p) => updateTicket(p.id, p.patch)));
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("Gantt addLink failed:", err);
        });
    },
    [],
  );

  const handleDeleteLink = useCallback((ev: { id: string | number; eventSource?: string }) => {
    // Skip our own external syncs (sync effect dispatches with
    // eventSource: "delete-link" to short-circuit SVAR and avoid this
    // very feedback loop).
    if (ev.eventSource === "delete-link") return;
    const linkIdStr = String(ev.id);
    // Parse our composite id: "link:source->target".
    const m = linkIdStr.match(/^link:(.+)->(.+)$/);
    if (!m) return;
    const sourceId = m[1];
    const targetId = m[2];
    const live = ticketsForLookupRef.current;
    const all = live.scope === "all" ? live.allTickets : live.currentTeamTickets;
    const target_t = all.find((t) => t.id === targetId);
    if (!target_t) return;
    const nextDeps = (target_t.dependencies ?? []).filter((d) => d !== sourceId);
    updateTicket(targetId, { dependencies: nextDeps }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Gantt deleteLink failed:", err);
    });
  }, []);

  const currentTeam = teams.find((tt) => tt.id === currentTeamId);

  return (
    <div className="p-4 md:p-8">
      <PageHeader
        title="Gantt"
        description="Timeline view of epics and tickets with start/due dates."
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <select
                className="input text-xs h-8 py-0"
                value={scope}
                onChange={(e) => setScope(e.target.value as Scope)}
                aria-label="Scope"
              >
                <option value="team">Current team</option>
                <option value="all">All teams</option>
              </select>
            )}
            <select
              className="input text-xs h-8 py-0"
              value={zoom}
              onChange={(e) => setZoom(e.target.value as Zoom)}
              aria-label="Zoom"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
            </select>
            <label className="text-xs inline-flex items-center gap-1.5 text-surface-600 dark:text-surface-300">
              <input
                type="checkbox"
                checked={showOnlyEpics}
                onChange={(e) => setShowOnlyEpics(e.target.checked)}
              />
              Only epics
            </label>
          </div>
        }
      />

      {undatedCount > 0 && (
        <div className="mb-4 flex gap-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3.5 py-3 text-sm dark:bg-amber-900/20 dark:ring-amber-700/40">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0 dark:text-amber-400" />
          <p className="text-amber-800 dark:text-amber-200">
            <strong>{undatedCount}</strong> ticket{undatedCount > 1 ? "s have" : " has"} no start or due date and won't appear here. Edit them to set dates.
          </p>
        </div>
      )}

      {scope === "team" && currentTeam && (
        <p className="text-xs text-surface-500 mb-3 dark:text-surface-400 inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", getTeamSwatchClass(currentTeam.color))} />
          {currentTeam.name}
        </p>
      )}

      {loading || initialTasks === null ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Loading…</p>
      ) : initialTasks.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No dated work to show"
          description="Open a ticket and set a start and due date to make it appear on the Gantt."
        />
      ) : (
        <div
          ref={ganttHostRef}
          className="kanban-gantt-host rounded-lg ring-1 ring-surface-200 overflow-hidden dark:ring-surface-700"
          style={{ height: "70vh" }}
        >
          <Theme>
            <Gantt
              /* `initialTasks` is captured once when data first loads
                 (and re-seeded only on view-config changes). Every
                 subsequent ticket edit reaches SVAR via api.exec in
                 the sync effect above — that way SVAR keeps its
                 internal layout state (grid width, expand/collapse,
                 scroll) intact. */
              tasks={initialTasks}
              links={initialLinks}
              scales={scalesProp}
              /* A single "Name" column so SVAR renders the expand /
                 collapse toggle next to summary tasks. Reference is
                 module-stable — see GANTT_COLUMNS above. */
              columns={GANTT_COLUMNS}
              zoom
              /* We compute the rollup ourselves in buildGanttTasks
                 so it can count undated children too. */
              summary={GANTT_SUMMARY}
              init={handleGanttInit}
              onUpdateTask={handleUpdateTask}
              onSelectTask={handleSelectTask}
              onAddLink={handleAddLink}
              onDeleteLink={handleDeleteLink}
            />
          </Theme>
        </div>
      )}
      {/* SVAR's default summary bg/fill are ~the same green (#00ba94 /
          #099f81), which makes the progress fill nearly invisible. We
          deepen the fill and lighten the bg for ~3:1 contrast. Same
          treatment for task bars.

          We target the theme classes directly because SVAR defines the
          variables on .wx-willow-theme / .wx-willow-dark-theme — those
          selectors win over a parent .kanban-gantt-host setter. */}
      <style>{`
        .kanban-gantt-host .wx-willow-theme,
        .kanban-gantt-host .wx-willow-dark-theme {
          --wx-gantt-summary-color: #34d399;
          --wx-gantt-summary-fill-color: #047857;
          --wx-gantt-summary-border-color: #047857;
          --wx-gantt-task-color: #60a5fa;
          --wx-gantt-task-fill-color: #1d4ed8;
          --wx-gantt-task-border-color: #1d4ed8;
        }
      `}</style>

      <TicketModal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        ticket={editing}
        workflow={workflow as Workflow}
      />
    </div>
  );
}

interface BuildArgs {
  tickets: Ticket[];
  epics: Ticket[];
  showOnlyEpics: boolean;
}

function buildGanttTasks({ tickets, epics, showOnlyEpics }: BuildArgs): {
  tasks: GanttRow[];
  undatedCount: number;
} {
  const out: GanttRow[] = [];
  let undatedCount = 0;

  // Index children by epicId so we can emit them under each epic.
  const childrenByEpic = new Map<string, Ticket[]>();
  const orphans: Ticket[] = [];
  for (const t of tickets) {
    if (t.type === EPIC_TYPE) continue;
    if (t.epicId) {
      const list = childrenByEpic.get(t.epicId) ?? [];
      list.push(t);
      childrenByEpic.set(t.epicId, list);
    } else {
      orphans.push(t);
    }
  }

  for (const epic of epics) {
    const epicChildren = childrenByEpic.get(epic.id) ?? [];
    const datedChildren: Array<{ ticket: Ticket; band: { start: Date; end: Date } }> = [];
    for (const child of epicChildren) {
      const band = deriveBand(child);
      if (band) datedChildren.push({ ticket: child, band });
      else undatedCount++;
    }
    // The epic row spans the union of its dated children's bands.
    // Falls back to the epic's own start/due only when no children
    // have dates — that way adding a ticket to an epic re-spans the
    // bar automatically without the user having to also update the
    // epic's own dates. If neither source exists, skip the epic.
    const epicSelfBand = deriveBand(epic);
    const childBand = unionBand(datedChildren.map((c) => c.band));
    const epicBand = childBand ?? epicSelfBand;
    if (!epicBand && datedChildren.length === 0) {
      if (epic.startDate != null || epic.dueDate != null) undatedCount++;
      continue;
    }
    if (!epicBand) continue;
    // Compute the rollup progress ourselves: average across ALL
    // children regardless of whether they have dates. SVAR's built-in
    // `summary.autoProgress` only rolls up children visible in the
    // chart, which would silently ignore undated tickets — we want
    // those to count too.
    const rollupProgress =
      epicChildren.length === 0
        ? epic.progress ?? 0
        : Math.round(
            epicChildren.reduce((acc, c) => acc + (c.progress ?? 0), 0) /
              epicChildren.length,
          );
    // `open: true` is only safe when we actually emit children for
    // this epic. SVAR's internal toArray() recurses through node.data
    // when `open === true` and crashes ("t is null" in forEach) if
    // we say it's expanded but never push children — which is exactly
    // what happens in "Only epics" mode.
    const willEmitChildren = !showOnlyEpics && datedChildren.length > 0;
    out.push({
      id: epic.id,
      text: epic.title,
      start: epicBand.start,
      end: epicBand.end,
      type: "summary",
      progress: rollupProgress,
      ...(willEmitChildren ? { open: true } : {}),
      _kanbanId: epic.id,
      _dependencies: Array.isArray(epic.dependencies) ? [...epic.dependencies] : undefined,
    });
    if (!showOnlyEpics) {
      for (const { ticket, band } of datedChildren) {
        out.push({
          id: ticket.id,
          text: ticket.title,
          start: band.start,
          end: band.end,
          type: "task",
          progress: ticket.progress ?? 0,
          parent: epic.id,
          _kanbanId: ticket.id,
          _dependencies: Array.isArray(ticket.dependencies) ? [...ticket.dependencies] : undefined,
        });
      }
    }
  }

  if (!showOnlyEpics) {
    // Tickets without an epic — render at the top level so they're not
    // lost. No synthetic parent row to keep the data shape predictable
    // for SVAR's tree.
    for (const t of orphans) {
      const band = deriveBand(t);
      if (!band) {
        undatedCount++;
        continue;
      }
      out.push({
        id: t.id,
        text: t.title,
        start: band.start,
        end: band.end,
        type: "task",
        progress: t.progress ?? 0,
        _kanbanId: t.id,
        _dependencies: Array.isArray(t.dependencies) ? [...t.dependencies] : undefined,
      });
    }
  } else {
    // In "only epics" mode, count orphans as undated context (they're
    // hidden but still relevant feedback for the banner).
    for (const t of orphans) {
      if (deriveBand(t) === null) undatedCount++;
    }
  }

  return { tasks: out, undatedCount };
}
