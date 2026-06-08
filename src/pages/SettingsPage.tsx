import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Cloud,
  Database,
  Download,
  Flame,
  Plug,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
} from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { getDefaultWorkflow, saveWorkflow, validateWorkflow } from "../services/workflow";
import {
  DEFAULT_FLEXWEG_API_BASE_URL,
  getFlexwegConfig,
  setFlexwegConfig,
} from "../services/flexwegConfig";
import { getAsanaConfig, setAsanaConfig, type AsanaStatusMap } from "../services/asanaConfig";
import { getMe, invalidateAsanaTokenCache, AsanaApiError } from "../services/asana/client";
import { invalidateAsanaConfigCache } from "../hooks/useAsanaConfig";
import { getBackendKind, getRuntimeConfig } from "../lib/runtimeConfig";

export function SettingsPage() {
  const { isAdmin } = useAuth();
  const backend = getBackendKind();

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Settings"
        description="Configure your Kanban workflow. The completion column is used to determine which tickets are archived when a sprint ends."
      />

      <WorkflowSettings />

      {/* Flexweg attachments config works in both backends — the
          dispatcher routes reads/writes to Firestore (Firebase) or
          to the local SQLite `config` table. Same admin-only-write,
          all-active-users-read posture. */}
      {isAdmin && <FlexwegApiSettings backend={backend} />}

      {isAdmin && <AsanaSettings />}

      {isAdmin && <BackendSettings backend={backend} />}
    </div>
  );
}

