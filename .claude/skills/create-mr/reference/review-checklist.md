# Auto-review checklist (Symfony 8 / PHP 8.4 project)

What Claude looks for during Step 6 of `/create-mr`. Findings are sorted into
five buckets; each finding becomes a single `AskUserQuestion`.

## 1. Bugs

- Null dereference: `$user->getX()` when `$user` could be `null` (especially
  after `getUser()` calls without `IsGranted('ROLE_USER')`).
- Unhandled exceptions: Stripe / Sentry / Doctrine calls that throw need a
  `try/catch` or a documented "let it bubble" rationale.
- Off-by-one in loops, pagination, slug truncation.
- Race conditions in concurrent writes (the storage-jobs pipeline has
  examples of how to lock — see `LockFactory` usage in
  `FileApiController`).
- Missing input validation at boundaries: REST endpoints, MCP tools, form
  submissions, OAuth callbacks.
- Symfony Messenger handlers that swallow exceptions silently (always
  log + rethrow or re-dispatch).

## 2. Architecture

- Fat controllers: business logic that belongs in a service. The project's
  pattern is `Service\<Domain>\<...>Service` (`AppInstallerService`,
  `PricingUrlResolver`, `S3StorageService`).
- God-classes: a service with more than ~10 public methods often needs to
  be split.
- Tight coupling: a controller that imports a repository directly instead
  of going through the service layer.
- Public methods that should be `private` or `protected` — minimize the
  exposed surface.
- Missing `readonly` on injected dependencies (constructor property
  promotion + `readonly` is the standard pattern in this codebase).
- Hardcoded paths / slugs / route names instead of constants or enums.

## 3. Style / conventions

- Missing return types on every method (PHP 8.4 — there's no excuse).
- Missing parameter types on every method.
- `array` parameters / returns without `@param` / `@return` describing the
  shape.
- Magic numbers: `if ($x > 86400)` → name it `self::DAY_IN_SECONDS`.
- Dead code: unreachable branches, unused imports, commented-out blocks.
- Inconsistent casing: `$apiKey` vs `$api_key` vs `$ApiKey` in the same
  file.
- `new \DateTime()` instead of `new \DateTimeImmutable()` (project
  standard).
- Untyped `mixed` where a `union` or `enum` would be more precise.

## 4. Documentation

- Default to **no** comment. Only add one when the *why* is non-obvious —
  a hidden constraint, a subtle invariant, a workaround, behaviour that
  would surprise a future reader.
- Never explain *what* the code does — the names should already tell us.
- Never reference the current task / fix / caller in comments — those
  belong in the PR description and rot as the codebase evolves.
- Class-level docblock for services that orchestrate non-trivial state:
  what does this service own? what invariants does it enforce?
- For new public APIs (controllers, MCP tools), include the `hint_for_ai`
  field in error responses (project convention — see existing
  `FileApiController` for the pattern).

## 5. Security

- SQL injection via raw queries: every `createQueryBuilder` should use
  parameter binding; never concatenate user input into the WHERE clause.
- Path traversal in file APIs: paths containing `..` or starting with `/`
  must be rejected. See `FileApiController` for the canonical regex.
- Missing CSRF on state-changing routes: forms in twig templates need
  `{{ form_widget(form._token) }}`, AJAX endpoints under `/account/*`
  need a CSRF check.
- Secrets in `.env` instead of secret vault: anything starting with
  `*_TOKEN`, `*_SECRET`, `*_KEY`, `*_DSN` that's a real credential must
  be in `.env.local` (gitignored) or pulled from a secret manager.
- Missing authentication on `/account/*` or `/api/*` routes: every
  controller method should either have `#[IsGranted(...)]` or
  authenticate explicitly via `ApiKeyService`.
- User-supplied HTML rendered without sanitization: the project uses
  `symfony/html-sanitizer` — never echo raw user HTML.
- Public storage bucket: every uploaded file should have `ACL =>
  'public-read'` set explicitly (or be in a private bucket if it should
  not be public).

## Severity grading

For each finding, pick one of:

- **Critical** — actively broken (bug bucket) or actively dangerous
  (security bucket). Default to "Apply".
- **Major** — design issue that will hurt within 1–2 sprints
  (architecture bucket). Default to "Apply" unless the user objects.
- **Minor** — style nit, missing comment, magic number (style /
  documentation buckets). Surface as a batch at the end so the user can
  bulk-skip if pressed for time.

Always show the finding's line + the proposed fix in chat before asking —
the user must be able to evaluate the trade-off in seconds.
