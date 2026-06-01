---
name: create-mr
description: Use when the user types `/create-mr`, asks to "open a PR", "create a pull request", "ship this work", "open the PR with what I just did", or any phrase meaning they want to push the current changes for review. Walks through a structured auto-review (typecheck + production build + Claude-driven code review with interactive fixes), infers a conventional-commits commit message, builds an English PR description, rebuilds + commits `dist/` (this kanban deploys as a static artifact), and pushes the branch. If `gh` CLI is installed and authenticated it opens the PR automatically; otherwise it prints a pre-filled GitHub "compare" URL the user clicks once in the browser (zero extra install, zero token). Asks the user at every destructive step. GitHub-only.
version: 1.1.0
---

# create-mr — auto-review then open a GitHub Pull Request

This skill takes "I've finished a piece of work, ship it" and runs it through the
same checklist a careful colleague would: typecheck, build, code review,
structured commit message, structured PR description, issue linking, and finally
the actual push + PR open. Every destructive step is gated by `AskUserQuestion`.

## Project context

This is **flexweg / kanban**: a static React + Vite + TypeScript SPA. Key facts that
shape every step of this skill:

- **No backend code**: everything is client-side TypeScript. There is no PHP,
  no Symfony, no Doctrine.
- **Dual data backend**: `src/services/{firebase,flexweg-sqlite}/*.ts` are
  swappable implementations sharing the same function signatures, wired via
  thin dispatcher files at the top of `src/services/`. **Any new public
  service function must exist in both subfolders** or one of them will fail
  at runtime depending on the user's chosen backend.
- **`dist/` is committed**: the static bundle is the deploy artifact. After
  any source change you must `npm run build` and commit the regenerated
  `dist/` so deploy stays in sync. The skill enforces this at Step 11.
- **Only static analysis**: `npm run typecheck` (tsc --noEmit) is the entire
  CI pass. There's no test runner, linter, or formatter. The compiler IS
  the gate.
- **Teams + Gantt** are project-level concepts: tickets carry `teamId`,
  `startDate`, `dueDate`, `progress`. Suggested commit scopes include
  `teams`, `gantt`, `backend`, `sqlite`, `firebase`, `ui`, `auth`. See
  [CLAUDE.md](../../../CLAUDE.md) for the architectural details.
- **The Gantt view (`/gantt`) is fragile**. It wraps `@svar-ui/react-gantt`,
  whose internals re-init on every `tasks` prop change. We work around it
  with two coordinated mechanisms — a stable `initialTasks` seed + diff'd
  `api.exec` sync (with `eventSource` matching the action name for the
  fast-path), AND a DOM-side width restore after each sync. The full
  rationale is in CLAUDE.md's "Gantt view" section. **Don't touch
  GanttPage.tsx without re-reading that section** — the load-bearing
  invariants aren't visible from the code alone.

## Prerequisites

- Inside a git repository with an `origin` remote pointing at GitHub. `git
  push` must already work (HTTPS credentials cached, or SSH key).
- Node + npm installed (`npm run typecheck` and `npm run build` need to
  succeed).
- **One of**:
  - `gh` CLI installed and authenticated (`gh auth status`) → fully automated
    PR creation, OR
  - Nothing extra → the skill falls back to printing a pre-filled GitHub
    "compare" URL the user clicks once in their browser. Zero install,
    zero token.

## Workflow

### Step 1 — pre-flight

```bash
git rev-parse --is-inside-work-tree
git symbolic-ref --short HEAD
git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'
git status --porcelain
git remote get-url origin
command -v gh >/dev/null && gh auth status -h github.com 2>&1
```

Capture: `currentBranch`, `defaultBranch` (usually `master` on this repo), the
working-tree state, the origin URL (to derive `<owner>/<repo>` for the compare
URL), and whether `gh` is available + authenticated.

Set `MODE = "gh"` if `gh` is installed AND authenticated; otherwise
`MODE = "compare-url"`. Both modes are first-class — only the final step
(Step 11) differs.

### Step 2 — pick / create the working branch

- If `currentBranch !== defaultBranch` → keep it, just note in chat (`Working
  on <currentBranch> → target <defaultBranch>`).
