import { ChevronsUpDown, UsersRound } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAppData } from "../../context/AppDataContext";
import { getTeamSwatchClass } from "../../lib/teams";

interface TeamSwitcherProps {
  className?: string;
  compact?: boolean;
}

// Native <select> styled like a chip — same trick as LocaleSwitcher
// (invisible select stretched over a styled span). Native ensures
// keyboard nav + mobile UX work without writing a custom dropdown.
export function TeamSwitcher({ className, compact = false }: TeamSwitcherProps) {
  const { myTeams, currentTeamId, currentTeam, setCurrentTeamId } = useAppData();
  if (myTeams.length === 0) return null;

  const swatch = getTeamSwatchClass(currentTeam?.color);

  return (
    <div className={cn("relative flex items-center", className)}>
      <span
        className={cn(
          "flex-1 inline-flex items-center gap-2 rounded-lg ring-1 ring-surface-200 bg-white px-2.5 py-1.5 text-sm font-medium text-surface-700 dark:bg-surface-800 dark:ring-surface-700 dark:text-surface-200",
          compact && "px-2 py-1 text-xs",
        )}
      >
        <UsersRound className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", "shrink-0")} />
        <span className={cn("h-2 w-2 rounded-full shrink-0", swatch)} aria-hidden="true" />
        <span className="truncate flex-1">{currentTeam?.name ?? "—"}</span>
        <ChevronsUpDown className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5", "text-surface-400 shrink-0")} />
      </span>
      <select
        value={currentTeamId}
        onChange={(e) => setCurrentTeamId(e.target.value)}
        className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
        aria-label="Switch team"
      >
        {myTeams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
    </div>
  );
}
