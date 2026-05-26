import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Database,
  Flame,
  LayoutGrid,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import {
  buildConfigJsSource,
  resetRuntimeConfigCache,
  type FlexwegRuntimeConfig,
  type SqliteRuntimeConfig,
} from "../lib/runtimeConfig";
import { getAppFolder } from "../lib/adminBase";
import {
  SetupApiError,
  testFlexwegConnection,
  uploadConfigJs,
  type SetupFlexwegConfig,
} from "../lib/setupApi";
import {
  collections,
  configDocs,
  getAuthClient,
  getDb,
  initFirebaseFromSetup,
} from "../services/firebaseClient";
import { DEFAULT_FLEXWEG_API_BASE_URL } from "../services/flexwegConfig";
import { installSqliteApp, SqliteApiError } from "../services/flexweg-sqlite/client";
import { ensureSchema } from "../services/flexweg-sqlite/schema";
import { setFlexwegConfig as setSqliteFlexwegConfig } from "../services/flexweg-sqlite/flexwegConfig";
import { loginUser, registerUser } from "../services/flexweg-sqlite/userAuth";
import { LocaleSwitcher } from "../components/ui/LocaleSwitcher";

interface FormState {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  adminEmail: string;
  adminPassword: string;
  flexwegApiKey: string;
  flexwegSiteUrl: string;
  flexwegApiBaseUrl: string;
  // SQLite-only: relative path of the database file inside the user's
  // Flexweg site (e.g. "kanban/db.sqlite"). Auto-suggested from the
  // app's current folder so a kanban deployed at /kanban/ defaults
  // to "kanban/db.sqlite".
  sqlitePath: string;
}

// Pre-fills the Flexweg site URL with the page's current origin AND
// the detected app folder — the Kanban is typically deployed at
// `<site>/<folder>/`, so the URL the user wants is the full path they
// loaded the setup form from. Skipped on localhost where the origin is
// never a useful default.
function defaultSiteUrl(): string {
  if (typeof window === "undefined") return "";
  const h = window.location.hostname;
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "[::1]" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h.endsWith(".localhost")
  ) {
    return "";
  }
  const folder = getAppFolder();
  return folder ? `${window.location.origin}/${folder}` : window.location.origin;
}

// Suggests an initial value for the SQLite path. Uses the detected
// app folder (`kanban/`, `tickets/`, `clients/acme/kanban/`, …) and
// appends `db.sqlite`. Falls back to `kanban/db.sqlite` when the
// folder cannot be detected (root deployment / SSR).
function defaultSqlitePath(): string {
  if (typeof window === "undefined") return "kanban/db.sqlite";
  const folder = getAppFolder();
  return folder ? `${folder}/db.sqlite` : "kanban/db.sqlite";
}

// Reads `?apikey=...` from the page URL so deployments triggered from
// the Flexweg dashboard can pre-fill the key and skip the copy/paste
// step. The query string is wiped by the post-install reload (see
// `reloadAfterSetup`) so the sensitive value never sticks around in
// browser history / bookmarks / referer headers.
function defaultFlexwegApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const v = new URL(window.location.href).searchParams.get("apikey");
    return v?.trim() ?? "";
  } catch {
    return "";
  }
}

// Reloads after a successful setup. Strips ALL query params (including
// the sensitive `?apikey=...` that the user may have arrived with) so
// nothing leaks into history / bookmarks / referer. No cache-bust
// needed: Flexweg's Cloudflare layer auto-invalidates files on
// modification, and the install flow has just rewritten config.js.
function reloadAfterSetup(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.search = "";
  window.location.replace(url.toString());
}

const INITIAL_STATE: FormState = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  adminEmail: "",
  adminPassword: "",
  flexwegApiKey: defaultFlexwegApiKey(),
  flexwegSiteUrl: defaultSiteUrl(),
  flexwegApiBaseUrl: DEFAULT_FLEXWEG_API_BASE_URL,
  sqlitePath: defaultSqlitePath(),
};

type ErrorKind =
  | "missingFields"
  | "firebaseAuth"
  | "firebaseAuthInvalidCredential"
  | "wrongAdminEmail"
  | "flexwegAuth"
  | "flexwegNetwork"
  | "firestoreRules"
  | "firestoreOther"
  | "uploadFailed"
  | "generic";

interface ErrorState {
  kind: ErrorKind;
  detail?: string;
}

// Map a Firebase Auth error code onto a translation key.
function authErrorTranslationKey(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "setup.errors.firebaseAuthInvalidCredential";
    case "auth/user-not-found":
      return "setup.errors.firebaseAuthUserNotFound";
    case "auth/invalid-email":
      return "setup.errors.firebaseAuthInvalidEmail";
    case "auth/api-key-not-valid":
    case "auth/invalid-api-key":
      return "setup.errors.firebaseInvalidApiKey";
    case "auth/network-request-failed":
      return "setup.errors.firebaseNetwork";
    case "auth/too-many-requests":
      return "setup.errors.firebaseTooManyRequests";
    case "auth/operation-not-allowed":
      return "setup.errors.firebaseOperationNotAllowed";
    case "auth/user-disabled":
      return "setup.errors.firebaseUserDisabled";
    default:
      return "setup.errors.firebaseAuthGeneric";
  }
}

