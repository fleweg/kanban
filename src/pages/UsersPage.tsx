import { useEffect, useState, type FormEvent } from "react";
import {
  Users as UsersIcon,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserX,
  Trash2,
  UserPlus,
  UsersRound,
  Loader2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { UserAvatar } from "../components/users/UserAvatar";
import {
  subscribeToUsers,
  setUserRole,
  setUserDisabled,
  setUserTeams,
  deleteUserRecord,
  USER_ROLES,
} from "../services/users";
import { Modal } from "../components/ui/Modal";
import { useAppData } from "../context/AppDataContext";
import { GENERAL_TEAM_ID, getTeamColorClasses } from "../lib/teams";
import { cn, displayNameOf } from "../lib/utils";
import { sendResetEmail, describeAuthError } from "../services/auth";
import { getAdminEmail } from "../services/firebaseClient";
import { getBackendKind } from "../lib/runtimeConfig";
import { registerUser } from "../services/flexweg-sqlite/userAuth";
import { syncUsersFromApi } from "../services/flexweg-sqlite/users";
import { formatDate } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import type { UserRecord } from "../types";

export function UsersPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const { teams, getTeamById } = useAppData();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [teamsEditing, setTeamsEditing] = useState<UserRecord | null>(null);

  const isSqlite = getBackendKind() === "flexweg-sqlite";

  useEffect(() => {
    const unsub = subscribeToUsers(
      (list) => {
        setUsers(list);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  async function run(uid: string, fn: () => Promise<unknown>, successMessage?: string) {
    setBusyUid(uid);
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (successMessage) setInfo(successMessage);
    } catch (err) {
      setError(describeAuthError(err) ?? (err as Error).message);
    } finally {
      setBusyUid(null);
    }
  }

  const bootstrapEmail = getAdminEmail();

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <PageHeader
        title={t("users.title")}
        description={isSqlite ? t("users.descriptionSqlite") : t("users.descriptionFirebase")}
      />

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
          {error}
        </div>
      )}
      {info && (
        <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-2 text-sm dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/50">
          {info}
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4 text-surface-500 dark:text-surface-400" />
            <h2 className="text-sm font-semibold">{t("users.members")}</h2>
          </div>
          {isSqlite && (
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => {
                setAddOpen(true);
                setError(null);
                setInfo(null);
              }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              {t("users.addUser")}
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-surface-500 dark:text-surface-400">{t("users.loading")}</p>
        ) : users.length === 0 ? (
          <EmptyState
            title={t("users.empty.title")}
            description={isSqlite ? t("users.empty.descriptionSqlite") : t("users.empty.descriptionFirebase")}
          />
        ) : (
          <ul className="divide-y divide-surface-100 dark:divide-surface-800">
            {users.map((u) => {
              const isSelf = currentUser?.uid === u.id;
              const busy = busyUid === u.id;
              const isBootstrap = bootstrapEmail !== "" && u.email?.toLowerCase() === bootstrapEmail;
              // The bootstrap admin is admin via .env regardless of their role field.
              const isAdmin = u.role === USER_ROLES.admin || isBootstrap;
              const lockDestructive = isSelf || isBootstrap;
              return (
                <li key={u.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <UserAvatar user={u} size="md" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-sm font-medium text-surface-900 truncate dark:text-surface-50"
                          title={u.email}
                        >
                          {displayNameOf(u)}
                        </span>
                        {u.displayName && (
                          <span className="text-[11px] text-surface-500 dark:text-surface-400">{u.email}</span>
                        )}
                        <span
                          className={
                            "chip " +
                            (isAdmin
                              ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")
                          }
                        >
                          {isAdmin ? t("users.roleAdmin") : t("users.roleUser")}
                        </span>
                        {isBootstrap && (
                          <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            {t("users.bootstrap")}
                          </span>
                        )}
                        {u.disabled && (
                          <span className="chip bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            {t("users.disabled")}
                          </span>
                        )}
                        {isSelf && (
                          <span className="chip bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                            {t("users.you")}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-surface-500 mt-0.5 dark:text-surface-400">{t("users.added")} {formatDate(u.createdAt)}</p>
                      {u.teamIds && u.teamIds.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {u.teamIds.map((tid) => {
                            const team = getTeamById(tid);
                            if (!team) return null;
                            return (
                              <span
                                key={tid}
                                className={cn("chip text-[10px]", getTeamColorClasses(team.color))}
                              >
                                {team.name}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {!isSqlite && (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        title={t("users.resetPasswordTitle")}
                        onClick={() =>
                          run(u.id, () => sendResetEmail(u.email), t("users.resetPasswordSent", { email: u.email }))
                        }
                        disabled={busy}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {t("users.resetPassword")}
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      title="Edit team memberships"
                      onClick={() => setTeamsEditing(u)}
                      disabled={busy}
                    >
                      <UsersRound className="h-3.5 w-3.5" />
                      Teams
                    </button>

                    {isAdmin ? (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        title={isBootstrap ? t("users.demoteBootstrapTitle") : t("users.demoteTitle")}
                        onClick={() => run(u.id, () => setUserRole(u.id, USER_ROLES.user))}
                        disabled={busy || lockDestructive}
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        {t("users.demote")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        title={t("users.promoteTitle")}
                        onClick={() => run(u.id, () => setUserRole(u.id, USER_ROLES.admin))}
                        disabled={busy}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {t("users.promote")}
                      </button>
                    )}

                    {u.disabled ? (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => run(u.id, () => setUserDisabled(u.id, false))}
                        disabled={busy}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        {t("users.enable")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => run(u.id, () => setUserDisabled(u.id, true))}
                        disabled={busy || lockDestructive}
                      >
                        <UserX className="h-3.5 w-3.5" />
                        {t("users.disable")}
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-ghost text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
                      title={
                        isBootstrap
                          ? t("users.removeBootstrapTitle")
                          : isSqlite
                            ? t("users.removeSqliteTitle")
                            : t("users.removeFirebaseTitle")
                      }
                      onClick={() => {
                        const confirmMsg = isSqlite
                          ? t("users.removeConfirmSqlite", { email: u.email })
                          : t("users.removeConfirmFirebase", { email: u.email });
                        if (!window.confirm(confirmMsg)) return;
                        run(u.id, () => deleteUserRecord(u.id));
                      }}
                      disabled={busy || lockDestructive}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t("users.remove")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card p-5 mt-4 bg-surface-50/40 dark:bg-surface-950/40">
        <h3 className="text-sm font-semibold mb-2">{t("users.help.title")}</h3>
        {isSqlite ? (
          <ol className="text-sm text-surface-600 space-y-1.5 list-decimal pl-5 dark:text-surface-300">
            <li>{t("users.help.sqlite.step1")}</li>
            <li>{t("users.help.sqlite.step2")}</li>
            <li>{t("users.help.sqlite.step3")}</li>
          </ol>
        ) : (
          <ol className="text-sm text-surface-600 space-y-1.5 list-decimal pl-5 dark:text-surface-300">
            <li>{t("users.help.firebase.step1")}</li>
            <li>{t("users.help.firebase.step2")}</li>
            <li>{t("users.help.firebase.step3")}</li>
          </ol>
        )}
        {!isSqlite && bootstrapEmail && (
          <p className="text-xs text-surface-500 mt-3 dark:text-surface-400">
            {t("users.help.bootstrapLine")}{" "}
            <span className="font-medium">{bootstrapEmail}</span>
          </p>
        )}
      </div>

      {addOpen && (
        <AddUserModal
          onClose={() => setAddOpen(false)}
          onCreated={async (email) => {
            setAddOpen(false);
            setError(null);
            setInfo(t("users.addUserSuccess", { email }));
            // Refresh the local cache so the new user appears immediately
            // (the polling tick would also catch it, but this is snappier).
            try {
              await syncUsersFromApi();
            } catch {
              // Non-fatal — next poll will pick it up.
            }
          }}
        />
      )}

      {teamsEditing && (
        <TeamsEditorModal
          user={teamsEditing}
          allTeams={teams}
          onClose={() => setTeamsEditing(null)}
          onSave={async (next) => {
            try {
              await setUserTeams(teamsEditing.id, next);
              setTeamsEditing(null);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}

interface TeamsEditorModalProps {
  user: UserRecord;
  allTeams: { id: string; name: string; color?: string }[];
  onClose: () => void;
  onSave: (teamIds: string[]) => Promise<void> | void;
}

function TeamsEditorModal({ user, allTeams, onClose, onSave }: TeamsEditorModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(user.teamIds ?? []));
  const [submitting, setSubmitting] = useState(false);

  function toggle(id: string) {
    // General is always included — surface it as disabled below.
    if (id === GENERAL_TEAM_ID) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSubmitting(true);
    const teamIds = Array.from(selected);
    if (!teamIds.includes(GENERAL_TEAM_ID)) teamIds.push(GENERAL_TEAM_ID);
    try {
      await onSave(teamIds);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Teams for ${displayNameOf(user)}`}
      description="The General team is always included."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <ul className="space-y-1">
        {allTeams.map((team) => {
          const isGeneral = team.id === GENERAL_TEAM_ID;
          const checked = isGeneral || selected.has(team.id);
          return (
            <li key={team.id}>
              <label
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-surface-200 dark:ring-surface-700",
                  isGeneral && "opacity-70 cursor-default",
                  !isGeneral && "cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isGeneral}
                  onChange={() => toggle(team.id)}
                />
                <span className="text-sm font-medium text-surface-900 dark:text-surface-50">{team.name}</span>
                {isGeneral && (
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-surface-400">Default</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

interface AddUserModalProps {
  onClose: () => void;
  onCreated: (email: string) => void;
}

function AddUserModal({ onClose, onCreated }: AddUserModalProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
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
    if (password.length < 8) {
      setError(t("identity.errors.passwordTooShort"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await registerUser({
        email: cleanEmail,
        password,
        displayName: displayName.trim() || undefined,
      });
      onCreated(cleanEmail);
    } catch (err) {
      setError(describeAuthError(err) ?? (err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/60 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-surface-900 dark:text-surface-50">
            {t("users.addUserModal.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
            aria-label={t("common.cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-surface-500 mb-4 dark:text-surface-400">
          {t("users.addUserModal.intro")}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="add-user-name">
              {t("identity.fields.name")}
            </label>
            <input
              id="add-user-name"
              type="text"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("identity.fields.namePlaceholder")}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label" htmlFor="add-user-email">
              {t("identity.fields.email")}
            </label>
            <input
              id="add-user-email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@company.com"
              required
              autoComplete="off"
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="add-user-password">
              {t("identity.fields.password")}
            </label>
            <input
              id="add-user-password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
            />
            <p className="text-[11px] text-surface-500 mt-1 dark:text-surface-400">
              {t("identity.fields.passwordHint")}
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1 justify-center"
              disabled={submitting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 justify-center"
              disabled={submitting}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <Loader2
                  className={
                    "h-4 w-4 animate-spin " + (submitting ? "" : "hidden")
                  }
                />
                <span>
                  {submitting ? t("users.addUserModal.submitting") : t("users.addUserModal.submit")}
                </span>
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
