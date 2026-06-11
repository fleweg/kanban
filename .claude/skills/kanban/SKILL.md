---
name: kanban
description: Expert guide for the Flexweg Kanban — a static React + Vite + TypeScript SPA with two interchangeable backends (Firebase / Flexweg SQLite), runtime config via window.__FLEXWEG_CONFIG__, HashRouter, committed dist/, Firestore real-time subscriptions, SVAR Gantt integration, dependency cascade, team partitioning, sprint lifecycle and Flexweg Files API attachments. Use when working anywhere in this repo: editing components/pages/services/hooks, adding a backend, debugging Gantt or sprints, touching auth or attachments, or shipping the dist/ artifact.
---

# Flexweg Kanban Skill

Static **React 19 + Vite + TypeScript (`strict`)** SPA. Single source of truth for domain shapes: [src/types.ts](../../../src/types.ts). All paths in this file are relative to repo root.

## When to use this skill

- Editing anything under `src/` (components, pages, services, hooks, context, lib, i18n)
- Adding a backend, or extending Firebase / Flexweg SQLite parity
- Working on the SVAR Gantt page or the dependency cascade
- Touching the sprint lifecycle, workflow config, teams, or epics
- Debugging auth (Firebase Auth or the SQLite Auth API)
- Anything involving the Flexweg Files API (attachments + `config.js` upload)
- Shipping changes (the `dist/` is the deploy artifact and lives in git)

## Hard constraints

- **TypeScript `strict`** + `noUnusedLocals` + `noUnusedParameters`. The TS compiler is the only static-analysis pass — there is no linter, no formatter, no test runner. **Don't invent one.**
- **Always `npm run build` after a source change** and commit the regenerated `dist/`. Hosting only serves static files; no SPA fallback, no Node on the server.
- `vite.config.ts` sets `base: "./"` and the app uses **`HashRouter`** so routes live in the URL fragment. Don't switch to `BrowserRouter` — would break Flexweg subpath hosting and `file://` previews.
- **No Cloud Functions, no Firebase Storage.** Attachments go through the **Flexweg Files API**.
- **No backend.** The Flexweg API key is shipped to the browser intentionally (documented compromise in [CLAUDE.md](../../../CLAUDE.md) → *API key handling*). Don't reuse this pattern for a public app.
- UI strings on translated components go through `t()` from `react-i18next` and must exist in **all 7 locale bundles** (`en, fr, de, es, nl, pt, ko`). `en.json` is the source of truth.
- Path aliases: none. Use relative imports.
- Icons: `lucide-react` only.
- Styling: Tailwind utility classes + `clsx`. No CSS modules.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server at http://localhost:5173 |
| `npm run typecheck` | `tsc --noEmit` (runs automatically as `prebuild`) |
| `npm run build` | Type-check then static build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |

`.env` is **optional**. If `VITE_FIREBASE_*` + `VITE_ADMIN_EMAIL` are set, Vite bakes them in. If empty, the in-app **SetupForm** runs on first load and writes `<folder>/config.js` to the Flexweg site.

## Architecture (the 3 layers)

```
src/
├── types.ts                       Domain shapes — Ticket, Sprint, Workflow, UserRecord, Team, …
├── lib/                           Pure helpers (no IO): dependencies.ts, teams.ts, utils.ts, …
├── context/AppDataContext.tsx     Composes hooks → one provider; pre-derives team slices
├── hooks/                         use{Tickets,Sprints,Workflow,Users}.ts — wrap subscribe* services
├── services/
│   ├── firebaseClient.ts          Firebase SDK init (cached)
│   ├── flexwegConfig.ts           Firestore-stored Flexweg API key (Firebase-mode only)
│   ├── firebase/                  Firestore-backed implementations
│   ├── flexweg-sqlite/            SQLite-backed implementations (same signatures)
│   └── tickets.ts, sprints.ts…    THIN DISPATCHERS — read getBackendKind() at module load
├── pages/                         One per route
├── components/
│   ├── layout/                    Sidebar + Topbar + AppLayout
│   ├── kanban/                    KanbanBoard, columns
│   ├── tickets/                   TicketCard, TicketModal, Checklist, Attachments
│   ├── users/                     UserAvatar, UserPicker
│   ├── epics/EpicChip.tsx
│   └── ui/                        Reusable primitives (RichTextEditor, LocaleSwitcher, …)
└── i18n/                          en/fr/de/es/nl/pt/ko + index.ts
```

### Backend dispatch (the most important non-obvious bit)

