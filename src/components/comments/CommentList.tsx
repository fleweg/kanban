import { useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { CommentItem } from "./CommentItem";
import { CommentComposer } from "./CommentComposer";
import { subscribeToComments } from "../../services/comments";
import { useAppData } from "../../context/AppDataContext";
import { useAuth } from "../../context/AuthContext";
import type { TicketComment } from "../../types";

interface GroupedComment {
  top: TicketComment;
  replies: TicketComment[];
}

// Groups top-level comments with their direct replies. Replies whose parent
// no longer exists (rare edge case) get bubbled up as top-level so they remain
// visible.
function groupComments(comments: TicketComment[]): GroupedComment[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const tops: TicketComment[] = [];
  const repliesByParent = new Map<string, TicketComment[]>();
  for (const c of comments) {
    if (c.replyTo && byId.has(c.replyTo)) {
      const arr = repliesByParent.get(c.replyTo) ?? [];
      arr.push(c);
      repliesByParent.set(c.replyTo, arr);
    } else {
      tops.push(c);
    }
  }
  return tops.map((top) => ({ top, replies: repliesByParent.get(top.id) ?? [] }));
}

export function CommentList({ ticketId }: { ticketId: string }) {
  const { user, isAdmin } = useAuth();
  const { getUserById } = useAppData();
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<TicketComment | null>(null);

  useEffect(() => {
    if (!ticketId) return;
    setLoading(true);
    const unsub = subscribeToComments(
      ticketId,
      (list) => {
        setComments(list);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [ticketId]);

  const grouped = useMemo(() => groupComments(comments), [comments]);
  const visibleCount = comments.filter((c) => !c.deleted).length;

  function handleReply(comment: TicketComment) {
    setReplyingTo(comment);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="h-4 w-4 text-surface-500 dark:text-surface-400" />
        <h3 className="text-sm font-semibold">Comments {visibleCount > 0 && `(${visibleCount})`}</h3>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Loading comments…</p>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-surface-500 italic dark:text-surface-400">
          No comments yet. Start the conversation.
        </p>
      ) : (
        <ul className="space-y-4">
          {grouped.map(({ top, replies }) => (
            <li key={top.id} className="space-y-3">
              <CommentItem
                ticketId={ticketId}
                comment={top}
                currentUser={user}
                isAdmin={isAdmin}
                getUserById={getUserById}
                onReply={handleReply}
              />
              {replies.length > 0 && (
                <ul className="space-y-3 ml-2">
                  {replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentItem
                        ticketId={ticketId}
                        comment={reply}
                        currentUser={user}
                        isAdmin={isAdmin}
                        getUserById={getUserById}
                        isReply
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
        <CommentComposer
          ticketId={ticketId}
          currentUser={user}
          replyingTo={replyingTo}
          replyAuthorEmail={replyingTo ? getUserById(replyingTo.authorId)?.email ?? "" : ""}
          onCancelReply={() => setReplyingTo(null)}
          onPosted={() => setReplyingTo(null)}
        />
      </div>
    </div>
  );
}
