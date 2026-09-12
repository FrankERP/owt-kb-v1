// The drag-select model for the availability grid.
//
// Pure and neutral on purpose: jsdom performs no layout, so a drag's
// arithmetic — which days a pointer has crossed, how solid the "next month"
// shadow looks at a given distance, what element sits under a point — is
// tested here with no DOM (or a minimal fake) rather than through a rendered
// grid. `AvailabilityCalendar` only wires pointer events to these functions;
// it carries no selection logic of its own to test.

/** The long Spanish day label — the popover's title, and both surfaces' a11y names. */
export function fmtDayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

/**
 * Every `YYYY-MM-DD` from `min(a,b)` to `max(a,b)` inclusive, ascending.
 *
 * Reversed args normalise (the drag can run either direction). Days before
 * `todayIso` are dropped — `applyRange` already skips them on commit, and the
 * preview must agree or it would show a day it cannot actually mark. Capped
 * at 366 iterations against a runaway span (e.g. a mis-ordered pair spanning
 * years) rather than looping unbounded.
 */
export function isoRange(a: string, b: string, todayIso: string): string[] {
  const [start, end] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  let cur = new Date(start.slice(0, 10) + "T12:00:00");
  const last = new Date(end.slice(0, 10) + "T12:00:00");
  for (let i = 0; i < 366 && cur <= last; i++) {
    const iso = cur.toISOString().slice(0, 10);
    if (iso >= todayIso) out.push(iso);
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 12);
  }
  return out;
}

/**
 * How solid the next month's "shadow" tile is at `distancePx` from the
 * threshold that reveals it — `0` (invisible) at or beyond `reach`, `1`
 * (fully solid) at zero distance, linear between. A `NaN` or negative
 * distance reads as "already there" rather than "far away".
 */
export function shadowOpacity(distancePx: number, reach = 120): number {
  if (Number.isNaN(distancePx) || distancePx < 0) return 1;
  if (distancePx >= reach) return 0;
  return 1 - distancePx / reach;
}

/**
 * The `data-iso` of the day host under a viewport point, or `null`.
 *
 * A shadow tile that is not yet solid (`data-shadow="true" data-solid="false"`)
 * is not selectable — the finger has to actually reach it, not just pass near
 * it. The shadow flag lives on the month tile, an ancestor of the cell. `doc`
 * defaults to `document` but is injectable so this is testable with a fake
 * `elementFromPoint` and no real layout.
 */
export function isoFromPoint(
  x: number,
  y: number,
  doc: Pick<Document, "elementFromPoint"> = document,
): string | null {
  const el = doc.elementFromPoint(x, y);
  const host = el?.closest("[data-iso]");
  if (!host) return null;
  const shadow = el?.closest("[data-shadow]");
  if (shadow?.getAttribute("data-shadow") === "true" && shadow.getAttribute("data-solid") === "false") {
    return null;
  }
  return host.getAttribute("data-iso");
}

/**
 * The Spanish range title for the note popover: «del 12 al 15 de septiembre»
 * within one month, «del 30 de octubre al 1 de noviembre» across a boundary.
 * A single-day range falls back to `fmtDayLabel`.
 */
export function rangeLabel(first: string, last: string): string {
  if (first === last) return fmtDayLabel(first);
  const d1 = new Date(first + "T12:00:00");
  const d2 = new Date(last + "T12:00:00");
  const day1 = d1.getDate();
  const day2 = d2.getDate();
  const month1 = d1.toLocaleDateString("es-MX", { month: "long" });
  const month2 = d2.toLocaleDateString("es-MX", { month: "long" });
  if (month1 === month2 && d1.getFullYear() === d2.getFullYear()) {
    return `del ${day1} al ${day2} de ${month1}`;
  }
  return `del ${day1} de ${month1} al ${day2} de ${month2}`;
}
