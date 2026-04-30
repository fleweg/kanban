import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface BadgeProps {
  children: ReactNode;
  className?: string;
  dot?: boolean;
  dotColor?: string;
}

export function Badge({ children, className, dot, dotColor }: BadgeProps) {
  return (
    <span
      className={cn(
        "chip bg-surface-100 text-surface-700 ring-1 ring-inset ring-surface-200 dark:bg-surface-800 dark:text-surface-200 dark:ring-surface-700",
        className,
      )}
    >
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: dotColor ?? "currentColor" }}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
