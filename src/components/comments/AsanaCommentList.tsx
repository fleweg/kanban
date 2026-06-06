import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, MessageSquare, Send } from "lucide-react";
import {
  AsanaApiError,
  listStories,
  postStory,
  type AsanaStory,
} from "../../services/asana/client";
import {
  hasOriginMarker,
  ORIGIN_MARKER_SPAN,
  tiptapToAsana,
} from "../../services/asana/html";
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

// Filter user comments out of the system-event noise. Asana mixes
// "system" stories (assignment changes, due-date edits, etc.) with the
// real user comments — we only render the comments. Also skips empty
// stories (rare) and our own echoes (`<!-- kanban-origin -->`).
function isUserComment(story: AsanaStory): boolean {
  if (story.type !== "comment") return false;
  const text = story.html_text ?? story.text ?? "";
  if (!text) return false;
  return true;
}

// Strip <body>…</body> and the hidden origin marker so the display
// text is clean. Returns plain text since we want consistent styling
// with the native CommentList — also avoids re-rendering arbitrary
// HTML the PAT owner could inject.
function storyToPlainText(story: AsanaStory): string {
  const raw = story.html_text ?? story.text ?? "";
  // Strip outer <body> if present.
  const inner = raw
    .replace(/^\s*<body>/i, "")
    .replace(/<\/body>\s*$/i, "");
  // Strip our origin marker / span before extracting text so they
  // don't leak into the display.
  const withoutMarker = inner
    .replace(/<!-- kanban-origin -->/g, "")
    .replace(/<span[^>]*data-kanban-origin[^>]*><\/span>/g, "");
  // Quick HTML → text — keep paragraphs and line breaks readable.
  return withoutMarker
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

export function AsanaCommentList({ asanaGid, permalinkUrl }: AsanaCommentListProps) {
  const [stories, setStories] = useState<AsanaStory[]>([]);
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
          // Schedule the next poll AFTER this one resolves to avoid
          // overlapping requests on slow networks.
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

  const visible = stories.filter(isUserComment);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-surface-500 dark:text-surface-400" />
          <h3 className="text-sm font-semibold">
            Asana comments {visible.length > 0 && `(${visible.length})`}
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
      ) : visible.length === 0 ? (
        <p className="text-sm italic text-surface-500 dark:text-surface-400">
          No comments on this Asana task yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((story) => (
            <AsanaCommentRow key={story.gid} story={story} />
          ))}
        </ul>
      )}

      <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
        <AsanaCommentComposer asanaGid={asanaGid} />
      </div>
    </div>
  );
}

function AsanaCommentRow({ story }: { story: AsanaStory }) {
  const author = story.created_by?.name ?? story.created_by?.email ?? "Asana user";
  const text = storyToPlainText(story);
  const fromKanban = hasOriginMarker(story.html_text);
  return (
    <li className="rounded-md bg-surface-50 px-3 py-2 dark:bg-surface-800/50">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xs font-medium text-surface-900 dark:text-surface-100">
          {author}
        </span>
        {fromKanban && (
          <span
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            title="Posted from this Kanban"
          >
            Kanban
          </span>
        )}
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

function AsanaCommentComposer({ asanaGid }: { asanaGid: string }) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      // Wrap text in a paragraph so TipTap-style content survives the
      // Asana converter. Plain text from the textarea becomes "<p>$x</p>"
      // with line-break preservation.
      const html = body
        .split(/\n\n+/)
        .map((para) => `<p>${escapeForHtml(para).replace(/\n/g, "<br/>")}</p>`)
        .join("");
      // Sanitize through the Asana converter, then prefix the hidden
      // origin marker so we can dedupe it back when polling.
      const asanaBody = `${ORIGIN_MARKER_SPAN}${tiptapToAsana(html)}`;
      await postStory(asanaGid, asanaBody);
      setBody("");
    } catch (err) {
      if (err instanceof AsanaApiError) {
        setError(`Asana rejected the comment (HTTP ${err.status}).`);
      } else {
        setError((err as Error).message);
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
        disabled={submitting}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center justify-end">
        <button type="submit" className="btn-primary text-xs" disabled={submitting || !body.trim()}>
          <Send className="h-3.5 w-3.5" />
          {submitting ? "Posting…" : "Comment on Asana"}
        </button>
      </div>
    </form>
  );
}

function escapeForHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
