import { useEffect, useState } from "react";
import { Users as UsersIcon, KeyRound, ShieldCheck, ShieldOff, UserCheck, UserX, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { UserAvatar } from "../components/users/UserAvatar";
import {
  subscribeToUsers,
  setUserRole,
  setUserDisabled,
  deleteUserRecord,
  USER_ROLES,
} from "../services/users";
import { sendResetEmail, describeAuthError } from "../services/auth";
import { getAdminEmail } from "../services/firebase";
import { formatDate } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import type { UserRecord } from "../types";

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

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
        title="Users"
        description="Manage who can access this Kanban. Auth accounts are created in the Firebase Console; roles and access are managed here."
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
        <div className="flex items-center gap-2 mb-4">
          <UsersIcon className="h-4 w-4 text-surface-500 dark:text-surface-400" />
          <h2 className="text-sm font-semibold">Members</h2>
        </div>

        {loading ? (
          <p className="text-sm text-surface-500 dark:text-surface-400">Loading…</p>
        ) : users.length === 0 ? (
          <EmptyState
            title="No members yet"
            description="Once a new user signs in for the first time, they'll appear here."
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
                        <span className="text-sm font-medium text-surface-900 truncate dark:text-surface-50">{u.email}</span>
                        <span
                          className={
                            "chip " +
                            (isAdmin
                              ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")
                          }
                        >
                          {isAdmin ? "Admin" : "User"}
                        </span>
                        {isBootstrap && (
                          <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            Bootstrap
                          </span>
                        )}
                        {u.disabled && (
                          <span className="chip bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            Disabled
                          </span>
                        )}
                        {isSelf && (
                          <span className="chip bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                            You
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-surface-500 mt-0.5 dark:text-surface-400">Added {formatDate(u.createdAt)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      title="Send password reset email"
                      onClick={() =>
                        run(u.id, () => sendResetEmail(u.email), `Reset email sent to ${u.email}.`)
                      }
                      disabled={busy}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Reset password
                    </button>

                    {isAdmin ? (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        title={isBootstrap ? "Bootstrap admin cannot be demoted" : "Demote to user"}
                        onClick={() => run(u.id, () => setUserRole(u.id, USER_ROLES.user))}
                        disabled={busy || lockDestructive}
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        Demote
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        title="Promote to admin"
                        onClick={() => run(u.id, () => setUserRole(u.id, USER_ROLES.admin))}
                        disabled={busy}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Promote
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
                        Enable
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => run(u.id, () => setUserDisabled(u.id, true))}
                        disabled={busy || lockDestructive}
                      >
                        <UserX className="h-3.5 w-3.5" />
                        Disable
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-ghost text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
                      title={
                        isBootstrap
                          ? "Bootstrap admin record cannot be removed from here"
                          : "Remove access record (does not delete the Firebase Auth account)"
                      }
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Remove access for ${u.email}? They lose access immediately. To fully delete the account, also remove it from Firebase Authentication console.`,
                          )
                        )
                          return;
                        run(u.id, () => deleteUserRecord(u.id));
                      }}
                      disabled={busy || lockDestructive}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card p-5 mt-4 bg-surface-50/40 dark:bg-surface-950/40">
        <h3 className="text-sm font-semibold mb-2">How to add a new member</h3>
        <ol className="text-sm text-surface-600 space-y-1.5 list-decimal pl-5 dark:text-surface-300">
          <li>
            Open <span className="font-medium">Firebase Console → Authentication → Users → Add user</span> and create
            the account with email + password.
          </li>
          <li>Share the credentials with the new member.</li>
          <li>
            On their first sign-in, their record appears in this list with role <em>user</em>. Promote to admin if
            needed.
          </li>
        </ol>
        {bootstrapEmail && (
          <p className="text-xs text-surface-500 mt-3 dark:text-surface-400">
            Bootstrap admin (from <code className="bg-surface-100 px-1 py-0.5 rounded dark:bg-surface-800">.env</code>):{" "}
            <span className="font-medium">{bootstrapEmail}</span>
          </p>
        )}
      </div>
    </div>
  );
}
