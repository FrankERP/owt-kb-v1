# ADR-0009: Abandon seven UI redesign variants for "Backstage"

**Date:** 2026-05-19/20 (explored) → 2026-07-16 (shipped) · **Status:** Rationale not recorded

## Context

Over two days in May 2026, seven complete design languages were built out in
parallel branches — Cantoral, Cassette, Pizarra, Concierto, Estudio, Vitral,
Domingo — each on its own worktree, with `scripts/serve-all.sh` booting all
seven on ports 3000–3006 for side-by-side comparison. The Cantoral branch alone
carries a full `REDESIGN_PROPOSAL.md` with a five-stage rollout, a signature
motif, custom fonts, and a light "Pergamino" theme.

## Decision

None of the seven shipped. The identity in production is an eighth, unrelated
one: **Backstage** (`33c6e15`, 2026-07-16), described only as matching "the
redesigned Backstage logo."

None of the seven branches were merged to `main`.

## Rejected

All seven, implicitly. **No commit compares the options or says why Backstage
won.**

## Consequences

⚠️ **This ADR marks a gap rather than explaining a decision.** Roughly two days
of parallel design work was discarded with no recorded evaluation. If those
explorations still hold ideas worth harvesting, the branches are the only record
— and if they don't, that's worth writing down too, so nobody re-runs the
exercise.

Two live artifacts still point at the dead work and will mislead:

- `scripts/serve-all.sh` boots seven sibling worktrees that no longer exist.
- `docs/SOLVER_AND_INFRA.md:213` lists it as current tooling.

Both are noted here rather than deleted, since removing them is a judgement call
about whether the variants might ever be revisited.
