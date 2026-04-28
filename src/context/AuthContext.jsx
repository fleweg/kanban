import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { subscribeToAuth, signIn, signOut } from "../services/auth";
import { ensureSelfUserRecord, USER_ROLES } from "../services/users";
import { getAdminEmail } from "../services/firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        setError(err);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const value = useMemo(() => {
    const email = (user?.email ?? "").toLowerCase();
    const isBootstrapAdmin = email !== "" && email === getAdminEmail();
    const role = isBootstrapAdmin ? USER_ROLES.admin : record?.role ?? null;
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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
