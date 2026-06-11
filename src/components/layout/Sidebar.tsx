import { NavLink } from "react-router-dom";
import { BarChart3, Crown, Inbox, LayoutGrid, Layers, LogOut, Moon, Settings, Sun, Tag, Users, UsersRound, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";
import { useAppData } from "../../context/AppDataContext";
import { useProfileModal } from "../../context/ProfileModalContext";
import { useTheme } from "../../context/ThemeContext";
import { signOut } from "../../services/auth";
import { displayNameOf } from "../../lib/utils";
import { TeamSwitcher } from "../teams/TeamSwitcher";
import { UserAvatar } from "../users/UserAvatar";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const baseItems: NavItem[] = [
  { to: "/backlog", label: "Backlog", icon: Inbox },
  { to: "/sprint", label: "Active Sprint", icon: LayoutGrid },
  { to: "/sprints", label: "Sprints", icon: Layers },
  { to: "/epics", label: "Epics", icon: Crown },
  { to: "/gantt", label: "Gantt", icon: BarChart3 },
  { to: "/teams", label: "Teams", icon: UsersRound },
  { to: "/tags", label: "Tags", icon: Tag },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { user, isAdmin } = useAuth();
  const { getUserById } = useAppData();
  const { open: openProfile } = useProfileModal();
  const { theme, toggleTheme } = useTheme();
  const items: NavItem[] = isAdmin ? [...baseItems, { to: "/users", label: "Users", icon: Users }] : baseItems;
  const isDark = theme === "dark";
  // Live user record — reactive on Firestore onSnapshot / SQLite poll,
  // so an avatar uploaded from the modal updates the chip without a
  // manual refresh. Falls back to email/uid when the record hasn't
  // arrived yet (very first login).
  const liveRecord = user ? getUserById(user.uid) : null;

  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0 sticky top-0 h-screen border-r border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900">
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-surface-200 dark:border-surface-800">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center shadow-card">
          <LayoutGrid className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-none">Kanban</p>
          <p className="text-[11px] text-surface-500 mt-0.5 dark:text-surface-400">Sprints &amp; Backlog</p>
        </div>
      </div>
      <div className="px-3 pt-3 pb-1">
        <TeamSwitcher className="w-full" />
      </div>
      {/* min-h-0 + overflow-y-auto so the nav itself scrolls when the
          list of links is taller than the available space (e.g. small
          viewports with many admin routes). Without min-h-0 the flex
          child wouldn't shrink below its intrinsic content height and
          the bottom block would still get pushed off-screen. */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-0.5">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-surface-900 text-white shadow-card dark:bg-surface-100 dark:text-surface-900"
                  : "text-surface-600 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:text-surface-50",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-3 py-3 border-t border-surface-200 dark:border-surface-800">
        {user && (
          <button
            type="button"
            onClick={openProfile}
            className="w-full flex items-center gap-2 rounded-lg px-2 py-2 mb-1 text-left hover:bg-surface-100 transition-colors dark:hover:bg-surface-800"
            title="Open profile"
          >
            <UserAvatar
              user={liveRecord ?? null}
              uid={user.uid}
              email={user.email ?? undefined}
              size="md"
            />
            <div className="min-w-0">
              <p
                className="text-xs font-medium text-surface-700 truncate dark:text-surface-200"
                title={user.email ?? undefined}
              >
                {displayNameOf(liveRecord) || user.email}
              </p>
              <p className="text-[11px] text-surface-400 dark:text-surface-500">{isAdmin ? "Administrator" : "Member"}</p>
            </div>
          </button>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-surface-600 hover:bg-surface-100 hover:text-surface-900 transition-colors dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:text-surface-50"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <Sun className={cn("h-4 w-4", !isDark && "hidden")} />
          <Moon className={cn("h-4 w-4", isDark && "hidden")} />
          <span>{isDark ? "Light mode" : "Dark mode"}</span>
        </button>
        <button
          type="button"
          onClick={() => signOut()}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-surface-600 hover:bg-surface-100 hover:text-surface-900 transition-colors dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:text-surface-50"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
