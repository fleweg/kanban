---
name: create-mr
description: Use when the user types `/create-mr`, asks to "open a PR", "create a pull request", "ship this work", "open the PR with what I just did", or any phrase meaning they want to push the current changes for review. Walks through a structured auto-review (Symfony linters + Claude-driven code review with interactive fixes), infers a conventional-commits commit message, builds an English PR description, and pushes the branch. If `gh` CLI is installed and authenticated it opens the PR automatically; otherwise it prints a pre-filled GitHub "compare" URL the user clicks once in the browser (zero extra install, zero token). Asks the user at every destructive step. GitHub-only.
version: 1.0.0
---

# create-mr — auto-review then open a GitHub Pull Request

This skill takes "I've finished a piece of work, ship it" and runs it through the
same checklist a careful colleague would: lint pass, code review, structured
commit message, structured PR description, issue linking, and finally the actual
push + PR open. Every destructive step is gated by `AskUserQuestion`.

## Prerequisites

- Inside a git repository with an `origin` remote pointing at GitHub. `git push`
  must already work (HTTPS credentials cached, or SSH key).
- **One of**:
  - `gh` CLI installed and authenticated (`gh auth status`) → fully automated PR creation, OR
  - Nothing extra → the skill falls back to printing a pre-filled GitHub "compare" URL that
    the user clicks once in their browser to finalize the PR. Zero install, zero token.
- Docker dev stack running if full PHP linting matters (`docker compose ps app`).
  If the container is down, fall back to `php -l` on the host and skip Twig /
  YAML / Doctrine checks — tell the user explicitly which checks were skipped.

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
  **slug**. Confirm via `AskUserQuestion`:

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

The default flow stages with `git add -A` **after** the auto-review fixes are
applied (Step 6).

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

### Step 5 — Symfony linters on changed files

Run linters scoped to **what this branch actually touches** — flagging
pre-existing errors in untouched files is out of scope.

For each PHP file changed:

```bash
docker compose exec -T app php -l <file>
```

For each Twig file changed:

```bash
docker compose exec -T app php bin/console lint:twig --no-interaction <file>
```

For each YAML in `config/` or `translations/`:

```bash
docker compose exec -T app php bin/console lint:yaml --no-interaction <file>
```

If any Doctrine entity changed (`src/Entity/*.php` or migrations):

```bash
docker compose exec -T app php bin/console doctrine:schema:validate --skip-sync
```

If `composer.json` or `composer.lock` changed:

```bash
docker compose exec -T app composer validate --strict
```

When the `app` container is not running, fall back to `php -l <file>` on the
host. Skip Twig / YAML / Doctrine checks and tell the user explicitly: "Skipped
Twig/YAML/schema linting — Docker dev stack not running."

For each tool that reports errors, list the findings and ask the user (via
`AskUserQuestion`) whether to fix them as part of this PR.

### Step 6 — Claude auto-review

Read each modified file with surrounding context, classify findings into five
buckets (see [`reference/review-checklist.md`](reference/review-checklist.md)):

1. **Bugs** — null deref, off-by-one, unhandled exceptions, race conditions,
   missing error handling at system boundaries.
2. **Architecture** — fat controllers (move logic to services), god-classes,
   tight coupling, missing dependency injection, public methods that should be
   private. The project's [CLAUDE.md](../../../CLAUDE.md) describes the
   controller / service split — respect it.
3. **Style / conventions** — variable naming clarity, missing PHP 8.4 types /
   return types, magic numbers, dead code, inconsistent casing. Use
   `readonly`, `enum`, and constructor property promotion where they fit.
4. **Documentation** — missing or non-English docblocks, parameters without
   `@param`, return types without `@return`, complex blocks without inline
   `why`-comments. Per the project conventions (CLAUDE.md): default to *no*
   comment unless the *why* is non-obvious.
5. **Security** — SQL injection via raw queries, missing CSRF on
   state-changing routes, path traversal in file APIs (the project has
   `FileApiController` patterns for this), secrets in `.env` instead of
   secret vaults, missing authentication on routes under `/account/*` or
   `/api/*` that should require it.

For each finding, ask via `AskUserQuestion` (single-select):

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

Process findings sequentially. After applying, **re-run Step 5 linters** on
the touched files to confirm nothing regressed.

#### Tests are a suggestion, not a blocker

If the diff adds/modifies code without touching tests:

```
header: "Tests?"
question: "No tests cover the new logic in <file>. Add a test scaffold?"
options:
  - label: "Yes, scaffold a PHPUnit test (Recommended for non-trivial logic)"
    description: "I'll add a skeleton covering the main path. You fill in the assertions."
  - label: "Skip"
    description: "Open the PR without test coverage."
```

### Step 7 — build the commit message

Conventional commits format:

```
<type>(<scope>): <subject in imperative present, 50 chars max>

<body — bullet list of what changed, why, anything reviewers must know>

Co-Authored-By: Claude <noreply@anthropic.com>
```

Infer `<type>`, `<scope>`, `<subject>` from the diff content. Show the draft in
chat, then confirm via `AskUserQuestion`:

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
  - label: "Sentry issue"
    description: "Provide the short ID and permalink in chat — I'll embed them in the PR body."
  - label: "None / other"
    description: "Skip the linking. You can edit the PR later if needed."
