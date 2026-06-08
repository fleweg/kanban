import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ProfileModal } from "../components/users/ProfileModal";

interface ProfileModalValue {
  // Opens the profile modal. Called from the Topbar / Sidebar identity
  // chip. Idempotent — calling it while open is a no-op.
  open: () => void;
}

const ProfileModalContext = createContext<ProfileModalValue | null>(null);

// Mounts the ProfileModal once at the layout root so both Topbar and
// Sidebar can share the same instance. The state lives here rather
// than in either bar so opening from the mobile Topbar / desktop
// Sidebar doesn't double-render a modal.
export function ProfileModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo<ProfileModalValue>(
    () => ({ open: () => setOpen(true) }),
    [],
  );
  const handleClose = useCallback(() => setOpen(false), []);
  return (
    <ProfileModalContext.Provider value={value}>
      {children}
      <ProfileModal open={open} onClose={handleClose} />
    </ProfileModalContext.Provider>
  );
}

export function useProfileModal(): ProfileModalValue {
  const ctx = useContext(ProfileModalContext);
  if (!ctx) throw new Error("useProfileModal must be used inside <ProfileModalProvider>");
  return ctx;
}
