// Resolves the Kanban app's folder name on the Flexweg deployment by
// inspecting the URL the page was loaded from. Used to prefix the
// `config.js` upload path during first-run setup so the file lands in
// the same folder as `dist/index.html` regardless of how the user
// named the folder (e.g. /kanban/, /tickets/, /erf34f654GH3/, …).
//
// Conventions:
//   /kanban/index.html              → "kanban"
//   /erf34f654GH3/index.html        → "erf34f654GH3"
//   /clients/acme/kanban/index.html → "clients/acme/kanban"
//   /                                → ""  (root deployment — supported,
//                                          the kanban is the whole site)

const INDEX_FILE_RE = /^index\.[a-z0-9]+$/i;

export function getAppFolder(): string {
  if (typeof window === "undefined") return "";
  const path = window.location.pathname;
  // Split on /, drop empty segments produced by leading/trailing /,
  // then drop a trailing index.html-like file if present (Vite preview
  // / dev server / Flexweg all serve directory URLs with or without
  // the explicit file).
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (last && INDEX_FILE_RE.test(last)) segments.pop();
  return segments.join("/");
}

// Prefixes a path with the detected app folder. Pass paths WITHOUT a
// leading slash (`config.js`, …). Returns the relative Flexweg API
// path (e.g. `kanban/config.js`, or just `config.js` if the kanban
// lives at the site root).
//
// Unlike the CMS sibling, root deployment is allowed here — the kanban
// IS the whole site (no public-facing pages to pollute), so dropping
// dist/ at the Flexweg root works fine.
export function withAppBase(relativePath: string): string {
  const folder = getAppFolder();
  const clean = relativePath.replace(/^\/+/, "");
  return folder ? `${folder}/${clean}` : clean;
}
