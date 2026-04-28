# Kanban — Sprints &amp; Backlog

A fully static React + Firebase ticket manager with a backlog, sprint workflow, and a configurable Kanban board.

## Features

- **Backlog** — store tickets that aren&apos;t in any active sprint.
- **Sprints** — only one sprint can run at a time. End the active sprint to start a new one.
- **Kanban board** — drag &amp; drop tickets across columns of a configurable workflow.
- **Configurable workflow** — column ids, names, and the &quot;completion&quot; column are stored in Firestore as JSON and editable in the Settings page (a default JSON ships with the app).
- **End-of-sprint migration** — when a sprint is ended, tickets in the completion column stay archived in the ended sprint; every other ticket is migrated to the new sprint with the same status (or sent back to the backlog).
- **Real-time sync** — all data is streamed from Firestore via `onSnapshot`.
- **Static build** — deploy the `dist/` folder to any static host (Firebase Hosting, Netlify, Vercel, GitHub Pages…).

## Stack

- React 18 + Vite 5
- Firebase 11 (modular SDK, Firestore)
- React Router v6
- TailwindCSS 3
- @hello-pangea/dnd (drag &amp; drop)
- lucide-react (icons)

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure Firebase (see section below)
cp .env.example .env
# fill in the VITE_FIREBASE_* values

# 3. Run the dev server
npm run dev

# 4. Build for production
npm run build
npm run preview   # serve the static build locally
```

The dev server runs at <http://localhost:5173>.

---

## Firebase setup

This project uses **Firestore in Native mode** as its only backend. There is no Cloud Functions, Auth, or Storage requirement to get started.

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
| `tickets` | `{ title, description, priority, sprintId, status, createdBy, assigneeId, commentCount, createdAt, updatedAt }` |
| `tickets/{id}/comments` | `{ body, authorId, replyTo, edited, deleted, createdAt, updatedAt }` (subcollection) |
| `sprints` | `{ name, goal, status: "active" \| "completed", createdAt, startedAt, endedAt }` |
| `config` | Single document `workflow` containing `{ columns: [...], completedColumnId }` |

### 3. Register a web app

1. In the project console, open **Project settings &gt; General**.
2. In **Your apps**, click **&lt;/&gt; Web** to register a web app (skip Hosting for now).
3. Copy the `firebaseConfig` values shown — you&apos;ll paste them into `.env`.

### 4. Configure `.env`

Copy `.env.example` to `.env` at the project root, and fill in the values from the previous step plus the bootstrap admin email:

```bash
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef

