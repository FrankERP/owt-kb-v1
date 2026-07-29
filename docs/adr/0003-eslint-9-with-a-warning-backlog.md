# ADR-0003: Stay on ESLint 9; ship warnings as a visible backlog

**Date:** 2026-07-29 · **Status:** Accepted

## Context

`next lint` was removed in Next 16 and no `eslint.config.*` existed, so linting
silently did nothing from the upgrade until 2026-07-29. Restoring it surfaced
148 problems at once.

## Decision

Flat config in `eslint.config.mjs`, `npm run lint` → `eslint .`, and a gate of
**0 errors**. Rules with large backlogs run as **warnings** with the reason
written inline: `@typescript-eslint/no-explicit-any` (~65 sites) and
`react-hooks/set-state-in-effect` (~22 sites). `rules-of-hooks` is off for
`e2e/**` — Playwright's `use()` fixtures are not hooks.

Burn the warnings down one coherent batch at a time (the `/improve` ladder has a
rung for it). **When a rule reaches zero, promote it to `"error"` in the same
commit** so it can't regrow.

## Rejected

**ESLint 10.** Attempted and reverted: `eslint-plugin-react`'s peer range stops
at `^9.7` and it crashes on the removed `context.getFilename` API
(`TypeError: contextOrFilename.getFilename is not a function`). The
minimatch/brace-expansion overrides in [ADR-0001](0001-npm-overrides-for-transitive-pins.md)
already cover the advisories that motivated the upgrade. Don't re-attempt until
`eslint-plugin-react` widens its peer range.

**Mass-fixing the warnings to reach zero errors immediately.** Both rules need
per-site judgement: typing an `any` correctly means knowing the GROQ result
shape, and restructuring a `setState` in an effect changes render timing in
working UI. A blind pass would trade lint cleanliness for real bugs.

## Consequences

`npx eslint .` exits non-zero only on errors, so the warning count is
informational — it can drift upward unnoticed. The promote-to-error rule is what
prevents that, and it only works if applied when each backlog empties.
