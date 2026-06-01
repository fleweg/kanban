import clsx, { type ClassValue } from "clsx";
import type { Timestamp } from "firebase/firestore";
import type { ChecklistItem, Priority, Ticket, Workflow } from "../types";

export const cn = (...args: ClassValue[]) => clsx(...args);

// Anything we accept as "a date-ish value" coming from Firestore reads, JS
// Date construction, or a raw number. The runtime helpers all defend against
// undefined / NaN.
type DateLike = Timestamp | Date | string | number | null | undefined;

function toDate(value: DateLike): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as Timestamp).toDate();
  }
  const date = new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatDate(value: DateLike): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: DateLike): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Compact relative time for fresh items, falls back to absolute date after 24h.
export function formatRelativeTime(value: DateLike): string {
  const date = toDate(value);
  if (!date) return "—";
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return formatDate(value);
}

// Effective sort key for a ticket: explicit `order` if set, otherwise the
// creation timestamp in millis. Both are comparable numbers, so tickets with
// and without explicit order can mix in the same sort.
export function effectiveOrder(ticket: Pick<Ticket, "order" | "createdAt"> | null | undefined): number {
  if (typeof ticket?.order === "number") return ticket.order;
  const t = ticket?.createdAt;
  if (t && typeof t.toMillis === "function") return t.toMillis();
  return 0;
}

// Sort tickets descending by effective order — highest = top of the list.
// Match what the user sees: newest first, then drag-reordered manually.
export function compareTickets(a: Ticket, b: Ticket): number {
  return effectiveOrder(b) - effectiveOrder(a);
}

// Computes the `order` value for a ticket dropped at `destinationIndex` inside
// `column` (a list already sorted by descending order). Source ticket is
// removed first if present, so the helper works for both same-list reorders
// and cross-list moves.
//
// Strategy: midpoint between the new neighbors. Big initial gaps (1000)
// when inserting at an extremity. JS number precision is large enough that
// this can run hundreds of times between the same two neighbors before
// degrading.
export function computeNewOrder(column: Ticket[], sourceTicketId: string, destinationIndex: number): number {
  const filtered = column.filter((t) => t.id !== sourceTicketId);
  const above = destinationIndex <= 0 ? null : filtered[destinationIndex - 1];
  const below = destinationIndex >= filtered.length ? null : filtered[destinationIndex];
  const aboveOrder = above ? effectiveOrder(above) : null;
  const belowOrder = below ? effectiveOrder(below) : null;
  if (aboveOrder == null && belowOrder == null) return Date.now();
  if (aboveOrder == null) return (belowOrder as number) + 1000;
  if (belowOrder == null) return aboveOrder - 1000;
  return (aboveOrder + belowOrder) / 2;
}

export type TextToken = { type: "text"; value: string } | { type: "link"; value: string };

// Splits text into URL and non-URL fragments. Used by components that want to
// render plain-text content with clickable links without parsing markdown.
const URL_REGEX = /(https?:\/\/[^\s)]+)/g;
export function tokenizeForLinks(text: string | null | undefined): TextToken[] {
  if (!text) return [];
  const out: TextToken[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_REGEX)) {
    const idx = match.index ?? 0;
    if (idx > last) out.push({ type: "text", value: text.slice(last, idx) });
    out.push({ type: "link", value: match[0] });
    last = idx + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

export interface PriorityDef {
  value: Priority;
  label: string;
  color: string;
}

export const PRIORITIES: PriorityDef[] = [
  { value: "low", label: "Low", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { value: "medium", label: "Medium", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "high", label: "High", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  { value: "urgent", label: "Urgent", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
];

export function getPriority(value: Priority | null | undefined): PriorityDef {
  return PRIORITIES.find((p) => p.value === value) ?? PRIORITIES[1];
}

// Stable palette used for user avatars. Each entry is bg + text classes so
// the disc renders correctly with white text on a saturated background.
const AVATAR_PALETTE = [
  "bg-blue-500 text-white",
  "bg-emerald-500 text-white",
  "bg-amber-500 text-white",
  "bg-violet-500 text-white",
  "bg-rose-500 text-white",
  "bg-cyan-500 text-white",
  "bg-pink-500 text-white",
  "bg-orange-500 text-white",
  "bg-teal-500 text-white",
  "bg-indigo-500 text-white",
];

// djb2-style hash, deterministic so the same uid always maps to the same color.
function hashString(value: string): number {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function colorClassesFor(uid: string | null | undefined): string {
  if (!uid) return "bg-surface-200 text-surface-500";
  return AVATAR_PALETTE[hashString(uid) % AVATAR_PALETTE.length];
}

// Derives 1–2 uppercase letters from an email's local part (john.doe → JD,
// frederic → F). Falls back to the first character of the raw input.
export function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "?";
  const local = email.split("@")[0] ?? email;
  const parts = local
    .split(/[._\-+\s]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return (email[0] ?? "?").toUpperCase();
  const letters = parts.slice(0, 2).map((p) => p[0]).join("");
  return letters.toUpperCase();
}

// Returns the auto-applied progress when a ticket's status changes.
// - Moving into the workflow's completed column snaps progress to 100.
// - Moving into the first column snaps progress to 0.
// - Any other column preserves the existing progress (caller-driven).
// Returns null when there's no auto-rule to apply (caller should leave
// progress unchanged in that case).
export function autoProgressForStatus(
  status: string | null | undefined,
  workflow: Workflow | undefined,
): number | null {
  if (!workflow || !status) return null;
  if (status === workflow.completedColumnId) return 100;
  if (status === workflow.columns[0]?.id) return 0;
  return null;
}

// Counts done/total across a ticket's checklist. Tickets created before the
// checklist feature have no `checklist` field — treated as empty here.
export function checklistProgress(checklist: ChecklistItem[] | null | undefined): { done: number; total: number } {
  if (!Array.isArray(checklist) || checklist.length === 0) {
    return { done: 0, total: 0 };
  }
  const done = checklist.reduce((acc, item) => acc + (item?.done ? 1 : 0), 0);
  return { done, total: checklist.length };
}

// Human-readable byte size, e.g. 2048 -> "2.0 KB". Used for attachment rows.
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// Strips all tags from an HTML string and collapses whitespace, for use in
// previews (card descriptions, epic cards) where rich formatting would break
// layout. Falls back to a regex strip when DOMParser is unavailable.
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  const raw =
    typeof DOMParser !== "undefined"
      ? new DOMParser().parseFromString(html, "text/html").body.textContent ?? ""
      : html.replace(/<[^>]*>/g, "");
  return raw.replace(/\s+/g, " ").trim();
}
