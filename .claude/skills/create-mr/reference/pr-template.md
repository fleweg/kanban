# PR description template

The canonical body written to `/tmp/create-mr-body.md` and passed to
`gh pr create --body-file …`. Fill every applicable section in **English**.

```markdown
## Summary

<1–2 sentences: what this PR does and the user-visible effect.>

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

<One short paragraph: what could break? Hot path? Feature-flagged? How to
revert if it goes wrong (`git revert <sha>` is the default).>
```

## When to omit sections

| Section            | Skip when                                                     |
|--------------------|---------------------------------------------------------------|
| `Motivation`       | Trivial fix where the motivation is in the subject line       |
| `How to test`      | Pure docs / typo fix that needs no manual verification        |
| `Related`          | No linked issue / Sentry permalink                            |
| `Risk & rollback`  | Truly trivial change (one-line typo, comment, doc-only)       |

`Summary` and `Changes` are **mandatory** — a reviewer must be able to grasp
what changed without reading the diff.

## Style rules

- Bullet list under `Changes` — imperative voice, no trailing period.
- `How to test` uses GitHub checkboxes (`- [ ]`) so the reviewer can tick
  them off as they validate.
- Numbers should be precise where the diff allows: "Reduced query count
  from 247 to 3" beats "Reduced query count significantly".
- Link external context: blog posts, RFC drafts, upstream issues, Stack
  Overflow answers that informed the approach. Put them inline next to
  the bullet that motivated them, not in a "References" footer.

## What NEVER goes in the PR body

- Personal context ("I was tired last night so the variable naming is
  rough") — the PR body is for reviewers, not for journaling.
- Speculation about future work ("we should also …"). Open a follow-up
  issue instead and link it.
- Credentials, API keys, internal hostnames, customer data.
- Copy-pasted shell sessions — link to the relevant lines of code or
  paste a tight `<details><summary>` block if absolutely necessary.