`src/services/<feature>.ts` is a **dispatcher** that reads `getBackendKind()` at **module-load time** and re-exports from `firebase/` or `flexweg-sqlite/`. Choice is fixed for the page lifetime — switching backend requires a reload (Settings → Backend triggers it).

**Adding a backend** = create a sibling `src/services/<backend>/` exposing the same signatures, then branch each dispatcher. **Don't add a `useBackend()` runtime hook** — both paths would be instantiated and the listener/poller costs differ.

**Hooks and components import only from the dispatcher**, never from the implementation folders. They must stay backend-agnostic.

### Firestore boundary

`onSnapshot` subscriptions live exclusively in `src/services/<feature>.ts` (Firebase mode). Pages and components **must not import `firebase/firestore` directly**. Hooks return `{ data, loading, error }`; `AppDataContext` composes them — pages call `useAppData()` only (calling `useTickets()` directly creates duplicate listeners).

Mutations are plain async functions exported from the service files. `serverTimestamp()` for writes; `writeBatch` where atomicity matters.

### SQLite mode specifics

- HTTP wrapper: [src/services/flexweg-sqlite/client.ts](../../../src/services/flexweg-sqlite/client.ts) — `sqlQuery / sqlExec / sqlBatch / sqlVersion`, sends `X-Sqlite-Token` always, plus `X-Sqlite-User-Token` when logged in. Global `onUnauthorized` hook wipes session on 401.
- User auth: [src/services/flexweg-sqlite/userAuth.ts](../../../src/services/flexweg-sqlite/userAuth.ts) wraps the SQLite Auth API. Errors come back as `SqliteApiError`; map them via `describeAuthError()`.
- Session glue: [src/services/flexweg-sqlite/auth.ts](../../../src/services/flexweg-sqlite/auth.ts) emulates Firebase's `subscribeToAuth` shape; identity exposed as a `FirebaseUser` cast.
- **Real-time = polling** `/version` every ~4 s ([subscriptions.ts](../../../src/services/flexweg-sqlite/subscriptions.ts)) — single shared poller, fans out to subscribers on version bump.
- Schema: idempotent `CREATE TABLE IF NOT EXISTS` in [schema.ts](../../../src/services/flexweg-sqlite/schema.ts); JSON columns for `tickets.checklist` and `tickets.attachments`.
- **First user = admin** is enforced server-side in static-host's `SqliteAuthService::registerUser`. **No client-side admin-promotion logic** — the local `users` table is a UI cache populated by `ensureSelfUserRecord` on each login.

### Runtime config & first-run setup

Resolver: [src/lib/runtimeConfig.ts](../../../src/lib/runtimeConfig.ts) → `getRuntimeConfig()` checks (1) `window.__FLEXWEG_CONFIG__` (set synchronously by `/config.js` loaded before the bundle), then (2) `import.meta.env.VITE_*`, caches result. [src/services/firebase.ts](../../../src/services/firebase.ts) reads exclusively through this — **no direct `import.meta.env` access** elsewhere.

[App.tsx](../../../src/App.tsx) short-circuits to `<SetupForm />` when the resolver returns `null`. SetupForm flow has two paths (Firebase or SQLite); both end by `uploadConfigJs` writing `<folder>/config.js` to the Flexweg site. Folder auto-detected via `window.location.pathname` ([src/lib/adminBase.ts](../../../src/lib/adminBase.ts)). Setup helpers in [src/lib/setupApi.ts](../../../src/lib/setupApi.ts) are intentionally separate from the regular API modules (no Firestore yet during install).

### Sprint lifecycle

Only **one `active` sprint per team**. Enforced by `where("status","==","active").where("teamId","==",X)` precheck in `createSprint` and `endSprintAndStartNext`. Two end paths in [src/services/sprints.ts](../../../src/services/sprints.ts):

- `endSprintAndStartNext` → creates next sprint, moves unfinished tickets across (keeping their column), marks old sprint completed.
- `endSprintToBacklog` → unfinished tickets get `sprintId: null, status: null`.

**Always read `completedColumnId` from the live workflow** — never hardcode column ids.

### Workflow

[src/config/defaultWorkflow.json](../../../src/config/defaultWorkflow.json) seeds `config/workflow`. `validateWorkflow` in [src/services/workflow.ts](../../../src/services/workflow.ts) enforces unique column ids and that `completedColumnId` matches one. If a ticket's `status` references a deleted column, the board **falls back to the first column** — preserve that fallback rather than crashing.

### Teams (project-level partition)

