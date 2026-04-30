import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { subscribeToAuth, signIn, signOut } from "../services/auth";
import { ensureSelfUserRecord, USER_ROLES } from "../services/users";
import { getAdminEmail } from "../services/firebase";
import type { UserRecord, UserRole } from "../types";

interface AuthValue {
  user: FirebaseUser | null;
  record: UserRecord | null;
  role: UserRole | null;
  isAdmin: boolean;
  disabled: boolean;
  loading: boolean;
  error: Error | null;
  signIn: typeof signIn;
  signOut: typeof signOut;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [record, setRecord] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = subscribeToAuth(async (fbUser) => {
      setError(null);
      if (!fbUser) {
        setUser(null);
        setRecord(null);
        setLoading(false);
        return;
      }
      setUser(fbUser);
      try {
        // Every signed-in user (including the bootstrap admin) gets a Firestore
        // record so they can be picked as ticket assignees and rendered with an
        // avatar. The bootstrap admin's effective admin status still comes from
        // the email match in `.env` + Firestore rules, not from the role field.
        const rec = await ensureSelfUserRecord(fbUser);
        setRecord(rec);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const value = useMemo<AuthValue>(() => {
    const email = (user?.email ?? "").toLowerCase();
    const isBootstrapAdmin = email !== "" && email === getAdminEmail();
    const role: UserRole | null = isBootstrapAdmin ? USER_ROLES.admin : record?.role ?? null;
    const disabled = !isBootstrapAdmin && record?.disabled === true;
    return {
      user,
      record,
      role,
      isAdmin: role === USER_ROLES.admin,
      disabled,
      loading,
      error,
      signIn,
      signOut,
    };
  }, [user, record, loading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
