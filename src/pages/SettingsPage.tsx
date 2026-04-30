import { useEffect, useMemo, useState } from "react";
import { Save, Settings as SettingsIcon } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { useAppData } from "../context/AppDataContext";
import { getDefaultWorkflow, saveWorkflow, validateWorkflow } from "../services/workflow";

export function SettingsPage() {
  const { workflow } = useAppData();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const initial = useMemo(() => JSON.stringify(workflow, null, 2), [workflow]);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  async function handleSave() {
    setError(null);
    setSaved(false);
    let parsed;
    try {
      parsed = JSON.parse(draft);
      validateWorkflow(parsed);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setSaving(true);
    try {
      await saveWorkflow(parsed);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setDraft(JSON.stringify(getDefaultWorkflow(), null, 2));
    setError(null);
    setSaved(false);
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Settings"
        description="Configure your Kanban workflow. The completion column is used to determine which tickets are archived when a sprint ends."
      />

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <SettingsIcon className="h-4 w-4 text-surface-500 dark:text-surface-400" />
          <h2 className="text-sm font-semibold">Workflow JSON</h2>
        </div>

        <p className="text-sm text-surface-500 mb-3 dark:text-surface-400">
          Each column needs a unique <code className="text-xs bg-surface-100 px-1 py-0.5 rounded dark:bg-surface-800">id</code>,{" "}
          a <code className="text-xs bg-surface-100 px-1 py-0.5 rounded dark:bg-surface-800">name</code>, and an optional{" "}
          <code className="text-xs bg-surface-100 px-1 py-0.5 rounded dark:bg-surface-800">color</code>. The{" "}
          <code className="text-xs bg-surface-100 px-1 py-0.5 rounded dark:bg-surface-800">completedColumnId</code> must match one of
          the column ids.
        </p>

        <textarea
          className="input font-mono text-xs leading-relaxed min-h-[400px] whitespace-pre"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
            setSaved(false);
          }}
          spellCheck={false}
        />

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
            {error}
          </div>
        )}
        {saved && !error && (
          <div className="mt-3 rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-2 text-sm dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50">
            Workflow saved.
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost" onClick={handleReset}>
            Reset to default
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <p className="text-xs text-surface-500 mt-3 dark:text-surface-400">
        Tip: changing a column id while tickets reference it will move them back to the first column on the board.
      </p>
    </div>
  );
}
