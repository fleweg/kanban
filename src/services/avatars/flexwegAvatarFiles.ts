// Shared helpers for pushing / removing an avatar file on the Flexweg
// Files API. Both backend implementations (Firebase / SQLite) call
// these — the only thing that differs between modes is HOW the
// resulting `{path, url}` is written onto the user record.
//
// Pattern mirrors the attachments service: same auth header
// (`X-API-Key`), same encoding (base64), same DELETE shape. Failures
// on the DELETE path are best-effort — they never block the
// matching user-record write so a network blip doesn't leave the user
// staring at a "Removing…" spinner forever.

import { getFlexwegConfig } from "../flexwegConfig";
import { withAppBase } from "../../lib/adminBase";
import { resizeToSquareJpeg } from "../../lib/imageResize";

// Single resized file per user; overwriting works fine on the Flexweg
// Files API (PUT-like semantics on the same path). The `?v=…`
// cache-buster lives on the URL we store, not the path itself.
function avatarPathFor(uid: string): string {
  return withAppBase(`avatars/${uid}.jpg`);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const reader = new FileReader();
  const ready = new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader produced a non-string result."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read avatar blob."));
  });
  reader.readAsDataURL(blob);
  return ready;
}

export interface UploadedAvatar {
  // Storage path on Flexweg (no leading slash). What we hand to the
  // DELETE endpoint later.
  path: string;
  // Public URL with cache-buster appended. What we store on the user
  // record so every browser fetches the fresh image after an update.
  url: string;
  uploadedAt: number;
}

// Resizes the input file and uploads it to Flexweg. Returns the
// metadata the caller writes onto the user record. Caller is
// responsible for both backend-specific persistence and surfacing
// errors to the UI.
export async function uploadAvatarToFlexweg(uid: string, file: File): Promise<UploadedAvatar> {
  const config = await getFlexwegConfig();
  if (!config) {
    throw new Error(
      "Flexweg API key is not configured. Ask an admin to set it in Settings.",
    );
  }

  // Resize first — fail fast on a bad file before talking to the API.
  const { blob } = await resizeToSquareJpeg(file);
  const content = await blobToBase64(blob);

  const path = avatarPathFor(uid);
  const res = await fetch(`${config.apiBaseUrl}/files/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
    },
    body: JSON.stringify({ path, content, encoding: "base64" }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Flexweg avatar upload failed (${res.status}): ${detail || res.statusText}`);
  }

  const uploadedAt = Date.now();
  // The site origin (no path) + the storage path gives a stable
  // resolvable URL whatever subfolder the kanban lives in.
  // `?v={uploadedAt}` busts the browser + CDN cache so the new image
  // shows up immediately without users needing to hard-refresh.
  const url = `${new URL(config.siteUrl).origin}/${path}?v=${uploadedAt}`;

  return { path, url, uploadedAt };
}

// Best-effort DELETE on the Flexweg side. Swallows 404s (file already
// gone) and logs other errors without throwing — the caller's
// follow-up user-record clear should still happen even if the file
// stays on disk (orphan file is a minor disk footprint, the UI is
// what matters).
export async function deleteAvatarOnFlexweg(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const config = await getFlexwegConfig();
  if (!config) return;
  try {
    const url = `${config.apiBaseUrl}/files/delete?${new URLSearchParams({ path })}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "X-API-Key": config.apiKey },
    });
    if (!res.ok && res.status !== 404) {
      const detail = await res.text().catch(() => "");
      console.warn("Flexweg avatar delete failed", res.status, detail);
    }
  } catch (err) {
    console.warn("Flexweg avatar delete failed", err);
  }
}