// Backend switcher (admin-only). Shows the current backend and a
// switch button that wipes config.js, forcing the app back through
// the SetupForm where the user picks the other backend. **Data is
// NOT migrated** — the new backend starts empty. A "Download backup"
// link surfaces above the switch button for SQLite mode so the user
// can grab a copy of their .sqlite file via the Files API URL.
function BackendSettings({ backend }: { backend: ReturnType<typeof getBackendKind> }) {
  const [confirming, setConfirming] = useState(false);
  const config = getRuntimeConfig();
  const isFirebase = backend === "firebase";
  const isSqlite = backend === "flexweg-sqlite";
  const backupHref =
    config && config.backend === "flexweg-sqlite"
      ? `${config.flexweg.siteUrl}/${config.flexweg.sqlitePath}`
      : null;

  function switchBackend() {
    // Clear the in-browser runtime config and force a reload. The
    // app boots into the SetupForm because getRuntimeConfig() returns
    // null. The previous config.js is overwritten when the user
    // completes setup with the new backend.
    if (typeof window !== "undefined") {
      window.__FLEXWEG_CONFIG__ = null;
      const next = new URL(window.location.href);
      next.searchParams.set("_setup", String(Date.now()));
      window.location.replace(next.toString());
    }
  }

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center gap-2 mb-4">
        <RefreshCw className="h-4 w-4 text-surface-500 dark:text-surface-400" />
        <h2 className="text-sm font-semibold">Data backend</h2>
      </div>

      <p className="text-sm text-surface-600 mb-3 dark:text-surface-300">
        Active backend:{" "}
        <span className="inline-flex items-center gap-1.5 font-medium text-surface-900 dark:text-surface-50">
          {isFirebase ? (
            <>
              <Flame className="h-3.5 w-3.5 text-amber-500" />
              Firebase
            </>
          ) : isSqlite ? (
            <>
              <Database className="h-3.5 w-3.5 text-emerald-500" />
              Flexweg SQLite
            </>
          ) : (
            "Unknown"
          )}
        </span>
      </p>

      {isSqlite && backupHref && (
        <p className="text-xs text-surface-500 mb-3 dark:text-surface-400">
          <a
            href={backupHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-blue-600 hover:underline dark:text-blue-400"
          >
            <Download className="h-3.5 w-3.5" />
            Download a backup of the .sqlite file
          </a>{" "}
          before switching backends.
        </p>
      )}

      {!confirming ? (
        <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>
          Switch backend…
        </button>
      ) : (
        <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 p-4 dark:bg-amber-900/20 dark:ring-amber-700/40">
          <div className="flex gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium">All current data will be lost.</p>
              <p className="mt-1 text-xs leading-relaxed">
                Switching wipes the in-browser config and reloads into the setup form. The new
                backend starts empty — the previous backend's data stays where it is (in
                Firestore or as a .sqlite file on Flexweg), but the Kanban will not read it
                anymore until you switch back.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn-danger text-xs" onClick={switchBackend}>
                  Yes, switch backend
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowSettings() {
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
    <>
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
    </>
  );
}

// Admin-only block. Stores the Asana PAT + optional status-sync mapping
// in Firestore (`config/asana`) or the SQLite `config` table.
// Read by every signed-in user — same admin-write / all-users-read
// posture as FlexwegApiSettings. Documented compromise.
function AsanaSettings() {
  const { workflow } = useAppData();
  const [enabled, setEnabled] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [statusFieldGid, setStatusFieldGid] = useState("");
  const [statusMap, setStatusMap] = useState<AsanaStatusMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAsanaConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (cfg) {
          setEnabled(cfg.enabled);
          setHasExistingToken(Boolean(cfg.accessToken));
          setStatusFieldGid(cfg.statusFieldGid ?? "");
          setStatusMap(cfg.statusMap ?? {});
        }
      })
      .catch((err) => !cancelled && setError((err as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function resolveTokenForSave(): Promise<string> {
    if (accessToken) return accessToken;
    // The textarea is empty but a token was already persisted — keep it.
    const cfg = await getAsanaConfig();
    return cfg?.accessToken ?? "";
  }

  async function handleSave() {
    setError(null);
    setSaved(false);
    setTestResult(null);
    if (enabled && !accessToken && !hasExistingToken) {
      setError("Personal access token is required when the connector is enabled.");
      return;
    }
    setSaving(true);
    try {
      const token = await resolveTokenForSave();
      const trimmedField = statusFieldGid.trim();
      // Drop empty entries from the status map so we don't accumulate
      // stale columns the admin tried to map then cleared.
      const cleanMap: AsanaStatusMap = {};
      for (const [colId, enumGid] of Object.entries(statusMap)) {
        if (enumGid.trim()) cleanMap[colId] = enumGid.trim();
      }
      await setAsanaConfig({
        enabled,
        accessToken: token,
        statusFieldGid: trimmedField || undefined,
        statusMap: Object.keys(cleanMap).length > 0 ? cleanMap : undefined,
      });
      invalidateAsanaTokenCache();
      invalidateAsanaConfigCache();
      setAccessToken("");
      setHasExistingToken(Boolean(token));
      setStatusMap(cleanMap);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setError(null);
    setSaved(false);
    setTestResult(null);
    setTesting(true);
    try {
      const token = accessToken || (await resolveTokenForSave());
      if (!token) {
        setError("No token to test. Paste one above first.");
        setTesting(false);
        return;
      }
      const me = await getMe(token);
      setTestResult(me.email ? `Signed in as ${me.email}` : `Signed in as ${me.name ?? me.gid}`);
    } catch (err) {
      if (err instanceof AsanaApiError) {
        setError(`Asana rejected the token (HTTP ${err.status}).`);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setTesting(false);
    }
  }

  function updateMapEntry(columnId: string, enumGid: string) {
    setSaved(false);
    setStatusMap((prev) => ({ ...prev, [columnId]: enumGid }));
  }

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center gap-2 mb-4">
        <Plug className="h-4 w-4 text-surface-500 dark:text-surface-400" />
        <h2 className="text-sm font-semibold">Asana connector</h2>
      </div>

      <p className="text-sm text-surface-500 mb-3 dark:text-surface-400">
        Link Kanban tickets to Asana tasks. When linked, the ticket's comments
        come straight from the Asana task (and posting from here writes back as
        a story). Generate a Personal Access Token in{" "}
        <a
          href="https://app.asana.com/0/my-apps"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline dark:text-blue-400"
        >
          Asana → Developer console
        </a>
        . The token is stored alongside other admin config, readable by any
        signed-in team member.
      </p>

      {loading ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Loading current config…</p>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setSaved(false);
                setError(null);
              }}
            />
            <span>Enable the Asana connector</span>
          </label>

          <div>
            <label className="label" htmlFor="asana-token">
              Default Access Token
            </label>
            <input
              id="asana-token"
              className="input"
              type="password"
              value={accessToken}
              onChange={(e) => {
                setAccessToken(e.target.value);
                setSaved(false);
                setError(null);
                setTestResult(null);
              }}
              placeholder={
                hasExistingToken
                  ? "•••••••• (set — leave blank to keep)"
                  : "2/1234567890123/4567890123456:abcdef…"
              }
              autoComplete="off"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
              {testResult && (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">{testResult}</span>
              )}
            </div>
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-surface-700 dark:text-surface-200">
              Status sync (optional)
            </summary>
            <div className="mt-3 space-y-3 rounded-lg bg-surface-50 p-3 dark:bg-surface-800/50">
              <p className="text-xs text-surface-500 dark:text-surface-400">
                When a linked ticket crosses a column listed below, the Kanban
                writes the matching Asana custom-field enum value onto the task.
                Leave a column blank to skip it.
              </p>

              <div>
                <label className="label" htmlFor="asana-field-gid">
                  Custom field GID
                </label>
                <input
                  id="asana-field-gid"
                  className="input"
                  value={statusFieldGid}
                  onChange={(e) => {
                    setStatusFieldGid(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="1210640677028875"
                />
                <p className="text-xs text-surface-500 mt-1 dark:text-surface-400">
                  Single-select custom field. Find the GID in the Asana web UI
                  URL when editing the field, or via{" "}
                  <code className="text-[10px]">GET /custom_fields/&lt;id&gt;</code>.
                </p>
              </div>

              {workflow?.columns?.length ? (
                <div className="space-y-2">
                  {workflow.columns.map((col) => (
                    <div key={col.id} className="grid grid-cols-3 items-center gap-2">
                      <span className="text-xs text-surface-700 dark:text-surface-200 truncate">
                        {col.name}
                      </span>
                      <input
                        className="input col-span-2 text-xs"
                        value={statusMap[col.id] ?? ""}
                        onChange={(e) => updateMapEntry(col.id, e.target.value)}
                        placeholder="Asana enum value GID"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  Define workflow columns above first.
                </p>
              )}
            </div>
          </details>

          {error && (
            <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
              {error}
            </div>
          )}
          {saved && !error && (
            <div className="rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-2 text-sm dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50">
              Asana config saved.
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Admin-only block. Stores the Flexweg API key — in Firebase mode at
// Firestore `config/flexweg`, in SQLite mode in the local `config`
// table. Both rely on the backend dispatcher in services/flexwegConfig.ts.
function FlexwegApiSettings({ backend }: { backend: ReturnType<typeof getBackendKind> }) {
  const [siteUrl, setSiteUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_FLEXWEG_API_BASE_URL);
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFlexwegConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (cfg) {
          setSiteUrl(cfg.siteUrl);
          setApiBaseUrl(cfg.apiBaseUrl);
          setHasExistingKey(true);
          // Don't pre-fill apiKey: showing it would defeat the password input.
          // Leaving it empty means "keep the existing key unless I type a new one".
        }
      })
      .catch((err) => !cancelled && setError((err as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setError(null);
    setSaved(false);
    if (!siteUrl.trim()) {
      setError("Site URL is required.");
      return;
    }
    if (!apiKey && !hasExistingKey) {
      setError("API key is required.");
      return;
    }
    setSaving(true);
    try {
      // If apiKey field is empty, fetch the existing key and re-save with new
      // siteUrl / apiBaseUrl. Otherwise use the new key.
      let nextKey = apiKey;
      if (!nextKey && hasExistingKey) {
        const cfg = await getFlexwegConfig();
        nextKey = cfg?.apiKey ?? "";
        if (!nextKey) {
          setError("Could not load existing API key.");
          setSaving(false);
          return;
        }
      }
      await setFlexwegConfig({
        apiKey: nextKey,
        siteUrl: siteUrl.trim(),
        apiBaseUrl: apiBaseUrl.trim() || DEFAULT_FLEXWEG_API_BASE_URL,
      });
      setApiKey("");
      setHasExistingKey(true);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center gap-2 mb-4">
        <Cloud className="h-4 w-4 text-surface-500 dark:text-surface-400" />
        <h2 className="text-sm font-semibold">Flexweg API (ticket attachments)</h2>
      </div>

      <p className="text-sm text-surface-500 mb-3 dark:text-surface-400">
        Required to upload attachments. Generate a permanent API key in your{" "}
        <a
          href="https://www.flexweg.com/account/settings#api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline dark:text-blue-400"
        >
          Flexweg account
        </a>
        . The key is stored {backend === "flexweg-sqlite" ? "in the local SQLite database" : "in Firestore"} —
        readable by any signed-in team member, writable by admins only.
      </p>

      {loading ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Loading current config…</p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="flexweg-site-url">
              Site URL
            </label>
            <input
              id="flexweg-site-url"
              className="input"
              value={siteUrl}
              onChange={(e) => {
                setSiteUrl(e.target.value);
                setSaved(false);
                setError(null);
              }}
              placeholder="https://your-site.flexweg.com"
            />
            <p className="text-xs text-surface-500 mt-1 dark:text-surface-400">
              Used to build the public download URLs for attachments.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="flexweg-api-key">
              API key
            </label>
            <input
              id="flexweg-api-key"
              className="input"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaved(false);
                setError(null);
              }}
              placeholder={hasExistingKey ? "•••••••• (set — leave blank to keep)" : "Paste your permanent key"}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="label" htmlFor="flexweg-api-base">
              API base URL
            </label>
            <input
              id="flexweg-api-base"
              className="input"
              value={apiBaseUrl}
              onChange={(e) => {
                setApiBaseUrl(e.target.value);
                setSaved(false);
                setError(null);
              }}
              placeholder={DEFAULT_FLEXWEG_API_BASE_URL}
            />
            <p className="text-xs text-surface-500 mt-1 dark:text-surface-400">
              Default: <code>{DEFAULT_FLEXWEG_API_BASE_URL}</code>. Override only if your account uses a different host.
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
              {error}
            </div>
          )}
          {saved && !error && (
            <div className="rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-2 text-sm dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50">
              Flexweg config saved.
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
