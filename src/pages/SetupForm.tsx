import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  LayoutGrid,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import {
  buildConfigJsSource,
  type FlexwegRuntimeConfig,
} from "../lib/runtimeConfig";
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
} from "../services/firebase";
import { DEFAULT_FLEXWEG_API_BASE_URL } from "../services/flexwegConfig";
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
}

// Pre-fills the Flexweg site URL with the page's current origin —
// the Kanban is typically deployed at `<site>/kanban/`, so the page
// hosting this form lives under the very URL the user wants to type.
// Skipped on localhost where the origin is never a useful default.
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
  return window.location.origin;
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
  flexwegApiKey: "",
  flexwegSiteUrl: defaultSiteUrl(),
  flexwegApiBaseUrl: DEFAULT_FLEXWEG_API_BASE_URL,
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

type WizardStep = "welcome" | "terms" | "firebase" | "flexweg";

export function SetupForm() {
  const { t } = useTranslation();
  // Three-step wizard: welcome landing, then Firebase config (sign-in
  // + email match), then Flexweg config (API test + Firestore write +
  // config.js upload). Welcome step primes the user on the Firebase
  // prerequisite before throwing eleven form fields at them.
  const [wizardStep, setWizardStep] = useState<WizardStep>("welcome");
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
      window.setTimeout(() => {
        const next = new URL(window.location.href);
        next.searchParams.set("_setup", String(Date.now()));
        window.location.replace(next.toString());
      }, 2000);
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

        <Stepper currentStep={wizardStep} />

        {wizardStep === "welcome" ? (
          <WelcomeStep onContinue={() => setWizardStep("terms")} />
        ) : wizardStep === "terms" ? (
          <TermsStep
            onAccept={() => setWizardStep("firebase")}
            onBack={() => setWizardStep("welcome")}
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
                  onClick={() => setWizardStep("terms")}
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
}

function Stepper({ currentStep }: StepperProps) {
  const { t } = useTranslation();
  const steps: Array<{ id: WizardStep; label: string }> = [
    { id: "welcome", label: t("setup.stepper.welcome") },
    { id: "terms", label: t("setup.stepper.terms") },
    { id: "firebase", label: t("setup.stepper.firebase") },
    { id: "flexweg", label: t("setup.stepper.flexweg") },
  ];
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

interface WelcomeStepProps {
  onContinue: () => void;
}

function WelcomeStep({ onContinue }: WelcomeStepProps) {
  const { t } = useTranslation();
  const tutorialUrl = t("setup.welcome.tutorialUrl");
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">
        {t("setup.welcome.heading")}
      </h2>
      <p className="text-sm text-surface-600 dark:text-surface-300 mt-3">
        {t("setup.welcome.intro")}
      </p>
      <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800/60 dark:bg-blue-950/40">
        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200">
          {t("setup.welcome.firebaseTitle")}
        </h3>
        <p className="text-xs text-blue-800/90 dark:text-blue-300/90 mt-1.5 leading-relaxed">
          {t("setup.welcome.firebaseBody")}
        </p>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <a
          href={tutorialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary flex-1 justify-center"
        >
          <BookOpen className="h-4 w-4" />
          {t("setup.welcome.tutorialButton")}
        </a>
        <button
          type="button"
          onClick={onContinue}
          className="btn-primary flex-1 justify-center"
        >
          {t("setup.welcome.haveAccountButton")}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface TermsStepProps {
  onAccept: () => void;
  onBack: () => void;
}

// 7-section terms wall, mirroring the CMS sibling. Each section's title +
// body is i18n'd under setup.terms.section{N}.{title,body} so we map over
// a fixed range without changing this component when the text is edited.
const TERMS_SECTION_COUNT = 7;

function TermsStep({ onAccept, onBack }: TermsStepProps) {
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

      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary flex-1 justify-center"
        >
          {t("common.back")}
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={!accepted}
          className="btn-primary flex-1 justify-center"
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
