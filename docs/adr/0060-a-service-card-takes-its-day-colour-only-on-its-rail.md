# ADR-0060: A service card takes its day colour only on its rail

**Date:** 2026-10-20 · **Status:** Accepted

## Context

A design audit (thread «Qué le falta para verse premium», Frank's approval of
"superficies y color") found the most-seen surface in the app, the weekend
`DayCard`, carrying four colours at once. Saturday tinted the border, a glow, the
header ground, the date, every section label, the song keys, the medley spine and
the instrument chips in the `warning` family. That is the same amber the alerts
use, so the card read as a warning, and in light mode it was a pale yellow band.
The cards were also translucent over a six-layer page wash with diagonal bands, so
the bands showed through every card and cut long lists in half.

## Decision

- **One device for the day.** `DayCard` and `DayCardDisclosure` mark the day with
  a 3 px rail down the left edge, in the agenda's tone vocabulary (`TONE_RAIL`,
  `app/utils/agenda.ts`). The agenda's rows use the same map. Nothing else on the
  card takes the tone.
- **The rest of the card is neutral.** Dates are `ink-dim`, keys are `ink`, and
  labels, chips and the medley spine are `mono-400`/`ink-dim`. The countdown pill
  is neutral too. Cyan stays on what can be pressed (Ensayar, Practicar), and
  green only marks «tú».
- **Cards are opaque.** `.brand-surface`, `.brand-library-module` and
  `.brand-search-console` paint `--surface-card`: raised-alt navy in dark and
  white in light. Light's page moved to `#f5f7fa`. `.brand-atmosphere` is one
  radial glow at the top (`--atmosphere-glow`, 16% in dark and 5% in light).

## Rejected

- **A softer amber for Saturday.** It reduces how loud the colour is but not how
  many colours there are. The count is the problem: when colour is everywhere it
  stops meaning anything.
- **Dark card ground `--surface-raised` (13 34 52).** `mono-600` text measured
  4.3:1 on it, under the 4.5 floor the 2026-08-12 raise was tuned for. On
  raised-alt (10 25 41) it measures 4.7:1.
- **Changing the typography in the same pass.** Frank rejected the font change and
  the move away from uppercase titles. Fonts and uppercase titles stay.

## Consequences

Saturday still reads as orange and Sunday as blue, but only on the rail and in the
calendar's strip and grid, which colour-code days on purpose. Re-tinting the
header or the labels brings back the alert-coloured Saturday. Making `--surface-card`
translucent again brings back the page bands showing through cards.