type WizardStep = "terms" | "backend" | "firebase" | "flexweg" | "sqlite";

type BackendChoice = "firebase" | "flexweg-sqlite" | null;

export function SetupForm() {
  const { t } = useTranslation();
  // Multi-step wizard. Welcome and terms are common; after Terms the
  // user picks the data backend (Firebase vs Flexweg SQLite) and the
  // subsequent steps differ. Firebase needs sign-in + the existing
  // Flexweg attachments config; SQLite needs a single Flexweg-key
  // step that swaps for a scoped Sqlite token.
  const [wizardStep, setWizardStep] = useState<WizardStep>("terms");
  // Default to Flexweg SQLite — fastest path, no external service.
  // The user can still switch to Firebase on the backend choice step.
  const [backendChoice, setBackendChoice] = useState<BackendChoice>("flexweg-sqlite");
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  // Append-only timeline driving the progress overlay so the user
  // sees what's already done while the current step spins.
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [error, setError] = useState<ErrorState | null>(null);
  const [done, setDone] = useState(false);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function trimmed(): FormState {
    return {
      ...form,
      apiKey: form.apiKey.trim(),
      authDomain: form.authDomain.trim(),
      projectId: form.projectId.trim(),
      storageBucket: form.storageBucket.trim(),
      messagingSenderId: form.messagingSenderId.trim(),
      appId: form.appId.trim(),
      adminEmail: form.adminEmail.trim().toLowerCase(),
      flexwegApiKey: form.flexwegApiKey.trim(),
      flexwegSiteUrl: form.flexwegSiteUrl.trim().replace(/\/+$/, ""),
      flexwegApiBaseUrl:
        form.flexwegApiBaseUrl.trim().replace(/\/+$/, "") ||
        DEFAULT_FLEXWEG_API_BASE_URL,
      sqlitePath: form.sqlitePath.trim().replace(/^\/+|\/+$/g, ""),
    };
  }

  function validateFirebase(state: FormState): boolean {
    const required: Array<keyof FormState> = [
      "apiKey",
      "authDomain",
      "projectId",
      "storageBucket",
      "messagingSenderId",
      "appId",
      "adminEmail",
    ];
    for (const k of required) {
      if (!state[k]) return false;
    }
    if (!form.adminPassword) return false;
    if (!/.+@.+\..+/.test(state.adminEmail)) return false;
    return true;
  }

  function validateSqlite(state: FormState): boolean {
    const required: Array<keyof FormState> = [
      "flexwegApiKey",
      "flexwegSiteUrl",
      "flexwegApiBaseUrl",
      "sqlitePath",
      // The first admin user is created during install — we need
      // their email + password to seed the auth API.
      "adminEmail",
    ];
    for (const k of required) {
      if (!state[k]) return false;
    }
    if (!/.+@.+\..+/.test(state.adminEmail)) return false;
    if (!form.adminPassword || form.adminPassword.length < 8) return false;
    // SQLite path must end with .sqlite (or .db) and contain only
    // safe characters. Server enforces this too, but a client check
    // gives a friendlier error.
    if (!/^[\w./-]+\.(sqlite|db)$/i.test(state.sqlitePath)) return false;
    return true;
  }

  function validateFlexweg(state: FormState): boolean {
    const required: Array<keyof FormState> = [
      "flexwegApiKey",
      "flexwegSiteUrl",
      "flexwegApiBaseUrl",
    ];
    for (const k of required) {
      if (!state[k]) return false;
    }
    return true;
  }

  // Sub-step 1: Firebase configuration. Validates the Firebase
  // fields, initialises the SDK, signs the admin in, verifies the
  // email match, and transitions the wizard to the Flexweg sub-step.
  // No writes to Firestore or Flexweg happen here — Sub-step 2's job
  // — so the user can bail mid-setup without leaving stale state
  // behind.
  async function handleFirebaseSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setProgressLog([]);

    const state = trimmed();
    if (!validateFirebase(state)) {
      setError({ kind: "missingFields" });
      setSubmitting(false);
      return;
    }

    const runtimeConfig: FlexwegRuntimeConfig = {
      backend: "firebase",
      firebase: {
        apiKey: state.apiKey,
        authDomain: state.authDomain,
        projectId: state.projectId,
        storageBucket: state.storageBucket,
        messagingSenderId: state.messagingSenderId,
        appId: state.appId,
      },
      adminEmail: state.adminEmail,
    };

    const logDone = (label: string) =>
      setProgressLog((prev) => [...prev, label]);
    try {
      // 1. Initialise Firebase + sign in.
      setStep(t("setup.steps.signIn"));
      initFirebaseFromSetup(runtimeConfig);
      try {
        await signInWithEmailAndPassword(
          getAuthClient(),
          state.adminEmail,
          form.adminPassword,
        );
      } catch (err) {
        const detailKey = authErrorTranslationKey(err);
        const fbErr = err as { code?: string; message?: string };
        if (detailKey === "setup.errors.firebaseAuthInvalidCredential") {
          setError({ kind: "firebaseAuthInvalidCredential" });
          setSubmitting(false);
          setStep(null);
          return;
        }
        let detail = t(detailKey);
        if (detailKey === "setup.errors.firebaseAuthGeneric") {
          if (fbErr.code) detail += ` [${fbErr.code}]`;
          if (fbErr.message) detail += `: ${fbErr.message}`;
        }
        setError({ kind: "firebaseAuth", detail });
        setSubmitting(false);
        setStep(null);
        return;
      }
      logDone(t("setup.stepsDone.signIn"));

      // 2. Email match guard.
      setStep(t("setup.steps.verifyEmail"));
      const signedInEmail = (
        getAuthClient().currentUser?.email ?? ""
      ).toLowerCase();
      if (signedInEmail !== state.adminEmail) {
        setError({ kind: "wrongAdminEmail" });
        setSubmitting(false);
        setStep(null);
        return;
      }
      logDone(t("setup.stepsDone.verifyEmail"));

      // Firebase sub-step done — transition to the Flexweg form.
      // Keep the progress log accumulated so the user sees the
      // Firebase checks already completed when sub-step 2 starts.
      setStep(null);
      setSubmitting(false);
      setWizardStep("flexweg");
    } catch (err) {
      setError({ kind: "generic", detail: (err as Error).message });
      setSubmitting(false);
      setStep(null);
    }
  }

  // Sub-step 2: Flexweg configuration. Validates the Flexweg fields,
  // tests the API key, writes config/flexweg to Firestore so the
  // attachments service works out of the box, then uploads
  // /<folder>/config.js to Flexweg so the next reload (and every
  // teammate's first visit) reads the populated runtime config.
  async function handleFlexwegSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    // Don't reset progressLog — keep the Firebase entries visible so
    // the user sees the cumulative completion.

    const state = trimmed();
    if (!validateFlexweg(state)) {
      setError({ kind: "missingFields" });
      setSubmitting(false);
      return;
    }

    const runtimeConfig: FlexwegRuntimeConfig = {
      backend: "firebase",
      firebase: {
        apiKey: state.apiKey,
        authDomain: state.authDomain,
        projectId: state.projectId,
        storageBucket: state.storageBucket,
        messagingSenderId: state.messagingSenderId,
        appId: state.appId,
      },
      adminEmail: state.adminEmail,
    };
    const flexwegConfig: SetupFlexwegConfig = {
      apiKey: state.flexwegApiKey,
      siteUrl: state.flexwegSiteUrl,
      apiBaseUrl: state.flexwegApiBaseUrl,
    };

    const logDone = (label: string) =>
      setProgressLog((prev) => [...prev, label]);
    try {
      // 3. Test Flexweg API.
      setStep(t("setup.steps.testFlexweg"));
      try {
        await testFlexwegConnection(flexwegConfig);
      } catch (err) {
        if (err instanceof SetupApiError) {
          if (err.status === 401 || err.status === 403) {
            setError({ kind: "flexwegAuth" });
          } else {
            setError({
              kind: "generic",
              detail: t("setup.errors.flexwegHttp", {
                status: err.status,
                detail: err.message,
              }),
            });
          }
        } else {
          setError({ kind: "flexwegNetwork" });
        }
        setSubmitting(false);
        setStep(null);
        return;
      }
      logDone(t("setup.stepsDone.testFlexweg"));

      // 4. Write config/flexweg to Firestore. With this in place the
      //    Attachments tab on tickets works immediately after the
      //    setup completes — no need to revisit Settings.
      setStep(t("setup.steps.writeFirestore"));
      try {
        await setDoc(doc(getDb(), collections.config, configDocs.flexweg), {
          apiKey: flexwegConfig.apiKey,
          siteUrl: flexwegConfig.siteUrl,
          apiBaseUrl: flexwegConfig.apiBaseUrl,
        });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "";
        if (code === "permission-denied") {
          setError({ kind: "firestoreRules", detail: state.adminEmail });
        } else {
          setError({
            kind: "firestoreOther",
            detail: (err as Error).message,
          });
        }
        setSubmitting(false);
        setStep(null);
        return;
      }
      logDone(t("setup.stepsDone.writeFirestore"));

      // 5. Upload config.js to Flexweg. The path is auto-detected
      //    from window.location.pathname so the kanban can live in
      //    any folder on the Flexweg site.
      setStep(t("setup.steps.uploadConfig"));
      try {
        const source = buildConfigJsSource(runtimeConfig);
        await uploadConfigJs(flexwegConfig, source);
      } catch (err) {
        setError({
          kind: "uploadFailed",
          detail: err instanceof Error ? err.message : String(err),
        });
        setSubmitting(false);
        setStep(null);
        return;
      }
      logDone(t("setup.stepsDone.uploadConfig"));

      setDone(true);
      setStep(null);
      window.setTimeout(reloadAfterSetup, 2000);
    } catch (err) {
      setError({ kind: "generic", detail: (err as Error).message });
      setSubmitting(false);
      setStep(null);
    }
  }

  // SQLite-mode install. Single-step replacement for the
  // Firebase+Flexweg combo:
  //   1. POST /api/v1/sqlite/auth/install with the master Flexweg API
  //      key (exchanged for a scoped Sqlite token, then discarded).
  //   2. Apply the SqliteRuntimeConfig locally so subsequent API calls
  //      route through the new backend without a reload.
  //   3. Run schema bootstrap (CREATE TABLEs + seed workflow).
  //   4. Upload config.js to Flexweg using the master key.
  //   5. Reload — every future boot reads config.js, picks the SQLite
  //      backend, and uses the scoped token.
  async function handleSqliteInstall(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setProgressLog([]);

    const state = trimmed();
    if (!validateSqlite(state)) {
      setError({ kind: "missingFields" });
      setSubmitting(false);
      return;
    }

    const logDone = (label: string) =>
      setProgressLog((prev) => [...prev, label]);
    try {
      // 1. Exchange master API key for scoped SQLite token (with
      //    requireUserAuth=true so every CRUD request must also carry
      //    a user session token).
      setStep(t("setup.steps.sqliteInstall"));
      let token: string;
      try {
        const installed = await installSqliteApp({
          masterApiKey: state.flexwegApiKey,
          apiBaseUrl: state.flexwegApiBaseUrl,
          path: state.sqlitePath,
          name: "Kanban app",
          requireUserAuth: true,
          allowedOrigins: typeof window !== "undefined" ? [window.location.origin] : undefined,
        });
        token = installed.token;
      } catch (err) {
        if (err instanceof SqliteApiError) {
          if (err.status === 401 || err.status === 403) {
            setError({ kind: "flexwegAuth" });
          } else {
            setError({
              kind: "generic",
              detail: t("setup.errors.flexwegHttp", {
                status: err.status,
                detail: err.message,
              }),
            });
          }
        } else {
          setError({ kind: "flexwegNetwork" });
        }
        setSubmitting(false);
        setStep(null);
        return;
      }
      logDone(t("setup.stepsDone.sqliteInstall"));

      // 2. Inject the SqliteRuntimeConfig before any SQL call so the
      //    client (sqlBatch / sqlQuery / register / login) resolves
      //    the right backend.
      const runtimeConfig: SqliteRuntimeConfig = {
        backend: "flexweg-sqlite",
        flexweg: {
          siteUrl: state.flexwegSiteUrl,
          apiBaseUrl: state.flexwegApiBaseUrl,
          sqliteToken: token,
          sqlitePath: state.sqlitePath,
        },
      };
      if (typeof window !== "undefined") {
        window.__FLEXWEG_CONFIG__ = runtimeConfig;
      }
      resetRuntimeConfigCache();

      // 3. Register the admin + log them in. The server's "first
      //    user = admin" rule applies — the very first registration
      //    on this brand-new DB gets role=admin automatically.
      //    Login persists the user token in localStorage via
      //    loginUser(), which is required by subsequent CRUD calls
      //    since the scoped token has requireUserAuth=true.
      setStep(t("setup.steps.sqliteRegisterAdmin"));
      try {
        // Pass the master API key explicitly — the server now requires
        // admin authorization on /auth/register so the public scoped
        // token alone can't seed accounts (see SqliteAuthApiController).
        // We still hold the key in this step's local state; it's
        // discarded right after the schema bootstrap finishes below.
        await registerUser({
          email: state.adminEmail,
          password: form.adminPassword,
          displayName: state.adminEmail.split("@")[0],
          masterApiKey: state.flexwegApiKey,
        });
        await loginUser({
          email: state.adminEmail,
          password: form.adminPassword,
        });
      } catch (err) {
        setError({
          kind: "generic",
          detail: err instanceof Error ? err.message : String(err),
        });
        setSubmitting(false);
        setStep(null);
        return;
      }
      logDone(t("setup.stepsDone.sqliteRegisterAdmin"));

      // 4. Bootstrap the schema. Idempotent — safe to run on a brand
      //    new DB or an existing one. Login above means the sqlBatch
      //    inside ensureSchema() can authenticate.
      setStep(t("setup.steps.sqliteSchema"));
      try {
        await ensureSchema();
      } catch (err) {
        setError({ kind: "generic", detail: (err as Error).message });
        setSubmitting(false);
        setStep(null);
        return;
      }
      logDone(t("setup.stepsDone.sqliteSchema"));

      // 4b. Persist the Flexweg API key in the SQLite `config` table
      //     so the attachments service can use it post-install. Same
      //     security profile as Firebase mode (all-active-users-read,
      //     admin-write enforced by the Auth API).
      try {
        await setSqliteFlexwegConfig({
          apiKey: state.flexwegApiKey,
          siteUrl: state.flexwegSiteUrl,
          apiBaseUrl: state.flexwegApiBaseUrl,
        });
      } catch (err) {
        // Non-fatal: install still succeeded, attachments just won't
        // work until the admin re-enters the key from Settings.
        console.warn("Failed to persist Flexweg API key — attachments will be unavailable until set from Settings", err);
      }

      // 4. Upload config.js to Flexweg with the master key — same
      //    helper used by the Firebase flow. Master key is discarded
      //    after this call; it is never persisted in config.js.
      setStep(t("setup.steps.uploadConfig"));
      const flexwegSetup: SetupFlexwegConfig = {
        apiKey: state.flexwegApiKey,
        siteUrl: state.flexwegSiteUrl,
        apiBaseUrl: state.flexwegApiBaseUrl,
      };
      try {
        const source = buildConfigJsSource(runtimeConfig);
        await uploadConfigJs(flexwegSetup, source);
      } catch (err) {
        setError({
          kind: "uploadFailed",
          detail: err instanceof Error ? err.message : String(err),
        });
        setSubmitting(false);
        setStep(null);
        return;
      }
      logDone(t("setup.stepsDone.uploadConfig"));

      // 5. Reload — next boot will read the new config.js and route
      //    everything to the SQLite backend.
      setDone(true);
      setStep(null);
      window.setTimeout(reloadAfterSetup, 2000);
    } catch (err) {
      setError({ kind: "generic", detail: (err as Error).message });
      setSubmitting(false);
      setStep(null);
    }
  }

  return (
    <div className="relative min-h-full flex items-center justify-center p-6 bg-surface-50 dark:bg-surface-950">
      <div className="absolute top-4 right-4 z-10">
        <LocaleSwitcher />
      </div>
      {/* Render the overlay through a portal on <body> so its mount /
          unmount doesn't shuffle siblings inside the form tree. With
          a portal the overlay's DOM is isolated from whatever browser
          extensions (Grammarly, translators, password managers)
          inject inside the form. */}
      {(submitting || done) &&
        createPortal(
          <SetupProgressOverlay
            step={step}
            progressLog={progressLog}
            done={done}
          />,
          document.body,
        )}
      <div className="w-full max-w-2xl relative z-10">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center shadow-card">
            <LayoutGrid className="h-5 w-5 text-white" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold leading-none">
              {t("setup.title")}
            </p>
            <p className="text-[11px] text-surface-500 mt-0.5 dark:text-surface-400">
              {t("setup.subtitle")}
            </p>
          </div>
        </div>

        <Stepper currentStep={wizardStep} backendChoice={backendChoice} />

        {wizardStep === "terms" ? (
          <TermsStep onAccept={() => setWizardStep("backend")} />
        ) : wizardStep === "backend" ? (
          <BackendChoiceStep
            value={backendChoice}
            onChange={setBackendChoice}
            onContinue={() => {
              setError(null);
              if (backendChoice === "flexweg-sqlite") {
                setWizardStep("sqlite");
              } else {
                setBackendChoice("firebase");
                setWizardStep("firebase");
              }
            }}
            onBack={() => setWizardStep("terms")}
          />
        ) : wizardStep === "sqlite" ? (
          <SqliteInstallStep
            form={form}
            patch={patch}
            onSubmit={handleSqliteInstall}
            onBack={() => {
              setError(null);
              setWizardStep("backend");
            }}
            submitting={submitting}
            done={done}
            error={error}
          />
        ) : wizardStep === "firebase" ? (
          <div className="card p-6">
            <p className="text-sm text-surface-600 dark:text-surface-300">
              {t("setup.intro")}
            </p>

            <form onSubmit={handleFirebaseSubmit} className="mt-6 space-y-6">
              <fieldset className="space-y-4">
                <legend className="text-sm font-semibold text-surface-900 dark:text-surface-50">
                  {t("setup.sections.firebase")}
                </legend>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {t("setup.help.firebase")}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field
                    label={t("setup.fields.apiKey")}
                    value={form.apiKey}
                    onChange={(v) => patch("apiKey", v)}
                    required
                    autoFocus
                  />
                  <Field
                    label={t("setup.fields.authDomain")}
                    placeholder="your-project.firebaseapp.com"
                    value={form.authDomain}
                    onChange={(v) => patch("authDomain", v)}
                    required
                  />
                  <Field
                    label={t("setup.fields.projectId")}
                    placeholder="your-project"
                    value={form.projectId}
                    onChange={(v) => patch("projectId", v)}
                    required
                  />
                  <Field
                    label={t("setup.fields.storageBucket")}
                    placeholder="your-project.appspot.com"
                    value={form.storageBucket}
                    onChange={(v) => patch("storageBucket", v)}
                    required
                  />
                  <Field
                    label={t("setup.fields.messagingSenderId")}
                    value={form.messagingSenderId}
                    onChange={(v) => patch("messagingSenderId", v)}
                    required
                  />
                  <Field
                    label={t("setup.fields.appId")}
                    value={form.appId}
                    onChange={(v) => patch("appId", v)}
                    required
                  />
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="text-sm font-semibold text-surface-900 dark:text-surface-50">
                  {t("setup.sections.admin")}
                </legend>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {t("setup.help.admin")}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field
                    type="email"
                    label={t("setup.fields.adminEmail")}
                    placeholder="you@company.com"
                    value={form.adminEmail}
                    onChange={(v) => patch("adminEmail", v)}
                    required
                    autoComplete="email"
                  />
                  <Field
                    type="password"
                    label={t("setup.fields.adminPassword")}
                    placeholder="••••••••"
                    value={form.adminPassword}
                    onChange={(v) => patch("adminPassword", v)}
                    required
                    autoComplete="current-password"
                  />
                </div>
              </fieldset>

              <div aria-live="polite" aria-atomic="true">
                {error ? (
                  <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
                    <ErrorMessage error={error} />
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setWizardStep("backend")}
                  className="btn-secondary flex-1 justify-center"
                  disabled={submitting || done}
                >
                  {t("common.back")}
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1 justify-center"
                  disabled={submitting || done}
                >
                  {t("setup.continueToFlexweg")}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </form>
          </div>
        ) : (
          // wizardStep === "flexweg"
          <div className="card p-6">
            <p className="text-sm text-surface-600 dark:text-surface-300">
              {t("setup.introFlexweg")}
            </p>

            <form onSubmit={handleFlexwegSubmit} className="mt-6 space-y-6">
              <fieldset className="space-y-4">
                <legend className="text-sm font-semibold text-surface-900 dark:text-surface-50">
                  {t("setup.sections.flexweg")}
                </legend>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {t("setup.help.flexweg")}
                </p>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <Field
                      label={t("setup.fields.flexwegApiKey")}
                      value={form.flexwegApiKey}
                      onChange={(v) => patch("flexwegApiKey", v)}
                      required
                      autoFocus
                    />
                    <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-1">
                      {t("setup.help.flexwegApiKeyHint")}{" "}
                      <a
                        href="https://www.flexweg.com/account/settings"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {t("setup.help.flexwegApiKeyLink")}
                      </a>
                      .
                    </p>
                  </div>
                  <Field
                    label={t("setup.fields.flexwegSiteUrl")}
                    placeholder="https://your-site.flexweg.com"
                    value={form.flexwegSiteUrl}
                    onChange={(v) => patch("flexwegSiteUrl", v)}
                    required
                  />
                  <Field
                    label={t("setup.fields.flexwegApiBaseUrl")}
                    value={form.flexwegApiBaseUrl}
                    onChange={(v) => patch("flexwegApiBaseUrl", v)}
                    required
                  />
                </div>
              </fieldset>

              <div aria-live="polite" aria-atomic="true">
                {error ? (
                  <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
                    <ErrorMessage error={error} />
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setWizardStep("firebase");
                  }}
                  className="btn-secondary flex-1 justify-center"
                  disabled={submitting || done}
                >
                  {t("common.back")}
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1 justify-center"
                  disabled={submitting || done}
                >
                  {t("setup.submit")}
                </button>
              </div>
            </form>
          </div>
        )}

        <p className="text-[11px] text-surface-400 text-center mt-4 dark:text-surface-500">
          {t("setup.footer")}
        </p>
      </div>
    </div>
  );
}