```

### Step 9 — build the PR description

Use the [`reference/pr-template.md`](reference/pr-template.md) template, in
**English**:

```markdown
## Summary

<1–2 sentences: what this PR does and the user-visible effect>

## Motivation

<Why this change is needed. Reference the issue / Sentry issue / bug report.
Explain the problem before the solution.>

## Changes

- <bullet 1: imperative voice — "Add SentryTraceMiddleware…">
- <bullet 2>
- <bullet 3>

## How to test

- [ ] <reproducible step 1>
- [ ] <reproducible step 2>
- [ ] <expected output / behaviour>

## Related

- Closes #N                                ← if GitHub issue
- Sentry: [SENTRY-XYZ](<permalink>)        ← if Sentry

## Risk & rollback

<One paragraph: what could break? Hot path? Feature-flagged? How to revert
(e.g. `git revert <sha>`).>
```

Skip sections that don't apply (e.g. no "Related" line if no issue).

### Step 10 — final confirmation

Show the user a single block:

- Source branch → target branch
- Commit message (full)
- PR title (= first line of commit message)
- PR body (rendered)

Ask via `AskUserQuestion`:

```
header: "Ship it?"
question: "Commit, push, and open the GitHub Pull Request?"
options:
  - label: "Yes, ship it (Recommended)"
    description: "Run the full sequence in one go."
  - label: "Show me the diff once more"
    description: "Print `git diff origin/<default>...HEAD` again in chat."
  - label: "Cancel"
    description: "Abort. Branch + commits remain local."
```

### Step 11 — execute

Common prelude (regardless of mode):

```bash
# Stage every modification (auto-fixes from review + any user edits)
git add -A

# Commit with the conventional message from Step 7. Use a HEREDOC for
# multi-line bodies so the formatting survives shell escaping.
git commit -m "$(cat <<'EOF'
<full message from Step 7>
EOF
)"

# Push the branch (no force, ever)
git push -u origin "<currentBranch>"

# Persist the PR body so both modes can read it
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

Build a `compare` URL with `title` and `body` query params pre-filled, then
print it for the user to open. GitHub's compare endpoint accepts both params
on the new-PR form.

```bash
# Derive owner/repo from `git remote get-url origin`. Works for both
# https://github.com/<owner>/<repo>(.git)? and git@github.com:<owner>/<repo>(.git)?
ORIGIN=$(git remote get-url origin)
# Use separate -e expressions so the script stays portable between GNU and
# BSD sed (macOS). One alternation regex breaks on macOS sed -E.
OWNER_REPO=$(printf '%s\n' "$ORIGIN" \
  | sed -e 's|^https://github\.com/||' \
        -e 's|^git@github\.com:||' \
        -e 's|\.git$||')

# URL-encode the title and body via python3 (works everywhere, no jq needed)
TITLE_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "<PR title>")
BODY_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(open('/tmp/create-mr-body.md').read()))")

PR_URL="https://github.com/${OWNER_REPO}/compare/<defaultBranch>...<currentBranch>?expand=1&title=${TITLE_ENC}&body=${BODY_ENC}"

echo "Open this URL to finalize the PR (title + body are pre-filled, just click 'Create Pull Request'):"
echo "  ${PR_URL}"
```

Print the URL in chat and ask the user to click "Create Pull Request" on the
GitHub page that opens. The skill considers the work done at this point — the
final click happens in the browser.

> Note: GitHub also emits a "Create a pull request for '<branch>' by visiting:
> https://github.com/<owner>/<repo>/pull/new/<branch>" line on stderr during
> `git push`. That URL works too but doesn't pre-fill the title/body, so the
> compare URL above is preferred.

### Step 12 — final summary

```
✓ Branch:     feat/sentry-trace-context (new) → master
✓ Linters:    php -l ✓, lint:twig ✓, lint:yaml ✓
✓ Review:     3 findings, 3 applied
✓ Commit:     feat(sentry): forward trace context to all outgoing HTTP calls
✓ Pushed:     origin/feat/sentry-trace-context
✓ PR:         https://github.com/<org>/<repo>/pull/137
```

## Things to ask the user before doing

- Creating a new branch when on default (Step 2).
- How to handle uncommitted changes (Step 3).
- Whether to fix linter errors (Step 5).
- Every individual auto-review finding (Step 6).
- Whether to add a test scaffold (Step 6).
- Whether the commit message is OK (Step 7).
- Which issue to link (Step 8).
- The final "Ship it?" gate (Step 10).

## Things to never do

- `git push --force` — neither directly nor through any flag.
- `git commit --no-verify` unless the user explicitly chose to skip a failing
  hook.
- Merge the PR after creating it. The skill **only opens** the PR; review and
  merge are humans' jobs.
- Modify `.env`, `.env.local`, `composer.json`, `package.json` outside of what
  the user's diff already touches.
- Edit files unrelated to the diff to "improve" them — stay scoped.
- Run destructive git operations (`reset --hard`, `clean -fd`,
  `checkout -- <file>` against modified files).

## Reference

- [`reference/review-checklist.md`](reference/review-checklist.md) — what Claude checks in a Symfony 8 project, bucket by bucket.
- [`reference/pr-template.md`](reference/pr-template.md) — the canonical English PR body template.
- [`reference/conventional-commits.md`](reference/conventional-commits.md) — type / scope / subject rules.
