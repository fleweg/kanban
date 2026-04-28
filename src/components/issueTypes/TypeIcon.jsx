import { cn } from "../../lib/utils";
import { getIssueType } from "../../lib/issueTypes";

const sizes = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
};

// Small colored icon used to mark a ticket's type (task/bug/story/epic).
// Defaults to the "task" type when no id is provided.
export function TypeIcon({ type, size = "sm", className }) {
  const def = getIssueType(type);
  const Icon = def.icon;
  return (
    <Icon
      className={cn(sizes[size] ?? sizes.sm, def.color, "shrink-0", className)}
      aria-label={def.label}
    />
  );
}