interface StepperProps {
  currentStep: WizardStep;
  backendChoice: BackendChoice;
}

function Stepper({ currentStep, backendChoice }: StepperProps) {
  const { t } = useTranslation();
  // The path after "backend" depends on the chosen backend. Until the
  // user picks, we show only the common prefix.
  const base: Array<{ id: WizardStep; label: string }> = [
    { id: "terms", label: t("setup.stepper.terms") },
    { id: "backend", label: t("setup.stepper.backend") },
  ];
  let steps = base;
  if (backendChoice === "flexweg-sqlite" || currentStep === "sqlite") {
    steps = [...base, { id: "sqlite", label: t("setup.stepper.sqlite") }];
  } else if (
    backendChoice === "firebase" ||
    currentStep === "firebase" ||
    currentStep === "flexweg"
  ) {
    steps = [
      ...base,
      { id: "firebase", label: t("setup.stepper.firebase") },
      { id: "flexweg", label: t("setup.stepper.flexweg") },
    ];
  }
  const activeIndex = steps.findIndex((s) => s.id === currentStep);
  return (
    <div className="flex items-center justify-center gap-3 mb-6">
      {steps.map((s, idx) => {
        const isActive = idx === activeIndex;
        const isDone = idx < activeIndex;
        return (
          <div key={s.id} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={
                  "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors " +
                  (isDone
                    ? "bg-emerald-500 text-white"
                    : isActive
                      ? "bg-blue-600 text-white"
                      : "bg-surface-200 text-surface-500 dark:bg-surface-800 dark:text-surface-400")
                }
              >
                {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
              </div>
              <span
                className={
                  "text-xs font-medium " +
                  (isActive
                    ? "text-surface-900 dark:text-surface-50"
                    : "text-surface-500 dark:text-surface-400")
                }
              >
                {s.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={
                  "h-px w-8 transition-colors " +
                  (isDone
                    ? "bg-emerald-500"
                    : "bg-surface-300 dark:bg-surface-700")
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface TermsStepProps {
  onAccept: () => void;
}

// 7-section terms wall, mirroring the CMS sibling. Each section's title +
// body is i18n'd under setup.terms.section{N}.{title,body} so we map over
// a fixed range without changing this component when the text is edited.
const TERMS_SECTION_COUNT = 7;

function TermsStep({ onAccept }: TermsStepProps) {
  const { t } = useTranslation();
  const [accepted, setAccepted] = useState(false);
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">
        {t("setup.terms.title")}
      </h2>
      <p className="text-sm text-surface-600 dark:text-surface-300 mt-3">
        {t("setup.terms.intro")}
      </p>

      <div className="mt-5 max-h-80 overflow-y-auto pr-2 space-y-4 rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-900/40">
        {Array.from({ length: TERMS_SECTION_COUNT }, (_, i) => i + 1).map((n) => (
          <section key={n}>
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-50">
              {t(`setup.terms.section${n}.title`)}
            </h3>
            <p className="text-xs text-surface-600 dark:text-surface-300 mt-1.5 leading-relaxed">
              {t(`setup.terms.section${n}.body`)}
            </p>
          </section>
        ))}
      </div>

      <label className="mt-5 flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-surface-300 text-blue-600 focus:ring-blue-500 dark:border-surface-600 dark:bg-surface-800"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span className="text-sm text-surface-700 dark:text-surface-200">
          {t("setup.terms.accept")}
        </span>
      </label>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onAccept}
          disabled={!accepted}
          className="btn-primary justify-center"
        >
          {t("setup.terms.continue")}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
  autoComplete,
  autoFocus,
}: FieldProps) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type={type}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
      />
    </div>
  );
}

function ErrorMessage({ error }: { error: ErrorState }) {
  const { t } = useTranslation();
  switch (error.kind) {
    case "missingFields":
      return <span>{t("setup.errors.missingFields")}</span>;
    case "firebaseAuth":
      return <span>{error.detail ?? t("setup.errors.firebaseAuthGeneric")}</span>;
    case "firebaseAuthInvalidCredential":
      return (
        <div className="space-y-1.5">
          <p>{t("setup.errors.firebaseAuthInvalidCredential")}</p>
          <p className="text-xs whitespace-pre-line leading-relaxed">
            {t("setup.errors.firebaseAuthInvalidCredentialHint")}
          </p>
        </div>
      );
    case "wrongAdminEmail":
      return <span>{t("setup.errors.wrongAdminEmail")}</span>;
    case "flexwegAuth":
      return <span>{t("setup.errors.flexwegAuth")}</span>;
    case "flexwegNetwork":
      return <span>{t("setup.errors.flexwegNetwork")}</span>;
    case "firestoreRules":
      return (
        <div className="space-y-1.5">
          <p>{t("setup.errors.firestoreRulesTitle")}</p>
          <p className="text-xs leading-relaxed">
            {t("setup.errors.firestoreRulesHint", { email: error.detail ?? "" })}
          </p>
        </div>
      );
    case "firestoreOther":
      return (
        <span>
          {t("setup.errors.firestoreOther")}: {error.detail}
        </span>
      );
    case "uploadFailed":
      return (
        <span>
          {t("setup.errors.uploadFailed")}
          {error.detail ? `: ${error.detail}` : ""}
        </span>
      );
    case "generic":
    default:
      return <span>{error.detail ?? t("setup.errors.generic")}</span>;
  }
}

interface BackendChoiceStepProps {
  value: BackendChoice;
  onChange: (choice: BackendChoice) => void;
  onContinue: () => void;
  onBack: () => void;
}

// Stacked radio choice — minimalist take ported from the Notion app.
// Two labels (full-row click target), each with a tiny icon + 1-line
// hint. No bullets / warnings / external link button — the trade-offs
// live in the install steps themselves and in the docs.
function BackendChoiceStep({ value, onChange, onContinue, onBack }: BackendChoiceStepProps) {
  const { t } = useTranslation();
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">
        {t("setup.backend.heading")}
      </h2>
      <p className="text-sm text-surface-600 dark:text-surface-300 mt-3">
        {t("setup.backend.intro")}
      </p>

      <div className="mt-5 space-y-3">
        <BackendRadio
          icon={Database}
          title={t("setup.backend.sqliteTitle")}
          hint={t("setup.backend.sqliteHint")}
          selected={value === "flexweg-sqlite"}
          onSelect={() => onChange("flexweg-sqlite")}
        />
        <BackendRadio
          icon={Flame}
          title={t("setup.backend.firebaseTitle")}
          hint={t("setup.backend.firebaseHint")}
          selected={value === "firebase"}
          onSelect={() => onChange("firebase")}
        />
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <button type="button" onClick={onBack} className="btn-secondary flex-1 justify-center">
          {t("common.back")}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={value === null}
          className="btn-primary flex-1 justify-center"
        >
          {t("setup.backend.continue")}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface BackendRadioProps {
  icon: typeof Flame;
  title: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}

function BackendRadio({ icon: Icon, title, hint, selected, onSelect }: BackendRadioProps) {
  return (
    <label
      className={
        "flex items-start gap-3 p-3 rounded-lg ring-1 ring-inset cursor-pointer transition-colors " +
        (selected
          ? "ring-blue-500 bg-blue-50/60 dark:ring-blue-400 dark:bg-blue-900/20"
          : "ring-surface-200 hover:bg-surface-50 dark:ring-surface-700 dark:hover:bg-surface-800/60")
      }
    >
      <input
        type="radio"
        name="backend"
        checked={selected}
        onChange={onSelect}
        className="mt-1"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Icon className="h-4 w-4 text-surface-500" />
          {title}
        </p>
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 leading-relaxed">
          {hint}
        </p>
      </div>
    </label>
  );
}

interface SqliteInstallStepProps {
  form: FormState;
  patch: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  submitting: boolean;
  done: boolean;
  error: ErrorState | null;
}

function SqliteInstallStep({
  form,
  patch,
  onSubmit,
  onBack,
  submitting,
  done,
  error,
}: SqliteInstallStepProps) {
  const { t } = useTranslation();
  // Snapshot at mount: was the API key pre-filled from `?apikey=`?
  // Used to show a "✓ Detected from URL" confirmation chip.
  const [apiKeyFromUrl] = useState(() => defaultFlexwegApiKey() !== "");
  // Advanced (Site URL / API base / SQLite path) starts collapsed when
  // all three are pre-filled — covers the common Flexweg dashboard
  // install flow. If any is empty (typically Site URL on localhost),
  // we expand so the user doesn't miss a required field.
  const [advancedOpen, setAdvancedOpen] = useState(
    () => !form.flexwegSiteUrl || !form.flexwegApiBaseUrl || !form.sqlitePath,
  );
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-3">
        <Cloud className="h-4 w-4 text-emerald-500" />
        <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">
          {t("setup.sqlite.heading")}
        </h2>
      </div>
      <p className="text-sm text-surface-600 dark:text-surface-300">
        {t("setup.sqlite.intro")}
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <fieldset className="space-y-4">
          <legend className="sr-only">{t("setup.sqlite.heading")}</legend>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Field
                label={t("setup.fields.flexwegApiKey")}
                type="password"
                value={form.flexwegApiKey}
                onChange={(v) => patch("flexwegApiKey", v)}
                required
                autoFocus={!apiKeyFromUrl}
              />
              {apiKeyFromUrl ? (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {t("setup.sqlite.detectedFromUrl")}
                </p>
              ) : (
                <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-1">
                  {t("setup.sqlite.apiKeyHint")}{" "}
                  <a
                    href="https://www.flexweg.com/account/settings"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {t("setup.help.flexwegApiKeyLink")}
                  </a>
                  .
                </p>
              )}
            </div>

            {/* Advanced toggle — collapses Site URL / API base URL /
                SQLite path when they're all pre-filled and the user
                doesn't need to touch them. */}
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="self-start inline-flex items-center gap-1 text-xs text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
              aria-expanded={advancedOpen}
            >
              <ChevronDown
                className={
                  "h-3.5 w-3.5 transition-transform " + (advancedOpen ? "" : "-rotate-90")
                }
              />
              {t("setup.sqlite.advanced")}
            </button>

            {advancedOpen && (
              <>
                <Field
                  label={t("setup.fields.flexwegSiteUrl")}
                  placeholder="https://your-site.flexweg.com"
                  value={form.flexwegSiteUrl}
                  onChange={(v) => patch("flexwegSiteUrl", v)}
                  required
                />
                <Field
                  label={t("setup.fields.flexwegApiBaseUrl")}
                  value={form.flexwegApiBaseUrl}
                  onChange={(v) => patch("flexwegApiBaseUrl", v)}
                  required
                />
                <div>
                  <Field
                    label={t("setup.fields.sqlitePath")}
                    placeholder="kanban/db.sqlite"
                    value={form.sqlitePath}
                    onChange={(v) => patch("sqlitePath", v)}
                    required
                  />
                  <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-1">
                    {t("setup.sqlite.pathHint")}
                  </p>
                </div>
              </>
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-4 border-t border-surface-200 pt-5 dark:border-surface-700">
          <legend className="text-sm font-semibold text-surface-900 dark:text-surface-50">
            {t("setup.sqlite.adminHeading")}
          </legend>
          <p className="text-xs text-surface-500 dark:text-surface-400">
            {t("setup.sqlite.adminIntro")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              type="email"
              label={t("setup.fields.adminEmail")}
              placeholder="you@company.com"
              value={form.adminEmail}
              onChange={(v) => patch("adminEmail", v)}
              required
              autoComplete="email"
            />
            <Field
              type="password"
              label={t("setup.fields.adminPassword")}
              placeholder="••••••••"
              value={form.adminPassword}
              onChange={(v) => patch("adminPassword", v)}
              required
              autoComplete="new-password"
            />
          </div>
          <p className="text-[11px] text-surface-500 dark:text-surface-400 -mt-1">
            {t("setup.sqlite.passwordHint")}
          </p>
        </fieldset>

        <div aria-live="polite" aria-atomic="true">
          {error ? (
            <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
              <ErrorMessage error={error} />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={onBack}
            className="btn-secondary flex-1 justify-center"
            disabled={submitting || done}
          >
            {t("common.back")}
          </button>
          <button
            type="submit"
            className="btn-primary flex-1 justify-center"
            disabled={submitting || done}
          >
            {t("setup.sqlite.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}

interface ProgressOverlayProps {
  step: string | null;
  progressLog: string[];
  done: boolean;
}

function SetupProgressOverlay({ step, progressLog, done }: ProgressOverlayProps) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 backdrop-blur-sm p-6">
      <div className="card w-full max-w-md p-6 text-center">
        {done ? (
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-4" />
        ) : (
          <Loader2 className="h-10 w-10 text-blue-500 mx-auto mb-4 animate-spin" />
        )}
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">
          {done ? t("setup.success") : t("setup.submitting")}
        </h2>
        {!done && step && (
          <p className="text-sm text-surface-600 dark:text-surface-300 mt-2">
            {step}
          </p>
        )}
        {progressLog.length > 0 && (
          <ul className="mt-5 space-y-1.5 text-left">
            {progressLog.map((entry, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-xs text-surface-500 dark:text-surface-400"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>{entry}</span>
              </li>
            ))}
          </ul>
        )}
        {done && (
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-4">
            {t("setup.reloadingHint")}
          </p>
        )}
      </div>
    </div>
  );
}
