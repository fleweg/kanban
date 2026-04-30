import { cn, colorClassesFor, initialsFromEmail } from "../../lib/utils";
import type { UserRecord } from "../../types";

type AvatarSize = "xs" | "sm" | "md" | "lg";

const sizes: Record<AvatarSize, string> = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-6 w-6 text-[11px]",
  md: "h-7 w-7 text-xs",
  lg: "h-9 w-9 text-sm",
};

interface UserAvatarProps {
  user?: UserRecord | null;
  uid?: string | null;
  email?: string | null;
  size?: AvatarSize;
  className?: string;
  title?: string;
}

// Renders a colored disc with up to two initials. Color is derived from the
// uid so the same user always gets the same color across the app. Pass `user`
// (a record from the `users` collection) when available, or just `email`/`uid`
// for a best-effort render when the user can't be resolved.
export function UserAvatar({ user, uid, email, size = "sm", className, title }: UserAvatarProps) {
  const resolvedUid = user?.id ?? uid ?? email ?? "";
  const resolvedEmail = user?.email ?? email ?? "";
  const initials = initialsFromEmail(resolvedEmail);
  const color = colorClassesFor(resolvedUid);
  const tooltip = title ?? resolvedEmail ?? "Unknown user";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold ring-1 ring-white/40 shadow-sm select-none",
        sizes[size] ?? sizes.sm,
        color,
        className,
      )}
      title={tooltip}
      aria-label={tooltip}
    >
      {initials}
    </span>
  );
}

interface UnassignedAvatarProps {
  size?: AvatarSize;
  className?: string;
}

// Placeholder used when a ticket has no assignee.
export function UnassignedAvatar({ size = "sm", className }: UnassignedAvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold ring-1 ring-dashed ring-surface-300 bg-surface-50 text-surface-400 select-none dark:bg-surface-800 dark:ring-surface-600 dark:text-surface-500",
        sizes[size] ?? sizes.sm,
        className,
      )}
      title="Unassigned"
      aria-label="Unassigned"
    >
      ?
    </span>
  );
}
