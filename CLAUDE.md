# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static React + Vite SPA backed by Firebase Firestore (no Cloud Functions, no Auth). Implements a backlog, single-active-sprint workflow, and a configurable Kanban board.

The built `dist/` directory is **committed to the repo** and is the deploy artifact — hosting only requires serving static files (no npm/Node on the server, no SPA fallback config). `vite.config.js` sets `base: "./"` so all asset paths are relative; the SPA uses `HashRouter` so routes live in the URL fragment (`#/sprint`, `#/backlog`, …) and any host that simply serves `index.html` works — including subpaths and `file://`. After any source change you must `npm run build` and commit the regenerated `dist/`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server at http://localhost:5173 |
| `npm run build` | Static production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |

There is no test runner, linter, or formatter wired up — don't invent one.

The Firebase env vars are inlined into the bundle at build time, so `.env` is required on the build machine but **not** on the host serving `dist/`.

## Firebase configuration

Firebase credentials are read from `VITE_FIREBASE_*` env vars (see `.env.example`). [src/services/firebase.js](src/services/firebase.js) lazily initializes the app via `getDb()` and exposes `getMissingFirebaseEnvVars()`. [src/App.jsx](src/App.jsx) calls that on mount and renders an `ErrorScreen` instead of the app when any var is missing — preserve that guard. After editing `.env`, the dev server must be restarted.

Firestore collections used: `tickets`, `sprints`, and a single-doc `config/workflow`. The README documents the (open) security rules and the document shapes.

## Authentication

