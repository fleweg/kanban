import { useEffect, useState } from "react";
import { cn, colorClassesFor, displayNameOf, initialsFor } from "../../lib/utils";
import type { UserRecord } from "../../types";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

const sizes: Record<AvatarSize, string> = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-6 w-6 text-[11px]",
  md: "h-7 w-7 text-xs",
  lg: "h-9 w-9 text-sm",
  // xl/2xl are used by the profile modal preview — never on the
  // boards, so they're free to be larger.
  xl: "h-16 w-16 text-xl",
  "2xl": "h-24 w-24 text-3xl",
};

interface UserAvatarProps {
  user?: UserRecord | null;
  uid?: string | null;
  email?: string | null;
  size?: AvatarSize;
  className?: string;
  title?: string;
}

// Renders the user's uploaded avatar image when available, otherwise
// a colored disc with up to two initials. Color is derived from the
// uid so the same user always gets the same color across the app. If
// the image URL fails to load (expired token, deleted file, …) the
// component falls back to the initials disc silently.
//
// Implementation note: always returns the same outer <span> element
// type with the same set of props (className/title/aria-label), then
// conditionally renders <img> OR a text node inside. Keeping the outer
// VDOM shape stable across the avatar-changes-mid-render transition
// avoids React reconciliation crashes that we saw when the two
// returns branched into different markup paths.
export function UserAvatar({ user, uid, email, size = "sm", className, title }: UserAvatarProps) {
  const resolvedUid = user?.id ?? uid ?? email ?? "";
  const resolvedEmail = user?.email ?? email ?? "";
  // Combine the user record (when supplied) with the loose
  // email/uid props so initialsFor / displayNameOf can lean on
  // displayName when available and fall back to email otherwise.
  const surface = user ?? { email: resolvedEmail, displayName: null };
  const initials = initialsFor(surface);
  const color = colorClassesFor(resolvedUid);
  const tooltip = title ?? (displayNameOf(surface) || "Unknown user");
  const avatarUrl = user?.avatarUrl ?? null;
  const [imgFailed, setImgFailed] = useState(false);

  // Reset the failure flag whenever the URL itself changes — a user
  // uploading a fresh avatar over a previously-broken one should be
  // able to see it. Without this, `imgFailed` would stay true forever
  // for this component instance and the new image would be skipped.
  useEffect(() => {
    setImgFailed(false);
  }, [avatarUrl]);

  const showImage = Boolean(avatarUrl) && !imgFailed;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full ring-1 ring-white/40 shadow-sm select-none overflow-hidden",
        sizes[size] ?? sizes.sm,
        // Initials path needs the deterministic color background and
        // bold text; image path overrides those with the bitmap.
        !showImage && "font-semibold",
        !showImage && color,
        className,
      )}
      title={tooltip}
      aria-label={tooltip}
    >
      {showImage ? (
        <img
          // Keying on the URL forces React to drop the old <img> and
          // mount a fresh one when the user uploads a replacement. The
          // browser then triggers a clean load event on the new src
          // (and a clean onError if it fails) instead of relying on
          // the implicit src-change behavior, which can be flaky.
          key={avatarUrl}
          src={avatarUrl ?? undefined}
          alt={tooltip}
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
          draggable={false}
        />
      ) : (
        initials
      )}
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
