# Conventional Commits — type, scope, subject

The skill writes commit messages and PR titles in this exact format:

```
<type>(<scope>): <subject>

<body — optional, bullet list>

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Type

| Type       | When                                                                  |
|------------|-----------------------------------------------------------------------|
| `feat`     | A new user-visible feature                                            |
| `fix`      | A bug fix                                                             |
| `refactor` | Same behavior, cleaner code                                           |
| `perf`     | Performance-only change with no behavior change                       |
| `style`    | Formatting, whitespace (rare — usually folded into `chore`)           |
| `docs`     | Documentation only (CLAUDE.md, README, code comments)                 |
| `test`     | Adding or modifying tests (no test runner in this repo yet)           |
| `build`    | Build system, deps, lockfiles (`package.json`, `package-lock.json`)   |
| `ci`       | CI/CD config (.github/workflows, deploy hooks)                        |
| `chore`    | Routine maintenance, no production impact                             |
| `revert`   | Revert a previous commit                                              |

When in doubt between `feat` and `refactor`: if a user could notice the change
in the UI or API, it's `feat` (or `fix` if it was broken). Otherwise `refactor`.

## Scope

A short noun that points at the area touched. Pick one — never multiple.
Scopes that fit this repo:

- `backend` — anything spanning both Firebase + SQLite or the dispatcher layer
- `firebase` — Firestore-only changes (rules, collections, services under `firebase/`)
- `sqlite` — Flexweg SQLite-only changes (schema, services under `flexweg-sqlite/`)
- `auth` — login, user records, role / disabled / membership, password reset
- `teams` — team entity, TeamSwitcher, TeamsPage, team-scoped slices
- `gantt` — Gantt view, start/due/progress fields, auto-progress rule, SVAR integration
- `epics` — Epic-type tickets, EpicsPage, EpicPicker
- `sprints` — sprint lifecycle, EndSprintModal, sprint scoping
- `backlog` — BacklogPage, drag-reorder, move-to-sprint
- `kanban` — Kanban board (`/sprint` page), drag between columns
- `tickets` — Ticket model, TicketModal, TicketCard, comments/checklist/attachments
- `attachments` — Flexweg Files API integration, upload/delete flows
- `comments` — comment threads, soft-delete, notifications
- `setup` — first-run installer / SetupForm
- `i18n` — translations under `src/i18n/`
- `ui` — purely visual / shared components / theming
- `docs` — CLAUDE.md, README only
- `dist` — committed `dist/` rebuild (rarely on its own; usually folded into the feature commit)
- `deps` — `package.json` / `package-lock.json` bumps

Omit the scope if a single label doesn't fit cleanly. Better no scope than a
misleading one.

## Subject

- Imperative mood ("add", "fix", "rename" — not "added", "fixes", "renaming").
- ≤ 50 characters total including the `<type>(<scope>):` prefix.
- No trailing period.
- Lowercase first letter (after the colon).

## Body

Optional, but encouraged for anything non-trivial:

```
feat(gantt): add timeline view with start/due/progress fields

- Add startDate, dueDate, progress (0-100) to the Ticket model
- Mirror columns in SQLite schema via idempotent ensureGanttColumns
- Auto-snap progress to 0/100 when status crosses first/completed column
- Wire SVAR react-gantt under /gantt with team scoping + zoom levels
- Update Firestore rules to allow the new fields on writes

Refs: https://github.com/svar-widgets/react-gantt

Co-Authored-By: Claude <noreply@anthropic.com>
```

- Wrap at 72 chars.
- Use bullets, not paragraphs, unless context truly warrants prose.
- Reference issues / PRs in a trailing `Refs:` or `Closes #N` line.
- For changes touching both backends, mention parity explicitly so the
  reviewer can verify both sides were kept in sync.

## What to AVOID

- Mixing two concerns in one commit: never do
  `feat(api): add new endpoint and fix unrelated bug` — split into two.
- Generic subjects: "fix bug", "update files", "wip" — useless in `git log`.
- Translating "what the user said" verbatim: the message describes the *code
  change*, not the request that prompted it.