- If `currentBranch === defaultBranch` → we can't open `master → master`.
  Infer a conventional-commits **type** (`feat` / `fix` / `chore` / `refactor`
  / `docs` / `test`) from the staged + unstaged diff, then a 3–5 word kebab
  **slug**. The slug should reflect the dominant feature area — common
  scopes in this repo: `teams`, `gantt`, `backend`, `sqlite`, `firebase`,
  `auth`, `ui`. Confirm via `AskUserQuestion`:

  ```
  header: "Branch name"
  question: "You're on the default branch. Create a new branch?"
  options:
    - label: "<type>/<inferred-slug> (Recommended)"
      description: "Standard convention: <type>/<3-5-word-kebab-summary>."
    - label: "Let me type a name"
      description: "I'll provide the branch name in chat."
    - label: "Cancel"
      description: "Abort /create-mr."
  ```

  On approval: `git checkout -b <branch>`.

### Step 3 — handle uncommitted changes

If `git status --porcelain` is non-empty, ask via `AskUserQuestion`:

```
header: "Uncommitted"
question: "There are uncommitted changes. How do you want to handle them?"
options:
  - label: "Commit them as part of this PR (Recommended)"
    description: "I'll stage everything, run the auto-review, and use a single conventional-commits message."
  - label: "Include without auto-committing"
    description: "Stage but don't commit; the user wants to review in another tool first."
  - label: "Cancel"
    description: "Abort /create-mr."
```

When staging, **never `git add -A` blindly**. Use explicit paths to exclude:

- `.claude/` (local skill tooling, not project code)
- `.env*` (secrets)
- any stray credentials

Typical stage command:

```bash
git add CLAUDE.md README.md src/ public/ index.html package.json package-lock.json vite.config.ts tailwind.config.js
# … and `dist/` after the build in Step 11
```

### Step 4 — collect the diff

```bash
# Files outgoing vs default branch
git diff --name-only "origin/${defaultBranch}...HEAD"

# Local uncommitted (working + staged)
git status --porcelain | awk '{print $2}'

# Patch text for review
git diff "origin/${defaultBranch}...HEAD"
git diff   # unstaged
git diff --staged
```

If both outgoing AND working files are empty → "Nothing to ship." Stop.

### Step 5 — static analysis

Two checks. Both **must** pass before opening a PR.

```bash
npm run typecheck   # tsc --noEmit
npm run build       # vite production build (prebuild also runs typecheck)
```

If `typecheck` fails, surface the first 30 lines of TS errors, ask via
`AskUserQuestion` whether to fix them. Re-run after each fix until clean. If
the user opts to skip, **abort** — a broken bundle won't help anyone.

If `build` fails (e.g. CSS bundling issue, missing asset), same loop.

Notes specific to this project:

- The kanban has **no test runner**, **no lint**, **no formatter**. Don't
  invent one. `tsc` is the entire CI pass.
- The build emits to `dist/`. After the review fixes are applied (Step 6),
  the build is re-run in Step 11 so the committed `dist/` reflects the
  final source.

### Step 6 — Claude auto-review

Read each modified `src/**/*.{ts,tsx}` file with surrounding context, classify
findings into five buckets:

1. **Bugs** — null derefs (especially around `getRuntimeConfig()`,
   `getDb()`), unhandled rejections, race conditions in optimistic updates,
   `useEffect` deps missing or stale, broken subscription cleanup,
   leaking polling timers, off-by-one in pagination/ordering.
2. **Architecture** — direct imports from `firebase/*` or `flexweg-sqlite/*`
   in pages/components (must go through the top-level dispatcher), missing
   parity between the two backend impls (a function added in one but not
   the other), workflow assumptions that hard-code column ids instead of
   reading `workflow.completedColumnId`, team-scoping bypassed (reading
   global `tickets`/`sprints` where `currentTeam*` was the right slice).
3. **Style / conventions** — `as any` masking a real type error, unsafe
   casts outside the services boundary, magic numbers, dead code,
   inconsistent casing. Domain types live in `src/types.ts`; ad-hoc
   `Record<string, unknown>` shapes are a smell.
4. **Documentation** — only flag when missing context would mislead readers
   (e.g. an undocumented invariant). Per project convention: default to *no*
   comment unless the *why* is non-obvious. Don't add docblocks just to
   placate a reviewer.
5. **Security** — secrets logged or written to localStorage with no scope,
   API keys leaked via console.log, XSS via `dangerouslySetInnerHTML`
   (TipTap output is the only legit one), path traversal in attachment
   paths, missing auth gating on routes that should require it.

Per-finding `AskUserQuestion`:

```
header: "Apply fix?"
question: "<file>:<line> — <one-line summary of the finding>"
options:
  - label: "Apply the proposed fix (Recommended)"
    description: "<short description of what changes>"
  - label: "Skip this finding"
    description: "Leave the code as-is."
  - label: "Discuss in chat"
    description: "Propose a different approach in chat first."
```

