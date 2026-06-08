import { useState, type FormEvent } from "react";
import { ExternalLink, Link2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import {
  AsanaApiError,
  getTask,
  parseAsanaTaskInput,
  type AsanaTask,
} from "../../services/asana/client";
import { asanaToTipTap } from "../../services/asana/html";

export interface AsanaLinkResult {
  gid: string;
  task: AsanaTask;
  // Description preview converted from Asana's html_notes into
  // TipTap-compatible HTML. Caller decides whether to overwrite the
  // current description or just store the gid.
  descriptionHtml: string;
  permalinkUrl: string | null;
}

interface LinkAsanaModalProps {
  open: boolean;
  onClose: () => void;
  onLink: (result: AsanaLinkResult, applyDescription: boolean, overwriteTitle: boolean) => void;
  // Default value for "apply description" — true when called from
  // ticket creation (no description yet), false when called from edit
  // (don't clobber the user's existing prose).
  defaultApplyDescription?: boolean;
  // Mirror for the title — same rationale.
  defaultOverwriteTitle?: boolean;
}

export function LinkAsanaModal({
  open,
  onClose,
  onLink,
  defaultApplyDescription = true,
  defaultOverwriteTitle = true,
}: LinkAsanaModalProps) {
  const [input, setInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<AsanaTask | null>(null);
  const [applyDescription, setApplyDescription] = useState(defaultApplyDescription);
  const [overwriteTitle, setOverwriteTitle] = useState(defaultOverwriteTitle);

  function reset() {
    setInput("");
    setError(null);
    setTask(null);
    setApplyDescription(defaultApplyDescription);
    setOverwriteTitle(defaultOverwriteTitle);
  }

  async function handleFetch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const gid = parseAsanaTaskInput(input);
    if (!gid) {
      setError("Paste an Asana task URL or GID.");
      return;
    }
    setFetching(true);
    try {
      const t = await getTask(gid);
      setTask(t);
    } catch (err) {
      if (err instanceof AsanaApiError) {
        if (err.status === 404) setError("Task not found on Asana.");
        else if (err.status === 401) setError("Asana rejected the PAT. Check it in Settings.");
        else setError(`Asana ${err.status}: ${err.message}`);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setFetching(false);
    }
  }

  function handleConfirm() {
    if (!task) return;
    onLink(
      {
        gid: task.gid,
        task,
        descriptionHtml: asanaToTipTap(task.html_notes),
        permalinkUrl: task.permalink_url ?? null,
      },
      applyDescription,
      overwriteTitle,
    );
    reset();
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={
        <span className="inline-flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Link to Asana
        </span>
      }
      description="Paste the Asana task URL (or its GID) to pull title, description and live comments."
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          {task ? (
            <button type="button" className="btn-primary" onClick={handleConfirm}>
              <Link2 className="h-4 w-4" />
              Link this task
            </button>
          ) : (
            <button
              type="submit"
              form="link-asana-form"
              className="btn-primary"
              disabled={fetching}
            >
              {fetching ? "Fetching…" : "Fetch task"}
            </button>
          )}
        </>
      }
    >
      <form id="link-asana-form" onSubmit={handleFetch} className="space-y-3">
        <div>
          <label className="label" htmlFor="asana-input">
            Task URL or GID
          </label>
          <input
            id="asana-input"
            className="input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
              setTask(null);
            }}
            placeholder="https://app.asana.com/0/123/456 or 12345…"
            autoFocus
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
            {error}
          </div>
        )}

        {task && (
          <div className="rounded-lg ring-1 ring-surface-200 p-3 space-y-2 dark:ring-surface-700">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-surface-900 dark:text-surface-50">
                {task.name}
              </p>
              {task.permalink_url && (
                <a
                  href={task.permalink_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open
                </a>
              )}
            </div>
            <p className="text-xs text-surface-500 dark:text-surface-400">
              GID: <code className="text-[11px]">{task.gid}</code>
              {task.created_by?.name && <> · by {task.created_by.name}</>}
              {task.projects?.length ? <> · {task.projects.map((p) => p.name).join(", ")}</> : null}
            </p>

            <label className="flex items-start gap-2 text-xs text-surface-700 dark:text-surface-200">
              <input
                type="checkbox"
                checked={overwriteTitle}
                onChange={(e) => setOverwriteTitle(e.target.checked)}
                className="mt-0.5"
              />
              <span>Overwrite the ticket title with the Asana task name.</span>
            </label>

            <label className="flex items-start gap-2 text-xs text-surface-700 dark:text-surface-200">
              <input
                type="checkbox"
                checked={applyDescription}
                onChange={(e) => setApplyDescription(e.target.checked)}
                className="mt-0.5"
              />
              <span>Replace the ticket description with the Asana notes.</span>
            </label>
          </div>
        )}
      </form>
    </Modal>
  );
}
