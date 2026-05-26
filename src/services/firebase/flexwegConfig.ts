import { doc, getDoc, setDoc } from "firebase/firestore";
import { collections, configDocs, getDb } from "../firebaseClient";
import type { FlexwegConfig } from "../flexwegConfig";

// `FlexwegConfig` is intentionally imported as a type-only reference
// from the top-level dispatcher to keep the runtime import graph
// acyclic (the dispatcher imports this file, so we mustn't import the
// runtime values back from it).

const flexwegDocRef = () => doc(getDb(), collections.config, configDocs.flexweg);

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export const DEFAULT_FLEXWEG_API_BASE_URL = "https://www.flexweg.com/api/v1";

export async function getFlexwegConfig(): Promise<FlexwegConfig | null> {
  const snap = await getDoc(flexwegDocRef());
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<FlexwegConfig> | undefined;
  if (!data?.apiKey || !data?.siteUrl) return null;
  return {
    apiKey: data.apiKey,
    siteUrl: stripTrailingSlash(data.siteUrl),
    apiBaseUrl: stripTrailingSlash(data.apiBaseUrl ?? DEFAULT_FLEXWEG_API_BASE_URL),
  };
}

export async function setFlexwegConfig(next: FlexwegConfig): Promise<void> {
  await setDoc(flexwegDocRef(), {
    apiKey: next.apiKey,
    siteUrl: stripTrailingSlash(next.siteUrl),
    apiBaseUrl: stripTrailingSlash(next.apiBaseUrl || DEFAULT_FLEXWEG_API_BASE_URL),
  });
}
