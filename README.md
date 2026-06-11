# Kanban — Sprints &amp; Backlog

A fully static React + Firebase ticket manager with a backlog, sprint workflow, and a configurable Kanban board.

&gt; This project is the reference implementation for Flexweg&apos;s [Kanban with Firebase](https://documentation.flexweg.com/use-cases/kanban-with-firebase/) use case — a guided walkthrough of cloning, configuring Firebase, building, and deploying the app to [Flexweg](https://www.flexweg.com)&apos;s free static hosting. The README below is the deeper technical reference.

## Features

- **Backlog** — store tickets that aren&apos;t in any active sprint.
- **Sprints** — only one sprint can run at a time. End the active sprint to start a new one.
- **Kanban board** — drag &amp; drop tickets across columns of a configurable workflow.
- **Configurable workflow** — column ids, names, and the &quot;completion&quot; column are stored in Firestore as JSON and editable in the Settings page (a default JSON ships with the app).
- **End-of-sprint migration** — when a sprint is ended, tickets in the completion column stay archived in the ended sprint; every other ticket is migrated to the new sprint with the same status (or sent back to the backlog).
- **Rich descriptions** — WYSIWYG editor (TipTap) with bold/italic, headings, lists, code blocks, links.
- **Checklist** — sub-tasks per ticket with live progress badge on cards.
- **Attachments** — drop images / PDF / text / fonts (up to 10 MB each) into any ticket; stored on your Flexweg site via its [Files API](https://documentation.flexweg.com/api-reference/files/), downloadable from the modal.
- **Real-time sync** — all data is streamed from Firestore via `onSnapshot` (Firebase mode) or polled every ~4 s via the Flexweg SQLite version endpoint (SQLite mode).
- **Two backend choices at install** — pick **Firebase** (real-time, attachments) or **Flexweg SQLite** (no external account, real email+password auth via the Flexweg SQLite Auth API, SQL via the Flexweg-hosted database service).
- **Static build** — deploy the `dist/` folder to any static host. Designed primarily for [Flexweg](https://www.flexweg.com), but works on Netlify, Vercel, GitHub Pages, Firebase Hosting, etc.
- **First-run setup UI** — drop the bundled `dist/` on Flexweg without editing `.env` and the app shows an in-browser **SetupForm**. It collects Firebase config + bootstrap admin email + Flexweg API key, then writes a populated `config.js` back to your Flexweg site so every browser boots straight into the app without re-running the form. `.env` is now optional — useful for non-developer deployments.
- **7 admin languages** — UI translated into English, French, German, Spanish, Dutch, Portuguese, Korean. Resolves from `localStorage` → `navigator.language` → English. Switchable from anywhere via the flag chip.

## Stack

- React 18 + Vite 5
- **TypeScript** (strict mode — `tsc --noEmit` runs as a `prebuild` gate)
- Firebase 11 (modular SDK, Firestore)
- React Router v6
- TailwindCSS 3
- @hello-pangea/dnd (drag &amp; drop)
- lucide-react (icons)

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure Firebase — TWO PATHS, pick one:

# 2a. Developer path: bake credentials into the build via .env
cp .env.example .env
# fill in the VITE_FIREBASE_* + VITE_ADMIN_EMAIL values

# 2b. No-edit path: skip .env. The app renders an in-browser
#     SetupForm on first load, you fill in Firebase config + admin
#     email there, and it persists to localStorage. Useful for
#     deploying dist/ to a host without ever opening a code editor.

# 3. Run the dev server
npm run dev

# 4. Type-check on demand (also runs automatically before each build)
npm run typecheck

# 5. Build for production
npm run build
npm run preview   # serve the static build locally
```

The dev server runs at <http://localhost:5173>.

---

## Choosing a data backend

At first run the SetupForm asks you to pick how the Kanban stores its data. Both choices keep the app fully static on Flexweg — the difference is what's on the other end of the wire:

| | **Firebase** | **Flexweg SQLite** |
| --- | --- | --- |
| External services | Firebase project (free Spark plan) + Flexweg site | Flexweg site only |
| Authentication | Firebase email/password + per-user roles | Email/password via the Flexweg SQLite Auth API (bcrypt server-side) + per-user roles |
| Real-time updates | Push (`onSnapshot`) | Polling (~4 s via `/api/v1/sqlite/version`) |
| Atomic concurrent writes | Yes (Firestore transactions) | Yes (server-side Symfony Lock + SQLite transactions) |
| Attachments | ✅ 10 MB files via Flexweg Files API | ✅ 10 MB files via Flexweg Files API (master key persisted in SQLite `config` table) |
| Setup friction | ~5 min Firebase Console click-through + paste keys | ~30 s (paste Flexweg API key, set admin email/password, click install) |
| Best for | Teams needing the full Firebase ecosystem | Teams wanting a self-contained, Flexweg-only deployment |

You can switch backends later from **Settings → Data backend**, but switching wipes the current data (no automatic migration). The previous backend's data stays where it is and can be re-attached by switching back.

The Firebase setup below is required if you choose Firebase. If you choose SQLite, jump to [Flexweg SQLite setup](#flexweg-sqlite-setup) instead.

## Firebase setup

This project uses **Firestore in Native mode** for data and **Firebase Authentication** (email/password) for the login gate. Ticket attachments are stored on your Flexweg site (not Firebase Storage) via the Flexweg Files API — see the [Attachments section](#attachments) for setup. No Cloud Functions, no Firebase Storage.

&gt; For an opinionated, Flexweg-flavored walkthrough of the steps below (with screenshots and the full deploy story), see the [**Kanban with Firebase**](https://documentation.flexweg.com/use-cases/kanban-with-firebase/) use case on Flexweg&apos;s documentation site. The [**Connect to external databases**](https://documentation.flexweg.com/advanced-usage/external-databases/) page also explains why a public Firebase API key is safe to ship in a static bundle when Firestore Security Rules are configured properly — the model this project relies on.

### 1. Create a Firebase project

1. Go to <https://console.firebase.google.com/>.
2. Click **Add project** and follow the wizard.
3. Disable Google Analytics if you don&apos;t need it.

### 2. Create a Firestore database

1. In the project console, open **Build &gt; Firestore Database**.
2. Click **Create database**.
3. Pick a location close to your users (you cannot change it later).
4. Start in **production mode** — we&apos;ll add the security rules below.

You don&apos;t need to create any collections by hand. The app creates them on first use:

| Collection | Document shape |
| --- | --- |
| `tickets` | `{ title, description, priority, sprintId, status, createdBy, assigneeId, commentCount, order, type, epicId, checklist[], attachments[], createdAt, updatedAt }` |
| `tickets/{id}/comments` | `{ body, authorId, replyTo, edited, deleted, createdAt, updatedAt }` (subcollection) |
| `sprints` | `{ name, goal, status: "active" \| "completed", createdAt, startedAt, endedAt }` |
| `config` | `workflow`: `{ columns: [...], completedColumnId }` · `flexweg`: `{ apiKey, siteUrl, apiBaseUrl }` (set from Settings, admin-only) |

### 3. Register a web app

1. In the project console, open **Project settings &gt; General**.
2. In **Your apps**, click **&lt;/&gt; Web** to register a web app (skip Hosting for now).
3. Copy the `firebaseConfig` values shown — you&apos;ll paste them into `.env`.

### 4. Configure the Firebase credentials

There are **two ways** to feed Firebase config + bootstrap admin email into the app. The resolver in [`src/lib/runtimeConfig.ts`](src/lib/runtimeConfig.ts) checks them in this order and the first complete source wins:

1. **`window.__FLEXWEG_CONFIG__`** — set by `/config.js` loaded synchronously before the bundle. The bundled `public/config.js` ships as `window.__FLEXWEG_CONFIG__ = null;`. The in-app **SetupForm** rewrites that file on your Flexweg site after first-run configuration; from that point on, every visitor's browser reads the populated config before the bundle boots. This is the production path on Flexweg — see [section 8 (Deploy)](#8-deploy-to-flexweg) for the end-to-end flow.

2. **`.env` at build time** — the developer path. Copy `.env.example` to `.env`:

   ```bash
   VITE_FIREBASE_API_KEY=AIzaSy...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
   VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef

   # Email of the bootstrap administrator (must match an account you create
   # in Firebase Authentication, see "Authentication & user management" below).
   VITE_ADMIN_EMAIL=admin@example.com
   ```

   Restart `npm run dev` after editing. Vite inlines these into the bundle at build time and the SetupForm never shows.

> **You don't have to pick the path before building.** The same `dist/` works for both: if `.env` was filled at build time, the values are baked in; otherwise the SetupForm appears on first load and writes `config.js` to Flexweg, which takes over for subsequent reloads. Whichever path you take, **the rules file in step 5 still needs the admin email hardcoded** — Firestore rules can't read env vars or fetched JS files.

### 5. Firestore security rules

Open **Firestore Database &gt; Rules** and paste the rules below. They require a signed-in, non-disabled user for every read/write, and restrict the `users` collection to administrators. Replace `admin@example.com` with whatever bootstrap admin email you configured at the runtime layer — `.env`'s `VITE_ADMIN_EMAIL`, the SetupForm's localStorage entry, or a hand-edited `dist/config.js`. Firestore rules can't read those sources, so the value has to be pinned here statically; any mismatch makes admin-only writes fail with `permission-denied`.

> Note: `isBootstrapAdmin()` checks email match only — **not** `request.auth.token.email_verified`. If you'd rather refuse unverified accounts admin access, add `&& request.auth.token.email_verified == true` inside that function and turn on email verification in Firebase Console → Authentication → Templates. The default leaves verification off because the kanban is an internal-team tool where the bootstrap admin is created manually by an operator.

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function userDoc() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function isBootstrapAdmin() {
      return signedIn() && request.auth.token.email.lower() == "admin@example.com";
    }

    function hasUserDoc() {
      return signedIn() && exists(/databases/$(database)/documents/users/$(request.auth.uid));
    }

    function isActiveUser() {
      return isBootstrapAdmin() || (hasUserDoc() && userDoc().disabled != true);
    }

    function isAdmin() {
      return isBootstrapAdmin() || (hasUserDoc() && userDoc().role == "admin" && userDoc().disabled != true);
    }

    match /tickets/{id} { allow read, write: if isActiveUser(); }
    match /sprints/{id} { allow read, write: if isActiveUser(); }

    // Teams catalog — readable by every active member (the team
    // switcher and assignee picker render the list), writable only by
    // admins (create/rename/delete on the /teams page).
    match /teams/{id} {
      allow read:  if isActiveUser();
      allow write: if isAdmin();
    }

    // Tags vocabulary — read by every active member; create + update
    // open to any active user (inline-create in the TagPicker keeps
    // friction low, like Trello labels); delete restricted to admins
    // (deletion cascades a strip across every ticket's `tagIds`).
    match /tags/{id} {
      allow read:           if isActiveUser();
      allow create, update: if isActiveUser();
      allow delete:         if isAdmin();
    }

    // Workflow JSON is editable by every active member (Settings page).
    match /config/workflow { allow read, write: if isActiveUser(); }
    // One-shot migration flags (teams backfill). The first authenticated
    // boot writes the flag so the migration only runs once per project.
    match /config/migrations { allow read, write: if isActiveUser(); }
    // Flexweg API key — readable by active users (the attachments service
    // needs it to upload), writable only by admins.
    match /config/flexweg  {
      allow read:  if isActiveUser();
      allow write: if isAdmin();
    }
    // Asana connector config (PAT + optional status-field mapping) —
    // same posture as the Flexweg key: read by every signed-in user
    // (the ticket modal needs it to call the Asana API), write by
    // admins only.
    match /config/asana    {
      allow read:  if isActiveUser();
      allow write: if isAdmin();
    }

    match /tickets/{ticketId}/comments/{commentId} {
      allow read:   if isActiveUser();
      allow create: if isActiveUser() && request.resource.data.authorId == request.auth.uid;
      // Soft-delete is performed via update (sets deleted: true), so updates
      // are open to the author and to admins. Hard-delete is forbidden.
      allow update: if isActiveUser() && (resource.data.authorId == request.auth.uid || isAdmin());
    }

    match /users/{uid} {
      // Self-doc is always readable (first-login bootstrap needs to detect
      // that no record exists yet). Listing is open to active users so the
      // app can render assignee avatars and offer the assignee picker.
      allow get: if signedIn() && (request.auth.uid == uid || isActiveUser());
      allow list: if isActiveUser();

      // Self-create on first login: any signed-in user can create their
      // own record with role "user". teamIds must be a list — every new
      // user is auto-enrolled in the default "general" team.
      allow create: if signedIn()
                    && request.auth.uid == uid
                    && request.resource.data.role == "user"
                    && request.resource.data.disabled == false
                    && request.resource.data.teamIds is list;
      // Admins can update or delete any user record. Users can update
      // their own record as long as role / disabled / email don't
      // change — this lets them set/clear their own `avatarPath` +
      // `avatarUrl` via the Profile modal without granting any
      // privilege-escalation surface.
      allow update: if isAdmin()
                    || (signedIn()
                        && request.auth.uid == uid
                        && request.resource.data.role == resource.data.role
                        && request.resource.data.disabled == resource.data.disabled
                        && request.resource.data.email == resource.data.email);
      allow delete: if isAdmin();
    }
  }
}
```

### 6. Enable Email/Password authentication

1. In the Firebase console, open **Build &gt; Authentication**.
2. Click **Get started**, then in the **Sign-in method** tab enable **Email/Password**.
3. Open the **Users** tab and click **Add user** to create the bootstrap administrator. Use the same email you set for `VITE_ADMIN_EMAIL` in `.env`.

That account is the only one that can sign in until you create more (see "Authentication &amp; user management" below).

### 7. (Optional) Indexes

Firestore will prompt you in the browser console with a one-click link the first time it needs a composite index. The current queries are simple enough that no manual index is required:

- `tickets` ordered by `createdAt desc`
- `sprints` ordered by `createdAt desc`
- `tickets where sprintId == X`
- `sprints where status == "active"`

---

## Flexweg SQLite setup

(Skip this section if you chose Firebase above.)

The SQLite backend uses the Flexweg [SQLite Database API](https://documentation.flexweg.com/api-reference/sqlite). The actual database file lives on **your own Flexweg site's S3 storage** (at the path you choose, e.g. `kanban/db.sqlite`). All reads and writes go through `static-host`'s `/api/v1/sqlite/*` endpoints — concurrency is handled server-side by Symfony Lock + SQLite transactions.

### What you need

1. A Flexweg account on a plan with enough quota for one extra file (the `.sqlite` blob) and the API calls you'll make. The Free tier (2 MB total) is too tight for real use; Standard and above work.
2. Your **master Flexweg API key** (from Account → API in your Flexweg dashboard). You'll paste it **once** during install — the SetupForm exchanges it for a **scoped Sqlite token** that's strictly limited to one SQLite file and persisted in `config.js`. The master key is never saved.

### Install flow

1. Reach the SetupForm (either fresh deployment or after clicking "Switch backend" in Settings).
2. Pick **Flexweg SQLite** on the backend choice step.
3. Fill the form:
   - **API key** — your master Flexweg key (one-time use).
   - **Site URL** — `https://your-site.flexweg.com` (pre-filled from `window.location.origin`).
   - **API base URL** — defaults to `https://www.flexweg.com/api/v1`, override only if you self-host.
   - **SQLite path** — defaults to `<app-folder>/db.sqlite`. Each project on your site gets its own SQLite (`kanban/db.sqlite`, `blog/posts.sqlite`, …).
4. Click **Install**. The form:
   1. `POST /api/v1/sqlite/auth/install` — exchange master key for scoped token bound to the chosen path
   2. Apply the new runtime config locally
   3. Bootstrap the schema (`CREATE TABLE` for tickets/sprints/workflow/comments/users/config + seed the default workflow)
   4. Upload `config.js` to Flexweg using the master key (one last use)
   5. Reload — the app boots into SQLite mode and the scoped token is the only credential in `config.js`

### Identity in SQLite mode

Real email + password authentication, backed by the [Flexweg SQLite Auth API](https://documentation.flexweg.com/api-reference/sqlite-auth):

- The admin account is created during install (you enter an email + password on the install form).
- The first registered user is **automatically promoted to admin** (server-side rule).
- Subsequent team members sign up via the **Create account** tab on the login screen. They get the `user` role by default; an admin can promote them from the Users page.
- Passwords are **bcrypt-hashed server-side** (PHP `password_hash`, cost 12) — hashes never leave Flexweg's MySQL.
- After login, the browser receives an opaque **session token** (30-day sliding expiry) stored in `localStorage` and sent as `X-Sqlite-User-Token` on every SQLite request alongside the scoped token.
- The scoped token (in `config.js`) is gated by `requireUserAuth=true` — without a valid user token, every CRUD endpoint returns 401.

**Security model**: the scoped token in `config.js` plus a valid user session are both required for any read or write. Compromising `config.js` alone gives an attacker no data access — they still need a working login.

### What works (and doesn't) vs Firebase mode

| Feature | Firebase mode | SQLite mode |
| --- | --- | --- |
| Tickets, sprints, workflow, epics, drag-drop | ✅ | ✅ |
| Rich-text descriptions | ✅ | ✅ |
| Checklist | ✅ | ✅ |
| Comments | ✅ | ✅ |
| Users page (promote / demote / disable) | ✅ | ✅ (browser-local identities) |
| Real-time push between teammates | ✅ instant | ⏱️ ~4 s polling |
| Attachments | ✅ 10 MB | ✅ 10 MB |
| Password reset | ✅ Firebase Auth | ⛔ N/A (no passwords) |

### Switching between backends later

Go to **Settings → Data backend** and click **Switch backend**. This wipes the in-browser runtime config and reloads into the SetupForm. The previous backend's data is **not deleted** — it stays in Firestore or in the `.sqlite` file — but the Kanban won't read it again until you switch back.

For SQLite mode, the Settings panel offers a **"Download backup"** link pointing to the public URL of the `.sqlite` file (via the regular Flexweg Files API). Grab it before switching if you might want to restore later.

### 8. Deploy to Flexweg

This project is intended to be hosted on [**Flexweg**](https://www.flexweg.com) — its free static hosting is the canonical target and the whole build pipeline is tuned for it (`vite.config.ts` uses `base: &quot;./&quot;` and the SPA uses `HashRouter`, so no SPA-fallback config is needed on the host).

The pre-built `dist/` directory is committed to the repo, so deploying does not require Node on the host. The minimum flow is:

1. **Build** locally (only needed if you changed any source — the committed `dist/` is always up to date with the latest commit):
   ```bash
   npm run build
   ```
2. **Upload** the contents of `dist/` to your Flexweg site root via the Flexweg file explorer (or the Flexweg CLI / GitHub Action if you have a CI pipeline).

The full step-by-step guide — including how to create your Flexweg account, generate an API key, and wire up GitHub Actions for automatic deploys — lives on the Flexweg docs:

- [**Kanban with Firebase**](https://documentation.flexweg.com/use-cases/kanban-with-firebase/) — end-to-end walkthrough for this exact project.
- [**Use-case prerequisites**](https://documentation.flexweg.com/use-cases/prerequisites/) — Docker / Git / GitHub / Flexweg account setup, done once.
- [**Git CI/CD**](https://documentation.flexweg.com/advanced-usage/git-cicd/) — automating `npm run build` + upload from a GitHub Actions workflow.

#### Deploying elsewhere

The `dist/` folder is plain static files, so any host that serves `index.html` works (Netlify, Vercel, GitHub Pages, Firebase Hosting, Cloudflare Pages, …). If you specifically want Firebase Hosting:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # public dir: dist, single-page app: yes
npm run build
firebase deploy --only hosting
```

---

## Authentication &amp; user management

The app is gated by Firebase Authentication (email/password). Anyone landing on the site sees a sign-in screen; nothing in Firestore is readable until they log in.

### Roles

There are two roles:

- **`admin`** — full access to everything, plus the **Users** page where they manage other members.
- **`user`** — full access to tickets, sprints, and settings, but no access to the Users page.

The role of every member except the bootstrap admin is stored in Firestore under `users/{uid}.role`.

### Bootstrap administrator

The very first administrator is "hard-coded" through configuration:

- The email lives in the **runtime config** — sourced from `.env` (`VITE_ADMIN_EMAIL`), the SetupForm's localStorage entry, or a hand-edited `dist/config.js`. See "Configure the Firebase credentials" above for the three sources.
- The same email is referenced in the Firestore security rules.
- This account is treated as admin **without** needing a record in the `users` Firestore collection — that solves the chicken-and-egg problem of needing an admin to create the first admin.

If you ever need to change the bootstrap admin, update the active runtime source (re-run the SetupForm, or edit `.env` + rebuild, or edit `dist/config.js` on the host) **and** the Firestore rules.

### Adding a new member

Adding a new member is a two-step flow:

1. **An administrator creates the Firebase Authentication account** in **Firebase Console &gt; Authentication &gt; Users &gt; Add user** (email + password). They share the credentials with the new member out-of-band (e.g. a password manager).
2. **The new member signs in once** at the Kanban URL. On their very first sign-in, the app auto-creates a document at `users/{uid}` with `role: "user"`. They immediately appear in the **Users** page in the app.

> Why not create the account from the Kanban itself? The Firebase client SDK does not allow signing up another user without logging the current admin out. To keep the flow simple, we leave that step in the Firebase console and handle everything else in-app.

### Managing existing members

From the **Users** page (admin only) an administrator can:

| Action | Effect |
| --- | --- |
| **Reset password** | Sends a password-reset email to that member (uses Firebase's built-in flow). |
| **Promote** / **Demote** | Switches the role between `user` and `admin`. |
| **Disable** / **Enable** | Sets `users/{uid}.disabled = true/false`. The Firestore rules block disabled users immediately on their next request. The Auth account still exists. |
| **Remove** | Deletes the `users/{uid}` Firestore record. The member loses access immediately, but their **Firebase Auth account still exists**. To delete it permanently, also remove it from **Firebase Console &gt; Authentication &gt; Users**. |

An admin can never disable, demote, or remove **themselves** from the Users page (the buttons are disabled when the row matches the current user).

### Forgotten password

A self-service link is available on the sign-in screen. The user enters their email, clicks **Forgot password?**, and Firebase sends them a reset email — no admin action needed.

### Account disabled or removed

If a user's record has `disabled: true` or no longer exists, the next page request fails the security rules. The app catches this and shows an "Account disabled" screen with a sign-out button, instead of a blank page.

### Avatars and ticket assignment

Each user is rendered as a colored disc with their initials, derived from the email's local part (`john.doe@x.com` → `JD`, `frederic@…` → `F`). The disc color is hashed deterministically from the user's `uid`, so the same person always shows up in the same color across the app. No avatar uploads — initials only, computed client-side.

Tickets carry two user-related fields:

- **`createdBy`** — the `uid` of whoever clicked "Create ticket". Set automatically, immutable. Visible at the bottom of the ticket modal in edit mode.
- **`assigneeId`** — the `uid` of the assignee, or `null`. Editable from the ticket modal via an "Assignee" dropdown. Any active user can be picked, including the bootstrap admin. Tickets without an assignee show a dashed `?` placeholder on their card; assigned tickets show the assignee's avatar in the bottom-right corner.

Tickets created before this feature was added simply have no assignee until someone edits them.

### Issue types &amp; epics

Each ticket carries a **type**: `task` (default), `bug`, `story`, or `epic`. The type catalog lives in [src/lib/issueTypes.ts](src/lib/issueTypes.ts); to add another type (e.g. `chore`), append an entry there with an icon (from `lucide-react`) and Tailwind color classes — and add the new id to the `IssueType` union in [src/types.ts](src/types.ts).

The type icon shows up in three places: at the start of the ticket title (on cards and in the modal), in the ticket modal's **Type** dropdown, and on the modal header next to the title. The type doesn't affect filtering or status flow today; it's purely a categorization aid.

**Epics** are tickets with `type === "epic"`. They behave differently from regular tickets:

- They **never appear in the backlog or on the Kanban board**. They live in their own page at `/epics`.
- They cannot be placed in a sprint or in a workflow column (the modal hides the Sprint / Status fields when type is `epic`).
- They cannot be nested under another epic — the **Epic** picker is hidden when type is `epic`.

Other tickets can reference an epic via the `epicId` field, set from the **Epic** dropdown in the ticket modal. When set, the ticket's card shows a colored **epic chip** next to its priority — clicking the chip is a planned shortcut (today it just labels). Each epic gets a deterministic chip color based on its id, so distinct epics stand out from each other on the board.

The **Epics page** (`/epics`) lists all epics as cards with a progress bar (`completed children / total children`, where "completed" matches the workflow's completion column). Click an epic to edit it via the standard ticket modal — comments, assignee, type, priority all work the same way.

If an epic is deleted, its child tickets keep their (now dangling) `epicId`. The UI silently hides the broken chip; no cascade, no orphan cleanup. Recreating an epic with the same id is impossible (Firestore generates new ids), so this is effectively a one-way release.

### Drag &amp; drop ordering

Tickets carry a numeric `order` field. The Kanban board and the backlog list both sort tickets in **descending** order (highest = top). New tickets are created with `order = Date.now()` so they land at the top by default.

When a ticket is dropped at a new position, the app computes its new `order` as the **midpoint** between its new neighbors (or `neighbor.order ± 1000` when dropped at an extremity). On the Kanban board, a cross-column drop also rewrites the ticket's `status`, atomically with the order change.

Tickets created before this feature was added have no explicit `order`. They sort by `createdAt` until they're touched by a drag, at which point a real `order` value is written.

### Comments

Each ticket has its own comment thread, stored as a Firestore subcollection at `tickets/{ticketId}/comments`. The thread is real-time: any active user reading the ticket sees new comments as they're posted.

**Posting a comment**: open a ticket, scroll to the **Comments** section at the bottom of the ticket modal, type, and click **Comment**. The comment appears immediately.

**Replying**: click **Reply** on a top-level comment, type, click **Reply**. Replies are indented one level under their parent. There is no second level of reply — you can reply to a comment, but you cannot reply to a reply (a deliberate choice to avoid threading complexity for a small-team tool).

**Editing**: click **Edit** on your own comment, change the text, click **Save**. The comment shows an "edited" hint next to its timestamp.

**Deleting**: click **Delete** on your own comment (or any comment if you are an admin). The comment is **soft-deleted** — the body is replaced with a `[deleted]` placeholder so any replies to it stay in context. The Firestore document remains in place; only its `body` and `deleted` fields change. The ticket's `commentCount` is decremented so the card badge stays accurate.

**Comment count on cards**: tickets show a `💬 N` badge beside their priority chip when N > 0. The count is denormalized into `tickets/{id}.commentCount` and is incremented/decremented atomically with each post or soft-delete (single Firestore batch), so the card never goes stale.

**URLs are auto-linkified** in comment bodies. There is no markdown — bodies are rendered as plain text, with `http(s)://…` URLs turned into clickable links. This keeps the surface small and avoids any XSS risk from user-pasted content.

**No notifications / @mentions** today.

### Description editor

The ticket description uses a small WYSIWYG editor based on [TipTap](https://tiptap.dev). Output is sanitized HTML stored as a string on the ticket doc — no Markdown, no JSON tree. Toolbar covers **B / I / S / inline code / code block / h2 / h3 / bullet & numbered lists / blockquote / link**.

Card and Epics-page previews strip HTML to plain text via `htmlToPlainText` in [src/lib/utils.ts](src/lib/utils.ts) so rich formatting never breaks the `line-clamp-2` layout.

Pre-existing tickets with plain-text descriptions are displayed transparently — the editor wraps unstructured input in a `&lt;p&gt;` and converts `\n` to `&lt;br&gt;` on first open, so multi-line legacy content keeps its layout.

### Checklist

Each ticket can carry a checklist (sub-tasks). Items are stored as an array on the ticket doc (`checklist: [{ id, text, done, createdAt }]`) — no subcollection, since checklists are short by nature and array updates piggyback on the same ticket write.

**Adding / editing**: open a ticket, switch to the **Checklist** tab. Type in the bottom input + Enter to add. Click an item to rename inline. Drag-free reordering uses ↑/↓ arrows. Empty edits delete the item (matches Jira/Trello).

**Card badge**: tickets show a `☑ done/total` badge next to the comment badge. Green when complete, gray otherwise.

Edits persist immediately (no Save button) — the checklist component reads the live ticket from the app data context so concurrent edits show up in real time.

### Attachments

Tickets accept file uploads up to **10 MB each** stored on your Flexweg site via its [Files API](https://documentation.flexweg.com/api-reference/files/). The chosen storage strategy is documented further down ("Why Flexweg, not Firebase Storage").

**One-time setup (admin)** — before anyone can upload:

1. Generate a **permanent API key** in your [Flexweg account → API](https://www.flexweg.com/account/settings#api-keys). The key is scoped to a single site.
2. In the Kanban, sign in as an admin and open **Settings**. A "Flexweg API (ticket attachments)" block is shown only to admins. Fill in:
   - **Site URL** — the public URL of your Flexweg site, e.g. `https://your-site.flexweg.com` (no trailing slash). Used to build download URLs.
   - **API key** — paste the permanent key from step 1.
   - **API base URL** — defaults to `https://www.flexweg.com/api/v1`. Override only if your account uses a different host.
3. Click **Save**. Configuration is written to Firestore at `config/flexweg` (Firebase mode) or to the local SQLite `config` table (SQLite mode). Until this is done, the **Attachments** tab on tickets shows a "not configured" message instead of the drop zone. In SQLite mode the install flow persists the key automatically using the value you typed for `/auth/install`, so attachments work out of the box.

**Storage layout**: `attachments/{ticketId}/{attachmentId}-{filename}` on your Flexweg site. Folders are created automatically by the Files API. Attachment metadata (name, content type, size, public URL, uploader, timestamp) lives in `tickets/{id}.attachments[]` so the list reads back without any extra API calls.

**Adding files**: open a ticket, switch to the **Attachments** tab. Drop files or click to pick — multiple files at once is fine. A coarse progress indicator shows per file (encoding → uploading → persisting); the Flexweg upload is a single POST so we can't observe transfer bytes like a resumable upload.

**Allowed types**: constrained to what Flexweg's Files API accepts — images (JPG, PNG, GIF, SVG, WebP, ICO), PDF, fonts (WOFF, WOFF2, TTF, OTF), and text/code (HTML, CSS, JS, JSON, XML, TXT, MD, CSV). **Office documents (Word/Excel/PowerPoint), archives (ZIP/RAR/7z), and video are not supported**. The 10 MB cap is enforced client-side; the Flexweg quota (per plan) is the hard ceiling.

**Previews**: image attachments render a thumbnail; everything else gets a typed icon. Click the thumbnail or **Download** to fetch — files are served as static assets at `https://your-site.flexweg.com/attachments/...`.

**Deletion**: click the trash icon on a row. The Flexweg `DELETE /api/v1/files/delete?path=...` is called first (best-effort — a 404 means the file was already gone), then the metadata is removed from the `attachments` array. When an entire ticket is deleted, the app loops over the `attachments[]` and DELETEs each one before removing the Firestore doc — so we never accumulate orphaned files counting against the Flexweg quota.

Card badge: `📎 N` next to the comment / checklist badges.

#### Why Flexweg, not Firebase Storage

Firebase Storage requires the Blaze (paid) plan. Flexweg, on the other hand, already hosts the static SPA — its Files API gives us the same upload/list/delete capabilities for free within the site's plan quota. The trade-off is:
- ✅ No extra paid service.
- ✅ Files served by the same CDN as the app.
- ⛔ Reduced file-type whitelist (no Office, no archives).
- ⛔ The Flexweg API key has to be stored somewhere reachable by the browser (we use Firestore, gated by Firestore rules to active users only). A team member could in theory extract the key from devtools — acceptable for an internal tool, but **do not use this pattern for a public-facing app**.

&gt; **Security note**: the Flexweg docs explicitly say *"Never ship the API key to the browser"* (it's intended for backend use). The Firestore-cached approach is a documented compromise — the key isn't in the bundle, but signed-in team members can extract it at runtime. For a public-facing deployment, route uploads through a backend (Cloud Function, Cloudflare Worker, etc.) so the key stays server-side.

---

## Usage

### Backlog
- Create new tickets at any time.
- **Drag &amp; drop tickets to reorder them** — useful for prioritizing what to pull into the next sprint.
- If a sprint is active, each backlog ticket gets a quick-action button to move it into the sprint.

### Active sprint
- Only one sprint can run at once.
- Drag &amp; drop tickets between columns to change their status, **or within a column to reorder them**. The new order is persisted to Firestore.
- Click any ticket to edit, change priority, or delete it.
- Click **End sprint** to either:
  - **Start a new sprint** — non-completed tickets are migrated to the new sprint, keeping their column.
  - **Send back to backlog** — non-completed tickets are returned to the backlog. The active sprint slot is freed up.

### Sprints
- Lists all past and current sprints with progress (`completed / total` tickets).
- Starting a new sprint is disabled while one is active.

### Settings — workflow
- Edit the workflow JSON directly. The board uses these columns in order.
- Each column needs a unique `id`, a `name`, and an optional `color` (any CSS color).
- `completedColumnId` controls which column is treated as &quot;done&quot; when ending a sprint.

```jsonc
{
  "columns": [
    { "id": "todo",          "name": "To Do",         "color": "#94a3b8" },
    { "id": "in_progress",   "name": "In Progress",   "color": "#3b82f6" },
    { "id": "freeze",        "name": "Freeze",        "color": "#06b6d4" },
    { "id": "to_review",     "name": "To Review",     "color": "#a855f7" },
    { "id": "in_production", "name": "In Production", "color": "#22c55e" }
  ],
  "completedColumnId": "in_production"
}
```

> Renaming a column id while tickets reference it is safe — affected tickets fall back to the first column on the board until you edit them.

---

## Project structure

The codebase is **TypeScript-first** (`.tsx` for components / pages, `.ts` for services / hooks / utils). Domain types (`Ticket`, `Sprint`, `Workflow`, `UserRecord`, …) live in [src/types.ts](src/types.ts) — extend that file rather than reaching for inline `Record<string, unknown>`. Firestore docs are cast to domain types only inside the `services/` layer (boundary); the rest of the app sees fully-typed data.

```
src/
├── components/
│   ├── ErrorScreen.tsx
│   ├── comments/        (CommentList, CommentItem, CommentComposer)
│   ├── epics/           (EpicChip, EpicPicker)
│   ├── issueTypes/      (TypeIcon, TypePicker)
│   ├── kanban/          (KanbanBoard, KanbanColumn)
│   ├── layout/          (AppLayout, Sidebar, Topbar, PageHeader)
│   ├── sprints/         (SprintCard, SprintModal, EndSprintModal)
│   ├── tickets/         (TicketCard, TicketModal, Checklist, Attachments)
│   ├── users/           (UserAvatar, UserPicker)
│   └── ui/              (Modal, Badge, EmptyState, LocaleSwitcher)
├── config/
│   └── defaultWorkflow.json
├── context/
│   ├── AppDataContext.tsx   (tickets/sprints/workflow/users data)
│   ├── AuthContext.tsx      (current user, role, isAdmin)
│   └── ThemeContext.tsx     (light/dark theme)
├── hooks/                   (useTickets, useSprints, useWorkflow, useUsers)
├── i18n/                    (i18next init + 7 locale bundles: en, fr, de, es, nl, pt, ko)
│   ├── index.ts
│   ├── en.json              (source of truth — every key falls back here)
│   ├── fr.json
│   ├── de.json
│   ├── es.json
│   ├── nl.json
│   ├── pt.json
│   └── ko.json
├── lib/
│   ├── adminBase.ts         (auto-detects the kanban's folder on Flexweg for config.js upload)
│   ├── issueTypes.ts        (task/bug/story/epic catalog)
│   ├── runtimeConfig.ts     (Firebase config resolver: window global → .env)
│   ├── setupApi.ts          (Flexweg API helpers used by the first-run SetupForm)
│   └── utils.ts
├── pages/
│   ├── ActiveSprintPage.tsx
│   ├── BacklogPage.tsx
│   ├── EpicsPage.tsx
│   ├── LoginPage.tsx
│   ├── SettingsPage.tsx
│   ├── SetupForm.tsx        (first-run config wizard — renders when getRuntimeConfig() is null)
│   ├── SprintsPage.tsx
│   └── UsersPage.tsx        (admin only)
├── services/
│   ├── firebase.ts          (lazy app/db/auth init via runtime config resolver)
│   ├── auth.ts              (signIn / signOut / reset)
│   ├── users.ts             (users collection CRUD)
│   ├── comments.ts          (per-ticket comment subcollection)
│   ├── attachments.ts       (Flexweg Files API uploads + ticket array sync)
│   ├── flexwegConfig.ts     (Firestore-cached Flexweg API key + site URL)
│   ├── sprints.ts
│   ├── tickets.ts
│   └── workflow.ts
├── App.tsx
├── index.css
├── main.tsx
├── types.ts                 (domain types — single source of truth)
└── vite-env.d.ts            (typed import.meta.env for VITE_* vars)
```

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run typecheck` | Run `tsc --noEmit` against the whole project. |
| `npm run build` | Type-check, then build the static site into `dist/`. A failing `tsc` blocks the bundle. |
| `npm run preview` | Preview the production build locally. |

## License

MIT
