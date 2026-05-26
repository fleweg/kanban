// Backend dispatcher for the Flexweg API config store.
//
// In Firebase mode the config lives in Firestore at `config/flexweg`
// (admin-write, all-active-users-read). In SQLite mode it lives in
// the local SQLite `config` table under the key "flexweg" (same
// admin/user gating, but enforced server-side by the SQLite Auth API
// rather than Firestore rules).

import { getBackendKind } from "../lib/runtimeConfig";
import * as firebase from "./firebase/flexwegConfig";
import * as sqlite from "./flexweg-sqlite/flexwegConfig";

export interface FlexwegConfig {
  // Permanent API key generated in Flexweg account → API. Used by the
  // attachments service to upload to `/api/v1/files/*`. Visible to any
  // authenticated user via devtools — same exposure level in both
  // backends. Documented compromise for internal-tool use only.
  apiKey: string;
  // Public base URL where uploaded files are served, e.g.
  // "https://your-site.flexweg.com" (no trailing slash). Used to build
  // download URLs as `${siteUrl}/${storagePath}`.
  siteUrl: string;
  // API base URL, e.g. "https://www.flexweg.com/api/v1" (no trailing
  // slash). Configurable so a future host change doesn't require a
  // redeploy.
  apiBaseUrl: string;
}

const impl = getBackendKind() === "flexweg-sqlite" ? sqlite : firebase;

export const DEFAULT_FLEXWEG_API_BASE_URL = impl.DEFAULT_FLEXWEG_API_BASE_URL;
export const getFlexwegConfig = impl.getFlexwegConfig;
export const setFlexwegConfig = impl.setFlexwegConfig;
