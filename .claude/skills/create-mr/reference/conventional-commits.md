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
| `test`     | Adding or modifying tests                                             |
| `build`    | Build system, deps, lockfiles (composer.lock, package-lock.json)      |
| `ci`       | CI/CD config (.github/workflows, Dockerfile dev stages)               |
| `chore`    | Routine maintenance, no production impact                             |
| `revert`   | Revert a previous commit                                              |

When in doubt between `feat` and `refactor`: if a user could notice the change
in the UI or API, it's `feat` (or `fix` if it was broken). Otherwise `refactor`.

## Scope

A short noun that points at the area touched. Pick one — never multiple.
Scopes that fit this repo:

- `api` — REST + MCP endpoints
- `mcp` — the MCP server / tools
- `auth` — login, OAuth, API keys, sessions
- `billing` — Stripe, plans, AI tokens
- `apps` — AppInstaller, flexweg-apps directory
- `storage` — S3, file CRUD, storage jobs
- `account` — /account/* UI
- `home` — homepage + public marketing pages
- `pricing` — pricing page + localized variants
- `i18n` — translations, locale routing
- `ai` — AI providers, chat, prompt service
- `forms` — form management feature
- `domains` — custom domain + DNS
- `infra` — Docker, nginx, env, deploys
- `db` — entities, migrations, schemas

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
feat(ai): support Google Gemini 2.5 models

- Add gemini-2.5-flash, -pro, -flash-lite to the model registry
- Update GoogleAiProvider to format messages as `contents[]`
- Migrate users on deprecated gemini-1.5-flash to gemini-2.5-flash
- Drop the `--provider=google-ai` shortcut nobody uses

Refs: https://ai.google.dev/gemini-api/docs/changelog

Co-Authored-By: Claude <noreply@anthropic.com>
```

- Wrap at 72 chars.
- Use bullets, not paragraphs, unless context truly warrants prose.
- Reference issues / PRs / Sentry permalinks in a trailing `Refs:` or
  `Closes #N` line.

## What to AVOID

- Mixing two concerns in one commit: never do
  `feat(api): add new endpoint and fix unrelated bug` — split into two.
- Generic subjects: "fix bug", "update files", "wip" — useless in `git log`.
- Translating "what the user said" verbatim: the message describes the *code
  change*, not the request that prompted it.
