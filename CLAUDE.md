# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static React + Vite SPA written in **TypeScript** (`strict` mode), backed by Firebase Firestore (no Cloud Functions, no Auth). Implements a backlog, single-active-sprint workflow, and a configurable Kanban board.

The built `dist/` directory is **committed to the repo** and is the deploy artifact — hosting only requires serving static files (no npm/Node on the server, no SPA fallback config). [vite.config.ts](vite.config.ts) sets `base: "./"` so all asset paths are relative; the SPA uses `HashRouter` so routes live in the URL fragment (`#/sprint`, `#/backlog`, …) and any host that simply serves `index.html` works — including subpaths and `file://`. After any source change you must `npm run build` and commit the regenerated `dist/`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server at http://localhost:5173 |
| `npm run typecheck` | `tsc --noEmit` — runs automatically before `build` via `prebuild` |
| `npm run build` | Type-check then static production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |

There is no test runner, linter, or formatter wired up — don't invent one. The TypeScript compiler is the only static analysis pass; a build that doesn't typecheck won't produce a bundle.

The Firebase env vars are inlined into the bundle at build time, so `.env` is required on the build machine but **not** on the host serving `dist/`.

## Firebase configuration

Firebase credentials are read from `VITE_FIREBASE_*` env vars (see `.env.example`). [src/services/firebase.ts](src/services/firebase.ts) lazily initializes the app via `getDb()` and exposes `getMissingFirebaseEnvVars()`. [src/App.tsx](src/App.tsx) calls that on mount and renders an `ErrorScreen` instead of the app when any var is missing — preserve that guard. After editing `.env`, the dev server must be restarted.

Env vars are typed in [src/vite-env.d.ts](src/vite-env.d.ts) (the `ImportMetaEnv` augmentation). Add new `VITE_*` entries there and `import.meta.env.VITE_FOO` becomes typed everywhere.

Firestore collections used: `tickets`, `sprints`, and a single-doc `config/workflow`. The README documents the (open) security rules and the document shapes.

## Authentication

The app is gated behind Firebase Auth (email/password). [src/context/AuthContext.tsx](src/context/AuthContext.tsx) wraps everything; until the first `onAuthStateChanged` resolves, the app shows a spinner instead of the login page (otherwise we'd flash the login during session restoration from localStorage).

The **bootstrap admin** is configured via `VITE_ADMIN_EMAIL` in `.env`. That account is treated as admin without needing a `users/{uid}` Firestore record — it solves the chicken-and-egg of needing an admin to bootstrap. The Firestore rules duplicate this email (rules can't read env vars). Changing the bootstrap admin = update both `.env` and the rules.

Other members are mirrored in a Firestore `users` collection (doc id = `auth.uid`, fields `{ email, role, disabled, createdAt, createdBy }`). On a new user's **first** sign-in, the client calls `ensureSelfUserRecord` which `setDoc`s their record with `role: "user"` (rules allow self-create with that exact shape only).

User lifecycle is intentionally split: the Firebase Auth account is created **manually in the Firebase Console** (the client SDK can't create another user without logging the admin out, and we explicitly avoided the secondary-app workaround). Everything else — role changes, disable/enable, password reset, removal — happens from the in-app `/users` page (admin-only). True deletion of an Auth account still requires a manual click in the console; the in-app "Remove" only deletes the Firestore record.

`AuthenticatedShell` in [src/App.tsx](src/App.tsx) ensures `<AppDataProvider>` only mounts when a non-disabled user is authenticated, so Firestore subscriptions never fire before auth is ready. `<RequireAdmin>` guards `/users`. Layout components ([Sidebar.tsx](src/components/layout/Sidebar.tsx) / [Topbar.tsx](src/components/layout/Topbar.tsx)) hide the Users link for non-admins and surface the Sign-out button + current user's email.

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