`Ticket.teamId`, `Sprint.teamId`, `UserRecord.teamIds`. Default team id `general` is non-deletable, acts as lazy-fallback for legacy rows. Boot migration is idempotent via `config/migrations.teamBackfillAt` (Firebase) or `config["team_backfill_done_at"]` (SQLite). Current team lives in `AppDataContext` (`currentTeamId`, persisted in `localStorage.kanbanCurrentTeam`). All pages should consume `currentTeam*` slices (`currentTeamTickets`, `currentTeamSprints`, …). **Backward-compat alias**: `useAppData().activeSprint` = `currentTeamActiveSprint`; prefer the explicit slice in new code.

Moving a ticket between teams clears `sprintId + status` in the same write (`moveTicketToTeam`). The modal confirms before doing this if the ticket was in an active sprint.

### Epics

Epic = ticket with `type === "epic"`. Same collection, comments, rules. The service layer **rejects `sprintId`, `status`, and `epicId` for epics**. `AppDataContext` splits `tickets` into `epics` + `nonEpicTickets`; the board derives from the latter so epics never reach Kanban.

Chip color = deterministic djb2 hash of the epic id; soft palette inlined in [EpicChip](../../../src/components/epics/EpicChip.tsx) because Tailwind can't generate dynamic class names. Dangling `epicId` is silently hidden (no cascade on epic delete).

### Dependencies & cascade

Implicit **finish-to-start** (no lag). [src/lib/dependencies.ts](../../../src/lib/dependencies.ts) exposes:

- `dependenciesAreCyclic(tickets, sourceId, candidateDepId)` — DFS cycle check at insertion. Cycle candidates are hidden from `DependenciesPicker`.
- `computeShiftFromDependencies(ticket, byId)` — `{ startDate, dueDate }` patch to satisfy deps (preserves duration).
- `cascadeFromChangedTicket(tickets, changedId, override?)` — BFS through dependents, ordered patch list.

Cascade triggers: TicketModal submit (when dates/deps change), Gantt `onUpdateTask` (drag-end), Gantt `onAddLink` (drag-to-create). `onDeleteLink` parses composite link id `"link:<source>-><target>"` and removes — no cascade (removing a constraint never trips the chain).

**Epics never appear as cascade sources** — they have no stored `dueDate` (derived). A ticket may still list an epic in `dependencies`; the entry just contributes nothing.

Deleting a ticket strips its id from every other ticket's `dependencies` (Firebase: `arrayRemove`; SQLite: `LIKE '%"id"%'` scan + rewrite).

### Gantt view (SVAR `@svar-ui/react-gantt`)

[GanttPage](../../../src/pages/GanttPage.tsx). Key invariants:

- **Children win for epic dates.** Epic bar spans `min start → max end` of dated children. Epic's own dates are fallback only.
- **Epic progress = simple average of all children's progress** (dated or not). We disable SVAR's `autoProgress: true` (it only counts visible/dated rows) and set the rollup `progress` ourselves on the summary row.
- **Auto-progress on status change**: `autoProgressForStatus` in [src/lib/utils.ts](../../../src/lib/utils.ts) — moving into `completedColumnId` snaps to 100, first column to 0, intermediate columns preserve manual value. Applied in `KanbanBoard` drag handler, `BacklogPage.moveToSprint`, `TicketModal` submit.

**Two SVAR gotchas we worked around** (do not break these):

1. **Stable `tasks` prop + imperative API sync.** Page captures `initialTasks` once per `scope|onlyEpics|zoom` key. Subsequent edits dispatched via `api.exec("update-task" | "add-task" | "delete-task", { ..., eventSource: "<action-name>", skipUndo: true })`. **`eventSource` MUST equal the action name** — that's the documented fast-path; without it the slow recompute runs and grid panel width resets. `onUpdateTask` ignores events whose `eventSource` matches our actions to break the loop. Same pattern for **links** (`add-link` / `delete-link`).
2. **DOM-side width restore.** Even fast-path re-emits the store; columns selector returns a fresh ref, `H(ne)` resets panel width. Workaround: capture `.wx-table-container.offsetWidth` before each sync, reapply via inline style + `flex-basis`/`flex-grow:0`/`flex-shrink:0` in `requestAnimationFrame` after dispatch.

If bumping the SVAR version, re-check `node_modules/@svar-ui/gantt-store/dist/index.js` — the fast-path string match and init `useEffect` deps are the load-bearing structures.

**TS quirk**: `columns: false` collapses to `never`. Pass `columns={false as unknown as []}` if hiding entirely. We ship one `{ id: "text", header: "Name", width: 260 }` column instead.

