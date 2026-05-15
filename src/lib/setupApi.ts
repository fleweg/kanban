// Minimal Flexweg API helpers used during the first-run SetupForm
// flow. We can't reuse services/flexwegConfig.ts here because that
// module pulls credentials from `config/flexweg` in Firestore, which
// doesn't yet exist when the kanban is being configured for the first
// time. So we accept the credentials as explicit arguments and call
// fetch directly.
//
// Both helpers are read-light (storage-limits is a single GET,
// uploadConfigJs is a single POST) — no shared error funnel needed;
// the SetupForm renders its own inline error states.

import { withAppBase } from "./adminBase";

export interface SetupFlexwegConfig {
  apiKey: string;
  siteUrl: string;
  apiBaseUrl: string;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export class SetupApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SetupApiError";
  }
}

// Pings the Flexweg storage-limits endpoint to verify the provided
// API key is valid. Throws SetupApiError on HTTP failure (with the
// status code) or rethrows the original Error on network/CORS/abort.
export async function testFlexwegConnection(
  config: SetupFlexwegConfig,
  signal?: AbortSignal,
): Promise<void> {
  const base = stripTrailingSlash(config.apiBaseUrl);
  const res = await fetch(`${base}/files/storage-limits`, {
    method: "GET",
    headers: { "X-API-Key": config.apiKey },
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SetupApiError(
      body.length > 0 ? body.slice(0, 240) : `HTTP ${res.status}`,
      res.status,
    );
  }
}

// Uploads `<folder>/config.js` to Flexweg with the provided
// credentials. The folder is auto-detected via withAppBase so the
// kanban can be deployed at any path on Flexweg. Used only by the
// SetupForm; subsequent updates would go through the regular
// flexwegConfig.ts module since the Firestore config will be live
// after the first run.
export async function uploadConfigJs(
  config: SetupFlexwegConfig,
  source: string,
  signal?: AbortSignal,
): Promise<void> {
  const base = stripTrailingSlash(config.apiBaseUrl);
  const res = await fetch(`${base}/files/upload`, {
    method: "POST",
    headers: {
      "X-API-Key": config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path: withAppBase("config.js"),
      content: source,
      encoding: "utf-8",
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SetupApiError(
      body.length > 0 ? body.slice(0, 240) : `HTTP ${res.status}`,
      res.status,
    );
  }
}
