import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { addComment } from "../../services/comments";

export function CommentComposer({ ticketId, currentUser, replyingTo, replyAuthorEmail, onCancelReply, onPosted }) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  // Focus the textarea when entering reply mode so the user can type immediately.
  useEffect(() => {
    if (replyingTo && textareaRef.current) textareaRef.current.focus();
  }, [replyingTo]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!currentUser?.uid) {
      setError("You must be signed in to comment.");
      return;
    }
    if (!body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addComment({
        ticketId,
        authorId: currentUser.uid,
        body,
        replyTo: replyingTo?.id ?? null,
      });
      setBody("");
      onPosted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {replyingTo && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-surface-100 px-2.5 py-1.5 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-300">
          <span className="truncate">
            Replying to <span className="font-medium text-surface-900 dark:text-surface-100">{replyAuthorEmail}</span>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            className="text-surface-400 hover:text-surface-700 dark:text-surface-500 dark:hover:text-surface-200"
            aria-label="Cancel reply"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="input min-h-[70px] resize-y text-sm"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={replyingTo ? "Write a reply…" : "Add a comment…"}
        disabled={submitting}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center justify-end">
        <button type="submit" className="btn-primary text-xs" disabled={submitting || !body.trim()}>
          <Send className="h-3.5 w-3.5" />
          {submitting ? "Posting…" : replyingTo ? "Reply" : "Comment"}
        </button>
      </div>
    </form>
  );
}