# Email of the bootstrap administrator (must match an account you create in
# Firebase Authentication, see "Authentication & user management" below).
VITE_ADMIN_EMAIL=admin@example.com
```

Restart `npm run dev` after editing `.env`.

> The app guards against missing variables and shows a friendly error screen if any are absent.

### 5. Firestore security rules

Open **Firestore Database &gt; Rules** and paste the rules below. They require a signed-in, non-disabled user for every read/write, and restrict the `users` collection to administrators. Replace `admin@example.com` with the same value you set for `VITE_ADMIN_EMAIL` in `.env`.

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
    match /config/{id}  { allow read, write: if isActiveUser(); }

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

      // Self-create on first login: any signed-in user can create their own record with role "user".
      allow create: if signedIn()
                    && request.auth.uid == uid
                    && request.resource.data.role == "user"
                    && request.resource.data.disabled == false;
      allow update, delete: if isAdmin();
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

### 8. (Optional) Deploy to Firebase Hosting

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

- The email is set in `.env` as `VITE_ADMIN_EMAIL`.
- The same email is referenced in the Firestore security rules.
- This account is treated as admin **without** needing a record in the `users` Firestore collection — that solves the chicken-and-egg problem of needing an admin to create the first admin.

If you ever need to change the bootstrap admin, update both `.env` (then `npm run build` + redeploy) **and** the Firestore rules.

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

Each user is rendered as a colored disc with their initials, derived from the email's local part (`john.doe@x.com` → `JD`, `frederic@…` → `F`). The disc color is hashed deterministically from the user's `uid`, so the same person always shows up in the same color across the app. No avatar uploads, no Firebase Storage — purely client-side.

Tickets carry two user-related fields:

- **`createdBy`** — the `uid` of whoever clicked "Create ticket". Set automatically, immutable. Visible at the bottom of the ticket modal in edit mode.
- **`assigneeId`** — the `uid` of the assignee, or `null`. Editable from the ticket modal via an "Assignee" dropdown. Any active user can be picked, including the bootstrap admin. Tickets without an assignee show a dashed `?` placeholder on their card; assigned tickets show the assignee's avatar in the bottom-right corner.

Tickets created before this feature was added simply have no assignee until someone edits them.

### Comments

Each ticket has its own comment thread, stored as a Firestore subcollection at `tickets/{ticketId}/comments`. The thread is real-time: any active user reading the ticket sees new comments as they're posted.

**Posting a comment**: open a ticket, scroll to the **Comments** section at the bottom of the ticket modal, type, and click **Comment**. The comment appears immediately.

**Replying**: click **Reply** on a top-level comment, type, click **Reply**. Replies are indented one level under their parent. There is no second level of reply — you can reply to a comment, but you cannot reply to a reply (a deliberate choice to avoid threading complexity for a small-team tool).

**Editing**: click **Edit** on your own comment, change the text, click **Save**. The comment shows an "edited" hint next to its timestamp.

**Deleting**: click **Delete** on your own comment (or any comment if you are an admin). The comment is **soft-deleted** — the body is replaced with a `[deleted]` placeholder so any replies to it stay in context. The Firestore document remains in place; only its `body` and `deleted` fields change. The ticket's `commentCount` is decremented so the card badge stays accurate.

**Comment count on cards**: tickets show a `💬 N` badge beside their priority chip when N > 0. The count is denormalized into `tickets/{id}.commentCount` and is incremented/decremented atomically with each post or soft-delete (single Firestore batch), so the card never goes stale.

**URLs are auto-linkified** in comment bodies. There is no markdown — bodies are rendered as plain text, with `http(s)://…` URLs turned into clickable links. This keeps the surface small and avoids any XSS risk from user-pasted content.

**No notifications / @mentions** today.

---

## Usage

### Backlog
- Create new tickets at any time.
- If a sprint is active, each backlog ticket gets a quick-action button to move it into the sprint.

### Active sprint
- Only one sprint can run at once.
- Drag &amp; drop tickets between columns. The status update is persisted to Firestore.
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

```
src/
├── components/
│   ├── ErrorScreen.jsx
│   ├── kanban/
│   ├── layout/         (AppLayout, Sidebar, Topbar, PageHeader)
│   ├── sprints/
│   ├── tickets/
│   └── ui/
├── config/
│   └── defaultWorkflow.json
├── context/
│   ├── AppDataContext.jsx   (tickets/sprints/workflow data)
│   └── AuthContext.jsx      (current user, role, isAdmin)
├── hooks/                   (useTickets, useSprints, useWorkflow)
├── lib/
│   └── utils.js
├── pages/
│   ├── ActiveSprintPage.jsx
│   ├── BacklogPage.jsx
│   ├── LoginPage.jsx
│   ├── SettingsPage.jsx
│   ├── SprintsPage.jsx
│   └── UsersPage.jsx        (admin only)
├── services/
│   ├── firebase.js          (lazy app/db/auth init, env vars)
│   ├── auth.js              (signIn / signOut / reset)
│   ├── users.js             (users collection CRUD)
│   ├── sprints.js
│   ├── tickets.js
│   └── workflow.js
├── App.jsx
├── index.css
└── main.jsx
```

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Build the static site into `dist/`. |
| `npm run preview` | Preview the production build locally. |

## License

MIT
