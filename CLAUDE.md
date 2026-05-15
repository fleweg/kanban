# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static React + Vite SPA written in **TypeScript** (`strict` mode), backed by Firebase Firestore (data) and Firebase Auth (email/password gate). Ticket attachments are uploaded to the Flexweg site via its Files API — **not** Firebase Storage (which requires the paid Blaze plan). No Cloud Functions. Implements a backlog, single-active-sprint workflow, and a configurable Kanban board.

The built `dist/` directory is **committed to the repo** and is the deploy artifact — hosting only requires serving static files (no npm/Node on the server, no SPA fallback config). [vite.config.ts](vite.config.ts) sets `base: "./"` so all asset paths are relative; the SPA uses `HashRouter` so routes live in the URL fragment (`#/sprint`, `#/backlog`, …) and any host that simply serves `index.html` works — including subpaths and `file://`. After any source change you must `npm run build` and commit the regenerated `dist/`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server at http://localhost:5173 |
| `npm run typecheck` | `tsc --noEmit` — runs automatically before `build` via `prebuild` |
| `npm run build` | Type-check then static production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |

There is no test runner, linter, or formatter wired up — don't invent one. The TypeScript compiler is the only static analysis pass; a build that doesn't typecheck won't produce a bundle.

`.env` is **optional**: the app can also be configured at runtime through the in-app first-run **SetupForm** (see "Runtime config & first-run setup" below). If the developer has `VITE_FIREBASE_*` + `VITE_ADMIN_EMAIL` filled in `.env`, Vite bakes them into the bundle and the SetupForm never shows. If `.env` is empty (typical for a fresh `dist/` dropped on Flexweg by a non-developer), the app renders the SetupForm on first load and writes a populated `<folder>/config.js` to Flexweg on success — every browser thereafter reads the config from that file synchronously before the bundle boots.

## Runtime config & first-run setup

The app reads its Firebase config + admin email through one resolver that converges two sources of truth:

1. **`window.__FLEXWEG_CONFIG__`** — set synchronously by `/config.js` (loaded via a plain `<script>` in `index.html` *before* the main bundle). The bundled `public/config.js` ships as `window.__FLEXWEG_CONFIG__ = null;` — the SetupForm rewrites it on Flexweg with real values once the user fills the form.
2. **`import.meta.env.VITE_FIREBASE_*` + `VITE_ADMIN_EMAIL`** — Vite-injected from `.env` at build time (or served live during `npm run dev`). Legacy / dev path.

[src/lib/runtimeConfig.ts](src/lib/runtimeConfig.ts) exposes `getRuntimeConfig()` which checks (1), then (2), and caches the result. [src/services/firebase.ts](src/services/firebase.ts) reads exclusively through this resolver — no direct `import.meta.env` access remains. [src/App.tsx](src/App.tsx) short-circuits to `<SetupForm />` (skipping `<AuthProvider>` etc.) when the resolver returns `null`.

The SetupForm flow ([src/pages/SetupForm.tsx](src/pages/SetupForm.tsx)) is a three-step wizard:

1. **Welcome** — primes the user on the Firebase + Flexweg prerequisites and links to the official Firebase setup guide.
2. **Firebase** — collects the 6 web-app config fields + bootstrap admin email + password, then:
   1. `initFirebaseFromSetup` populates `window.__FLEXWEG_CONFIG__` + initialises the SDK with the form's values (so subsequent Firestore writes see the same instance).
   2. `signInWithEmailAndPassword` validates the credentials against Firebase Auth.
   3. Email match: confirms `auth.currentUser.email === form.adminEmail` (catches typos).
   4. Transitions to the Flexweg sub-step; no Firestore or Flexweg write yet, so users can bail without leaving stale state.
3. **Flexweg** — collects Flexweg API key + site URL + API base URL, then:
   1. `testFlexwegConnection` pings `/files/storage-limits` to verify the key.
   2. Writes `config/flexweg` to Firestore so the attachments service works out of the box — the admin doesn't have to revisit Settings to wire up uploads.
   3. `uploadConfigJs` writes a serialised `window.__FLEXWEG_CONFIG__ = {…}` to `<folder>/config.js` on Flexweg. The folder is auto-detected from `window.location.pathname` via [src/lib/adminBase.ts](src/lib/adminBase.ts), so the kanban can live at any path on the Flexweg site (`/kanban/`, `/tickets/`, `/erf34f654GH3/`, or even the site root).
   4. Reloads with a cache-buster (`?_setup=<timestamp>`) — next boot fetches the freshly-uploaded `config.js`, the resolver picks the values up via `readFromGlobal()`, and the app boots into the normal authenticated path.

