import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ExternalLink, Loader2, MessageSquare, Send } from "lucide-react";
import {
  AsanaApiError,
  listStories,
  postStory,
  type AsanaStory,
} from "../../services/asana/client";
import { formatRelativeTime } from "../../lib/utils";

interface AsanaCommentListProps {
  // Asana task GID this ticket is linked to.
  asanaGid: string;
  // app.asana.com permalink, used for the "Open in Asana" link in the
  // header. Optional — when missing we fall back to constructing a
  // generic URL.
  permalinkUrl?: string | null;
}

// Polling cadence for /stories. Asana free-tier allows 150 requests
// per minute; one open ticket modal at 30s = 2 RPM/ticket. Plenty of
// headroom even with several tabs open.
const POLL_INTERVAL_MS = 30_000;

// Internal: stories the user has just posted but the next poll hasn't
// brought back yet. Either still in-flight (`status: "pending"`),
// confirmed by Asana's response (`"confirmed"` — kept until the next
// poll dedupes by real gid), or rejected (`"failed"` — visible with a
// retry / dismiss until the user acts).
interface OptimisticStory {
  // Local-only id used to track the row through state transitions.
  localId: string;
  // Real Asana gid once postStory resolves. Until then it's null and
  // the optimistic row is keyed by localId.
  gid: string | null;
  text: string;
  createdAt: string;
  status: "pending" | "confirmed" | "failed";
  error?: string;
}

// Filter user comments out of the system-event noise. Asana mixes
// "system" stories (assignment changes, due-date edits, etc.) with the
// real user comments — we only render the comments. Also skips empty
// stories (rare).
function isUserComment(story: AsanaStory): boolean {
  if (story.type !== "comment") return false;
  const text = story.html_text ?? story.text ?? "";
  if (!text) return false;
  return true;
}

// Returns the cleanest plain-text version of a story. Prefer the
// `text` field — Asana populates it alongside `html_text` even for
// HTML stories, so it works for both paths and avoids us re-parsing
// HTML (and re-displaying it raw when Asana refused to parse the
// posted HTML, e.g. unsupported tags). Falls back to an HTML→text
// pass on `html_text` if `text` is missing.
function storyToPlainText(story: AsanaStory): string {
  if (story.text && story.text.trim()) return story.text;
  const raw = story.html_text ?? "";
  if (!raw) return "";
  const inner = raw
    .replace(/^\s*<body>/i, "")
    .replace(/<\/body>\s*$/i, "");
  if (typeof DOMParser === "undefined") {
    return inner.replace(/<[^>]+>/g, "").trim();
  }
  const doc = new DOMParser().parseFromString(`<div>${inner}</div>`, "text/html");
  return (doc.body.firstElementChild?.textContent ?? "").trim();
}

function newLocalId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AsanaCommentList({ asanaGid, permalinkUrl }: AsanaCommentListProps) {
  const [stories, setStories] = useState<AsanaStory[]>([]);
  const [optimistic, setOptimistic] = useState<OptimisticStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Use a ref so refresh() always sees the latest value without having
  // to be re-bound every tick.
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function refresh() {
      try {
        const data = await listStories(asanaGid);
        if (!aliveRef.current) return;
        setStories(data);
        // Drop confirmed optimistic rows whose real gid is now in the
        // polled list — they've made the round-trip. Pending/failed
        // entries stay until they resolve themselves.
        const polledGids = new Set(data.map((s) => s.gid));
        setOptimistic((prev) =>
          prev.filter((o) => !(o.status === "confirmed" && o.gid && polledGids.has(o.gid))),
        );
        setError(null);
      } catch (err) {
        if (!aliveRef.current) return;
        if (err instanceof AsanaApiError) {
          setError(`Asana ${err.status}: ${err.message}`);
        } else {
          setError((err as Error).message);
        }
      } finally {
        if (aliveRef.current) {
          setLoading(false);
          timer = setTimeout(refresh, POLL_INTERVAL_MS);
        }
      }
    }

    refresh();

    return () => {
      aliveRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [asanaGid]);

  // Reset optimistic queue when switching tickets — otherwise a stale
  // pending row from a previous task could leak into a new modal mount
  // for a different gid (unlikely but cheap to guard).
  useEffect(() => {
    setOptimistic([]);
  }, [asanaGid]);

  // Post handler — adds an optimistic row, calls Asana, transitions
  // the row to confirmed / failed. Returns true on success so the
  // composer can clear its textarea.
  async function postOptimistically(text: string): Promise<boolean> {
    const localId = newLocalId();
    const optimisticRow: OptimisticStory = {
      localId,
      gid: null,
      text,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    setOptimistic((prev) => [...prev, optimisticRow]);

    try {
      const created = await postStory(asanaGid, { text });
      setOptimistic((prev) =>
        prev.map((o) =>
          o.localId === localId ? { ...o, gid: created.gid, status: "confirmed" } : o,
        ),
      );
      return true;
    } catch (err) {
      const msg =
        err instanceof AsanaApiError
          ? `Asana rejected the comment (HTTP ${err.status}).`
          : (err as Error).message;
      setOptimistic((prev) =>
        prev.map((o) => (o.localId === localId ? { ...o, status: "failed", error: msg } : o)),
      );
      return false;
    }
  }

  function dismissFailed(localId: string) {
    setOptimistic((prev) => prev.filter((o) => o.localId !== localId));
  }

  // Visible comments = polled user comments + every optimistic row
  // (pending/confirmed/failed). Dedupe so a confirmed-but-not-yet-
  // polled row doesn't sneak in twice if the next poll happens before
  // we drop it.
  const visibleStories = useMemo(() => stories.filter(isUserComment), [stories]);
  const polledGids = useMemo(() => new Set(visibleStories.map((s) => s.gid)), [visibleStories]);
  const visibleOptimistic = useMemo(
    () => optimistic.filter((o) => !(o.gid && polledGids.has(o.gid))),
    [optimistic, polledGids],
  );
  const totalCount = visibleStories.length + visibleOptimistic.length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-surface-500 dark:text-surface-400" />
          <h3 className="text-sm font-semibold">
            Asana comments {totalCount > 0 && `(${totalCount})`}
          </h3>
        </div>
        {permalinkUrl && (
          <a
            href={permalinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            <ExternalLink className="h-3 w-3" />
            Open in Asana
          </a>
        )}
      </div>

      <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-700/40">
        Comments shown here come from the linked Asana task. Posting from this
        Kanban writes back as a comment on the Asana side.
      </p>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">
          Loading Asana comments…
        </p>
      ) : totalCount === 0 ? (
        <p className="text-sm italic text-surface-500 dark:text-surface-400">
          No comments on this Asana task yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {visibleStories.map((story) => (
            <AsanaCommentRow key={story.gid} story={story} />
          ))}
          {visibleOptimistic.map((o) => (
            <OptimisticCommentRow key={o.localId} story={o} onDismiss={dismissFailed} />
          ))}
        </ul>
      )}

      <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
        <AsanaCommentComposer onPost={postOptimistically} />
      </div>
    </div>
  );
}

