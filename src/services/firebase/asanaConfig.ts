import { doc, getDoc, setDoc } from "firebase/firestore";
import { collections, getDb } from "../firebaseClient";
import type { AsanaConfig } from "../asanaConfig";

// `AsanaConfig` is type-only — keeps the runtime import graph acyclic
// with the top-level dispatcher.

// We hardcode the config doc id rather than extending `configDocs` to
// avoid a dependency in firebaseClient.ts (which is loaded very early
// in the boot sequence and should stay free of feature-specific names).
const ASANA_DOC_ID = "asana";

const asanaDocRef = () => doc(getDb(), collections.config, ASANA_DOC_ID);

export async function getAsanaConfig(): Promise<AsanaConfig | null> {
  const snap = await getDoc(asanaDocRef());
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<AsanaConfig> | undefined;
  if (!data) return null;
  // Persisted shape mirrors the public type — nothing to normalize
  // except defaulting `enabled` and stripping non-string GIDs.
  return {
    enabled: data.enabled === true,
    accessToken: typeof data.accessToken === "string" ? data.accessToken : "",
    statusFieldGid:
      typeof data.statusFieldGid === "string" && data.statusFieldGid.trim()
        ? data.statusFieldGid.trim()
        : undefined,
    statusMap: data.statusMap && typeof data.statusMap === "object" ? data.statusMap : undefined,
  };
}

export async function setAsanaConfig(next: AsanaConfig): Promise<void> {
  await setDoc(asanaDocRef(), {
    enabled: next.enabled,
    accessToken: next.accessToken,
    statusFieldGid: next.statusFieldGid ?? null,
    statusMap: next.statusMap ?? null,
  });
}
