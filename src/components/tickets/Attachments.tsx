import { useEffect, useRef, useState, type DragEvent, type ChangeEvent } from "react";
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  FileText,
  FileType,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { useAppData } from "../../context/AppDataContext";
import { useAuth } from "../../context/AuthContext";
import {
  deleteAttachment,
  uploadAttachment,
  validateAttachment,
} from "../../services/attachments";
import { getFlexwegConfig } from "../../services/flexwegConfig";
import { cn, formatBytes, formatRelativeTime } from "../../lib/utils";
import type { Attachment, Ticket } from "../../types";

interface InflightUpload {
  name: string;
  progress: number;
}

export function Attachments({ ticket }: { ticket: Ticket }) {
  const { tickets } = useAppData();
  const { user } = useAuth();
  // Read live so the list updates immediately after each upload/delete
  // without round-tripping through the modal's prop snapshot.
  const liveTicket = tickets.find((t) => t.id === ticket.id) ?? ticket;
  const attachments = liveTicket.attachments ?? [];

  const [uploads, setUploads] = useState<Record<string, InflightUpload>>({});
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // null = still loading, false = no Flexweg config yet, true = ready
  const [hasConfig, setHasConfig] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getFlexwegConfig()
      .then((cfg) => !cancelled && setHasConfig(cfg !== null))
      .catch(() => !cancelled && setHasConfig(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFiles(files: FileList | File[] | null) {
    if (!files || !user) return;
    setError(null);
    const list = Array.from(files);
    for (const file of list) {
      const check = validateAttachment(file);
      if (!check.ok) {
        setError(check.reason);
        continue;
      }
      const tempId = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((u) => ({ ...u, [tempId]: { name: file.name, progress: 0 } }));
      const handle = uploadAttachment(ticket.id, file, user.uid);
      handle.onProgress((pct) => {
        setUploads((u) => (u[tempId] ? { ...u, [tempId]: { ...u[tempId], progress: pct } } : u));
      });
      try {
        await handle.promise;
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploads((u) => {
          const next = { ...u };
          delete next[tempId];
          return next;
        });
      }
    }
  }

  function onSelectChange(e: ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files);
    // Reset so re-selecting the same file fires onChange again.
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Paperclip className="h-4 w-4 text-surface-500 dark:text-surface-400" />
        <h3 className="text-sm font-semibold">Attachments</h3>
        {attachments.length > 0 && (
          <span className="text-xs text-surface-500 dark:text-surface-400">({attachments.length})</span>
        )}
      </div>

      {hasConfig === false ? (
        <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 p-4 flex gap-3 text-sm dark:bg-amber-900/20 dark:ring-amber-700/40">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0 dark:text-amber-400" />
          <div>
            <p className="text-amber-800 font-medium dark:text-amber-200">
              Flexweg API key not configured
            </p>
            <p className="text-amber-700 mt-0.5 dark:text-amber-300">
              Ask an admin to set the Flexweg API key in <strong>Settings</strong> before uploading attachments.
            </p>
          </div>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "rounded-lg border-2 border-dashed p-5 text-center cursor-pointer transition-colors",
            dragOver
              ? "border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20"
              : "border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={onSelectChange}
            className="hidden"
          />
          <Upload className="h-5 w-5 mx-auto text-surface-400 mb-1.5 dark:text-surface-500" />
          <p className="text-sm text-surface-600 dark:text-surface-300">
            Drop files here or click to select
          </p>
          <p className="text-xs text-surface-400 mt-0.5 dark:text-surface-500">
            Up to 10 MB per file · images, PDF, text, fonts
          </p>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded bg-red-50 text-red-700 ring-1 ring-red-200 px-3 py-2 text-sm dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700/50">
          {error}
        </div>
      )}

      {Object.entries(uploads).length > 0 && (
        <ul className="mt-3 space-y-2">
          {Object.entries(uploads).map(([id, u]) => (
            <li
              key={id}
              className="flex items-center gap-3 rounded ring-1 ring-surface-200 px-3 py-2 text-sm dark:ring-surface-700"
            >
              <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
              <span className="truncate flex-1 text-surface-700 dark:text-surface-200">{u.name}</span>
              <span className="text-xs text-surface-500 tabular-nums dark:text-surface-400">
                {u.progress.toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      )}

      {attachments.length > 0 && (
        <ul className="mt-3 space-y-2">
          {[...attachments]
            .sort((a, b) => b.uploadedAt - a.uploadedAt)
            .map((a) => (
              <AttachmentRow key={a.id} ticketId={ticket.id} attachment={a} />
            ))}
        </ul>
      )}
    </div>
  );
}

function AttachmentRow({ ticketId, attachment }: { ticketId: string; attachment: Attachment }) {
  const { getUserById } = useAppData();
  const [deleting, setDeleting] = useState(false);
  const isImage = attachment.contentType.startsWith("image/");
  const uploader = getUserById(attachment.uploadedBy);

  async function handleDelete() {
    if (!window.confirm(`Delete "${attachment.name}"?`)) return;
    setDeleting(true);
    try {
      await deleteAttachment(ticketId, attachment);
    } catch (err) {
      console.error(err);
      setDeleting(false);
    }
  }

  return (
    <li className="group flex items-center gap-3 rounded ring-1 ring-surface-200 px-3 py-2 dark:ring-surface-700">
      {isImage ? (
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={attachment.url}
            alt={attachment.name}
            loading="lazy"
            className="h-10 w-10 rounded object-cover ring-1 ring-surface-200 dark:ring-surface-700"
          />
        </a>
      ) : (
        <div className="h-10 w-10 rounded bg-surface-100 flex items-center justify-center shrink-0 dark:bg-surface-800">
          <AttachmentIcon contentType={attachment.contentType} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-surface-900 dark:text-surface-100">
          {attachment.name}
        </p>
        <p className="text-xs text-surface-500 truncate dark:text-surface-400">
          {formatBytes(attachment.size)} · {formatRelativeTime(attachment.uploadedAt)}
          {uploader?.email && <> · {uploader.email}</>}
        </p>
      </div>
      <a
        href={attachment.url}
        download={attachment.name}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1.5 rounded text-surface-500 hover:text-surface-900 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-50 dark:hover:bg-surface-800"
        title="Download"
        aria-label={`Download ${attachment.name}`}
      >
        <Download className="h-4 w-4" />
      </a>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="p-1.5 rounded text-surface-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-surface-400 dark:hover:text-red-400 dark:hover:bg-red-900/30"
        title="Delete"
        aria-label={`Delete ${attachment.name}`}
      >
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </li>
  );
}

function AttachmentIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith("image/")) {
    return <ImageIcon className="h-5 w-5 text-blue-500" />;
  }
  if (contentType === "application/pdf") {
    return <FileType className="h-5 w-5 text-red-500" />;
  }
  if (contentType.includes("spreadsheet") || contentType.includes("excel") || contentType === "text/csv") {
    return <FileSpreadsheet className="h-5 w-5 text-emerald-500" />;
  }
  return <FileText className="h-5 w-5 text-surface-500 dark:text-surface-400" />;
}
