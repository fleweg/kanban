import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Eye, EyeOff, IdCard, KeyRound, Loader2, Plug, Trash2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { UserAvatar } from "./UserAvatar";
import { useAuth } from "../../context/AuthContext";
import { useAppData } from "../../context/AppDataContext";
import { removeSelfAvatar, uploadSelfAvatar } from "../../services/avatars";
import { MAX_AVATAR_INPUT_BYTES } from "../../lib/imageResize";
import { getBackendKind } from "../../lib/runtimeConfig";
import { changePassword } from "../../services/flexweg-sqlite/userAuth";
import { SqliteApiError } from "../../services/flexweg-sqlite/client";
import { setSelfAsanaToken, setSelfDisplayName } from "../../services/users";
import {
  AsanaApiError,
  getMe,
  setActiveUserAsanaToken,
} from "../../services/asana/client";
import { useAsanaConfig } from "../../hooks/useAsanaConfig";
import type { UserRecord } from "../../types";

// Min length used by the SetupForm + identity page when registering a
// new account. Reused here so the in-profile change flow is consistent
// with the rest of the app.
const MIN_PASSWORD_LENGTH = 8;

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
}

// User-facing modal for managing the personal avatar. Hangs on the
// Topbar / Sidebar identity chip — clicking the avatar opens it.
//
// State machine:
//   - "idle"      → preview the live avatar (or initials), buttons enabled
//   - "uploading" → spinner over the preview, buttons disabled
//   - "removing"  → ditto, after Remove was clicked
//
// The component reads the LIVE user record from AppDataContext so the
// preview updates the instant Firestore onSnapshot (or the SQLite
// poll tick) reflects the new avatar URL — no manual refresh.
export function ProfileModal({ open, onClose }: ProfileModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { getUserById } = useAppData();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<"idle" | "uploading" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);

  const liveRecord: UserRecord | null = user ? getUserById(user.uid) : null;
  // Stable fallback record so UserAvatar receives the same object
  // reference across renders while liveRecord is null — prevents
  // unnecessary <img> remounts during the very first login when the
  // record hasn't propagated yet. useMemo keys on the fields that
  // actually drive UserAvatar's output.
  const fallbackRecord = useMemo<UserRecord>(
    () => ({
      id: user?.uid ?? "",
      email: user?.email ?? "",
      role: "user",
      disabled: false,
      teamIds: [],
    }),
    [user?.uid, user?.email],
  );
  if (!user) return null;
  const displayRecord: UserRecord = liveRecord ?? fallbackRecord;

  function triggerFilePicker() {
    if (busy !== "idle") return;
    inputRef.current?.click();
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    // Always reset the input value AFTER reading the file — so picking
    // the same file twice in a row still fires onChange.
    if (inputRef.current) inputRef.current.value = "";
    if (!file || !user) return;
    setBusy("uploading");
    try {
      await uploadSelfAvatar(user.uid, file);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("idle");
    }
  }

  async function handleRemove() {
    setError(null);
    if (!user) return;
    setBusy("removing");
    try {
      await removeSelfAvatar(user.uid, displayRecord.avatarPath);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("idle");
    }
  }

  const hasAvatar = Boolean(displayRecord.avatarUrl);
  const working = busy !== "idle";

  return (
    <Modal
      // Keep `onClose` stable across busy state transitions. Toggling
      // the prop between a function and `undefined` re-fires Modal's
      // useEffect cleanup/setup loop on every busy flip, which was
      // racing with the upload-driven re-renders and tripping React
      // reconciliation. Closing mid-upload is harmless: the upload
      // promise continues in the background and writes to the user
      // record when it settles.
      open={open}
      onClose={onClose}
      title={t("profile.title")}
      description={t("profile.subtitle")}
      size="md"
      footer={
        <button type="button" className="btn-primary" onClick={onClose} disabled={working}>
          {t("profile.done")}
        </button>
      }
    >
      <div className="flex flex-col items-center gap-4 py-2">
        <DisplayNameSection currentRecord={displayRecord} />

        <div className="relative">
          <UserAvatar user={displayRecord} size="2xl" />
          {working && (
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
              <Loader2 className="h-6 w-6 text-white animate-spin" />
            </div>
          )}
        </div>

        <p className="text-sm text-surface-700 dark:text-surface-200">{displayRecord.email}</p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={triggerFilePicker}
            disabled={working}
          >
            <Camera className="h-3.5 w-3.5" />
            {hasAvatar ? t("profile.avatar.replace") : t("profile.avatar.upload")}
          </button>
          {hasAvatar && (
            <button
              type="button"
              className="btn-ghost text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
              onClick={handleRemove}
              disabled={working}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("profile.avatar.remove")}
            </button>
          )}
        </div>

        <p className="text-[11px] text-surface-500 dark:text-surface-400 text-center max-w-xs">
          {t("profile.avatar.hint", {
            mb: (MAX_AVATAR_INPUT_BYTES / 1024 / 1024).toFixed(0),
          })}
        </p>

        {error && (
          <div className="w-full rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-xs dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
            {error}
          </div>
        )}

        {/* Per-user Asana PAT: only surfaces when the connector is
            enabled globally (admin Settings → Asana). When the user
            hasn't set their own token, every Asana call falls back to
            the team-wide default PAT — so this section is the
            opt-in path to post comments / sync status under your own
            Asana identity. */}
        <AsanaTokenSection currentRecord={displayRecord} />

        {/* Password change is SQLite-only: the Flexweg SQLite Auth API
            exposes /auth/change-password. Firebase users already have a
            forgot-password flow from the login page (sendResetEmail). */}
        {getBackendKind() === "flexweg-sqlite" && <PasswordChangeSection />}
      </div>
    </Modal>
  );
}