**Theming**: wrap in `<Willow>` / `<WillowDark>`. Summary bar bg/fill defaults have ~no contrast — overridden in `.kanban-gantt-host .wx-willow-theme, .wx-willow-dark-theme` because SVAR sets the vars on the theme wrapper.

### Drag & drop ordering

Tickets carry numeric `order` (descending = top). `computeNewOrder` in [src/lib/utils.ts](../../../src/lib/utils.ts) picks the midpoint between visual neighbors (or ±1000 at extremities). `reorderTicket` writes a single `updateDoc` (status + order for cross-column drops). Tickets pre-dating this feature: `effectiveOrder()` falls back to `createdAt.toMillis()`. Same-slot drops (`source.index === destination.index`) are a no-op.

### Comments

Subcollection `tickets/{ticketId}/comments` (not array — 1 MB doc limit + per-ticket listener scope). Posts use `writeBatch`: comment write + `tickets/{id}.commentCount` increment in one atomic op. Threading is **one level deep**; replies whose parent was deleted bubble up to top-level. **Soft delete only** (`deleted: true`, blank `body`) — rules forbid `delete`. URLs in bodies tokenized via `tokenizeForLinks`; **no markdown** (XSS surface minimisation).

### Rich text descriptions

TipTap-based, stored as **HTML strings** on the ticket doc. TipTap's parse step acts as the whitelist on load — descriptions are never rendered as raw HTML outside the editor (cards use `htmlToPlainText`). Legacy plain-text values are wrapped in `<p>` and `\n` → `<br>` by `normalizeContent` in [RichTextEditor](../../../src/components/ui/RichTextEditor.tsx).

### Checklist

Stored as `checklist: ChecklistItem[]` on the ticket doc (short by design). Single setter `updateChecklist(id, items)` replaces the whole array. **The Checklist component must read the live ticket** via `useAppData().tickets.find(...)`, not the prop snapshot, otherwise modal edits don't reflect (same pattern reused for the Attachments tab badge).

### Attachments (Flexweg Files API)

- Files ≤ 10 MB. Whitelist constrained to what Flexweg accepts: **images, PDF, fonts, text/code** (HTML/CSS/JS/JSON/XML/TXT/MD/CSV). **No Office, no archives, no video** — would 4xx.
- Path: `attachments/{ticketId}/{attachmentId}-{filename}`. Public URL: `${siteUrl}/${path}` (bare, no token, no expiry).
- Metadata on `tickets/{id}.attachments[]` so list reads without secondary fetches.
- [src/services/attachments.ts](../../../src/services/attachments.ts) is the only Firebase-mode caller. Upload: base64 via `FileReader` → POST `/api/v1/files/upload` with `X-API-Key` → `arrayUnion` metadata. Progress is **milestone-based** (encoding → uploading → persisting), not byte-level.
- Delete: `DELETE /api/v1/files/delete?path=...` first (best-effort, swallow 404), then `arrayRemove`.
- `deleteTicket` iterates known `attachments[]` to delete each — no `list` API call.
- SQLite mode mirrors the same impl in [src/services/flexweg-sqlite/attachments.ts](../../../src/services/flexweg-sqlite/attachments.ts); reads the master Flexweg key from the SQLite `config` table (persisted during install).
- **API key is shipped to the browser intentionally** (see Hard constraints). Don't reuse this pattern for a public app.

### Auth (Firebase mode)

[AuthContext](../../../src/context/AuthContext.tsx) wraps everything; spinner until first `onAuthStateChanged` resolves (avoids flashing the login during session restore).

**Bootstrap admin** = `getRuntimeConfig().adminEmail` (from `.env` or uploaded `config.js`). Treated as admin without a `users/{uid}` record. **Firestore rules duplicate this email** — changing the bootstrap admin = update the runtime source AND the rules.

Other members: `users` collection (`{ email, role, disabled, createdAt, createdBy }`). On first sign-in, `ensureSelfUserRecord` self-creates the record with `role: "user"` (rules allow self-create with that exact shape only). **Auth account creation is manual in the Firebase Console** — explicitly avoided the secondary-app workaround.

`AuthenticatedShell` ensures `<AppDataProvider>` only mounts when a non-disabled user is authenticated — Firestore subscriptions never fire before auth is ready. `<RequireAdmin>` guards `/users`.

## Conventions

