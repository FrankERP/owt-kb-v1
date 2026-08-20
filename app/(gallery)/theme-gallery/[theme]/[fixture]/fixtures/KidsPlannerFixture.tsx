"use client";

// Kids planner fixture — the rotation board and the phone cards, side by side.
//
// `/kids/admin` is behind `requireMinistryManager`, so the only way to see this
// surface in both themes without a session is to host its two presentational
// halves here, the way `PlannerFixture` hosts `PlannerGrid`.
//
// IT HOSTS THE LAYOUTS, NOT `KidsPlanner` ITSELF, and that is deliberate. The
// shell owns the month picker and the four mutation handlers; mounting it on a
// PUBLIC, prerendered route would put "Publicar" one click away from anybody who
// happens to be signed in. `KidsRotationBoard` and `KidsSundayCards` take every
// handler as a prop, so this fixture passes inert ones — the same choice
// `PlannerFixture` makes with its `noop`s.
//
// BOTH layouts are mounted at once, exactly as the real planner mounts them: the
// board is `hidden md:block`, the cards are `md:hidden`. A wide capture shows the
// board and a narrow one shows the cards, from one route.
//
// The data below is a DESIGNED WORST CASE, not a happy path: a pair whose half is
// away, a pair that also serves worship that Sunday, and one seat nobody can fill.
// A screenshot of an all-green month would prove none of those states render.

import { useMemo, useState } from "react";
import { buildPlannerView } from "@/app/utils/kidsPlannerView";
import { KIDS_SEAT_LABELS, type KidsRoom, type KidsSeat } from "@/app/utils/kidsTypes";
import { KidsRotationBoard } from "@/app/components/kids/KidsRotationBoard";
import { KidsSundayCards } from "@/app/components/kids/KidsSundayCards";
import { SeatPicker } from "@/app/components/kids/SeatPicker";
import type { KidsSundayState } from "@/app/components/kids/kidsBoardProps";

// PLACEHOLDER NAMES, DELIBERATELY — do not "improve" these to the real roster.
//
// Same rule, and the same reason, as `PlannerFixture`: this route is PUBLIC and
// prerendered (ADR-0017), so a name here is published to the anonymous internet
// and is not retractable. Twelve pairs is TWENTY-FOUR real people — a far larger
// disclosure than the six first names that were removed from the planner fixture
// at 2183b3d. These are invented names of realistic Spanish shape and length, so
// the column widths and the chip truncation still get an honest workout.
//
// themeGallery.test.ts pins this set. If it is genuinely changing, change it
// there too, deliberately.
const PAIR_NAMES: [string, KidsRoom, string, string][] = [
  ["Bere y Tania", "chiquitos", "Bere", "Tania"],
  ["Iván y Rocío", "chiquitos", "Iván", "Rocío"],
  ["Nadia y Beto", "chiquitos", "Nadia", "Beto"],
  ["Pili y Quique", "chiquitos", "Pili", "Quique"],
  ["Rosa y Julio", "medianos", "Rosa", "Julio"],
  ["Tere y Uri", "medianos", "Tere", "Uri"],
  ["Mafer y Hugo", "medianos", "Mafer", "Hugo"],
  ["Gaby y Otto", "medianos", "Gaby", "Otto"],
  ["Vero y Santi", "grandes", "Vero", "Santi"],
  ["Wendy y Nico", "grandes", "Wendy", "Nico"],
  ["Lupe y Darío", "grandes", "Lupe", "Darío"],
  ["Zaira y Lalo", "grandes", "Zaira", "Lalo"],
];

const PAIRS = PAIR_NAMES.map(([name, room], index) => ({
  id: `p${index + 1}`,
  name,
  room,
  memberIds: [`p${index + 1}a`, `p${index + 1}b`] as [string, string],
  active: true,
}));

const MEMBER_NAMES: Record<string, string> = Object.fromEntries(
  PAIR_NAMES.flatMap(([, , first, second], index) => [
    [`p${index + 1}a`, first],
    [`p${index + 1}b`, second],
  ]),
);

const SUNDAYS = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"];

// Prior turns, so the wait clocks read as real numbers rather than a wall of
// "nunca" — including two rooms whose last turn is far enough back to put a
// different pair at the top of the bench.
const HISTORY = [
  { date: "2026-08-09", seats: { ensenanza: "p1", chiquitos: "p2", medianos: "p5", grandes: "p9" } },
  { date: "2026-08-16", seats: { ensenanza: "p5", chiquitos: "p3", medianos: "p6", grandes: "p10" } },
  { date: "2026-08-23", seats: { ensenanza: "p9", chiquitos: "p4", medianos: "p7", grandes: "p11" } },
  { date: "2026-08-30", seats: { ensenanza: "p2", chiquitos: "p1", medianos: "p8", grandes: "p12" } },
];

