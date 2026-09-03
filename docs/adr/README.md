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

**Status** is one of: `Accepted` · `Accepted, amended by ADR-NNNN` (the decision
still stands, but a later record narrowed or carved an exception out of it) ·
`Superseded by ADR-NNNN` · `Reversed` · `Rationale not recorded` (the decision is
real and load-bearing, but nobody wrote down why — a known gap, not a guess).

## Index

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-npm-overrides-for-transitive-pins.md) | Pin transitive dependencies with npm `overrides` | Accepted |
| [0002](0002-node-pinned-to-exact-22x.md) | Pin `engines.node` to exact `22.x`, not a range | Accepted |
| [0003](0003-eslint-9-with-a-warning-backlog.md) | Stay on ESLint 9; ship warnings as a visible backlog | Accepted |
| [0004](0004-solver-single-search-worker.md) | Solve with 1 search worker to stay on free-tier CPU | Accepted |
| [0005](0005-play-history-bounded-by-week.md) | Bound play history by week, not by a published-role join | Accepted |
| [0006](0006-approval-keeps-sibling-proposals.md) | Approving a proposal keeps the other proposals | Accepted |
| [0007](0007-client-side-auth-keeps-pages-static.md) | Read auth client-side so member pages stay static | Accepted, amended by ADR-0020 (seven worship pages gate server-side) |
| [0008](0008-forced-dark-theme.md) | Force dark mode app-wide | Superseded by [0016](0016-light-mode-revived-by-tokenisation.md) |
| [0009](0009-redesign-variants-abandoned.md) | Abandon seven UI redesign variants for "Backstage" | Rationale not recorded |
| [0010](0010-specials-fill-locally-not-in-the-solver.md) | Fill special services locally; move the rules to Sanity | Accepted — P6 implemented 2026-08-03 |
| [0011](0011-serialize-special-identities-globally.md) | Serialize special-service identities with one global coordinator | Accepted |
| [0012](0012-grid-drag-excludes-swap-touch-and-auto-scroll.md) | Grid drag moves one seat, desktop only, with no auto-scroll | Accepted |
| [0013](0013-smtp-sends-stay-serial.md) | SMTP sends stay serial, and the recipient cap sits below the seat count | **Reversed** 2026-08-27 — `SEND_CONCURRENCY` is 8 with the Gmail sender |
- [ADR-0014: Two Playwright configs](0014-two-playwright-configs.md) — why the write-safety harness is not reused for visual regression
- [ADR-0015: A third root layout, at a dynamic segment](0015-gallery-root-layout.md) — why the theme gallery's layout cannot be moved upward
- [ADR-0016: Revive light mode by tokenising colour](0016-light-mode-revived-by-tokenisation.md) — **supersedes ADR-0008**; why `dark:` variants and a partial-surface revival were both rejected
- [ADR-0017: Serve the theme gallery without a session](0017-public-theme-gallery.md) — why an auth boundary moved, and why the `/auth/` placement that needs no matcher edit was rejected
- [ADR-0018: Keep lyrics and chord charts as independent fields](0018-lyrics-and-charts-are-independent.md) — why `CHORD_MARKER_RE` must not route the song editor payload
- [ADR-0019: Ship Kids as its own vertical; generalize at the third ministry](0019-generalize-at-the-third-ministry.md) — why `kidsPair`/`kidsSchedule` are Kids-specific and generic ministry schemas were deferred
- [ADR-0020: Gate ministry isolation per page, not in the middleware](0020-ministry-isolation-gates-per-page.md) — **amends ADR-0007**; why seven worship pages became dynamic and their `revalidate` exports are now inert
- [ADR-0021: Kids alternatives spend a bounded amount of fairness, not just ties](0021-kids-alternatives-spend-fairness-not-ties.md) — why «Otra opción» reaches one rest-generation back instead of only reshuffling ties, and the two plausible tests that proved nothing before the third one caught it
- [ADR-0022: An unpublished Kids Sunday does not count as served](0022-unpublished-kids-sundays-do-not-count-as-served.md) — why the fairness clock filters `published == true` while the editing grid beside it deliberately does not, and why an abandoned draft is the ordinary case rather than the exotic one
- [ADR-0023: The message thread does not bump `APPROVAL_RECEIPT_VERSION`](0023-thread-does-not-bump-the-approval-receipt.md) — why a field added to `setlistProposal` is not a "fingerprinted shape change", and what bumping it would do to the 6 live approval receipts
- [ADR-0024: Read state belongs on neither `setlistProposal` nor `teamMembers`](0024-read-state-belongs-on-neither-document.md) — why both obvious homes for unread marks turn a page view into a write on a protected, revision-asserted document
- [ADR-0025: Send mail through a dedicated Gmail account, not the church mailbox](0025-mail-sends-through-a-gmail-account.md) — the 140-send measurement that justified leaving `contacto@oasis.mx`, and the alternatives rejected on the way. Written 2026-08-24 as ADR-0023, never merged, salvaged and renumbered 2026-08-28
- [ADR-0026: A failed send is not re-pended](0026-failed-sends-are-not-re-pended.md) — three designs and three adversarial review rounds that all failed to safely retry a failed send, and the two nodemailer facts and one Gmail behaviour that killed them
- [ADR-0027: Agent verification on dev uses a local read-only runner, not a server login path](0027-agent-dev-verification-is-a-local-read-only-runner.md) — why `scripts/dev-verify.ts` signs in as a dedicated member with no «Tipo» instead of minting a server verification session, and the `loginEvent`/`lastSeen` consequences accepted along the way
- [ADR-0028: Shared predicates live outside client modules](0028-shared-predicates-live-outside-client-modules.md) — why `paintsDayCard` is in `utils/` and not beside `DayCard`
- [ADR-0029: "Tipo" is the only worship eligibility axis](0029-tipo-is-the-only-worship-eligibility-axis.md) — why soft retirement was deleted rather than repaired, the defect that forced the choice, and the one warning capability lost with it
- [ADR-0030: The browser floor is iOS 15](0030-the-browser-floor-is-ios-15.md) — why `AbortSignal.timeout` was reverted to `AbortController`, and why none of the three gates can see a Safari-16-only API
