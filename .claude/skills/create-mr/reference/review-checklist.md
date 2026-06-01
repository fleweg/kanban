# Auto-review checklist (flexweg / kanban — React + Vite + TypeScript)

What Claude looks for during Step 6 of `/create-mr`. Findings are sorted into
five buckets; each finding becomes a single `AskUserQuestion`.

This is a **static React SPA** with **two interchangeable data backends**
(Firebase, Flexweg SQLite). Reviews focus on TypeScript correctness, React
patterns, and the architectural rules described in `CLAUDE.md`.

## 1. Bugs

- Null deref on `getRuntimeConfig()` / `getDb()` / `getAuthClient()` — they
  throw when the backend isn't initialised, which happens before the
  SetupForm completes. Wrap in the boot guard or short-circuit before
  calling.
- `useEffect` deps: missing entries (stale closures), or transitive
  identifiers that change every render (causing infinite loops).
- Polling loops (SQLite mode): `subscribeWithPolling` callbacks that never
  unsubscribe, or that throw and silently kill the polling timer.
- Optimistic-update bugs in `useTicketOptimistic`: not clearing the
  override on server error, or override merging that masks a server-side
  reset.
- Off-by-one in `computeNewOrder` neighbors (drag-reorder is the only
  place this matters).
- Race conditions in sprint lifecycle: `createSprint` / `endSprintAndStartNext`
  rely on a `where("status","==","active").where("teamId","==",X)` precheck;
  any code path that skips the team filter can spawn two active sprints.
- Missing input validation at boundaries: SetupForm fields, Flexweg API
  responses (the API may return 200 with an error payload), `JSON.parse`
  on user-provided strings.
- Promise rejections silently swallowed in `.catch(() => {})` — at minimum
  `console.warn` so it shows up in DevTools.
- `Date` math drift: `new Date("yyyy-mm-dd")` parses as UTC midnight, which
  is the previous day in negative timezones. Use `new Date(y, m-1, d)`
  for local-midnight parsing (see `dateInputToMs` in `TicketModal`).
- **GanttPage workarounds**: SVAR re-inits its internal layout state on
  every `tasks` prop change. Look for accidental break of the two
  workarounds:
    - Changing `<Gantt tasks={initialTasks}>` to pass the live
      `tasks` ref instead of the captured snapshot → SVAR re-inits on
      every edit, grid width resets.
    - Dropping the `eventSource: "update-task" | "add-task" |
      "delete-task"` from the `api.exec(...)` calls → SVAR's
      auto-recompute path runs, which re-emits the store and resets
      the grid width.
    - Removing the `requestAnimationFrame` width-restore at the end of
      the sync effect → grid width visibly snaps on every ticket edit.
    - Adding `flexgrow` to the `GANTT_COLUMNS` column definition →
      SVAR's `m.every(width && !flexgrow)` check fails, fallback
      width becomes hardcoded 440 instead of the column sum.
  All four are documented in CLAUDE.md's "Gantt view" section.
- **Dependencies (finish-to-start)**:
    - Cascade triggers: TicketModal submit, Gantt drag-end on a bar
      (`onUpdateTask`), Gantt drag-to-create-link (`onAddLink`). Each
      computes the patch via `cascadeFromChangedTicket` from
      `src/lib/dependencies.ts` and applies it as parallel
      `updateTicket` calls. If a new code path mutates `dueDate`
      without running the cascade, dependent tickets won't shift.
    - Cycle detection: `dependenciesAreCyclic` is checked client-side
      in `DependenciesPicker` (to filter the dropdown) AND in the
      Gantt `onAddLink` handler (to refuse drag-to-create). Both
      must stay in place — only one would leak.
    - `deleteTicket` cleanup: both backend impls must strip the
      deleted id from every other ticket's `dependencies` array.
      Firebase uses `arrayRemove`, SQLite scans `LIKE '%"id"%'`.
      Forgetting either leaves dangling deps that the UI renders as
      muted "deleted" chips.
    - Epics are NOT cascade sources (their `dueDate` is derived).
      `computeShiftFromDependencies` and the link-builder both skip
      them. Don't "fix" that without revisiting the data model.

## 2. Architecture

- **Dispatcher bypass**: a page/component that imports directly from
  `src/services/firebase/*` or `src/services/flexweg-sqlite/*` instead of
  going through the top-level `src/services/<name>.ts` dispatcher. The
  one documented exception is `UsersPage.tsx` ↔ `syncUsersFromApi`
  (SQLite-only function) — flag any new exception.
- **Backend parity**: a function added or modified in one backend without
  the matching change in the other. The skill's Step 6 sub-check covers
  this — surface as P0.
- **Team scoping bypass**: a page reading the global `tickets` / `sprints`
  / `epics` arrays from `useAppData()` when it should be reading the
  `currentTeam*` slice. The global arrays are appropriate for admin
  cross-team views and migrations only.