const ASSIGNMENTS = [
  { date: "2026-09-06", seats: { ensenanza: "p6", chiquitos: "p2", medianos: "p5", grandes: "p9" } },
  // The 13th deliberately leaves RG Medianos empty — see UNAVAILABLE below.
  { date: "2026-09-13", seats: { ensenanza: "p10", chiquitos: "p3", grandes: "p10" } },
  { date: "2026-09-20", seats: { ensenanza: "p3", chiquitos: "p4", medianos: "p7" } },
  { date: "2026-09-27", seats: {} as Partial<Record<KidsSeat, string>> },
];

// State 1 — a pair whose half is away, in BOTH places it can show.
//
// Quique is out on the 6th, which is the Sunday `PlannerView` anchors the bench
// to, so "Pili y Quique — Quique no disponible" is on screen in a STATIC capture
// with no interaction at all. Tania is out on the 20th, which surfaces the same
// state inside the seat picker. Without the first of those, the whole point of
// the redesign would only be provable by opening a modal.
//
// State 3 — an UNFILLABLE seat. Every medianos pair loses a member on the 13th,
// so RG Medianos that Sunday can say "Sin parejas disponibles para RG Medianos"
// instead of rendering a blank slot.
const UNAVAILABLE: Record<string, string[]> = {
  p1b: ["2026-09-20"],
  p4b: ["2026-09-06"],
  p5a: ["2026-09-13"],
  p6b: ["2026-09-13"],
  p7a: ["2026-09-13"],
  p8b: ["2026-09-13"],
};

// State 2 — a worship overlap. Amber and informational, never a block: Rosa is on
// the worship roster the same Sunday she teaches.
const WORSHIP: Record<string, string[]> = {
  "2026-09-06": ["p5a", "p6a"],
};

const noop = () => {};

/** Local noon, per the repo's timezone invariant — never a bare `new Date(iso)`. */
function label(iso: string): string {
  const text = new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function KidsPlannerFixture() {
  const [picking, setPicking] = useState<{ date: string; seat: KidsSeat } | null>(null);

  const view = useMemo(
    () =>
      buildPlannerView({
        sundays: SUNDAYS,
        pairs: PAIRS,
        assignments: ASSIGNMENTS,
        unavailable: UNAVAILABLE,
        memberNames: MEMBER_NAMES,
        history: HISTORY,
        worshipAssignments: WORSHIP,
      }),
    [],
  );

  const seatOf = (date: string, seat: KidsSeat) =>
    view.seats.find((s) => s.date === date && s.seat === seat)!;

  const sundays: KidsSundayState[] = SUNDAYS.map((date, index) => ({
    date,
    label: label(date),
    published: index === 0,
    filled: Object.keys(ASSIGNMENTS[index].seats).length,
    publishing: false,
  }));

  const boardProps = {
    sundays,
    seatOf,
    pairName: (id: string) => PAIRS.find((p) => p.id === id)?.name ?? "Pareja",
    monthLoad: view.monthLoad,
    noteFor: (date: string, seat: KidsSeat) => seatOf(date, seat).unfillableReason,
    busy: false,
    onOpenSeat: (date: string, seat: KidsSeat) => setPicking({ date, seat }),
    onTogglePublish: noop,
  };

  const pickingView = picking ? seatOf(picking.date, picking.seat) : null;

  return (
    <div data-gallery-surface="kids-planner" className="space-y-5">
      <p className="text-sm opacity-80">
        El tablero de rotación (≥ md) y las tarjetas por domingo (&lt; md) se montan a la vez, como
        en la planeación real. Los datos incluyen una pareja no disponible, un cruce con alabanza y
        un lugar que nadie puede cubrir.
      </p>

      <KidsRotationBoard
        {...boardProps}
        bench={view.bench}
        benchAnchorLabel={label(SUNDAYS[0])}
        onMove={noop}
      />
      <KidsSundayCards {...boardProps} />

      {picking && pickingView && (
        <SeatPicker
          seatView={pickingView}
          seatLabel={KIDS_SEAT_LABELS[picking.seat]}
          dateLabel={label(picking.date)}
          monthLoad={view.monthLoad}
          assignedName={
            pickingView.assignedPairId ? boardProps.pairName(pickingView.assignedPairId) : null
          }
          onChoose={() => setPicking(null)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
