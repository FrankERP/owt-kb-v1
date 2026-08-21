# ADR-0021: Kids alternatives spend a bounded amount of fairness, not just ties

**Date:** 2026-08-21 · **Status:** Accepted

## Context

`planKidsMonth` is pure and deterministic by design (spec §7): same input, same
output, so a month can be regenerated and diffed. The tie-break is
`a.id.localeCompare(b.id)` — the Sanity `_id`, alphabetically.

That made "Generar mes" a function with exactly one answer. When Niza does not
like the month it proposes, clicking again returns the identical board, forever.
There is no way to ask for a second opinion; the only recourse is to drag pairs
around by hand, which is the work the generator exists to avoid.

The state the roster is actually in makes it starker. With **zero saved
schedules** every pair sits on the `NEVER` sentinel, so *every* comparison is a
tie and the entire month is decided alphabetically — the first four pairs by
`_id` get the first Sunday, every time.

## Decision

`RotationInput` takes an optional `seed`. **Seed 0 (or absent) is byte-identical
to the previous behaviour** — the strictly least-recently-served month, which is
what «Generar mes» shows first and what every pre-existing test still pins.

A non-zero seed asks for an alternative. `eligibleUnderSlack`
(`app/utils/kidsRotation.ts`) collapses a seat's fairness-sorted pool to distinct
last-served dates — "generations" — and lets the variant draw from the first
`SLACK_GENERATIONS` (2), shuffled by an FNV-1a hash of `seed|category|pairId`.

**The most recent generation is always excluded whenever more than one exists**,
so a seeded variant can never pull last Sunday's pair forward. That is the bound.

`POST /api/kids/generate` accepts `{seed, exclude}` and walks forward from the
requested seed for the first plan whose `proposalFingerprint` the planner has not
already shown, answering `{exhausted:true}` rather than repeating itself.

The same trade already ships for worship: `gcf/owt_solver_v2.py` carries `seed`,
`random_tie_break_weight_max` and `RANDOMIZED_SEARCH`.

## Rejected

**Reshuffling only genuine ties** — keep fairness exact, replace the alphabetical
`_id` tie-break with a seeded one. It is the obvious move and it is why this file
exists, because it looks sufficient today and quietly stops working.

Today it *is* sufficient: nothing has been scheduled, so everything is tied. But
each saved month gives pairs distinct last-served dates, and once the rotation is
saturated there are no ties left to break. «Otra opción» would then return the
same board every time — the exact bug this work removes, reappearing months later
with no code change to blame it on.

This was not reasoned out, it was measured. The test written to pin it,
"still produces different plans once a SATURATED history leaves no ties at all",
passed against a ties-only implementation **twice** before the fixture was honest
enough to catch it:

1. First fixture: 4 Sundays of history. Enseñanza draws from all 12 pairs, so 8
   were still never-served and still tied — variety came from that leftover tie,
   not the slack.
2. Second fixture: fingerprinted only the room seats, where 4 pairs over 4
   Sundays *is* saturated. It still passed, because the enseñanza-first rule
   removes the teaching pair from its own room's pool that Sunday, so the tied
   enseñanza seat leaked variety into the rooms anyway.
3. Third fixture: twelve Sundays, every pair carrying a distinct last-served date
   in every category it can hold. Zero ties anywhere. Setting
   `SLACK_GENERATIONS = 1` now fails it.

Two plausible tests that proved nothing. Anyone re-opening this decision should
re-run that mutation before trusting a green suite.

**Unbounded shuffling of the whole pool** was rejected in the other direction: it
makes the seat a lottery and the rotation stops meaning anything. `SLACK_GENERATIONS
= 2` is the smallest value that still produces distinct months against a saturated
history.

## Consequences

- An alternative may seat a pair that rested slightly less than the most-rested
  one. Bounded to one generation back, and never the pair that served last
  Sunday. Fairness is *near*-exact, not exact — the first proposal remains exact.
- Determinism survives as a property: the seed is an **input**, not `Math.random()`.
  Same input plus same seed still gives the same month, so regenerate-and-diff
  still works and the engine stays free of `Date`/`Math.random` per the timezone
  invariant.
- `SLACK_GENERATIONS` is the fairness dial. Raising it buys variety with
  fairness; the "never seats the most recently served pair while a more rested one
  exists" test is what stops it going all the way.
- Exhaustion is reported, never papered over. If someone later "simplifies" the
  `exhausted` branch into redrawing the board anyway, «Otra opción» starts looking
  like a dead button.
