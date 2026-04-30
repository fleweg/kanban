import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../ui/Modal";
import { createSprint } from "../../services/sprints";

interface SprintModalProps {
  open: boolean;
  onClose: () => void;
}

export function SprintModal({ open, onClose }: SprintModalProps) {
  const [form, setForm] = useState({ name: "", goal: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ name: "", goal: "" });
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Sprint name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createSprint(form);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start a new sprint"
      description="Only one sprint can run at a time."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="sprint-form" className="btn-primary" disabled={submitting}>
            {submitting ? "Starting…" : "Start sprint"}
          </button>
        </>
      }
    >
      <form id="sprint-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="sprint-name">
            Name
          </label>
          <input
            id="sprint-name"
            className="input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Sprint 12"
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="sprint-goal">
            Goal (optional)
          </label>
          <textarea
            id="sprint-goal"
            className="input min-h-[100px] resize-y"
            value={form.goal}
            onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
            placeholder="What should this sprint accomplish?"
          />
        </div>
        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
