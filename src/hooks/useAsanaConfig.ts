import { useEffect, useState } from "react";
import { getAsanaConfig, type AsanaConfig } from "../services/asanaConfig";

// Lightweight React hook around `getAsanaConfig()`. Returns the cached
// config snapshot or null while loading / when no config exists. We
// intentionally do NOT subscribe to live changes — the connector is an
// admin-only setting that gets read on demand by components, not a
// reactive source of truth. Save-and-reload is the expected path when
// flipping `enabled` mid-session.
//
// Multiple hook instances share the same module-level promise so the
// modal + the kanban board don't double-fetch on first render.
let inflight: Promise<AsanaConfig | null> | null = null;
let cached: AsanaConfig | null = null;
let cacheLoaded = false;

export function invalidateAsanaConfigCache(): void {
  cached = null;
  cacheLoaded = false;
  inflight = null;
}

async function loadAsanaConfig(): Promise<AsanaConfig | null> {
  if (cacheLoaded) return cached;
  if (!inflight) {
    inflight = getAsanaConfig().then((cfg) => {
      cached = cfg;
      cacheLoaded = true;
      inflight = null;
      return cfg;
    });
  }
  return inflight;
}

export function useAsanaConfig(): AsanaConfig | null {
  const [cfg, setCfg] = useState<AsanaConfig | null>(cached);
  useEffect(() => {
    let alive = true;
    loadAsanaConfig().then((c) => {
      if (alive) setCfg(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}