Process findings sequentially. After applying, **re-run Step 5** to confirm
nothing regressed.

#### Backend parity check

When the diff adds or modifies a function under `src/services/firebase/` OR
`src/services/flexweg-sqlite/`, **verify the sibling impl has the same
function** with a matching signature. If not, flag as a P0 finding —
shipping just one side breaks the other backend at runtime.

#### Diff size warning

For large diffs (> 1000 lines or > 20 files), offer the user a choice:

```
header: "Review depth"
question: "Diff is large (<N> lines / <M> files). How thorough?"
options:
  - label: "Targeted scan of new modules only (Recommended)"
    description: "Skip cosmetic style nits across the whole diff; surface only bug/security/architecture red flags."
  - label: "Skip review, ship now"
    description: "Typecheck passed; you've reviewed yourself."
  - label: "Full file-by-file review"
    description: "Read everything. Slow but thorough."
```

### Step 7 — build the commit message

Conventional commits format:

```
<type>(<scope>): <subject in imperative present, 50 chars max>

<body — bullet list of what changed, why, anything reviewers must know>

Co-Authored-By: Claude <noreply@anthropic.com>
```

Suggested **scopes** for this repo (pick the dominant one when the diff
spans multiple):

- `backend` — anything touching both Firebase + SQLite together or the
  dispatcher layer
- `firebase` / `sqlite` — single-backend changes
- `teams` — team-related (TeamSwitcher, TeamsPage, teamId field, scoping)
- `gantt` — Gantt view, start/due/progress fields, auto-progress rule
- `auth` — login, user records, role / disabled / membership
- `ui` — purely visual / component changes
- `attachments`, `comments`, `checklist`, `epics`, `sprints` — feature areas
- `setup` — first-run installer / SetupForm
- `i18n` — translation files
- `dist` — `dist/` rebuild commit (rare on its own; usually folded into the
  feature commit)

Infer `<type>`, `<scope>`, `<subject>` from the diff content. Show the draft
in chat, then confirm via `AskUserQuestion`:

```
header: "Commit msg"
question: "Use this commit message?"
options:
  - label: "Use as-is (Recommended)"
    description: "Commit with the message above."
  - label: "Let me edit it"
    description: "I'll provide a different message in chat."
```

See [`reference/conventional-commits.md`](reference/conventional-commits.md)
for the full type / scope taxonomy.

### Step 8 — ask about the related issue

```
header: "Related"
question: "Is this work linked to an issue?"
options:
  - label: "GitHub issue"
    description: "I'll close it automatically via `Closes #N` in the PR body."
  - label: "None / other"
    description: "Skip the linking. You can edit the PR later if needed."
```

(No Sentry on this project — it's a static internal tool.)

### Step 9 — build the PR description

Use the [`reference/pr-template.md`](reference/pr-template.md) template, in
**English**:

```markdown
## Summary

<1–2 sentences: what this PR does and the user-visible effect>

## Motivation

<Why this change is needed. Reference the issue / bug report. Explain the
problem before the solution.>

## Changes

- <bullet 1: imperative voice — "Add team-scoped filtering to AppDataContext…">
- <bullet 2>
- <bullet 3>

## How to test

- [ ] <reproducible step 1>
- [ ] <reproducible step 2>
- [ ] `npm run typecheck` and `npm run build` both green.
- [ ] Test in both backends if applicable — Firebase mode AND SQLite mode.

## Related

- Closes #N                                ← if GitHub issue

## Risk & rollback

<One paragraph: what could break? Migration involved? Does it touch
Firestore rules (admin needs to redeploy them)? How to revert
(e.g. `git revert <sha>` + rebuild + redeploy `dist/`).>
```

For Gantt / teams / auth-touching PRs, **explicitly note Firestore rules
changes** if any — the user must paste them into the Firebase Console
manually since this project doesn't deploy rules via CLI.

Skip sections that don't apply.

### Step 10 — final confirmation

Show the user a single block:

- Source branch → target branch
- Commit message (full)
- PR title (= first line of commit message)
- PR body (rendered)
- Note: "Will rebuild `dist/` and commit it as part of this PR."

Ask via `AskUserQuestion`:

```
header: "Ship it?"
question: "Rebuild dist/, commit, push, and open the GitHub Pull Request?"
options:
  - label: "Yes, ship it (Recommended)"
    description: "Run the full sequence in one go."
  - label: "Show me the diff once more"
    description: "Print `git diff origin/<default>...HEAD` again in chat."
  - label: "Cancel"
    description: "Abort. Branch + commits remain local."