- Domain types → [src/types.ts](../../../src/types.ts). Don't sprinkle `as Ticket` casts; cast only at the Firestore boundary inside `services/`.
- Write payloads use the `FirestoreTime = Timestamp | FieldValue` union because `serverTimestamp()` returns a sentinel.
- Collection / doc names: `collections` + `configDocs` exports of [src/services/firebase.ts](../../../src/services/firebase.ts) — don't hardcode strings.
- `.tsx` for components/pages, `.ts` for services/hooks/utils/types.
- Tailwind `content` glob covers `.{js,jsx,ts,tsx}` — no special tooling needed for new files.
- i18n persistence is browser-scoped (`localStorage.kanbanLocale`). If team-wide locale becomes a requirement, mirror the CMS sibling's `setUserPreferences` pattern (not done today).

## Things NOT to do

- ✗ Import `firebase/firestore` from pages or components (only services may).
- ✗ Call `useTickets()` / `useSprints()` from pages — go through `useAppData()` to avoid duplicate listeners.
- ✗ Add a `useBackend()` runtime hook — keep dispatch at module load.
- ✗ Hardcode the "done" column id — read `completedColumnId` from the live workflow.
- ✗ Make epics reachable on the Kanban board — they're stripped at `AppDataContext` level.
- ✗ Add a cascade source for epics — their `dueDate` is derived (children win).
- ✗ Pass a fresh `tasks` array to `<Gantt>` on every render — use the stable `initialTasks` snapshot + `api.exec(..., { eventSource: <action-name> })` fast-path.
- ✗ Forget to commit `dist/` after a source change — the deploy is the artifact.
- ✗ Switch to `BrowserRouter` — breaks Flexweg subpath hosting and `file://`.
- ✗ Add Cloud Functions / Firebase Storage / a backend — out of scope.
- ✗ Use `import.meta.env` outside [src/services/firebase.ts](../../../src/services/firebase.ts) — go through `getRuntimeConfig()`.
- ✗ Upload Office docs, archives, or video as attachments — Flexweg rejects them.
- ✗ Add a markdown parser for comments — `tokenizeForLinks` is the contract.
- ✗ Hard-delete a comment — soft delete only (`deleted: true`, blank body).
- ✗ Add a linter / formatter / test runner — `tsc --noEmit` is the static-analysis pass.
- ✗ Read from the SetupForm modules (`src/lib/setupApi.ts`) after install — they're dormant by design.

## Things to do

- ✓ Add new domain shapes to [src/types.ts](../../../src/types.ts).
- ✓ Backend parity: every change in `services/firebase/*` must have a matching change in `services/flexweg-sqlite/*` (same signatures).
- ✓ New UI strings → `t()` + key added to all 7 `src/i18n/*.json` (English source of truth).
- ✓ Reorder/move tickets → `computeNewOrder` + `reorderTicket` (single write).
- ✓ Auto-progress on status change → `autoProgressForStatus` (already wired in KanbanBoard, BacklogPage, TicketModal).
- ✓ Gantt edits → `api.exec("update-task" | "add-task" | "delete-task" | "add-link" | "delete-link", { eventSource: "<same>", skipUndo: true })`.
- ✓ Settings touches Flexweg key (Firebase mode) → write through `setFlexwegConfig` to `config/flexweg`.
- ✓ Run `npm run build` before considering a change shippable; commit the regenerated `dist/`.
- ✓ When adding a route, mount it inside [AppLayout](../../../src/components/layout/AppLayout.tsx) (under `<AuthenticatedShell>`) so `AppDataProvider` is available.

## Quick reference

| Question | Answer |
| --- | --- |
| Who is admin? | Bootstrap = `getRuntimeConfig().adminEmail`; others = `users/{uid}.role === "admin"`. |
| Where is the workflow defined? | Firestore `config/workflow`, seeded from [src/config/defaultWorkflow.json](../../../src/config/defaultWorkflow.json). |
| How many active sprints? | One **per team**. Enforced at `createSprint` / `endSprintAndStartNext`. |
| Where does ticket ordering live? | `Ticket.order` (descending = top); fallback `createdAt.toMillis()` via `effectiveOrder()`. |
| Where are attachments stored? | Flexweg site, path `attachments/{ticketId}/...`. Metadata on `tickets/{id}.attachments[]`. |
| How is real-time done in SQLite mode? | Polling `/version` every ~4 s, single shared poller. |
| How to add a backend? | Sibling `src/services/<backend>/` with same signatures + branch in each dispatcher. |
| Where to change the bootstrap admin? | Runtime source (`.env` or uploaded `config.js`) AND Firestore rules. |
