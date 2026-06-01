import { NavLink } from "react-router-dom";
import { BarChart3, Crown, Inbox, LayoutGrid, Layers, LogOut, Moon, Settings, Sun, Users, UsersRound, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { signOut } from "../../services/auth";
import { TeamSwitcher } from "../teams/TeamSwitcher";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const baseItems: NavItem[] = [
  { to: "/backlog", label: "Backlog", icon: Inbox },
  { to: "/sprint", label: "Sprint", icon: LayoutGrid },
  { to: "/sprints", label: "Sprints", icon: Layers },
  { to: "/epics", label: "Epics", icon: Crown },
  { to: "/gantt", label: "Gantt", icon: BarChart3 },
  { to: "/teams", label: "Teams", icon: UsersRound },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Topbar() {
  const { user, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const items: NavItem[] = isAdmin ? [...baseItems, { to: "/users", label: "Users", icon: Users }] : baseItems;
  const isDark = theme === "dark";

  return (
    <header className="md:hidden sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-surface-200 dark:bg-surface-900/80 dark:border-surface-800">
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center shrink-0">
            <LayoutGrid className="h-3.5 w-3.5 text-white" />
          </div>
          <p className="text-sm font-semibold truncate">Kanban</p>
        </div>
        <div className="flex items-center gap-1">
          <TeamSwitcher compact className="mr-1" />
          {user && (
            <span className="text-xs text-surface-500 truncate max-w-[120px] dark:text-surface-400">
              {user.email}
            </span>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            className="p-1.5 rounded-md text-surface-500 hover:text-surface-900 hover:bg-surface-100 transition-colors dark:text-surface-400 dark:hover:text-surface-50 dark:hover:bg-surface-800"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            <Sun className={cn("h-4 w-4", !isDark && "hidden")} />
            <Moon className={cn("h-4 w-4", isDark && "hidden")} />
          </button>
          <button
            type="button"
            onClick={() => signOut()}
            className="p-1.5 rounded-md text-surface-500 hover:text-surface-900 hover:bg-surface-100 transition-colors dark:text-surface-400 dark:hover:text-surface-50 dark:hover:bg-surface-800"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
      <nav className="flex border-t border-surface-100 overflow-x-auto dark:border-surface-800">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex-1 min-w-[80px] flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors",
                isActive
                  ? "border-surface-900 text-surface-900 dark:border-surface-50 dark:text-surface-50"
                  : "border-transparent text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-50",
              )
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