// Inline form to change the user's own SQLite password. Calls
// `POST /auth/change-password` via the existing userAuth wrapper.
// Errors are mapped to friendly i18n messages — 401 = wrong current
// password, anything else falls back to a generic message.
//
// State machine:
//   - "idle"       → inputs editable, no feedback
//   - "submitting" → inputs disabled, button shows spinner label
//   - success      → fields cleared, green confirmation, auto-clears
//                    after 4 s (or on next field edit)
//   - error        → red inline message, persists until next edit
//                    or submit
function PasswordChangeSection() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Auto-clear the success banner after 4s so the form doesn't stay
  // greened-out forever. Editing any field also clears it (see the
  // onChange handlers) — whichever happens first.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(false), 4000);
    return () => clearTimeout(timer);
  }, [success]);

  function bumpEdit() {
    if (error) setError(null);
    if (success) setSuccess(false);
  }

  function resetForm() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    // Client-side validation order: required → length → match.
    // Server still re-checks (length policy + bcrypt-compare on the
    // current password) so this is just to fail fast and offer the
    // sharpest message.
    if (!current || !next || !confirm) {
      setError(t("profile.password.errors.missing"));
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(t("profile.password.errors.tooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (next !== confirm) {
      setError(t("profile.password.errors.mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      resetForm();
      setSuccess(true);
    } catch (err) {
      // 401 from /auth/change-password = wrong current password.
      // Everything else is a generic failure — we don't try to peel
      // open the response body here, the surface area isn't worth it.
      if (err instanceof SqliteApiError && err.status === 401) {
        setError(t("profile.password.errors.invalidCurrent"));
      } else {
        setError(t("profile.password.errors.generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const inputType = show ? "text" : "password";
  const dirty = Boolean(current || next || confirm);

  return (
    <div className="w-full pt-4 mt-2 border-t border-surface-200 dark:border-surface-800">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-surface-500 dark:text-surface-400" />
          <h3 className="text-sm font-semibold">{t("profile.password.title")}</h3>
        </div>
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100"
          title={show ? t("profile.password.hide") : t("profile.password.show")}
        >
          {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {show ? t("profile.password.hide") : t("profile.password.show")}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2.5" autoComplete="off">
        <div>
          <label className="label text-xs" htmlFor="profile-pwd-current">
            {t("profile.password.current")}
          </label>
          <input
            id="profile-pwd-current"
            className="input"
            type={inputType}
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              bumpEdit();
            }}
            disabled={submitting}
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="label text-xs" htmlFor="profile-pwd-new">
            {t("profile.password.new")}
          </label>
          <input
            id="profile-pwd-new"
            className="input"
            type={inputType}
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              bumpEdit();
            }}
            disabled={submitting}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="label text-xs" htmlFor="profile-pwd-confirm">
            {t("profile.password.confirm")}
          </label>
          <input
            id="profile-pwd-confirm"
            className="input"
            type={inputType}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              bumpEdit();
            }}
            disabled={submitting}
            autoComplete="new-password"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-xs dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
            {error}
          </div>
        )}
        {success && !error && (
          <div className="rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-2 text-xs dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50">
            {t("profile.password.success")}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {dirty && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={resetForm}
              disabled={submitting}
            >
              {t("profile.password.cancel")}
            </button>
          )}
          <button
            type="submit"
            className="btn-primary text-xs"
            disabled={submitting || !dirty}
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("profile.password.submitting")}
              </>
            ) : (
              t("profile.password.submit")
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

// Per-user Asana PAT manager. Rendered only when the connector is
// globally enabled (admin Settings → Asana). When the user hasn't set
// their own token, all Asana writes use the team-wide default from
// `config/asana` — so this is purely an opt-in identity override.
//
// Persisted on the user record (`asanaAccessToken`), AND mirrored
// into the Asana client's in-memory cache via setActiveUserAsanaToken
// so the next call uses the new value without waiting for AuthContext
// to re-fetch.
function AsanaTokenSection({ currentRecord }: { currentRecord: UserRecord }) {
  const { t } = useTranslation();
  const asanaConfig = useAsanaConfig();
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Reset transient UI state when the connector is toggled off behind
  // our back (admin disables it while the modal is open).
  useEffect(() => {
    if (!asanaConfig?.enabled) {
      setDraft("");
      setError(null);
      setSuccess(null);
      setTestResult(null);
    }
  }, [asanaConfig?.enabled]);

  // Auto-clear success messages after 4 s so the form doesn't stay
  // greened-out forever between visits.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(timer);
  }, [success]);

  if (!asanaConfig?.enabled) return null;

  const hasExistingToken = Boolean(currentRecord.asanaAccessToken);

  function bumpEdit() {
    if (error) setError(null);
    if (success) setSuccess(null);
    if (testResult) setTestResult(null);
  }

  async function handleTest() {
    setError(null);
    setSuccess(null);
    setTestResult(null);
    const tokenToTest = draft.trim() || currentRecord.asanaAccessToken || "";
    if (!tokenToTest) {
      setError(t("profile.asana.errors.missing"));
      return;
    }
    setTesting(true);
    try {
      const me = await getMe(tokenToTest);
      setTestResult(
        me.email ? t("profile.asana.testOk", { who: me.email }) : t("profile.asana.testOk", { who: me.name ?? me.gid }),
      );
    } catch (err) {
      if (err instanceof AsanaApiError && err.status === 401) {
        setError(t("profile.asana.errors.invalid"));
      } else {
        setError(t("profile.asana.errors.generic"));
      }
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setTestResult(null);
    const next = draft.trim();
    if (!next) {
      setError(t("profile.asana.errors.missing"));
      return;
    }
    setSubmitting(true);
    try {
      await setSelfAsanaToken(currentRecord.id, next);
      // Update the in-memory cache too — AuthContext's record won't
      // refresh until the next login, but the actual Asana client
      // calls need to pick up the new token immediately.
      setActiveUserAsanaToken(next);
      setDraft("");
      setSuccess(t("profile.asana.success.saved"));
    } catch (err) {
      setError((err as Error).message || t("profile.asana.errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClear() {
    setError(null);
    setSuccess(null);
    setTestResult(null);
    setSubmitting(true);
    try {
      await setSelfAsanaToken(currentRecord.id, null);
      setActiveUserAsanaToken(null);
      setDraft("");
      setSuccess(t("profile.asana.success.cleared"));
    } catch (err) {
      setError((err as Error).message || t("profile.asana.errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  const inputType = show ? "text" : "password";

  return (
    <div className="w-full pt-4 mt-2 border-t border-surface-200 dark:border-surface-800">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-surface-500 dark:text-surface-400" />
          <h3 className="text-sm font-semibold">{t("profile.asana.title")}</h3>
        </div>
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100"
          title={show ? t("profile.asana.hide") : t("profile.asana.show")}
        >
          {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {show ? t("profile.asana.hide") : t("profile.asana.show")}
        </button>
      </div>

      <p className="text-[11px] text-surface-500 mb-3 dark:text-surface-400">
        {hasExistingToken
          ? t("profile.asana.status.configured")
          : t("profile.asana.status.fallback")}
      </p>

      <form onSubmit={handleSave} className="space-y-2.5" autoComplete="off">
        <div>
          <label className="label text-xs" htmlFor="profile-asana-token">
            {t("profile.asana.token")}
          </label>
          <input
            id="profile-asana-token"
            className="input"
            type={inputType}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              bumpEdit();
            }}
            placeholder={
              hasExistingToken
                ? t("profile.asana.placeholder.existing")
                : t("profile.asana.placeholder.empty")
            }
            disabled={submitting || testing}
            autoComplete="off"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={handleTest}
            disabled={submitting || testing}
          >
            {testing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("profile.asana.testing")}
              </>
            ) : (
              t("profile.asana.test")
            )}
          </button>
          {testResult && (
            <span className="text-[11px] text-emerald-700 dark:text-emerald-300">{testResult}</span>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-xs dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
            {error}
          </div>
        )}
        {success && !error && (
          <div className="rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-2 text-xs dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50">
            {success}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {hasExistingToken && (
            <button
              type="button"
              className="btn-ghost text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
              onClick={handleClear}
              disabled={submitting || testing}
            >
              {t("profile.asana.clear")}
            </button>
          )}
          <button
            type="submit"
            className="btn-primary text-xs"
            disabled={submitting || testing || !draft.trim()}
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("profile.asana.submitting")}
              </>
            ) : (
              t("profile.asana.submit")
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

// Optional human-readable name shown wherever the user surfaces in
// the UI (assignee picker, comment authorship, avatars' tooltip,
// identity chip). Clearing it falls back to the email.
//
// Saving routes through the dispatcher: SQLite mode hits the Auth
// API + updates the local cache; Firebase mode does a setDoc(merge:
// true) so it also works on the bootstrap admin's first save when
// the users/{uid} doc doesn't exist yet.
const DISPLAY_NAME_MAX = 50;

function DisplayNameSection({ currentRecord }: { currentRecord: UserRecord }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(currentRecord.displayName ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Keep the input synced with the live record so any external
  // update (admin overwrite, /auth/me re-sync) propagates.
  useEffect(() => {
    setDraft(currentRecord.displayName ?? "");
  }, [currentRecord.displayName]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(false), 4000);
    return () => clearTimeout(timer);
  }, [success]);

  const persisted = currentRecord.displayName ?? "";
  const trimmed = draft.trim();
  const dirty = trimmed !== persisted.trim();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (trimmed.length > DISPLAY_NAME_MAX) {
      setError(t("profile.displayName.errors.tooLong", { max: DISPLAY_NAME_MAX }));
      return;
    }
    setSubmitting(true);
    try {
      await setSelfDisplayName(currentRecord.id, trimmed || null);
      setSuccess(true);
    } catch (err) {
      setError((err as Error).message || t("profile.displayName.errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setDraft(persisted);
    setError(null);
    setSuccess(false);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full" autoComplete="off">
      <div className="flex items-center gap-2 mb-2">
        <IdCard className="h-4 w-4 text-surface-500 dark:text-surface-400" />
        <h3 className="text-sm font-semibold">{t("profile.displayName.title")}</h3>
      </div>
      <p className="text-[11px] text-surface-500 mb-2 dark:text-surface-400">
        {t("profile.displayName.hint")}
      </p>
      <div className="flex items-center gap-2">
        <input
          className="input flex-1"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
            if (success) setSuccess(false);
          }}
          placeholder={t("profile.displayName.placeholder")}
          maxLength={DISPLAY_NAME_MAX + 10}
          disabled={submitting}
        />
        {dirty && (
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={handleReset}
            disabled={submitting}
          >
            {t("profile.displayName.cancel")}
          </button>
        )}
        <button type="submit" className="btn-primary text-xs" disabled={submitting || !dirty}>
          {submitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("profile.displayName.submitting")}
            </>
          ) : (
            t("profile.displayName.submit")
          )}
        </button>
      </div>
      {error && (
        <div className="mt-2 rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-xs dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
          {error}
        </div>
      )}
      {success && !error && (
        <div className="mt-2 rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-2 text-xs dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50">
          {t("profile.displayName.success")}
        </div>
      )}
    </form>
  );
}