The setup helpers in [src/lib/setupApi.ts](src/lib/setupApi.ts) are intentionally separate from [src/services/attachments.ts](src/services/attachments.ts) / [src/services/flexwegConfig.ts](src/services/flexwegConfig.ts): those modules resolve the Flexweg API key from Firestore (`config/flexweg`), which doesn't yet exist during first-run setup. The setup helpers accept the credentials as explicit arguments and call `fetch` directly. After setup completes and the admin reloads, every Flexweg call goes through the regular modules again — `setupApi.ts` is dormant for the lifetime of the deployment.

The kanban is **Flexweg-only by design**. Other static hosts (Vercel, Netlify, GitHub Pages) won't accept the `uploadConfigJs` POST, so the setup would fail. If you want to deploy elsewhere, bake `.env` at build time instead — the import-meta-env path bypasses the SetupForm entirely.

Env vars are typed in [src/vite-env.d.ts](src/vite-env.d.ts) (the `ImportMetaEnv` augmentation). Add new `VITE_*` entries there and `import.meta.env.VITE_FOO` becomes typed everywhere.

Firestore collections: `tickets`, `sprints`, `users`, and the `config/` collection holding `config/workflow` (Kanban columns) and `config/flexweg` (Flexweg API credentials, admin-writable only). Ticket attachments live on the Flexweg site at `attachments/{ticketId}/`. The README documents the Firestore security rules and the document shapes.

## Authentication