```

### Step 11 — execute

```bash
# 1. Stage source changes (explicit paths — never `git add -A`)
git add CLAUDE.md README.md src/ public/ index.html \
        package.json package-lock.json \
        vite.config.ts tailwind.config.js 2>/dev/null
# Add any other touched top-level files surfaced by `git status --porcelain`.

# 2. Rebuild dist/ from the final source so the committed bundle matches.
npm run build

# 3. Stage the regenerated dist/.
git add dist/

# 4. Commit with the conventional message from Step 7.
git commit -m "$(cat <<'EOF'
<full message from Step 7>
EOF
)"

# 5. Push the branch (no force, ever).
git push -u origin "<currentBranch>"

# 6. Persist the PR body so both modes can read it.
cat > /tmp/create-mr-body.md <<'EOF'
<full PR body from Step 9>
EOF
```

Then branch on `MODE`:

#### MODE = "gh" — auto-create via `gh` CLI

```bash
gh pr create \
  --base "<defaultBranch>" \
  --head "<currentBranch>" \
  --title "<PR title — first line of commit message>" \
  --body-file /tmp/create-mr-body.md
```

`gh pr create` prints the PR URL on success. Share it with the user.

#### MODE = "compare-url" — pre-filled GitHub PR page

```bash
ORIGIN=$(git remote get-url origin)
OWNER_REPO=$(printf '%s\n' "$ORIGIN" \
  | sed -e 's|^https://github\.com/||' \
        -e 's|^git@github\.com:||' \
        -e 's|\.git$||')

TITLE_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "<PR title>")
BODY_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(open('/tmp/create-mr-body.md').read()))")

PR_URL="https://github.com/${OWNER_REPO}/compare/<defaultBranch>...<currentBranch>?expand=1&title=${TITLE_ENC}&body=${BODY_ENC}"

echo "Open this URL to finalize the PR (title + body are pre-filled, just click 'Create Pull Request'):"
echo "  ${PR_URL}"
```

Print the URL in chat and ask the user to click "Create Pull Request" on the
GitHub page that opens. The skill considers the work done at this point — the
final click happens in the browser.

### Step 12 — final summary

```
✓ Branch:     feat/gantt-view (new) → master
✓ Typecheck:  npm run typecheck ✓
✓ Build:      npm run build ✓ (dist/ regenerated)
✓ Review:     3 findings, 3 applied
✓ Commit:     feat(gantt): add SVAR Gantt timeline with start/due/progress
✓ Pushed:     origin/feat/gantt-view
✓ PR:         https://github.com/<org>/<repo>/pull/137
```

## Things to ask the user before doing

- Creating a new branch when on default (Step 2).
- How to handle uncommitted changes (Step 3).
- Whether to fix typecheck / build errors (Step 5).
- Review depth when diff is large (Step 6).
- Every individual auto-review finding (Step 6).
- Whether the commit message is OK (Step 7).
- Which issue to link (Step 8).
- The final "Ship it?" gate (Step 10).

## Things to never do

- `git push --force` — neither directly nor through any flag.
- `git commit --no-verify` unless the user explicitly chose to skip a
  failing hook.
- `git add -A` or `git add .` — always stage explicit paths so `.claude/`,
  `.env*`, and any stray secrets stay out.
- Merge the PR after creating it. The skill **only opens** the PR; review
  and merge are humans' jobs.
- Modify `.env`, `.env.local`, `package.json`, `package-lock.json` outside
  of what the user's diff already touches.
- Edit files unrelated to the diff to "improve" them — stay scoped.
- Skip the `dist/` rebuild + commit. The deploy IS `dist/`; an out-of-sync
  bundle ships broken code.
- Run destructive git operations (`reset --hard`, `clean -fd`, `checkout
  -- <file>` against modified files).
- Touch `src/services/firebase/` without also touching the matching file
  under `src/services/flexweg-sqlite/` (and vice-versa) — the dispatcher
  layer assumes parity.
- Land a Gantt / Teams / Auth change that requires Firestore rules updates
  without explicitly flagging it in the PR body. The rules live in the
  Firebase Console, not in the repo.

## Reference

- [`reference/review-checklist.md`](reference/review-checklist.md) — the
  TypeScript / React / dual-backend review checklist, bucket by bucket.
- [`reference/pr-template.md`](reference/pr-template.md) — the canonical
  English PR body template.
- [`reference/conventional-commits.md`](reference/conventional-commits.md) —
  type / scope / subject rules.
