import { AlertTriangle } from "lucide-react";

interface ErrorScreenProps {
  title?: string;
  message?: string;
}

export function ErrorScreen({ title = "Something went wrong", message }: ErrorScreenProps) {
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mb-4 dark:bg-red-900/40">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
        </div>
        <h1 className="text-lg font-semibold text-surface-900 dark:text-surface-50">{title}</h1>
        {message && (
          <p className="text-sm text-surface-600 mt-2 whitespace-pre-line dark:text-surface-300">{message}</p>
        )}
        <p className="text-xs text-surface-500 mt-4 dark:text-surface-400">
          Check the browser console and your{" "}
          <code className="bg-surface-100 px-1 py-0.5 rounded dark:bg-surface-800">.env</code> configuration. See the
          README for setup instructions.
        </p>
      </div>
    </div>
  );
}
