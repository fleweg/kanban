import { useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { CornerDownRight, Pencil, Reply, Trash2 } from "lucide-react";
import { UserAvatar } from "../users/UserAvatar";
import { displayNameOf, formatRelativeTime, tokenizeForLinks } from "../../lib/utils";
import { softDeleteComment, updateComment } from "../../services/comments";
import type { TicketComment, UserRecord } from "../../types";

function CommentBody({ text }: { text: string }) {
  const tokens = tokenizeForLinks(text);
  return (
    <p className="text-sm text-surface-800 whitespace-pre-wrap break-words dark:text-surface-100">
      {tokens.map((t, i) =>
        t.type === "link" ? (
          <a
            key={i}
            href={t.value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline underline-offset-2 break-all dark:text-blue-400"
            onClick={(e) => e.stopPropagation()}
          >
            {t.value}
          </a>
        ) : (
          <span key={i}>{t.value}</span>
        ),
      )}
    </p>
  );
}

interface CommentItemProps {
  ticketId: string;
  comment: TicketComment;
  currentUser: FirebaseUser | null;
  isAdmin: boolean;
  getUserById: (uid: string | null | undefined) => UserRecord | null;
  onReply?: (comment: TicketComment) => void;
  isReply?: boolean;
}

export function CommentItem({
  ticketId,
  comment,
  currentUser,
  isAdmin,
  getUserById,
  onReply,
  isReply,
}: CommentItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const author = getUserById(comment.authorId);
  const isOwn = currentUser?.uid === comment.authorId;
  const canEdit = isOwn && !comment.deleted;
  const canDelete = (isOwn || isAdmin) && !comment.deleted;

  async function handleSave() {
    if (!draft.trim()) {
      setError("Comment cannot be empty.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateComment(ticketId, comment.id, draft);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this comment? This cannot be undone.")) return;
    setSubmitting(true);
    try {
      await softDeleteComment(ticketId, comment.id);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  function cancelEdit() {
    setDraft(comment.body);
    setEditing(false);
    setError(null);
  }

  return (
    <div className={isReply ? "pl-7 border-l-2 border-surface-200 dark:border-surface-700" : ""}>
      <div className="flex gap-2.5">
        <div className="pt-0.5 shrink-0">
          {isReply && <CornerDownRight className="absolute -ml-5 mt-1 h-3 w-3 text-surface-400 dark:text-surface-500" />}
          {comment.deleted || !author ? (
            <UserAvatar email={author?.email ?? ""} uid={comment.authorId} size="sm" />
          ) : (
            <UserAvatar user={author} size="sm" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs font-medium text-surface-900 dark:text-surface-100">
              {displayNameOf(author) || "Unknown user"}
            </span>
            <span className="text-[11px] text-surface-400 dark:text-surface-500">
              {formatRelativeTime(comment.createdAt)}
              {comment.edited && !comment.deleted && " · edited"}
            </span>
          </div>

          {comment.deleted ? (
            <p className="mt-1 text-sm italic text-surface-400 dark:text-surface-500">[deleted]</p>
          ) : editing ? (
            <div className="mt-1 space-y-2">
              <textarea
                className="input min-h-[70px] resize-y text-sm"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={submitting}
                autoFocus
              />
              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}
              <div className="flex items-center gap-2">
                <button type="button" className="btn-primary text-xs" onClick={handleSave} disabled={submitting}>
                  {submitting ? "Saving…" : "Save"}
                </button>
                <button type="button" className="btn-ghost text-xs" onClick={cancelEdit} disabled={submitting}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-0.5">
              <CommentBody text={comment.body} />
            </div>
          )}

          {!comment.deleted && !editing && (
            <div className="mt-1.5 flex items-center gap-3 text-[11px]">
              {!isReply && onReply && (
                <button
                  type="button"
                  className="text-surface-500 hover:text-surface-900 inline-flex items-center gap-1 dark:text-surface-400 dark:hover:text-surface-100"
                  onClick={() => onReply(comment)}
                >
                  <Reply className="h-3 w-3" />
                  Reply
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="text-surface-500 hover:text-surface-900 inline-flex items-center gap-1 dark:text-surface-400 dark:hover:text-surface-100"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="text-red-600 hover:text-red-700 inline-flex items-center gap-1 dark:text-red-400 dark:hover:text-red-300"
                  onClick={handleDelete}
                  disabled={submitting}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