The app is gated behind Firebase Auth (email/password). [src/context/AuthContext.tsx](src/context/AuthContext.tsx) wraps everything; until the first `onAuthStateChanged` resolves, the app shows a spinner instead of the login page (otherwise we'd flash the login during session restoration from localStorage).

The **bootstrap admin** email is read from the runtime config (`getRuntimeConfig().adminEmail` via [src/services/firebase.ts](src/services/firebase.ts)`.getAdminEmail()`). The value comes from `.env` (`VITE_ADMIN_EMAIL`) when the build was configured locally, or from the populated `<folder>/config.js` uploaded by the SetupForm to Flexweg on first run. That account is treated as admin without needing a `users/{uid}` Firestore record — it solves the chicken-and-egg of needing an admin to bootstrap. The Firestore rules duplicate this email (rules can't read env vars or fetched files). Changing the bootstrap admin = update the runtime source AND the rules.

Other members are mirrored in a Firestore `users` collection (doc id = `auth.uid`, fields `{ email, role, disabled, createdAt, createdBy }`). On a new user's **first** sign-in, the client calls `ensureSelfUserRecord` which `setDoc`s their record with `role: "user"` (rules allow self-create with that exact shape only).

User lifecycle is intentionally split: the Firebase Auth account is created **manually in the Firebase Console** (the client SDK can't create another user without logging the admin out, and we explicitly avoided the secondary-app workaround). Everything else — role changes, disable/enable, password reset, removal — happens from the in-app `/users` page (admin-only). True deletion of an Auth account still requires a manual click in the console; the in-app "Remove" only deletes the Firestore record.

`AuthenticatedShell` in [src/App.tsx](src/App.tsx) ensures `<AppDataProvider>` only mounts when a non-disabled user is authenticated, so Firestore subscriptions never fire before auth is ready. `<RequireAdmin>` guards `/users`. Layout components ([Sidebar.tsx](src/components/layout/Sidebar.tsx) / [Topbar.tsx](src/components/layout/Topbar.tsx)) hide the Users link for non-admins and surface the Sign-out button + current user's email.

## Internationalisation

The admin UI ships translated into 7 locales — `en` (default), `fr`, `de`, `es`, `nl`, `pt`, `ko`. Resolution order at boot: `localStorage.kanbanLocale` → `navigator.language` two-letter prefix → `DEFAULT_LOCALE` (`en`). Changes flow through `setActiveLocale(locale)` in [src/i18n/index.ts](src/i18n/index.ts) which updates both i18next and localStorage.

All translation keys are in English; `en.json` is the source of truth and i18next falls back to it for any missing key. Adding a new locale = create `src/i18n/<code>.json` mirroring `en.json`'s structure, register it in [src/i18n/index.ts](src/i18n/index.ts) (`SUPPORTED_LOCALES`, `LOCALE_LABELS`, `LOCALE_FLAGS`, the `resources` block and `AppLocale` union).

UI strings in user-facing components go through `t()`. The SetupForm is fully translated; the rest of the app is being migrated incrementally — when adding a new string to a translated component, add the key to all 7 bundles to keep them in sync. [src/components/ui/LocaleSwitcher.tsx](src/components/ui/LocaleSwitcher.tsx) is a compact chip (flag + invisible native `<select>`) — drop it anywhere a user might want to switch language.

Persistence is browser-scoped (no `users/{uid}.preferences.adminLocale` field today, unlike the CMS sibling — kanban's user record stays `{ email, role, disabled, createdAt, createdBy }`). If team-wide locale becomes a requirement, add the field on the user record + a Firestore-rules clause and mirror the CMS's `setUserPreferences` flow.

## Architecture

### Domain types

All domain shapes live in [src/types.ts](src/types.ts) (`Ticket`, `Sprint`, `Workflow`, `WorkflowColumn`, `TicketComment`, `UserRecord`, `IssueType`, `Priority`, `ChecklistItem`, `Theme`, …). Add new fields here, not as ad-hoc `Record<string, unknown>`.

Firestore returns docs as `DocumentData`. Each `subscribeToX` service casts `{ id, ...data }` to the corresponding domain type at the boundary — this is the only place untyped Firestore data is mixed with the domain model. Don't sprinkle `as Ticket` casts elsewhere; if you need a different shape, extend the type or model the union explicitly.

Write payloads use the union `Timestamp | FieldValue` (`FirestoreTime` in `types.ts`) because `serverTimestamp()` returns a `FieldValue` sentinel, while reads always come back as `Timestamp`.

### Data flow: Firestore → hooks → context → pages

All reads are real-time `onSnapshot` subscriptions in `src/services/{tickets,sprints,workflow,users,comments}.ts`. Each service file is the single place that talks to Firestore for its collection — pages and components must not import `firebase/firestore` directly.

`src/hooks/use{Tickets,Sprints,Workflow,Users}.ts` wrap the subscribe functions and expose `{ data, loading, error }`. [src/context/AppDataContext.tsx](src/context/AppDataContext.tsx) composes the hooks into a single provider and pre-derives `backlogTickets` and `activeSprintTickets`. Pages consume everything via `useAppData()`; do not call the hooks directly from pages or you'll create duplicate Firestore listeners.

Mutations are plain async functions exported from the same service files (e.g. `createTicket`, `endSprintAndStartNext`). They use `serverTimestamp()` and `writeBatch` where atomicity matters. Components await these directly — there is no global mutation/dispatch layer.

### Sprint lifecycle (the non-obvious part)

Only one sprint can be `status: "active"` at a time. `createSprint` and `endSprintAndStartNext` enforce this with a `where("status", "==", "active")` precheck. Two end-of-sprint paths exist in [src/services/sprints.ts](src/services/sprints.ts):

- `endSprintAndStartNext` — creates the next sprint, then in a single batch reassigns every ticket whose `status !== completedColumnId` to the new sprint (keeping its column status) and marks the old sprint completed. Tickets in the completion column stay archived in the ended sprint.
- `endSprintToBacklog` — same filter, but unfinished tickets get `sprintId: null, status: null` instead.

`completedColumnId` comes from the workflow config, not from a hardcoded constant — always read it from the current workflow before deciding which tickets count as "done".

### Workflow configuration

The Kanban columns are data, not code. [src/config/defaultWorkflow.json](src/config/defaultWorkflow.json) seeds the `config/workflow` Firestore doc; users edit it from the Settings page. `validateWorkflow` in [src/services/workflow.ts](src/services/workflow.ts) enforces unique column ids and that `completedColumnId` matches one of them. When a ticket's `status` references a column id that no longer exists (e.g. user renamed it), the board falls back to the first column — preserve that fallback rather than crashing.

### Issue types & epics

Tickets carry a `type` field (`task` / `bug` / `story` / `epic`, default `task`) and an optional `epicId`. The type catalog is hardcoded in [src/lib/issueTypes.ts](src/lib/issueTypes.ts) — single source of truth for label, icon (lucide-react), text color and chip classes. To add a type, append to `ISSUE_TYPES`; nothing else needs touching. The `IssueType` literal union in [src/types.ts](src/types.ts) must stay in sync.

**Epic = ticket with `type === "epic"`** — same collection, same comments, same rules. The model rejects `sprintId`, `status`, and `epicId` for epics at the service layer ([src/services/tickets.ts](src/services/tickets.ts)). [AppDataContext](src/context/AppDataContext.tsx) splits the global `tickets` array into `epics` and `nonEpicTickets`; the backlog and active sprint lists derive from `nonEpicTickets`, so epics naturally never reach the Kanban board.

[EpicsPage](src/pages/EpicsPage.tsx) lives at `/epics`. It computes per-epic progress at render time by scanning all tickets — no denormalized counter (unlike `commentCount`) because the page is rarely viewed and the calculation is cheap. Each card opens the standard [TicketModal](src/components/tickets/TicketModal.tsx); the modal detects epic-type forms via `form.type === EPIC_TYPE` and conditionally hides Sprint/Status/Epic fields and switches the header label.

Epic chip color is deterministic per epic id (same djb2 hash approach as user avatars), so each epic gets a stable distinct color across cards. [EpicChip](src/components/epics/EpicChip.tsx) holds the soft palette inline because Tailwind cannot generate dynamic class names.

Deleting an epic leaves its children with a dangling `epicId`. The UI hides the broken chip (`getEpicById` returns null, `EpicChip` renders nothing). No cascade, no cleanup — admins can re-link manually if they want.

### Drag & drop ordering

Tickets carry a numeric `order` field; both the Kanban board and the [BacklogPage](src/pages/BacklogPage.tsx) sort by it descending (highest = top). New tickets are created with `order = Date.now()` so they default to the top. The active sprint board ([KanbanBoard](src/components/kanban/KanbanBoard.tsx)) and the backlog list each have their own `DragDropContext` from `@hello-pangea/dnd`.

On every drop, [`computeNewOrder`](src/lib/utils.ts) calculates the midpoint between the new visual neighbors (or `±1000` at an extremity) and [`reorderTicket`](src/services/tickets.ts) writes a single `updateDoc` (status + order together for cross-column drops on the Kanban board, order-only for same-list reorders).

Tickets that pre-date this feature lack `order`. The `effectiveOrder()` helper falls back to `createdAt.toMillis()` so they still sort coherently against new tickets — the first drag involving such a ticket persists a real `order`. No batch migration was needed.

The status field stores the column `id`, not its display name. Dropping into the same slot (`source.index === destination.index`) is a no-op.

### Ticket assignment & avatars

Tickets carry `createdBy` (immutable, set on creation) and `assigneeId` (nullable, editable). Both are user `uid`s; resolution to an email/avatar happens at render time via `getUserById()` exposed on `AppDataContext`. The `users` collection feeds both the avatar lookup and the assignee picker, so non-admin users need read-list access to it (rules: `allow list: if isActiveUser()`).

[src/components/users/UserAvatar.tsx](src/components/users/UserAvatar.tsx) renders a colored disc with initials. Color comes from a deterministic hash of the `uid` (`colorClassesFor` in [src/lib/utils.ts](src/lib/utils.ts)) — same user → same color everywhere. Initials are derived from the email's local part (no `displayName` field today; easy to add later by reading `record.displayName ?? record.email`). [UserPicker.tsx](src/components/users/UserPicker.tsx) is a bare `<select>` over active users with an "Unassigned" first option.

The bootstrap admin auto-creates their own `users/{uid}` record with `role: "user"` like everyone else (otherwise they couldn't be picked as an assignee). Their effective admin status still flows from the email match in `.env` + rules — the role field is irrelevant for the bootstrap admin. The Users page detects them by email and shows a "Bootstrap" badge, treats them as Admin, and disables destructive actions on their row.

### Comments

Each ticket has its own thread under the Firestore subcollection `tickets/{ticketId}/comments`. Subcollection (not an array on the ticket) so we don't hit the 1 MB doc limit and so listeners are scoped per-ticket — the board doesn't re-render when an unrelated ticket gets a comment.

[src/services/comments.ts](src/services/comments.ts) handles the writes through `writeBatch` so each post atomically writes the comment **and** increments `tickets/{id}.commentCount`. The denormalized counter is what the [TicketCard](src/components/tickets/TicketCard.tsx) reads to render the `💬 N` badge — no extra subscription per card.

[CommentList](src/components/comments/CommentList.tsx) subscribes via `onSnapshot` only when its ticket modal is open (subscription cleaned up on unmount). It groups top-level comments with their replies via the `replyTo` field. Threading is intentionally **one level deep**: the "Reply" action is hidden on already-reply comments. Replies whose parent has been deleted bubble up as top-level so they stay visible.

Deletion is **soft** (set `deleted: true`, blank `body`) so replies pointing to the deleted comment keep their context. The UI shows `[deleted]`. The counter is decremented in the same batch. There's no hard-delete path; the Firestore rules forbid `delete` entirely.

URLs in bodies are turned into clickable links via `tokenizeForLinks` in [src/lib/utils.ts](src/lib/utils.ts). There is **no markdown** — keeps XSS surface minimal and avoids a parser dependency.

Permissions: any active user can read comments and post their own; updates allowed for the author or any admin (covers both edit and soft-delete since both go through `update`).

### Rich text descriptions

Ticket descriptions are edited via a [TipTap](https://tiptap.dev)-based WYSIWYG ([src/components/ui/RichTextEditor.tsx](src/components/ui/RichTextEditor.tsx)) and stored as **HTML strings** on the ticket doc. No Markdown, no JSON tree — HTML is human-inspectable in the Firebase console and round-trips through TipTap's schema parser, which acts as a whitelist (anything outside the allowed nodes/marks is stripped on load).

Two consequences worth knowing:
- **No DOMPurify on render.** The description is never rendered as HTML outside the editor — TicketCard / EpicsPage use `htmlToPlainText` for previews. The threat model is therefore covered by TipTap's own parse step.
- **Legacy plain-text descriptions** are normalized at editor load: if the value lacks any HTML tag, the editor wraps it in a `<p>` and converts `\n` to `<br>` so multi-line legacy content keeps its layout. See `normalizeContent` in `RichTextEditor.tsx`.

### Checklist

Each ticket can carry a checklist stored as an array on the ticket doc (`checklist: ChecklistItem[]`) — array, not subcollection, since checklists are short-by-design and the array fits comfortably under the 1 MB doc limit. The single setter `updateChecklist(id, items)` in [src/services/tickets.ts](src/services/tickets.ts) replaces the whole array; add / toggle / edit / delete / reorder all rebuild the array client-side.

The [Checklist component](src/components/tickets/Checklist.tsx) reads the **live** ticket via `useAppData().tickets.find(...)` rather than the prop snapshot — otherwise edits made in the modal wouldn't reflect immediately because the modal's `ticket` prop is captured at open-time. Same pattern is reused for the Attachments tab badge in [TicketModal](src/components/tickets/TicketModal.tsx).

### Attachments

Files up to 10 MB are uploaded to the **Flexweg site** via its [Files API](https://documentation.flexweg.com/api-reference/files/) — Firebase Storage is intentionally not used (it requires the paid Blaze plan). The Flexweg API path is `attachments/{ticketId}/{attachmentId}-{filename}` and the public URL is `${siteUrl}/${path}`. Metadata (`name`, `contentType`, `size`, `storagePath`, `url`, `uploadedAt`, `uploadedBy`) lives in `tickets/{id}.attachments[]` so the list reads back without secondary fetches.

[src/services/attachments.ts](src/services/attachments.ts) is the only place that talks to the Flexweg API:
- `uploadAttachment(ticketId, file, uid)` — reads the file via `FileReader` to base64, POSTs `{path, content, encoding: "base64"}` to `/api/v1/files/upload` with `X-API-Key`, then `arrayUnion`s the metadata onto the ticket. Returns an `UploadHandle` `{ promise, cancel, onProgress }`. Progress is *milestone-based* (encoding → uploading → persisting) — the API isn't streamable, so we can't observe transfer bytes like Firebase Storage's resumable uploads.
- `deleteAttachment(ticketId, attachment)` — `DELETE /api/v1/files/delete?path=...` first (best-effort, swallows 404), then `arrayRemove` from the ticket.
- `deleteAllAttachmentsForTicket(ticketId, attachments)` — called from `deleteTicket`. Iterates the known `attachments[]` (no `list` API call) and deletes each. Best-effort; never blocks the Firestore doc deletion.

`validateAttachment(file)` enforces the 10 MB cap and a strict whitelist constrained to **what Flexweg accepts**: images, PDF, fonts, text/code (HTML/CSS/JS/JSON/XML/TXT/MD/CSV). **No Office documents, archives, or video** — those would 4xx at the API layer. Falls back to extension matching when MIME is empty.

#### API key handling — read this carefully

The Flexweg permanent API key is stored in **Firestore** at `config/flexweg` (`{apiKey, siteUrl, apiBaseUrl}`). Firestore rules gate writes to admins only and reads to active users. Service flow:

[src/services/flexwegConfig.ts](src/services/flexwegConfig.ts) exposes `getFlexwegConfig()` (no caching — re-reads on every call, which is cheap; uploads aren't a hot path) and `setFlexwegConfig()` (used by the admin Settings page). The attachments service calls `getFlexwegConfig()` at the start of each operation; if it returns null, the Attachments tab UI shows a "configure your Flexweg key in Settings (admin only)" message instead of the drop zone.

**This is a documented compromise.** The Flexweg docs explicitly warn *"Never ship the API key to the browser"* — the key is meant for backend use. We accept that any signed-in team member can extract the key from devtools at runtime, because:
1. The key is gated by Firestore rules — anonymous visitors and disabled users cannot fetch it.
2. A team member already has full Firestore access; the Flexweg key gives no extra privilege over the project's own files (it's scoped to a single Flexweg site).
3. There is no backend in this architecture — the alternative would be Cloud Functions (Blaze plan) or an external proxy, defeating the "static-only" model.

**Do not reuse this pattern for a public-facing app.** If this Kanban ever needs to be exposed beyond an internal team, route uploads through a backend (Cloud Function, Cloudflare Worker) so the key stays server-side.

#### URLs and security posture

Public download URLs are bare static-asset URLs (`https://your-site.flexweg.com/attachments/...`) — anyone with the URL can read, no token, no expiry. Same posture as private GitHub raw URLs. Acceptable for internal tools; not acceptable for confidential or regulated data.

### Routing & layout

[src/App.tsx](src/App.tsx) wraps everything in `AppErrorBoundary` → `AppDataProvider` → `Routes`. Default route redirects to `/sprint`. All authenticated pages render inside [src/components/layout/AppLayout.tsx](src/components/layout/AppLayout.tsx) (Sidebar + Topbar + Outlet). Reusable primitives live in `src/components/ui/`.

## Conventions

- Path aliases: none. Use relative imports.
- Styling: TailwindCSS utility classes; `clsx` for conditional class composition. No CSS modules. The Tailwind `content` glob in [tailwind.config.js](tailwind.config.js) covers `.{js,jsx,ts,tsx}`.
- Icons: `lucide-react` only.
- File extensions: `.tsx` for components / pages, `.ts` for services / hooks / utils / domain types.
- Strict TypeScript (`strict: true`, `noUnusedLocals`, `noUnusedParameters`). Domain types live in [src/types.ts](src/types.ts); add new shapes there rather than inline `Record<string, unknown>`.
- Firestore data is cast to domain types only inside the `services/` layer (boundary). Don't re-cast in components / pages.
- Collection/doc names are centralized in `collections` and `configDocs` exports of [src/services/firebase.ts](src/services/firebase.ts) — reference them rather than hardcoding strings.
- UI strings on translated components must go through `t()` from `react-i18next` and exist in all 7 bundles under `src/i18n/`. English (`en.json`) is the source of truth; missing keys in other locales fall back to English automatically.
