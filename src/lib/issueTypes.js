import { BookOpen, Bug, Crown, Square } from "lucide-react";

// Issue type catalog. Hardcoded for now — the surface is small and unlikely to
// change often. If we ever want this configurable, mirror the workflow JSON
// pattern (Firestore doc + Settings page editor).
export const ISSUE_TYPES = [
  {
    id: "task",
    label: "Task",
    icon: Square,
    color: "text-blue-500",
    chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  {
    id: "bug",
    label: "Bug",
    icon: Bug,
    color: "text-red-500",
    chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  {
    id: "story",
    label: "Story",
    icon: BookOpen,
    color: "text-emerald-500",
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  {
    id: "epic",
    label: "Epic",
    icon: Crown,
    color: "text-violet-500",
    chip: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  },
];

export const DEFAULT_ISSUE_TYPE = "task";
export const EPIC_TYPE = "epic";

export function getIssueType(id) {
  return ISSUE_TYPES.find((t) => t.id === id) ?? ISSUE_TYPES[0];
}

export function isEpic(ticket) {
  return ticket?.type === EPIC_TYPE;
}
