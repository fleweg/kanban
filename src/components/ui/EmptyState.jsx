import { cn } from "../../lib/utils";

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-16 px-6 rounded-2xl border-2 border-dashed border-surface-200 bg-white/60 dark:border-surface-800 dark:bg-surface-900/40",
        className,
      )}
    >
      {Icon && (
        <div className="rounded-full bg-surface-100 p-3 mb-4 dark:bg-surface-800">
          <Icon className="h-5 w-5 text-surface-500 dark:text-surface-400" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-50">{title}</h3>
      {description && <p className="mt-1 text-sm text-surface-500 max-w-sm dark:text-surface-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