The app is gated behind Firebase Auth (email/password). [src/context/AuthContext.jsx](src/context/AuthContext.jsx) wraps everything; until the first `onAuthStateChanged` resolves, the app shows a spinner instead of the login page (otherwise we'd flash the login during session restoration from localStorage).

The **bootstrap admin** is configured via `VITE_ADMIN_EMAIL` in `.env`. That account is treated as admin without needing a `users/{uid}` Firestore record — it solves the chicken-and-egg of needing an admin to bootstrap. The Firestore rules duplicate this email (rules can't read env vars). Changing the bootstrap admin = update both `.env` and the rules.

Other members are mirrored in a Firestore `users` collection (doc id = `auth.uid`, fields `{ email, role, disabled, createdAt, createdBy }`). On a new user's **first** sign-in, the client calls `ensureSelfUserRecord` which `setDoc`s their record with `role: "user"` (rules allow self-create with that exact shape only).

User lifecycle is intentionally split: the Firebase Auth account is created **manually in the Firebase Console** (the client SDK can't create another user without logging the admin out, and we explicitly avoided the secondary-app workaround). Everything else — role changes, disable/enable, password reset, removal — happens from the in-app `/users` page (admin-only). True deletion of an Auth account still requires a manual click in the console; the in-app "Remove" only deletes the Firestore record.

`AuthenticatedShell` in [src/App.jsx](src/App.jsx) ensures `<AppDataProvider>` only mounts when a non-disabled user is authenticated, so Firestore subscriptions never fire before auth is ready. `<RequireAdmin>` guards `/users`. Layout components ([Sidebar.jsx](src/components/layout/Sidebar.jsx) / [Topbar.jsx](src/components/layout/Topbar.jsx)) hide the Users link for non-admins and surface the Sign-out button + current user's email.

## Architecture

### Data flow: Firestore → hooks → context → pages

All reads are real-time `onSnapshot` subscriptions in `src/services/{tickets,sprints,workflow}.js`. Each service file is the single place that talks to Firestore for its collection — pages and components must not import `firebase/firestore` directly.

`src/hooks/use{Tickets,Sprints,Workflow}.js` wrap the subscribe functions and expose `{ data, loading, error }`. [src/context/AppDataContext.jsx](src/context/AppDataContext.jsx) composes the three hooks into a single provider and pre-derives `backlogTickets` and `activeSprintTickets`. Pages consume everything via `useAppData()`; do not call the hooks directly from pages or you'll create duplicate Firestore listeners.

Mutations are plain async functions exported from the same service files (e.g. `createTicket`, `endSprintAndStartNext`). They use `serverTimestamp()` and `writeBatch` where atomicity matters. Components await these directly — there is no global mutation/dispatch layer.

### Sprint lifecycle (the non-obvious part)

Only one sprint can be `status: "active"` at a time. `createSprint` and `endSprintAndStartNext` enforce this with a `where("status", "==", "active")` precheck. Two end-of-sprint paths exist in [src/services/sprints.js](src/services/sprints.js):

- `endSprintAndStartNext` — creates the next sprint, then in a single batch reassigns every ticket whose `status !== completedColumnId` to the new sprint (keeping its column status) and marks the old sprint completed. Tickets in the completion column stay archived in the ended sprint.
- `endSprintToBacklog` — same filter, but unfinished tickets get `sprintId: null, status: null` instead.

`completedColumnId` comes from the workflow config, not from a hardcoded constant — always read it from the current workflow before deciding which tickets count as "done".

### Workflow configuration

The Kanban columns are data, not code. [src/config/defaultWorkflow.json](src/config/defaultWorkflow.json) seeds the `config/workflow` Firestore doc; users edit it from the Settings page. `validateWorkflow` in [src/services/workflow.js](src/services/workflow.js) enforces unique column ids and that `completedColumnId` matches one of them. When a ticket's `status` references a column id that no longer exists (e.g. user renamed it), the board falls back to the first column — preserve that fallback rather than crashing.

### Drag & drop

The board uses `@hello-pangea/dnd`. Dropping a ticket onto a different column calls `changeTicketStatus(id, newColumnId)`. The status field stores the column `id`, not its display name.

### Ticket assignment & avatars

Tickets carry `createdBy` (immutable, set on creation) and `assigneeId` (nullable, editable). Both are user `uid`s; resolution to an email/avatar happens at render time via `getUserById()` exposed on `AppDataContext`. The `users` collection feeds both the avatar lookup and the assignee picker, so non-admin users need read-list access to it (rules: `allow list: if isActiveUser()`).

[src/components/users/UserAvatar.jsx](src/components/users/UserAvatar.jsx) renders a colored disc with initials. Color comes from a deterministic hash of the `uid` (`colorClassesFor` in [src/lib/utils.js](src/lib/utils.js)) — same user → same color everywhere. Initials are derived from the email's local part (no `displayName` field today; easy to add later by reading `record.displayName ?? record.email`). [UserPicker.jsx](src/components/users/UserPicker.jsx) is a bare `<select>` over active users with an "Unassigned" first option.

The bootstrap admin auto-creates their own `users/{uid}` record with `role: "user"` like everyone else (otherwise they couldn't be picked as an assignee). Their effective admin status still flows from the email match in `.env` + rules — the role field is irrelevant for the bootstrap admin. The Users page detects them by email and shows a "Bootstrap" badge, treats them as Admin, and disables destructive actions on their row.

### Routing & layout

[src/App.jsx](src/App.jsx) wraps everything in `AppErrorBoundary` → `AppDataProvider` → `Routes`. Default route redirects to `/sprint`. All authenticated pages render inside [src/components/layout/AppLayout.jsx](src/components/layout/AppLayout.jsx) (Sidebar + Topbar + Outlet). Reusable primitives live in `src/components/ui/`.

## Conventions

- Path aliases: none. Use relative imports.
- Styling: TailwindCSS utility classes; `clsx` for conditional class composition. No CSS modules.
- Icons: `lucide-react` only.
- File extensions: `.jsx` for components, `.js` for service/hook/util modules.
- Collection/doc names are centralized in `collections` and `configDocs` exports of [src/services/firebase.js](src/services/firebase.js) — reference them rather than hardcoding strings.
