# Decision records

Short notes answering **"why is it like this?"** for choices you can't infer from
the code. One decision per file, newest number highest.

The rest of `docs/` says *what the system does today*. These say *what we chose
and what we turned down.* When the two disagree, `docs/` is right about the
present and the ADR is right about the history — fix the ADR's Status, don't
delete it.

## When to write one

Write an ADR when **a real alternative was rejected** and the reason isn't
obvious from reading the code. The test: would a competent person six months
from now "fix" this by undoing it?

Write one for:

- A pin, override, or version floor that looks arbitrary (ADR-0001, ADR-0002)
- Code that looks like a bug or a violation of a stated invariant but isn't (ADR-0005, ADR-0007)
- A thing deliberately *not* done, where the obvious move is to do it (ADR-0006)
- An upgrade attempted and reverted, so nobody re-runs it (ADR-0003)
- A tuning value that was measured, not guessed (ADR-0004)

**Don't** write one for: normal implementation choices, anything the code says
plainly, or a decision with no rejected alternative. Routine work does not need
an ADR — most changes shouldn't produce one. Rules and invariants belong in
`CLAUDE.md`; how a subsystem works belongs in its `docs/*.md`.

## Format

Copy [`TEMPLATE.md`](TEMPLATE.md). Keep it under a page. Number sequentially.
Prefer quoting real evidence (a commit body, a measurement, a production count)
over reconstructing reasoning from memory.

**Status** is one of: `Accepted` · `Superseded by ADR-NNNN` · `Reversed` ·
`Rationale not recorded` (the decision is real and load-bearing, but nobody
wrote down why — a known gap, not a guess).

## Index

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-npm-overrides-for-transitive-pins.md) | Pin transitive dependencies with npm `overrides` | Accepted |
| [0002](0002-node-pinned-to-exact-22x.md) | Pin `engines.node` to exact `22.x`, not a range | Accepted |
| [0003](0003-eslint-9-with-a-warning-backlog.md) | Stay on ESLint 9; ship warnings as a visible backlog | Accepted |
| [0004](0004-solver-single-search-worker.md) | Solve with 1 search worker to stay on free-tier CPU | Accepted |
| [0005](0005-play-history-bounded-by-week.md) | Bound play history by week, not by a published-role join | Accepted |
| [0006](0006-approval-keeps-sibling-proposals.md) | Approving a proposal keeps the other proposals | Accepted |
| [0007](0007-client-side-auth-keeps-pages-static.md) | Read auth client-side so member pages stay static | Accepted |
| [0008](0008-forced-dark-theme.md) | Force dark mode app-wide | Superseded by [0016](0016-light-mode-revived-by-tokenisation.md) |
| [0009](0009-redesign-variants-abandoned.md) | Abandon seven UI redesign variants for "Backstage" | Rationale not recorded |
| [0010](0010-specials-fill-locally-not-in-the-solver.md) | Fill special services locally; move the rules to Sanity | Accepted — P6 implemented 2026-08-03 |
| [0011](0011-serialize-special-identities-globally.md) | Serialize special-service identities with one global coordinator | Accepted |
| [0012](0012-grid-drag-excludes-swap-touch-and-auto-scroll.md) | Grid drag moves one seat, desktop only, with no auto-scroll | Accepted |
| [0013](0013-smtp-sends-stay-serial.md) | SMTP sends stay serial, and the recipient cap sits below the seat count | Accepted |
- [ADR-0014: Two Playwright configs](0014-two-playwright-configs.md) — why the write-safety harness is not reused for visual regression
- [ADR-0015: A third root layout, at a dynamic segment](0015-gallery-root-layout.md) — why the theme gallery's layout cannot be moved upward
- [ADR-0016: Revive light mode by tokenising colour](0016-light-mode-revived-by-tokenisation.md) — **supersedes ADR-0008**; why `dark:` variants and a partial-surface revival were both rejected
- [ADR-0017: Serve the theme gallery without a session](0017-public-theme-gallery.md) — why an auth boundary moved, and why the `/auth/` placement that needs no matcher edit was rejected
