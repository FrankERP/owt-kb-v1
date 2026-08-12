# Review log — Child F: Light mode, the staged rollout

**Artifact:** `2026-08-12-light-mode-F-the-rollout.md`
**Risk tier:** STANDARD — one fresh cold `APPROVED`.
**Outcome:** APPROVED at round 2. **Rounds: 2.** Written after the loop; never shown to a reviewer.

## What the two rounds found

**Round 1 — CHANGES_REQUIRED.** Three blockers, all real:

1. **The ordered rollback migrated the wrong store.** Step 3 said to rewrite stored
   `"system"` values in Sanity before flipping `enableSystem` back. But the pre-hydration
   seed reads `localStorage.getItem("theme")`, not Sanity — so those browsers would still
   seed `"system"` with the flag now false and land in the class-less document. Worse, the
   mirror population is *strictly larger* than the chose-system population: the storage
   listener writes `defaultTheme` back into every other open tab on any key removal, so
   members who never chose anything acquire a `"system"` mirror a Sanity migration cannot
   see. The rollback now reconciles the client mirror first, via a bumped migration key that
   must **ship and reach the team** before the flag moves.
2. **F1 shipped an announcement that was false while F1 was live.** Its copy promises the
   app follows your phone — untrue until F2 — and F1 deliberately withheld the button that
   would let anyone act on it. I had caught that exact error for the button one sentence
   earlier and made it again for the banner.
3. **The stale-claim sweep was a guessed pattern.** Replaced with a derived one whose output
   is eleven sites, not the three I had listed — including `ROUTES.md`, which §12 names and
   my doc table omitted entirely, and `UTILITIES_AND_COMPONENTS.md:147`, stale since E4.

**Round 2 — APPROVED**, with six non-blocking notes, all folded in before implementation:
the sweep command errored as printed (line-wrapped, so `ugrep` fails and GNU grep silently
drops its last alternative); the guards F inverts are six, not four, and two invert at F1;
F1's inertness was a UI claim stated as a general one, closed by merging F1+F2; the
`ThemePref` **type** widening was implied but unstated; two more stale comments no grep
would reach; and the banner's "aquí abajo" needed to be an anchor, since the control sits
most of a phone-page below it.

## What implementation found that neither round did

- **A seventh E-era guard to invert.** `themeWiring.test.ts`'s repair-ordering assertion
  still named `setTheme("dark")`. Found by running the suite, not by reading.
- **My own three-way guard had a regex bug** — `THEME_MIGRATION_SCRIPT[^;]*` stops at the
  first `;`, and the script body is full of them, so it was asserting against the opening
  clause only. Caught because the guard failed on correct code.
- **The three-way guard was then fire-proofed** by reverting copy 2 alone: two tests go red.
  That is the silent partial rollout it exists to catch.

## The lesson worth keeping

Child E's review took 19 rounds; F's took 2. The difference was not luck or a smaller
change — it was that **F's plan was written after E's, by someone who had already paid for
E's mistakes.** The three-copies-of-the-default hazard, the `enableSystem` landmine, the
"a claim you falsify need not contain the word you grep for" rule, and the fail-soft
`localStorage` discipline were all in the plan's first draft *because E's rounds had put
them in the code comments and the handoff notes.* Writing the handoff down is what made the
next child cheap.
