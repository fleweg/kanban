// SQLite-mode attachments. Uses the Flexweg Files API (`/api/v1/files/*`)
// to store the actual binaries — same target as Firebase mode. The
// difference is where the Flexweg API key comes from:
//   - Firebase mode: Firestore `config/flexweg`
//   - SQLite mode  : SQLite `config` table, key="flexweg"
// (See services/flexwegConfig.ts dispatcher.)
//
// Attachment metadata (id, name, url, …) lives on the ticket row as a
// JSON array column (`tickets.attachments`). We read-modify-write the
// whole array on each upload/delete — same as the Firebase impl's
// arrayUnion/arrayRemove, just expressed in SQL.

import { getFlexwegConfig } from "../flexwegConfig";
import { sqlExec, sqlQuery } from "./client";
import { notifyPotentialChange } from "./subscriptions";
import { withAppBase } from "../../lib/adminBase";
import type { Attachment } from "../../types";

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Same whitelist as the Firebase impl — Flexweg's Files API accepts
// this exact set, so rejecting client-side gives a friendlier error
// than waiting for the 4xx response.
const ALLOWED_EXACT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/svg+xml",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "application/pdf",
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "application/font-woff",
  "application/font-woff2",
  "application/x-font-ttf",
  "application/x-font-otf",
  "text/plain",
  "text/html",
  "text/css",
  "text/javascript",
  "text/csv",
  "text/markdown",
  "text/xml",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
]);

const ALLOWED_EXTENSIONS = new Set([
  "html",
  "css",
  "js",
  "json",
  "xml",
  "txt",
  "md",
  "csv",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "svg",
  "webp",
  "ico",
  "pdf",
  "woff",
  "woff2",
  "ttf",
  "otf",
]);

export function validateAttachment(file: File): { ok: true } | { ok: false; reason: string } {
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      reason: `"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB > 10 MB).`,
    };
  }
  if (file.type && ALLOWED_EXACT_TYPES.has(file.type)) return { ok: true };
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && ALLOWED_EXTENSIONS.has(ext)) return { ok: true };
  return {
    ok: false,
    reason: `"${file.name}" has an unsupported type. Allowed: images, PDF, text/code, fonts.`,
  };
}

function newAttachmentId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Strip path-unsafe characters from filename. Doesn't affect the
// displayed `name` — only the path used inside the Flexweg site.
function sanitizeForPath(name: string): string {
  return name.replace(/[^\w.\-+@()\s]/g, "_").slice(0, 200);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader result type"));
        return;
      }
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function readTicketAttachments(ticketId: string): Promise<Attachment[]> {
  const { rows } = await sqlQuery<{ attachments: string | null }>(
    "SELECT attachments FROM tickets WHERE id = ?",
    [ticketId],
  );
  if (rows.length === 0) return [];
  if (!rows[0].attachments) return [];
  try {
    const v = JSON.parse(rows[0].attachments);
    return Array.isArray(v) ? (v as Attachment[]) : [];
  } catch {
    return [];
  }
}

async function writeTicketAttachments(ticketId: string, attachments: Attachment[]): Promise<void> {
  await sqlExec(
    "UPDATE tickets SET attachments = ?, updated_at = ? WHERE id = ?",
    [JSON.stringify(attachments), Date.now(), ticketId],
  );
  notifyPotentialChange();
}

export interface UploadHandle {
  promise: Promise<Attachment>;
  cancel: () => void;
  // Milestone-based progress (encoding, uploading, persisting) since
  // the Flexweg upload is a single POST with the whole base64 body.
  onProgress: (cb: (percent: number) => void) => void;
}

export function uploadAttachment(ticketId: string, file: File, uploadedBy: string): UploadHandle {
  const validation = validateAttachment(file);
  if (!validation.ok) {
    return {
      promise: Promise.reject(new Error(validation.reason)),
      cancel: () => {},
      onProgress: () => {},
    };
  }

  const aborter = new AbortController();
  const id = newAttachmentId();
  // Prefix with the detected app folder so the file lands inside the
  // kanban's own subfolder (e.g. `kanban/attachments/...`) instead of
  // at the site root. Root deployments still resolve to plain
  // `attachments/...`.
  const path = withAppBase(`attachments/${ticketId}/${id}-${sanitizeForPath(file.name)}`);
  let progressCb: ((percent: number) => void) | null = null;
  const report = (pct: number) => {
    if (progressCb) progressCb(pct);
  };

  const promise: Promise<Attachment> = (async () => {
    const config = await getFlexwegConfig();
    if (!config) {
      throw new Error(
        "Flexweg API key is not configured. Ask an admin to set it in Settings.",
      );
    }

    report(10);
    const content = await fileToBase64(file);
    report(40);

    const res = await fetch(`${config.apiBaseUrl}/files/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
      body: JSON.stringify({ path, content, encoding: "base64" }),
      signal: aborter.signal,
    });
    report(85);

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Flexweg upload failed (${res.status}): ${detail || res.statusText}`);
    }

    // Build the download URL from the site origin only — `path`
    // already includes the app folder via withAppBase(), so prepending
    // the full siteUrl (which may itself end in /kanban) would double
    // the folder.
    const url = `${new URL(config.siteUrl).origin}/${path}`;
    const attachment: Attachment = {
      id,
      name: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      storagePath: path,
      url,
      uploadedAt: Date.now(),
      uploadedBy,
    };

    const existing = await readTicketAttachments(ticketId);
    await writeTicketAttachments(ticketId, [...existing, attachment]);

    report(100);
    return attachment;
  })();

  return {
    promise,
    cancel: () => aborter.abort(),
    onProgress: (cb) => {
      progressCb = cb;
    },
  };
}

// Deletes the Flexweg file (best-effort — 404 means it was already
// gone, treated as success), then removes the entry from the ticket's
// attachments array. We match by `id` since the JSON-encoded object
// might not be byte-identical to what's stored (timestamps, ordering).
export async function deleteAttachment(ticketId: string, attachment: Attachment): Promise<void> {
  const config = await getFlexwegConfig();
  if (config) {
    try {
      const url = `${config.apiBaseUrl}/files/delete?${new URLSearchParams({
        path: attachment.storagePath,
      })}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: { "X-API-Key": config.apiKey },
      });
      if (!res.ok && res.status !== 404) {
        const detail = await res.text().catch(() => "");
        console.warn("Flexweg delete failed", res.status, detail);
      }
    } catch (err) {
      console.warn("Flexweg delete failed", err);
    }
  }
  const existing = await readTicketAttachments(ticketId);
  const next = existing.filter((a) => a.id !== attachment.id);
  await writeTicketAttachments(ticketId, next);
}

// Cleanup hook for ticket deletion. Best-effort — failures are logged
// but never block. Walks the known `attachments` array instead of
// listing the Flexweg folder.
export async function deleteAllAttachmentsForTicket(
  ticketId: string,
  attachments: Attachment[] | undefined,
): Promise<void> {
  if (!attachments?.length) return;
  const config = await getFlexwegConfig();
  if (!config) {
    console.warn(`Skipping Flexweg cleanup for ticket ${ticketId} — no API config`);
    return;
  }
  await Promise.all(
    attachments.map(async (a) => {
      try {
        const url = `${config.apiBaseUrl}/files/delete?${new URLSearchParams({
          path: a.storagePath,
        })}`;
        await fetch(url, {
          method: "DELETE",
          headers: { "X-API-Key": config.apiKey },
        });
      } catch (err) {
        console.warn("Failed to delete attachment", a.storagePath, err);
      }
    }),
  );
}
