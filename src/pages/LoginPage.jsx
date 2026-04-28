import { useState } from "react";
import { LayoutGrid, Loader2 } from "lucide-react";
import { signIn, sendResetEmail, describeAuthError } from "../services/auth";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword() {
    if (!email.trim()) {
      setError("Enter your email above first, then click reset.");
      return;
    }
    setError(null);
    setInfo(null);
    try {
      await sendResetEmail(email);
      setInfo(`Password reset email sent to ${email.trim()}.`);
    } catch (err) {
      setError(describeAuthError(err));
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6 bg-surface-50 dark:bg-surface-950">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center shadow-card">
            <LayoutGrid className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-base font-semibold leading-none">Kanban</p>
            <p className="text-[11px] text-surface-500 mt-0.5 dark:text-surface-400">Sprints &amp; Backlog</p>
          </div>
        </div>

        <div className="card p-6">
          <h1 className="text-base font-semibold text-surface-900 dark:text-surface-50">Sign in</h1>
          <p className="text-sm text-surface-500 mt-1 dark:text-surface-400">Use your work email and password.</p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="login-email">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoFocus
              />
            </div>
            <div>
              <label className="label" htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-2 text-sm dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50">
                {info}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? "Signing in…" : "Sign in"}
            </button>

            <button
              type="button"
              className="btn-ghost w-full text-sm"
              onClick={handleResetPassword}
              disabled={submitting}
            >
              Forgot password?
            </button>
          </form>
        </div>

        <p className="text-[11px] text-surface-400 text-center mt-4 dark:text-surface-500">
          Account requests go through your administrator.
        </p>
      </div>
    </div>
  );
}
