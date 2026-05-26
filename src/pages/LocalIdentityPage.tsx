import { useState, type FormEvent } from "react";
import { LayoutGrid, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  describeAuthError,
  signIn,
} from "../services/flexweg-sqlite/auth";
import { LocaleSwitcher } from "../components/ui/LocaleSwitcher";

// Login screen for the Flexweg SQLite backend. Account creation is
// admin-only via the Users page — there is no public registration.

export function LocalIdentityPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/.+@.+\..+/.test(cleanEmail)) {
      setError(t("identity.errors.invalidEmail"));
      return;
    }
    if (!password) {
      setError(t("identity.errors.missingPassword"));
      return;
    }
    setSubmitting(true);
    setError(null);
    // Clear any leftover route hash (e.g. "#/users" from a previous
    // session that an admin had open) BEFORE the auth state change.
    // Otherwise React tries to unmount the login form AND mount Routes
    // with an immediate <Navigate replace /> redirect in the same
    // commit — a violent reconciliation that occasionally crashes with
    // "Node.insertBefore: Child to insert before is not a child of
    // this node" when a browser extension has injected DOM inside the
    // form.
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    try {
      await signIn(cleanEmail, password);
      // No explicit redirect — AuthContext emit triggers re-render.
    } catch (err) {
      setError(describeAuthError(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-full flex items-center justify-center p-6 bg-surface-50 dark:bg-surface-950">
      <div className="absolute top-4 right-4 z-10">
        <LocaleSwitcher />
      </div>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center shadow-card">
            <LayoutGrid className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-base font-semibold leading-none">{t("identity.brandTitle")}</p>
            <p className="text-[11px] text-surface-500 mt-0.5 dark:text-surface-400">
              {t("identity.brandSubtitle")}
            </p>
          </div>
        </div>

        <div className="card p-6">
          <h1 className="text-base font-semibold text-surface-900 dark:text-surface-50">
            {t("identity.login.heading")}
          </h1>
          <p className="text-sm text-surface-500 mt-1 dark:text-surface-400">
            {t("identity.login.intro")}
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="identity-email">
                {t("identity.fields.email")}
              </label>
              <input
                id="identity-email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
                autoFocus
              />
            </div>
            <div>
              <label className="label" htmlFor="identity-password">
                {t("identity.fields.password")}
              </label>
              <input
                id="identity-password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {/* Stable DOM structure across renders: always a span,
                  Loader2 visibility toggled via className. Prevents
                  insertBefore crashes when a browser extension has
                  injected nodes inside the form. */}
              <span className="inline-flex items-center justify-center gap-1.5">
                <Loader2
                  className={
                    "h-4 w-4 animate-spin " + (submitting ? "" : "hidden")
                  }
                />
                <span>
                  {submitting ? t("identity.login.submitting") : t("identity.login.submit")}
                </span>
              </span>
            </button>
          </form>
        </div>

        <p className="text-[11px] text-surface-400 text-center mt-4 dark:text-surface-500">
          {t("identity.footer")}
        </p>
      </div>
    </div>
  );
}
