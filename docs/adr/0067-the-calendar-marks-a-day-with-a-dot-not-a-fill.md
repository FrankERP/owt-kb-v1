# ADR-0067: The calendar marks a day with a dot, not a fill

**Date:** 2026-10-22 · **Status:** Accepted

## Context

The member design pass (thread «Diseño para miembros», Frank's approval of item 1,
2026-10-22) looked at `/schedule` after ADR-0059 had taken the day colour off the
service cards. The calendar was the one surface still painting it as a FILL: a
Saturday cell was an amber box with an amber border and amber text, a Sunday a cyan
one, a special a purple one, in both the week strip and the three-month grid, with a
fourth legend entry («Varios servicios», a corner dot) for a day carrying two. On a
phone a month with eight services was eight coloured boxes, the same amber the alerts
use, and the selected day's solid fill was a fourth state in each colour. Under the
month title sat a native `<input type="month">` — the OS drew «septiembre de 2026» in
its own font and case right under the brand heading that already said it, and tapping
it opened a wheel the brand cannot style; it was the one control on the page that did
not look like the app.

## Decision

- **One colour device for the calendar: a 5 px dot per service, under the number, on
  a neutral cell.** `app/components/DayDots.tsx` draws the dots in `TONE_RAIL`'s
  vocabulary (`app/utils/agenda.ts`) and exports the cell classes
  (`DAY_CELL_BASE/LIT/EMPTY/TODAY/SELECTED`) that `DayStrip` and `CalendarView`'s
  `MonthGrid` compose, so the two views are one design. A lit day is a raised
  `surface-card` cell; a day with two services shows two dots (the «Varios servicios»
  legend entry is gone); today is an inset accent ring; the selected day is an accent
  fill with base-coloured dots (and a base-coloured today ring, since an accent ring
  would vanish on the accent); the day the signed-in member serves paints its number
  positive («tú», the app's one green). The legend is three dots. Both views name a
  cell through `dayCellLabel`.
- **The cells come from one derivation.** `MonthGrid` builds its month from
  `monthStripDays`, the strip's own helper, instead of its private priority logic
  (`StripDay.tones` carries one tone per service).
- **The month name is the jump-to-month control.** `ScheduleHeader`'s title is a button
  that opens a `CueDialog mode="sheet"` of one year's twelve months as pill links to
  `?m=` (`yearMonths`), with year arrows stopped at the years `parseMonthParam`
  accepts (`MIN_YEAR`–`MAX_YEAR`). The native month input is gone. The sheet
  carries no one-month steppers (the R2 Task 4 ruling stands: the header's arrows own
  «Mes anterior»/«Mes siguiente»).
- **Weekday labels are words**: `DOW_SHORT` («Lun», «Mar», «Mié»…) in the strip and as
  the grid's column headers, instead of single initials («L M X J V S D», where «X» for
  miércoles is a convention not every member knows).

## Rejected

- **Keeping the tinted cells because "the calendar colour-codes on purpose"** (ADR-0059's
  own carve-out). The purpose survives in the dot; what the fill added was the count of
  colours, and ADR-0059's finding was that the count is the problem. A dot keeps the
  Saturday/Sunday/special distinction at a glance and lets the cell carry today, «tú»
  and selection without a fourth state per colour.
- **A softer tint per tone.** Same answer as ADR-0059: fewer decibels, same number of
  colours.
- **Keeping the native month input for accessibility.** The sheet is a `CueDialog`
  (focus trap, Escape, restore) with twelve labelled links («Septiembre 2026») and two
  labelled year buttons — a screen reader gets names, not a wheel. What the native
  control had that the sheet lacks is free typing of a year far away, which nobody
  needs for a setlist archive that starts in 2026.
- **Pulsing today's ring.** The R2 `brand-today-pulse` scaled a 4 px dot to 2.4×; a ring
  on a whole cell has no dot, and scaling the cell shifts seven columns. The keyframes
  are removed rather than left orphaned.

## Consequences

Re-tinting a cell brings back the alert-coloured Saturday the audit found; adding a
corner mark for «varios» brings back the legend entry that explained it. `DayDots`
caps the row at three dots — a fourth same-day set would be counted in the label, not
drawn. The month sheet shows one year at a time; reaching 2024 is two presses of
«Año anterior», not a scroll. `lightContrast.test.ts` measures `surface-base` on
`accent` for the selected cell (the `warning-fg`/`info-fg` selected fills no longer
exist).
