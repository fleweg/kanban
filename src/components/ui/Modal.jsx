import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export function Modal({ open, onClose, title, description, children, footer, size = "md" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-2xl",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-surface-900/40 backdrop-blur-sm animate-fade-in dark:bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative w-full bg-white rounded-2xl shadow-pop ring-1 ring-surface-200 animate-scale-in dark:bg-surface-900 dark:ring-surface-700",
          // Constrain to the viewport and let the body scroll. Header and
          // footer stay anchored so action buttons remain reachable on tall
          // content (long forms, long comment threads).
          "flex flex-col max-h-[90vh]",
          sizes[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 shrink-0">
          <div>
            {title && <h2 className="text-base font-semibold text-surface-900 dark:text-surface-50">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-surface-500 dark:text-surface-400">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-surface-400 hover:text-surface-700 transition-colors p-1 -mr-1 rounded-md hover:bg-surface-100 dark:text-surface-500 dark:hover:text-surface-200 dark:hover:bg-surface-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-3.5 bg-surface-50/60 rounded-b-2xl border-t border-surface-100 dark:bg-surface-950/40 dark:border-surface-800 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
