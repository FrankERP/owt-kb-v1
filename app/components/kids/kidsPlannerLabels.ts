import { KIDS_SEAT_LABELS, type KidsSeat } from "@/app/utils/kidsTypes";
import type { PairBlock, SeatView } from "@/app/utils/kidsPlannerView";

/**
 * How far back the wait clocks can see, in months.
 *
 * Three months is ~13 Sundays — three full turns of a four-pair room — so a pair
 * that does not appear in that window genuinely has been forgotten, and
 * `weeksSince === null` ("nunca", which the view sorts as most-overdue) is the
 * right answer rather than a truncation artefact.
 *
 * It lives in this module, which carries NO `"use client"`, precisely so the
 * server page and the client planner can share one number: an import from a
 * `"use client"` module into a Server Component yields a client reference, not a
 * value.
 */
export const HISTORY_MONTHS = 3;

/**
 * The words the planner puts on a blocked row — the whole point of the redesign.
 *
 * `buildPlannerView` returns every pair in a seat's pool, blocked ones included,
 * with a TYPED reason. This turns that type into Spanish. It lives apart from the
 * components because it is the one piece of the surface worth unit-testing: a
 * blocked row that says nothing is indistinguishable from a bug, and "Vale no
 * disponible" is the sentence Niza actually needs to read.
 */
export function blockLabel(block: PairBlock): string {
  switch (block.kind) {
    case "unavailable": {
      const names = block.memberNames;
      // The view names WHO is away. An empty list should not happen — the block is
      // only built from members found in `unavailable` — but a bare "no disponible"
      // beats rendering "  no disponible" if it ever does.
      if (names.length === 0) return "No disponible ese domingo";
      if (names.length === 1) return `${names[0]} no disponible`;
      return `${names.join(" y ")} no disponibles`;
    }
    case "seated":
      return `Ya tiene ${KIDS_SEAT_LABELS[block.seat]}`;
    case "wrong-room":
      return `Es de ${KIDS_SEAT_LABELS[block.room]}`;
    case "retired":
      return "Pareja retirada";
  }
}

/**
 * The worship overlap, which WARNS and never blocks (user ruling: "it wouldn't be
 * world-ending, but better if we could avoid"). Null when there is nothing to say,
 * so a caller can render nothing rather than an empty amber line.
 */
export function overlapLabel(memberNames: string[]): string | null {
  if (memberNames.length === 0) return null;
  return `También en alabanza: ${memberNames.join(" y ")}`;
}

/** "2 domingos este mes" — the load balance a column of dropdowns could not show. */
export function loadLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 domingo este mes" : `${count} domingos este mes`;
}

/**
 * May this pair take this seat — and if not, in the UI's own words.
 *
 * ONE exception to `SeatView`'s own verdict, and it is why this is a function
 * rather than a `block === null` check at three call sites: a drag that MOVES a
 * pair out of another seat on the SAME Sunday reads as `{ kind: "seated" }`,
 * because the view is built from the state before the move. Refusing it would
 * make "enseñanza → RG Medianos" — the most ordinary correction there is —
 * impossible by drag while the picker allowed it. The source seat is vacated by
 * the same update, so the invariant the server enforces (a pair holds at most one
 * seat per Sunday) still holds after it.
 */
export function canPlace(
  seatView: SeatView,
  pairId: string,
  from: { date: string; seat: KidsSeat } | null,
): { ok: true } | { ok: false; reason: string } {
  const option = seatView.options.find((candidate) => candidate.pairId === pairId);
  if (!option) return { ok: false, reason: "Esa pareja no pertenece a este lugar" };
  if (option.block === null) return { ok: true };
  if (
    option.block.kind === "seated" &&
    from !== null &&
    from.date === seatView.date &&
    from.seat === option.block.seat
  ) {
    return { ok: true };
  }
  return { ok: false, reason: blockLabel(option.block) };
}
