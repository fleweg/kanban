export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">{title}</h1>
        {description && <p className="text-sm text-surface-500 mt-1 dark:text-surface-400">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
