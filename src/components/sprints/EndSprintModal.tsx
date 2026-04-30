import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "../ui/Modal";
import { endSprintAndStartNext, endSprintToBacklog } from "../../services/sprints";
import type { Sprint, Workflow } from "../../types";

interface EndSprintModalProps {
  open: boolean;
  onClose: () => void;
  activeSprint: Sprint;
  workflow: Workflow;
  unfinishedCount: number;
}

export function EndSprintModal({ open, onClose, activeSprint, workflow, unfinishedCount }: EndSprintModalProps) {
  const [mode, setMode] = useState<"next" | "backlog">("next");
  const [form, setForm] = useState({ name: "", goal: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode("next");
      setForm({ name: "", goal: "" });
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "next") {
        if (!form.name.trim()) {
          setError("A name for the next sprint is required.");
          setSubmitting(false);
          return;
        }
        await endSprintAndStartNext({
          activeSprintId: activeSprint.id,
          nextSprintName: form.name,
          nextSprintGoal: form.goal,
          completedColumnId: workflow.completedColumnId,
        });
      } else {
        await endSprintToBacklog({
          activeSprintId: activeSprint.id,
          completedColumnId: workflow.completedColumnId,
        });
      }
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
      title={`End sprint: ${activeSprint?.name ?? ""}`}
      description="Tickets in the completion column will be archived. Unfinished tickets keep their status."
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="end-sprint-form" className="btn-danger" disabled={submitting}>
            {submitting ? "Ending…" : "End sprint"}
          </button>
        </>
      }
    >
      <form id="end-sprint-form" onSubmit={handleSubmit} className="space-y-4">
        {unfinishedCount > 0 && (
          <div className="flex gap-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3.5 py-3 text-sm dark:bg-amber-900/20 dark:ring-amber-700/40">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0 dark:text-amber-400" />
            <p className="text-amber-800 dark:text-amber-200">
              <strong>{unfinishedCount}</strong> ticket{unfinishedCount > 1 ? "s are" : " is"} not in the completion
              column. Choose how to handle them.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <label className="flex items-start gap-3 rounded-lg ring-1 ring-surface-200 p-3.5 cursor-pointer hover:bg-surface-50 dark:ring-surface-700 dark:hover:bg-surface-800">
            <input
              type="radio"
              name="mode"
              value="next"
              checked={mode === "next"}
              onChange={() => setMode("next")}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-surface-900 dark:text-surface-50">Start a new sprint</p>
              <p className="text-xs text-surface-500 mt-0.5 dark:text-surface-400">
                Unfinished tickets are migrated to the new sprint with their current status.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-lg ring-1 ring-surface-200 p-3.5 cursor-pointer hover:bg-surface-50 dark:ring-surface-700 dark:hover:bg-surface-800">
            <input
              type="radio"
              name="mode"
              value="backlog"
              checked={mode === "backlog"}
              onChange={() => setMode("backlog")}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-surface-900 dark:text-surface-50">Send back to backlog</p>
              <p className="text-xs text-surface-500 mt-0.5 dark:text-surface-400">
                Unfinished tickets return to the backlog. You can start a new sprint later.
              </p>
            </div>
          </label>
        </div>

        {mode === "next" && (
          <div className="space-y-3 pt-1">
            <div>
              <label className="label" htmlFor="next-name">
                New sprint name
              </label>
              <input
                id="next-name"
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Sprint 13"
              />
            </div>
            <div>
              <label className="label" htmlFor="next-goal">
                Goal (optional)
              </label>
              <textarea
                id="next-goal"
                className="input min-h-[80px] resize-y"
                value={form.goal}
                onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
                placeholder="What should this sprint accomplish?"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
