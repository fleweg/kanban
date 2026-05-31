// Single source of truth for team-related constants. The default
// "general" team is non-deletable and used as a fallback for any
// ticket/sprint/user with a missing teamId.
import type { Team } from "../types";

export const GENERAL_TEAM_ID = "general";
export const GENERAL_TEAM_NAME = "General";

// Fixed palette so we don't need a color picker. Each entry is a
// Tailwind chip class set (bg + text + ring) so it can be dropped
// directly on a <span className={...}> like other chip components.
export const TEAM_COLORS: { id: string; classes: string; swatch: string }[] = [
  { id: "slate", classes: "bg-slate-50 text-slate-700 ring-slate-200 dark:bg-slate-900/40 dark:text-slate-200 dark:ring-slate-700", swatch: "bg-slate-400" },
  { id: "blue", classes: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:ring-blue-700", swatch: "bg-blue-400" },
  { id: "emerald", classes: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-700", swatch: "bg-emerald-400" },
  { id: "amber", classes: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700", swatch: "bg-amber-400" },
  { id: "rose", classes: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-700", swatch: "bg-rose-400" },
  { id: "violet", classes: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:ring-violet-700", swatch: "bg-violet-400" },
  { id: "cyan", classes: "bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-900/40 dark:text-cyan-200 dark:ring-cyan-700", swatch: "bg-cyan-400" },
  { id: "fuchsia", classes: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200 dark:bg-fuchsia-900/40 dark:text-fuchsia-200 dark:ring-fuchsia-700", swatch: "bg-fuchsia-400" },
];

export const DEFAULT_TEAM_COLOR = TEAM_COLORS[0].id;

export function getTeamColorClasses(colorId: string | undefined): string {
  return (TEAM_COLORS.find((c) => c.id === colorId) ?? TEAM_COLORS[0]).classes;
}

export function getTeamSwatchClass(colorId: string | undefined): string {
  return (TEAM_COLORS.find((c) => c.id === colorId) ?? TEAM_COLORS[0]).swatch;
}

// Returns the user-facing name; uses an i18n fallback for the
// special "general" id so we can localize it later via t().
export function teamName(team: Team | null | undefined): string {
  if (!team) return GENERAL_TEAM_NAME;
  return team.name;
}