- **Workflow assumptions**: hard-coded column ids. Always read
  `workflow.completedColumnId` and `workflow.columns[0]?.id`. The
  `autoProgressForStatus` helper exists for the common case.
- **Domain types**: ad-hoc `Record<string, unknown>` shapes when the
  type belongs in `src/types.ts`. Cast-at-boundary only happens inside
  the `services/` layer.
- **Comments inline**: deletion is soft (set `deleted: true`, blank body),
  never hard. New code that does `deleteDoc` on a comment is wrong.
- **Subcollection vs array**: comments live in `tickets/{id}/comments`
  subcollection (Firestore) or `comments` table (SQLite). Checklist
  and attachments live as JSON columns / array fields on the ticket
  doc. Don't invert these choices without a strong reason.

## 3. Style / conventions

- `as any` masking a real type error. Cast at the service boundary if
  you must (`as Ticket` on Firestore reads is acceptable in `rowToTicket`)
  — never in pages/components.
- Missing TypeScript types on exported functions: the project is in
  `strict` mode with `noUnusedLocals` + `noUnusedParameters`. The
  compiler enforces a lot — but exported function signatures should
  still be explicit.
- Magic numbers: `4_000` for polling interval → name it
  `POLL_INTERVAL_MS`. Days as seconds, etc.
- Dead code: unused imports, commented-out blocks, unreachable branches.
- Inconsistent casing in service files: domain types are `camelCase`,
  SQL columns are `snake_case`. The `rowToX` / `xToRow` helpers
  translate at the boundary.
- `tabular-nums` class missing on numeric badges (`%`, counts, dates)
  that change live — without it the layout jitters.
- Hardcoded English strings in already-translated components. SetupForm,
  SettingsPage, UsersPage, TicketModal use `t()` extensively; new keys
  go in **all 7 i18n bundles** under `src/i18n/` (en.json is the source
  of truth, others fall back, so missing keys in non-EN bundles aren't
  fatal but are noise).
- Direct `firebase/firestore` imports in pages — services are the only
  place that should touch the Firestore SDK directly.

## 4. Documentation

- Default to **no comment**. Only add one when the *why* is non-obvious —
  a hidden constraint, a subtle invariant, a workaround, behaviour that
  would surprise a future reader. See CLAUDE.md for the project rule.
- Never explain *what* the code does — the names should already tell us.
- Never reference the current task / PR / caller in comments — those
  belong in the PR description and rot.
- Surface design decisions that aren't visible from the code: e.g. "we
  do NOT use `email_verified` here because the team is a closed beta",
  "this ALTER is idempotent because Flexweg's SQLite is 3.35+".
- CLAUDE.md should be updated when adding a new top-level feature
  (teams, gantt, etc.) — flag if the PR ships a major feature without
  documenting it there.

## 5. Security

- **Flexweg API key exposure**: documented compromise (CLAUDE.md
  explains it) — the key is in Firestore `config/flexweg` and readable
  by any active user. Don't add NEW places that fetch/log/persist the
  key, especially via `console.log`.
- **localStorage scope**: SQLite mode persists the user token under a
  shared key — don't add another auth source there without scoping by
  install path / project id.
- **XSS via dangerouslySetInnerHTML**: only the RichTextEditor TipTap
  output is allowed because TipTap's schema parser sanitises on parse.
  Anywhere else, never inject HTML from a user.
- **Attachment paths**: every Flexweg Files API call uses
  `attachments/{ticketId}/{attachmentId}-{filename}`. Path traversal
  (`..`, leading `/`) is rejected server-side, but the client should
  also normalise to avoid generating broken URLs.
- **Bootstrap admin check**: `request.auth.token.email.lower() ==
  "<bootstrap>"` lives in BOTH `.env`/`config.js` AND Firestore rules.
  Changing the email = update both.
- **Firestore rules drift**: any new top-level collection (e.g. `teams`)
  needs a `match /<collection>/{id}` block in rules. Flag in the PR
  body's "Firestore rules / SQLite schema" section so the operator
  publishes them.
- **Auth-API token leakage** (SQLite mode): the scoped Sqlite token
  lives in `config.js`. Never log it. The `callSqlite` helper redacts
  the token from error messages — preserve that.

## Severity grading

For each finding, pick one of:

- **Critical** — actively broken (bug bucket), actively dangerous
  (security bucket), or breaks backend parity (architecture bucket).
  Default to "Apply".
- **Major** — design issue that will hurt within 1–2 sprints
  (architecture / docs buckets). Default to "Apply" unless the user
  objects.
- **Minor** — style nit, magic number, missing tabular-nums (style /
  documentation buckets). Surface as a batch at the end so the user
  can bulk-skip if pressed for time.

Always show the finding's line + the proposed fix in chat before asking —
the user must be able to evaluate the trade-off in seconds.