function AsanaCommentRow({ story }: { story: AsanaStory }) {
  const author = story.created_by?.name ?? story.created_by?.email ?? "Asana user";
  const text = storyToPlainText(story);
  return (
    <li className="rounded-md bg-surface-50 px-3 py-2 dark:bg-surface-800/50">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xs font-medium text-surface-900 dark:text-surface-100">
          {author}
        </span>
        <span className="text-[11px] text-surface-400 dark:text-surface-500">
          {story.created_at && formatRelativeTime(new Date(story.created_at))}
        </span>
      </div>
      <p className="mt-1 text-sm text-surface-800 whitespace-pre-wrap break-words dark:text-surface-100">
        {text}
      </p>
    </li>
  );
}

function OptimisticCommentRow({
  story,
  onDismiss,
}: {
  story: OptimisticStory;
  onDismiss: (localId: string) => void;
}) {
  const isPending = story.status === "pending";
  const isFailed = story.status === "failed";
  return (
    <li
      className={
        isFailed
          ? "rounded-md bg-red-50 px-3 py-2 ring-1 ring-red-200 dark:bg-red-900/20 dark:ring-red-700/40"
          : "rounded-md bg-surface-50 px-3 py-2 dark:bg-surface-800/50"
      }
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xs font-medium text-surface-900 dark:text-surface-100">You</span>
        {isPending && (
          <span className="inline-flex items-center gap-1 text-[11px] text-surface-500 dark:text-surface-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Posting…
          </span>
        )}
        {isFailed && (
          <span className="inline-flex items-center gap-1 text-[11px] text-red-700 dark:text-red-300">
            <AlertTriangle className="h-3 w-3" />
            Not sent to Asana
          </span>
        )}
        {!isPending && !isFailed && (
          <span className="text-[11px] text-surface-400 dark:text-surface-500">just now</span>
        )}
      </div>
      <p
        className={
          isPending
            ? "mt-1 text-sm whitespace-pre-wrap break-words text-surface-500 italic dark:text-surface-400"
            : "mt-1 text-sm whitespace-pre-wrap break-words text-surface-800 dark:text-surface-100"
        }
      >
        {story.text}
      </p>
      {isFailed && (
        <div className="mt-1.5 flex items-center gap-3 text-[11px]">
          {story.error && (
            <span className="text-red-700 dark:text-red-300">{story.error}</span>
          )}
          <button
            type="button"
            className="ml-auto text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100"
            onClick={() => onDismiss(story.localId)}
          >
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}

function AsanaCommentComposer({ onPost }: { onPost: (text: string) => Promise<boolean> }) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim()) return;
    const text = body;
    // Clear the textarea immediately so the user can keep typing the
    // next comment without waiting for the round-trip. The optimistic
    // row already mirrors what they wrote.
    setBody("");
    setSubmitting(true);
    try {
      const ok = await onPost(text);
      if (!ok) {
        // Restore the textarea so the user can edit + retry. The
        // failed row in the list keeps the original content visible
        // alongside the error.
        setBody(text);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        className="input min-h-[70px] resize-y text-sm"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Reply on the Asana task…"
      />
      <div className="flex items-center justify-end">
        <button type="submit" className="btn-primary text-xs" disabled={submitting || !body.trim()}>
          <Send className="h-3.5 w-3.5" />
          {submitting ? "Posting…" : "Comment on Asana"}
        </button>
      </div>
    </form>
  );
}
