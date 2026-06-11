import { useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Modal } from "../components/ui/Modal";
import { TagChip } from "../components/tags/TagChip";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { createTag, deleteTag, updateTag } from "../services/tags";
import type { Tag } from "../types";

const DEFAULT_NEW_TAG_COLOR = "#64748b";

// Admin-only page for renaming, recoloring, and deleting tags. Tags
// are created inline from the TagPicker (any active user) — this page
// is the central reference for the team's vocabulary + the only place
// where destructive ops live, which is why it's gated to admins.
export function TagsPage() {
  const { tags, tickets, loading } = useAppData();
  const { isAdmin } = useAuth();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Count of tickets currently using each tag — surfaced in the row
  // and as an impact preview on the delete confirmation modal.
  const usage = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const tg of tags) map[tg.id] = 0;
    for (const t of tickets) {
      if (!Array.isArray(t.tagIds)) continue;
      for (const id of t.tagIds) {
        if (map[id] !== undefined) map[id] += 1;
      }
    }
    return map;
  }, [tags, tickets]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Tags"
        description={
          isAdmin
            ? "Edit names and colors. Deleting a tag removes it from every ticket that referenced it."
            : "Tags currently in use across the project."
        }
        actions={
          isAdmin ? (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New tag
            </button>
          ) : null
        }
      />

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Loading…</p>
      ) : tags.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="No tags yet"
          description="Create a tag from the picker on any ticket, or add the first one from here."
          action={
            isAdmin ? (
              <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New tag
              </button>
            ) : null
          }
        />
      ) : (
        <ul className="card divide-y divide-surface-200 dark:divide-surface-800">
          {tags.map((tg) => {
            const count = usage[tg.id] ?? 0;
            return (
              <li key={tg.id} className="px-4 py-3 flex items-center gap-3">
                <TagChip tag={tg} size="sm" />
                <span className="ml-auto text-xs text-surface-500 dark:text-surface-400">
                  {count} {count === 1 ? "ticket" : "tickets"}
                </span>
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => setEditing(tg)}
                      title="Edit tag"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
                      onClick={() => setDeleting(tg)}
                      title="Delete tag"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <TagFormModal
          onClose={() => setCreating(false)}
          onError={setError}
          mode="create"
        />
      )}
      {editing && (
        <TagFormModal
          tag={editing}
          onClose={() => setEditing(null)}
          onError={setError}
          mode="edit"
        />
      )}
      {deleting && (
        <DeleteTagModal
          tag={deleting}
          usageCount={usage[deleting.id] ?? 0}
          onClose={() => setDeleting(null)}
          onError={setError}
        />
      )}
    </div>
  );
}

interface TagFormModalProps {
  tag?: Tag;
  mode: "create" | "edit";
  onClose: () => void;
  onError: (message: string | null) => void;
}

function TagFormModal({ tag, mode, onClose, onError }: TagFormModalProps) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? DEFAULT_NEW_TAG_COLOR);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onError(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      if (mode === "create") {
        await createTag({ name: trimmed, color });
      } else if (tag) {
        await updateTag(tag.id, { name: trimmed, color });
      }
      onClose();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={submitting ? undefined : onClose}
      title={mode === "create" ? "New tag" : "Edit tag"}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            form="tag-form"
            className="btn-primary"
            disabled={submitting || !name.trim()}
          >
            {submitting ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </button>
        </>
      }
    >
      <form id="tag-form" onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label" htmlFor="tag-name">Name</label>
          <input
            id="tag-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="urgent, frontend, q1-2026…"
            maxLength={40}
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="tag-color">Color</label>
          <div className="flex items-center gap-3">
            <input
              id="tag-color"
              type="color"
              className="h-9 w-12 rounded border border-surface-300 dark:border-surface-700 cursor-pointer"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <span className="text-xs font-mono text-surface-500 dark:text-surface-400">{color}</span>
            {name.trim() && (
              <span className="ml-auto">
                <TagChip tag={{ id: "preview", name: name.trim(), color }} size="sm" />
              </span>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}

interface DeleteTagModalProps {
  tag: Tag;
  usageCount: number;
  onClose: () => void;
  onError: (message: string | null) => void;
}

function DeleteTagModal({ tag, usageCount, onClose, onError }: DeleteTagModalProps) {
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    onError(null);
    setSubmitting(true);
    try {
      await deleteTag(tag.id);
      onClose();
    } catch (err) {
      onError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={submitting ? undefined : onClose}
      title="Delete tag"
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Deleting…" : "Delete"}
          </button>
        </>
      }
    >
      <p className="text-sm">
        Delete <TagChip tag={tag} size="sm" className="align-middle" />?
      </p>
      {usageCount > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          This tag is currently on {usageCount} {usageCount === 1 ? "ticket" : "tickets"}. It will
          be removed from each of them.
        </p>
      )}
    </Modal>
  );
}
