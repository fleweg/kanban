import clsx from "clsx";

export const cn = (...args) => clsx(...args);

export function formatDate(value) {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Compact relative time for fresh items, falls back to absolute date after 24h.
export function formatRelativeTime(value) {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return formatDate(value);
}

// Splits text into URL and non-URL fragments. Used by components that want to
// render plain-text content with clickable links without parsing markdown.
const URL_REGEX = /(https?:\/\/[^\s)]+)/g;
export function tokenizeForLinks(text) {
  if (!text) return [];
  const out = [];
  let last = 0;
  for (const match of text.matchAll(URL_REGEX)) {
    if (match.index > last) out.push({ type: "text", value: text.slice(last, match.index) });
    out.push({ type: "link", value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

export const PRIORITIES = [
  { value: "low", label: "Low", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { value: "medium", label: "Medium", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "high", label: "High", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  { value: "urgent", label: "Urgent", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
];

export function getPriority(value) {
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
function hashString(value) {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function colorClassesFor(uid) {
  if (!uid) return "bg-surface-200 text-surface-500";
  return AVATAR_PALETTE[hashString(uid) % AVATAR_PALETTE.length];
}

// Derives 1–2 uppercase letters from an email's local part (john.doe → JD,
// frederic → F). Falls back to the first character of the raw input.
export function initialsFromEmail(email) {
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
