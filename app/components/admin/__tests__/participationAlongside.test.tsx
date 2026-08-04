/** @vitest-environment jsdom */
// The participation panel beside the two editing surfaces.
//
// The ONE thing worth pinning here is that the panel counts the work in
// progress, not just what is stored. A panel fed only `savedWindow` renders
// perfectly, sorts perfectly, and reports a member at 5 while the admin is in
// the act of making them 7 — a wrong answer that looks exactly like a right
// one. So every test below moves a seat and asserts the number MOVED, and each
// one was checked against a deliberately broken build (drop the draft half of
// the union / drop the saved half / stop excluding the edited service) before
// being kept.
//
// The second thing, and the reason the grid's fixtures below carry a service
// from a month nobody is planning: the grid's rail is SCOPED TO THE MONTH BEING
// GENERATED (`participationSaved` in `MonthGenerator`) — the drafts on screen
// plus everything already saved in that month, and nothing from any other. The
// Tablero is deliberately NOT month-scoped: it edits one service on one date and
// its `windowRoles` is a rolling 56-day window anchored at that date
// (`ServicesPanel.recentRolesWindow`), which is the right baseline for a
// one-service decision and the wrong one for "is this month fair".
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { MIN_WIDTH, RAIL_WIDTH } from "../ParticipationRail";
import SeatBoard, { boardParticipationRoles } from "../SeatBoard";
import { buildColumns, plannerParticipationRoles, type GridCell, type SavedRole } from "../plannerModel";
import { computeParticipation, type ParticipantRole } from "@/app/utils/computeParticipation";
import type { AssignedSeat, RankMember } from "../candidateRanking";
import type { ServiceRole } from "../serviceCardModel";
import { readyRules } from "./rulesHarness";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const members: RankMember[] = [
  { _id: "m1", member_name: "Frank", memberType: ["voz", "sunday_lead"] },
  { _id: "m2", member_name: "Gaby", memberType: ["voz", "sunday_lead"] },
  { _id: "m3", member_name: "Liu", memberType: ["voz"] },
  { _id: "d1", member_name: "Samo", memberType: ["instrumento"] },
];

const person = (id: string) => ({ _id: id, member_name: members.find((m) => m._id === id)!.member_name });

/** A saved Sunday whose Lead is `leadId`. */
function savedSunday(date: string, leadId: string, extra: Partial<ParticipantRole> = {}): ParticipantRole {
  return {
    _type: "sunday_role",
    date,
    leads: [person(leadId)],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...extra,
  };
}

/** A saved special on `date`, named `name`, whose Lead is `leadId`. */
function savedSpecial(date: string, name: string, leadId: string): SavedRole {
  return {
    _type: "special_role",
    date,
    service_name: name,
    leads: [person(leadId)],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
  };
}

/**
 * The rendered rail, wherever it landed.
 *
 * Two places, on purpose. The GUTTER placement is portalled to `document.body`
 * (`ParticipationRail`, and the WebKit reason is in its header), so it is not
 * under the render container; the in-flow fallback still is. Looking in the
 * container first and the document second finds exactly one either way — and
 * keeps every assertion below asking the same question it asked before the
 * portal, rather than being softened to accommodate it.
 *
 * `selector` narrows to one surface where a test needs to; the default matches
 * either.
 */
function findRail(container: HTMLElement, selector = "[data-participation-rail]"): HTMLElement | null {
  return container.querySelector<HTMLElement>(selector) ?? document.body.querySelector<HTMLElement>(selector);
}

/** The big number the sidebar renders for a member, or `null` when absent. */
function railTotal(container: HTMLElement, name: string): number | null {
  const rail = findRail(container);
  if (!rail) throw new Error("no participation rail rendered");
  const nameEl = within(rail as HTMLElement).queryByText(name);
  if (!nameEl) return null;
  // Row shape (`ParticipationSidebar.tsx:73-88`): the name sits two levels
  // inside the row, and the row's last child is the total.
  const row = nameEl.parentElement!.parentElement!;
  return Number(row.lastElementChild!.textContent);
}

// ─── The grid's arithmetic, without a DOM ────────────────────────────────────

describe("plannerParticipationRoles — saved + drafts, each service once", () => {
  const columns = buildColumns({ sundayDates: ["2026-02-01", "2026-02-08"], activeSatDates: [] });

  it("sums the saved history and the drafts on screen", () => {
    const saved = [savedSunday("2026-01-04", "m1"), savedSunday("2026-01-11", "m1")];
    const cells: GridCell[] = [
      { date: "2026-02-01", rowId: "lead", memberIds: ["m1"], origin: "manual" },
    ];
    const totals = computeParticipation(plannerParticipationRoles({ saved, creatableColumns: columns, cells, members }));
    // 2 saved + 1 draft. Either half alone gives 2 or 1 — only the union gives 3.
    expect(totals.find((r) => r.name === "Frank")!.total).toBe(3);
  });

  it("counts a saved service the grid is NOT planning", () => {
    const totals = computeParticipation(
      plannerParticipationRoles({ saved: [savedSunday("2026-01-04", "m2")], creatableColumns: columns, cells: [], members }),
    );
    expect(totals.find((r) => r.name === "Gaby")!.total).toBe(1);
  });

  it("counts a service present on BOTH sides once, from the draft", () => {
    // The same Sunday, saved with Gaby and re-planned with Frank.
    const saved = [savedSunday("2026-02-01", "m2")];
    const cells: GridCell[] = [
      { date: "2026-02-01", rowId: "lead", memberIds: ["m1"], origin: "manual" },
    ];
    const totals = computeParticipation(plannerParticipationRoles({ saved, creatableColumns: columns, cells, members }));
    expect(totals.find((r) => r.name === "Frank")!.total).toBe(1);
    expect(totals.find((r) => r.name === "Gaby")).toBeUndefined();
  });

  it("keeps the saved service when the grid's column for it is EMPTY", () => {
    // A creatable column with nobody in it makes no claim about who serves.
    const totals = computeParticipation(
      plannerParticipationRoles({ saved: [savedSunday("2026-02-01", "m2")], creatableColumns: columns, cells: [], members }),
    );
    expect(totals.find((r) => r.name === "Gaby")!.total).toBe(1);
  });

  it("ignores a column that will NOT be created, and keeps its saved roster", () => {
    // The Auto trap. `applySolveResponse` and `applySpecialFill` both seat
    // people into columns that will never reach Sanity — an already-existing
    // mid-month service among them. If those seats counted, the solver's
    // invention would report as serving AND displace the real roster.
    const saved = [savedSunday("2026-02-01", "m2")];
    const cells: GridCell[] = [
      { date: "2026-02-01", rowId: "lead", memberIds: ["m1"], origin: "auto" },
    ];
    const totals = computeParticipation(
      // 2026-02-01 exists already, so it is not among the creatable columns.
      plannerParticipationRoles({
        saved,
        creatableColumns: columns.filter((c) => c.date !== "2026-02-01"),
        cells,
        members,
      }),
    );
    expect(totals.find((r) => r.name === "Gaby")!.total).toBe(1); // the truth survives
    expect(totals.find((r) => r.name === "Frank")).toBeUndefined(); // the invention does not
  });

  // ── Two specials, one date ────────────────────────────────────────────────
  //
  // A special's identity on the server is `special_role:${date}:${name}`
  // (`roleCreationReceipt.ts`), so a date can legitimately hold two of them and
  // the grid can plan the second while the first is already stored. A dedup key
  // of `_type|date` alone cannot tell them apart, and the populated draft wins:
  // the whole saved roster disappears from a chart whose only job is to say who
  // has served. That is the same failure the `creatableColumns` fix closed, one
  // layer down.

  it("keeps a saved special when the grid plans a DIFFERENTLY NAMED one on the same date", () => {
    // The reviewer's case, verbatim. "Vigilia" is stored on 2026-02-11 with Gaby
    // leading; the admin adds "Retiro" on the same date (a different name, so
    // not `isExisting`, so creatable) and seats Frank.
    const specialColumns = buildColumns({
      sundayDates: [],
      activeSatDates: [],
      specials: [{ date: "2026-02-11", name: "Retiro" }],
    });
    const cells: GridCell[] = [
      { date: "2026-02-11", rowId: "lead", memberIds: ["m1"], origin: "manual" },
    ];
    const totals = computeParticipation(
      plannerParticipationRoles({
        saved: [savedSpecial("2026-02-11", "Vigilia", "m2")],
        creatableColumns: specialColumns,
        cells,
        members,
      }),
    );
    // Both served, on two different services. With a name-blind key Gaby is
    // absent entirely — a person who served reading as never having served.
    expect(totals.find((r) => r.name === "Gaby")!.especial).toBe(1);
    expect(totals.find((r) => r.name === "Gaby")!.total).toBe(1);
    expect(totals.find((r) => r.name === "Frank")!.total).toBe(1);
  });

  it("still counts a re-planned special ONCE when the name is the same", () => {
    // The other direction, and why widening the key is not "never dedup a
    // special": same date AND same name is the same service, so the draft
    // replaces the stored copy exactly as it does for a Sunday.
    const specialColumns = buildColumns({
      sundayDates: [],
      activeSatDates: [],
      specials: [{ date: "2026-02-11", name: "Vigilia" }],
    });
    const cells: GridCell[] = [
      { date: "2026-02-11", rowId: "lead", memberIds: ["m1"], origin: "manual" },
    ];
    const totals = computeParticipation(
      plannerParticipationRoles({
        saved: [savedSpecial("2026-02-11", "Vigilia", "m2")],
        creatableColumns: specialColumns,
        cells,
        members,
      }),
    );
    expect(totals.find((r) => r.name === "Frank")!.total).toBe(1);
    expect(totals.find((r) => r.name === "Gaby")).toBeUndefined();
  });

  it("matches the name the way the SERVER does — normalized, never lowercased", () => {
    // `normalizeServiceName` collapses whitespace and NFC-normalizes, so the
    // admin retyping "  Vigilia   de  Oración " is still the same service; a
    // `.toLowerCase()` would make "vigilia" the same service too, and the
    // server (`roleWriteOps.ts`) says it is not.
    const columnsFor = (name: string) =>
      buildColumns({ sundayDates: [], activeSatDates: [], specials: [{ date: "2026-02-11", name }] });
    const cells: GridCell[] = [
      { date: "2026-02-11", rowId: "lead", memberIds: ["m1"], origin: "manual" },
    ];
    const saved = [savedSpecial("2026-02-11", "Vigilia de Oración", "m2")];

    const collapsed = computeParticipation(
      plannerParticipationRoles({ saved, creatableColumns: columnsFor("  Vigilia   de  Oración "), cells, members }),
    );
    expect(collapsed.find((r) => r.name === "Gaby")).toBeUndefined(); // one service

    const otherCase = computeParticipation(
      plannerParticipationRoles({ saved, creatableColumns: columnsFor("vigilia de oración"), cells, members }),
    );
    expect(otherCase.find((r) => r.name === "Gaby")!.total).toBe(1); // two services
  });
});

// ─── The Tablero's arithmetic, without a DOM ─────────────────────────────────

describe("boardParticipationRoles — the edited service, live", () => {
  const assigned: AssignedSeat[] = [
    { seatId: "lead", category: "voz", memberId: "m1" },
    { seatId: "instrumento:Bass", category: "instrumento", memberId: "d1" },
  ];

  it("replaces the SAVED copy of the service being edited with the live seats", () => {
    const saved = [
      { ...savedSunday("2026-02-08", "m2"), _id: "role-1" },
      savedSunday("2026-01-04", "m2"),
    ];
    const roles = boardParticipationRoles({
      saved,
      savedId: "role-1",
      type: "sunday_role",
      date: "2026-02-08",
      assigned,
      members,
    });
    const totals = computeParticipation(roles);
    // Gaby held the Lead of role-1 when it was saved and has been swapped out:
    // she keeps only her January service. Counting both copies would give her 2.
    expect(totals.find((r) => r.name === "Gaby")!.total).toBe(1);
    expect(totals.find((r) => r.name === "Frank")!.total).toBe(1);
    expect(totals.find((r) => r.name === "Samo")!.instrWeeks).toBe(1);
  });

  it("drops nothing when there is no saved service yet (create mode)", () => {
    const roles = boardParticipationRoles({
      saved: [savedSunday("2026-01-04", "m2")],
      savedId: undefined,
      type: "sunday_role",
      date: "2026-02-08",
      assigned,
      members,
    });
    const totals = computeParticipation(roles);
    expect(totals.find((r) => r.name === "Gaby")!.total).toBe(1);
    expect(totals.find((r) => r.name === "Frank")!.total).toBe(1);
  });

  it("counts the Coro seat and the FOH seat, not only Lead and instruments", () => {
    // `inSeat("coro")` and `inCategory("foh")` were the two lines in
    // `boardParticipationRoles` that no test touched: replacing either with `[]`
    // left the whole suite green while the rail silently under-counted the
    // people in those seats.
    const roles = boardParticipationRoles({
      saved: [],
      type: "sunday_role",
      date: "2026-02-08",
      assigned: [
        { seatId: "coro", category: "voz", memberId: "m3" },
        { seatId: "foh:Sonido", category: "foh", memberId: "d1" },
      ],
      members,
    });
    const totals = computeParticipation(roles);
    expect(totals.find((r) => r.name === "Liu")!.coro).toBe(1);
    expect(totals.find((r) => r.name === "Liu")!.total).toBe(1);
    expect(totals.find((r) => r.name === "Samo")!.fohWeeks).toBe(1);
  });

  it("drops the edited service by _id, not by date — the board can MOVE the date", () => {
    // The date input is editable, so the live role's date is not the stored
    // one's. A date match would keep the stored copy and count Gaby twice.
    const roles = boardParticipationRoles({
      saved: [{ ...savedSunday("2026-02-08", "m2"), _id: "role-1" }],
      savedId: "role-1",
      type: "sunday_role",
      date: "2026-02-15",
      assigned,
      members,
    });
    const totals = computeParticipation(roles);
    expect(totals.find((r) => r.name === "Gaby")).toBeUndefined();
    expect(totals.find((r) => r.name === "Frank")!.total).toBe(1);
  });

  it("keeps the OTHER special saved on the date the edited one shares", () => {
    // Two specials can share a date (`special_role:${date}:${name}`). Matching
    // on date would drop both and erase a roster nobody is editing.
    const roles = boardParticipationRoles({
      saved: [
        { ...savedSpecial("2026-02-11", "Vigilia", "m2"), _id: "role-1" },
        { ...savedSpecial("2026-02-11", "Retiro", "m3"), _id: "role-2" },
      ],
      savedId: "role-1",
      type: "special_role",
      date: "2026-02-11",
      assigned,
      members,
    });
    const totals = computeParticipation(roles);
    expect(totals.find((r) => r.name === "Liu")!.total).toBe(1); // Retiro, untouched
    expect(totals.find((r) => r.name === "Gaby")).toBeUndefined(); // Vigilia's stored Lead, swapped out
    expect(totals.find((r) => r.name === "Frank")!.total).toBe(1); // the live seats
  });

  it("round-trips an id with no member record rather than dropping the person", () => {
    const roles = boardParticipationRoles({
      saved: [],
      type: "sunday_role",
      date: "2026-02-08",
      assigned: [{ seatId: "lead", category: "voz", memberId: "ghost" }],
      members,
    });
    expect(roles[0].leads).toEqual([{ _id: "ghost" }]);
  });
});

// ─── The planner grid, end to end ────────────────────────────────────────────

/**
 * A wide (or deliberately narrow) viewport.
 *
 * The rail chooses its placement from `matchMedia` (`ParticipationRail`), and
 * jsdom neither implements `matchMedia` nor lays anything out — so a test that
 * does not stub it exercises the FALLBACK placement and nothing else. Both
 * surfaces need this, for opposite reasons: the Tablero renders no rail at all
 * below its threshold, while the grid's rail renders inline. Every `goToGrid`
 * test in this file predates the stub and therefore only ever rendered the
 * inline branch — which is how a select that overflowed the fixed rail by 47px
 * shipped under a green suite. The gutter branch is covered explicitly below.
 *
 * `queries` records what the component ASKED for, so a test can prove which
 * threshold a surface used rather than inferring it from the answer.
 */
function stubWideViewport(wide = true, queries: string[] = []) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => {
      queries.push(query);
      return {
        matches: wide,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    },
  );
  return queries;
}

/**
 * `MonthGenerator` step 1 → step 2, on a month with a single Sunday column so
 * the grid is small enough to reason about. February 2026 starts on a Sunday.
 */
function goToGrid(
  allRoles: ParticipantRole[],
  existingRoles: { _id: string; _type: string; date: string }[] = [],
  // `container` mounts the generator inside a caller-supplied node — the only
  // way to put a real `.brand-admin-shell` above it, which the portal tests
  // need. Everything else renders into RTL's default node as before.
  options: { container?: HTMLElement } = {},
) {
  const view = render(
    <MonthGenerator
      members={members}
      existingRoles={existingRoles}
      allRoles={allRoles}
      rules={readyRules()}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />,
    options.container ? { container: options.container } : undefined,
  );
  const { container } = view;
  fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: "2" } });
  fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, {
    target: { value: "2026" },
  });
  for (const kind of ["saturday", "sunday"] as const) {
    for (const date of Array.from(container.querySelectorAll(`[data-day-kind="${kind}"]`)).map((el) =>
      el.getAttribute("data-date"),
    )) {
      const cell = container.querySelector(`[data-date="${date}"]`);
      // Keep 2026-02-01 only.
      const wanted = kind === "sunday" && date === "2026-02-01";
      if (cell?.getAttribute("data-selected") === "true" !== wanted) fireEvent.click(cell!);
    }
  }
  fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
  return view;
}

/** Seat `name` in the Lead cell of `date` through the real picker. */
function seatLead(container: HTMLElement, date: string, name: string) {
  fireEvent.click(container.querySelector(`[data-row-id="lead"][data-date="${date}"]`)!);
  const li = screen
    .getAllByText(name)
    .map((el) => el.closest("li"))
    .find((el): el is HTMLLIElement => el !== null);
  if (!li) throw new Error(`no candidate row for ${name}`);
  fireEvent.click(li);
}

describe("the planner grid's rail counts the drafts being built", () => {
  it("raises a member's total the moment they are seated in the grid", () => {
    // Two saved Sundays led by Frank: one INSIDE the month being generated
    // (counts) and one in January, inside D12's 56-day ranking lookback but
    // outside the month (does not). The numbers below are the same ones this
    // test has always asserted; the January service is here so that restoring
    // the lookback to `participationSaved` makes them 2 and 3 instead.
    const { container } = goToGrid([savedSunday("2026-02-08", "m1"), savedSunday("2026-01-04", "m1")]);

    expect(railTotal(container, "Frank")).toBe(1); // saved only
    seatLead(container, "2026-02-01", "Frank");
    // THE ASSERTION THIS FILE EXISTS FOR. Deleting the draft half of the union
    // in `plannerParticipationRoles` leaves this at 1 and fails here.
    expect(railTotal(container, "Frank")).toBe(2);
  });

  it("shows a member who exists only in a draft, and one who exists only in history", () => {
    // "History" is now history WITHIN the month: Gaby's 15-Feb service counts,
    // her January one does not. Restoring the lookback puts her at 2 below.
    const { container } = goToGrid([savedSunday("2026-02-15", "m2"), savedSunday("2026-01-04", "m2")]);

    expect(railTotal(container, "Gaby")).toBe(1); // history only
    expect(railTotal(container, "Liu")).toBeNull(); // nowhere yet
    seatLead(container, "2026-02-01", "Liu");
    expect(railTotal(container, "Liu")).toBe(1); // draft only
    expect(railTotal(container, "Gaby")).toBe(1); // and history survived the draft
  });

  it("counts a service saved LATER in the planned month, outside D12's lookback", () => {
    // `savedWindowFor` ends AT the month's first Sunday, so a 22-Feb service is
    // outside the ranking window entirely. For ranking that is right; for "is
    // this month fair" it is a hole — half a month generated last week would be
    // invisible. `participationSaved` filters `allRoles` by the month's prefix,
    // and that is the only thing that makes Gaby appear.
    const { container } = goToGrid([savedSunday("2026-02-22", "m2")]);
    expect(railTotal(container, "Gaby")).toBe(1);
  });

  it("ignores seats on a column it will NOT create, and keeps that service's real roster", () => {
    // The wiring half of the Auto trap: `MonthGenerator` must hand the rail the
    // columns `isCreatable` accepts, not the columns on screen. A Sunday that
    // already exists still gets a column, and BOTH fillers seat people into it
    // (`applySolveResponse` has no isExisting test; `applySpecialFill` says so
    // in its own comment). Passing `columns` here instead of `creatableColumns`
    // makes the invention below count AND displaces Gaby's real roster.
    const { container } = goToGrid(
      [savedSunday("2026-02-01", "m2")],
      [{ _id: "role-1", _type: "sunday_role", date: "2026-02-01" }],
    );

    expect(railTotal(container, "Gaby")).toBe(1);
    seatLead(container, "2026-02-01", "Frank");
    expect(railTotal(container, "Frank")).toBeNull(); // never going to be created
    expect(railTotal(container, "Gaby")).toBe(1); // and the truth was not displaced
  });

  it("un-seating a member takes the count back down", () => {
    const { container } = goToGrid([]);
    seatLead(container, "2026-02-01", "Frank");
    expect(railTotal(container, "Frank")).toBe(1);
    seatLead(container, "2026-02-01", "Frank"); // the picker toggles
    expect(railTotal(container, "Frank")).toBeNull();
  });
});

// ─── The scope: the month being generated, and only it ───────────────────────
//
// "It should show the participations for the month that is being created" —
// and yes, services already SAVED in that month count. The rail used to add
// D12's rolling 56-day lookback on top, which answers a different question than
// the one the admin is holding: a chart headed "Febrero" carrying January's
// load cannot be read against the February grid beside it, and an empty grid
// never started from zero.
//
// Every test here was checked against a build with the lookback restored
// (`inWindow.has(r) ||` back in `participationSaved`); each one fails there.

describe("the grid's rail is scoped to the month being generated", () => {
  it("reads everyone at ZERO on an empty grid, however busy the weeks before were", () => {
    // Both services are inside the 56-day window ending at 2026-02-01, so with
    // the lookback restored Frank reads 1 and Gaby reads 1 right here — the
    // starting line the admin expects to be clean is not.
    const { container } = goToGrid([savedSunday("2026-01-04", "m1"), savedSunday("2026-01-25", "m2")]);

    expect(railTotal(container, "Frank")).toBeNull();
    expect(railTotal(container, "Gaby")).toBeNull();
    // Zero as the chart's ANSWER, not as its absence: the rail is mounted and
    // says so in Spanish.
    expect(findRail(container)).not.toBeNull();
    expect(screen.getByText("Sin participaciones en voces.")).toBeTruthy();
  });

  it("counts a service saved in the month even though it is NOT on screen", () => {
    // The second-pass case, and the reason saved-in-month counts at all:
    // generate February, create some services, come back and generate the rest.
    // Only 2026-02-01 is selected here, so 2026-02-15 has no column — it is not
    // a draft, it is not re-planned, and it is still February's load.
    const { container } = goToGrid([savedSunday("2026-02-15", "m2")]);
    expect(railTotal(container, "Gaby")).toBe(1);
  });

  it("ignores a saved service from an adjacent month, either side", () => {
    // 2026-01-25 is a week before the month starts and 2026-03-01 the day after
    // it ends — the two dates a month-prefix filter gets wrong if it is ever
    // rewritten as a date-range comparison.
    const { container } = goToGrid([savedSunday("2026-01-25", "m1"), savedSunday("2026-03-01", "m2")]);
    expect(railTotal(container, "Frank")).toBeNull();
    expect(railTotal(container, "Gaby")).toBeNull();
  });

  it("counts a service that is BOTH saved in the month and re-planned in the grid, once", () => {
    // The de-duplication, end to end rather than only in `plannerParticipationRoles`:
    // now that the whole month is in scope, every saved service the grid re-plans
    // is a collision. Dropping the dedup key double-counts Frank to 2 here.
    const { container } = goToGrid([savedSunday("2026-02-01", "m1")]);

    expect(railTotal(container, "Frank")).toBe(1); // the saved copy, column empty
    seatLead(container, "2026-02-01", "Frank");
    expect(railTotal(container, "Frank")).toBe(1); // the draft copy — still ONE service
  });

  it("re-scopes when the admin changes the month, without a remount", () => {
    // `participationSaved` is memoised on `[allRoles, year, month]`. Keyed on
    // `allRoles` alone (or on a `savedWindow` that no longer feeds it) February's
    // roster would still be on screen while the grid shows March.
    const { container } = goToGrid([savedSunday("2026-02-08", "m1"), savedSunday("2026-03-08", "m2")]);
    expect(railTotal(container, "Frank")).toBe(1);
    expect(railTotal(container, "Gaby")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    expect(railTotal(container, "Frank")).toBeNull();
    expect(railTotal(container, "Gaby")).toBe(1);
  });
});

// ─── The grid's chart is a COLUMN now, at every width ────────────────────────
//
// It used to be `position: fixed` in the page's left gutter above 1700px and an
// inline block below it. Both are gone. The admin page caps its content at
// `max-w-7xl` (1280px), so the 1512px laptop this app is planned on has ~116px
// of gutter and never saw a 216px chart at all — the gutter answer never reached
// the machine it was for. It is now the left column of `PlannerGrid`'s
// three-column workspace, in the flow, taking real width from the grid on every
// machine including the ultrawide where the gutter did work. That trade was
// asked for explicitly; the tests below are what stop it drifting back.
//
// WHAT THIS CANNOT DO: jsdom has no layout engine. `getBoundingClientRect` is all
// zeroes and `scrollWidth` is 0, so nothing here can prove the three columns fit
// a 1512px viewport, or that the chart's content fits inside 190px. What is
// assertable is the CONTRACT that produces the fit: which placement was taken,
// that no viewport threshold is consulted at all any more, the classes that size
// the tracks, and the `w-full` that stops the select from setting the chart's
// width. A real-browser measurement at 1512×982 is still the only thing that can
// catch an overflow.

describe("the grid's chart placement — an in-flow column, at every width", () => {
  for (const wide of [true, false]) {
    it(`is a column, never the gutter, on a ${wide ? "wide" : "narrow"} viewport`, () => {
      // Parametrised on purpose. The old behaviour differed by viewport (fixed
      // gutter above 1700, inline below), so a single-width test could not tell
      // "always a column" from "still branching". Both widths, one answer.
      stubWideViewport(wide);
      const { container } = goToGrid([savedSunday("2026-02-08", "m1")]);
      const rail = findRail(container, '[data-participation-rail="panel"]') as HTMLElement;

      expect(rail).not.toBeNull();
      expect(rail.getAttribute("data-rail-placement")).toBe("column");
      // Nothing viewport-anchored: `fixed` inside `.brand-admin-shell` is the
      // shape that needed the portal, and re-introducing any of it here would
      // re-introduce the Safari paint bug along with it.
      for (const cls of ["fixed", "left-2", "top-24", "top-20", `w-[${RAIL_WIDTH}px]`]) {
        expect(rail.className.split(/\s+/)).not.toContain(cls);
      }
      // The track width the layout arithmetic is stated in (`PlannerGrid.tsx`'s
      // header, `app/brand.css`), applied only once there is room for a row.
      expect(rail.className.split(/\s+/)).toContain("xl:w-[190px]");
      // Placement only: the chart still counts what it always counted.
      expect(railTotal(container, "Frank")).toBe(1);
      seatLead(container, "2026-02-01", "Frank");
      expect(railTotal(container, "Frank")).toBe(2);
    });
  }

  it("consults NO viewport threshold — the column is unconditional", () => {
    // The grid's chart no longer goes through `ParticipationRail` at all, so it
    // asks `matchMedia` nothing. A query reappearing here means someone put the
    // branch back, and the 1512px laptop loses the chart again silently.
    const queries = stubWideViewport();
    goToGrid([]);
    expect(queries.filter((q) => q.includes("min-width"))).toEqual([]);
    expect(queries).not.toContain(`(min-width: ${MIN_WIDTH.dialog}px)`);
  });

  it("gives the candidate picker its own column, only while a cell is active", () => {
    // The interaction change the three-column layout is: the picker was an
    // in-place popover under the grid and is now a persistent right column. It
    // must NOT be mounted while idle — an always-present 240px panel is 240px
    // the grid does not have for the time nobody is picking anybody.
    stubWideViewport();
    const { container } = goToGrid([]);
    expect(container.querySelector("[data-candidate-picker]")).toBeNull();

    fireEvent.click(container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]')!);
    const picker = container.querySelector("[data-candidate-picker]") as HTMLElement;
    expect(picker).not.toBeNull();
    expect(picker.className.split(/\s+/)).toContain("xl:w-[240px]");
    // Focus follows the panel, which is the whole reason it carries a label:
    // the picker is now far from the cell that opened it.
    expect(document.activeElement).toBe(picker);
    expect(picker.getAttribute("aria-label")).toContain("Lead");
    // And the cell says it is the one being edited — with the list on the far
    // side of the grid, nothing else on screen would.
    expect(
      container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]')!.getAttribute("data-active"),
    ).toBe("true");
  });

  it("switches the open picker to another cell without closing it, and moves focus", () => {
    stubWideViewport();
    const { container } = goToGrid([]);
    fireEvent.click(container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]')!);
    fireEvent.click(container.querySelector('[data-row-id="bgv"][data-date="2026-02-01"]')!);

    const pickers = container.querySelectorAll("[data-candidate-picker]");
    expect(pickers.length).toBe(1); // replaced in place, not stacked
    expect((pickers[0] as HTMLElement).getAttribute("aria-label")).toContain("BGV");
    expect(document.activeElement).toBe(pickers[0]);
    expect(
      container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]')!.getAttribute("data-active"),
    ).toBeNull();
  });

  it("Cerrar returns focus to the cell that opened the picker", () => {
    // A popover left focus somewhere sensible on its own because it sat next to
    // its trigger. A column on the far side of the grid does not: without this a
    // keyboard user restarts at the top of the page every time they close it.
    stubWideViewport();
    const { container } = goToGrid([]);
    const cell = container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]') as HTMLElement;
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(container.querySelector("[data-candidate-picker]")).toBeNull();
    expect(document.activeElement).toBe(cell);
  });

  it("Escape closes the picker instead of the generator", () => {
    // `MonthGenerator` also listens for Escape on `document`, and its answer is
    // to close the whole generator. The picker's listener is capture-phase for
    // exactly this reason — bubble-phase order between two listeners on one node
    // flips whenever either effect re-registers.
    stubWideViewport();
    const onClose = vi.fn();
    const { container } = render(
      <MonthGenerator
        members={members}
        existingRoles={[]}
        allRoles={[]}
        rules={readyRules()}
        onClose={onClose}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    const cell = container.querySelector('[data-row-id="lead"]') as HTMLElement;
    fireEvent.click(cell);
    expect(container.querySelector("[data-candidate-picker]")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("[data-candidate-picker]")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // And with nothing left to dismiss, Escape reaches the generator again.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the Voces/Instrumentos select from setting the rail's width", () => {
    // The defect, as close as jsdom can get to it. Beside the title the select
    // demanded its widest option ("Instrumentos", 112px) ON TOP of the title's
    // ~131px, and the header overflowed the fixed 216px box by 47px onto the
    // grid. Stacked and `w-full`, it is capped by the rail instead.
    stubWideViewport();
    const { container } = goToGrid([]);
    const rail = findRail(container, '[data-participation-rail="panel"]') as HTMLElement;
    const header = rail.querySelector("[data-rail-header]") as HTMLElement;
    const select = rail.querySelector("select") as HTMLSelectElement;

    expect(header).not.toBeNull();
    expect(header.contains(select)).toBe(true);
    expect(select.className.split(/\s+/)).toContain("w-full");
    // A flex row is what made the two widths ADD. A block header makes the
    // demand the wider of the two.
    expect(header.className.split(/\s+/)).not.toContain("flex");
    expect(header.className).not.toContain("justify-between");
  });

  it("full screen drops both side panels and keeps every assignment", () => {
    // "Sometimes I need to take a screenshot of the whole month." The mode has
    // to be a real mode — side panels gone, columns free to shrink — and it has
    // to survive the round trip: entering swaps a host element for a portal, so
    // React rebuilds the DOM and anything that lived in it would be lost.
    stubWideViewport();
    const { container } = goToGrid([]);
    seatLead(container, "2026-02-01", "Frank");
    expect(railTotal(container, "Frank")).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /Pantalla completa/ }));
    const full = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    expect(full).not.toBeNull();
    expect(full.parentElement).toBe(document.body); // portalled OUT of the shell
    expect(full.querySelector("[data-participation-rail]")).toBeNull();
    // The seat is still there, rendered by the same component instance.
    expect(full.querySelector('[data-row-id="lead"][data-date="2026-02-01"]')!.textContent).toContain(
      "Frank",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(railTotal(container, "Frank")).toBe(1); // and nothing was discarded
  });
});

// ─── The portal, as a structural pin ─────────────────────────────────────────

/**
 * WHAT THIS CATCHES, and — more importantly — what it does not.
 *
 * The gutter rail paints nothing in Safari while it is a descendant of an
 * ancestor carrying `position: relative` + `isolation: isolate` +
 * `overflow: hidden` (`.brand-admin-shell`, `.brand-facet-panel`). The remedy
 * is to render it somewhere else entirely, and "somewhere else" is now a design
 * decision rather than an implementation detail — so it is worth a test.
 *
 * CATCHES: someone deleting `createPortal` because the spec says a fixed
 * element escapes `overflow: hidden` anyway (it does; that reading is correct
 * and still produces an invisible rail in WebKit), or moving the mount site
 * back under the shell, or portalling to a node that is itself inside it.
 *
 * DOES NOT CATCH — and cannot, in jsdom, which has no layout or paint engine:
 * that the rail is actually VISIBLE; clipping, stacking, compositing or z-order
 * of any kind; whether `.brand-admin-shell` still carries the offending trio
 * (nothing here reads CSS); or the same bug arriving via a NEW ancestor
 * elsewhere. It pins the shape of the fix, not the absence of the bug. The only
 * instrument that can confirm the bug is gone is a human looking at real Safari
 * at ≥1700px — headless WebKit does not reproduce it.
 */
describe("the gutter rail renders outside the surfaces that swallow it", () => {
  for (const wide of [true, false]) {
    it(`keeps the grid's chart INSIDE .brand-admin-shell, in the flow (${wide ? "wide" : "narrow"})`, () => {
      // The inverse pin, and the reason it is worth writing down: the portal was
      // the right answer while the chart was `position: fixed`, and the WebKit
      // bug it works around is real. An in-flow column is not fixed, so the bug
      // does not apply to it — and portalling it anyway would rip the left
      // column out of the layout and drop it at the end of the body. Both
      // viewport widths, because the old code branched on width here.
      stubWideViewport(wide);
      const shell = document.createElement("div");
      shell.className = "brand-admin-shell";
      document.body.appendChild(shell);
      try {
        const { container } = goToGrid([savedSunday("2026-02-08", "m1")], [], { container: shell });
        const rail = findRail(container, '[data-participation-rail="panel"]') as HTMLElement;

        expect(rail).not.toBeNull();
        expect(rail.getAttribute("data-rail-placement")).toBe("column");
        expect(rail.closest(".brand-admin-shell")).toBe(shell);
        expect(rail.parentElement).not.toBe(document.body);
        // Same component, same state: the counts move when a seat moves.
        expect(railTotal(container, "Frank")).toBe(1);
        seatLead(container, "2026-02-01", "Frank");
        expect(railTotal(container, "Frank")).toBe(2);
      } finally {
        shell.remove();
      }
    });
  }

  it("puts FULL SCREEN outside .brand-admin-shell — the one fixed thing left here", () => {
    // Full screen IS `position: fixed` inside the shell's `relative` +
    // `isolation: isolate` + `overflow: hidden` trio, so it inherits the bug the
    // rail's portal was written for, and it inherits the portal with it.
    stubWideViewport();
    const shell = document.createElement("div");
    shell.className = "brand-admin-shell";
    document.body.appendChild(shell);
    try {
      const { container } = goToGrid([], [], { container: shell });
      fireEvent.click(screen.getByRole("button", { name: /Pantalla completa/ }));
      const full = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;

      expect(full).not.toBeNull();
      expect(full.closest(".brand-admin-shell")).toBeNull();
      expect(shell.contains(full)).toBe(false);
      expect(container.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    } finally {
      shell.remove();
    }
  });

  it("puts the Tablero's rail outside the dialog shell that carries the same trio", () => {
    // `CueDialog`'s shell is `brand-facet-panel` — `relative` + `isolation:
    // isolate` + `overflow: hidden`, the identical property set. `SeatBoard`
    // renders its own markup here rather than through `CueDialog`, so the
    // panel class is applied to a stand-in wrapper for the same reason as above.
    stubWideViewport();
    const panel = document.createElement("div");
    panel.className = "brand-facet-panel";
    document.body.appendChild(panel);
    try {
      const { container } = renderBoard({}, panel);
      const rail = findRail(container, '[data-participation-rail="dialog"]') as HTMLElement;

      expect(rail).not.toBeNull();
      expect(rail.getAttribute("data-rail-placement")).toBe("gutter");
      expect(rail.closest(".brand-facet-panel")).toBeNull();
      expect(panel.contains(rail)).toBe(false);
      expect(rail.parentElement).toBe(document.body);
      expect(railTotal(container, "Gaby")).toBe(1);
    } finally {
      panel.remove();
    }
  });
});

describe("the picker's load figure is labelled, so it cannot pose as the rail's total", () => {
  // `rankCandidates` reads `load` out of `computeParticipation` — the same
  // counter the rail renders — but over a different set of services (`unionRoles`
  // vs `plannerParticipationRoles`). With the rail now in the gutter beside the
  // picker, an admin sees both at once and they legitimately disagree. Neither
  // number is wrong; the bare 10px figure was.
  it("names the measure beside every candidate in the grid's picker", () => {
    const { container } = goToGrid([savedSunday("2026-01-04", "m1")]);
    fireEvent.click(container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]')!);
    const labelled = screen.getAllByText(/Carga para ordenar/);
    expect(labelled.length).toBeGreaterThan(0);
    // Frank's one January service, under a label that says what it counts.
    expect(labelled.some((el) => el.textContent === "Carga para ordenar: 1")).toBe(true);
  });
});

// ─── The Tablero, end to end ─────────────────────────────────────────────────

/**
 * The roster pane's row for a name. Once someone is seated their name also
 * appears as a seat chip and in the rail, so a bare `getByText` is ambiguous —
 * only the roster row is an `<li>` (the pattern `SeatBoard.test.tsx` uses).
 */
function rosterRow(name: string): HTMLLIElement {
  const li = screen
    .getAllByText(name)
    .map((el) => el.closest("li"))
    .find((el): el is HTMLLIElement => el !== null);
  if (!li) throw new Error(`no roster row for ${name}`);
  return li;
}

const savedRole: ServiceRole = {
  _id: "role-1",
  _type: "sunday_role",
  date: "2026-02-08",
  leads: [{ _id: "m2", member_name: "Gaby" }],
  bgvs: [],
  chorus: [],
  instruments: [],
  foh: [],
} as unknown as ServiceRole;

function renderBoard(
  props: Partial<React.ComponentProps<typeof SeatBoard>> = {},
  // As `goToGrid`: a caller-supplied mount node, so a real `.brand-facet-panel`
  // can sit above the board the way `CueDialog`'s shell does.
  container?: HTMLElement,
) {
  return render(
    <SeatBoard
      initial={savedRole}
      members={members}
      windowRoles={[
        { ...savedRole, _id: "role-1" } as unknown as ParticipantRole & { _id: string },
        savedSunday("2026-01-04", "m1"),
      ]}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
      loading={false}
      {...props}
    />,
    container ? { container } : undefined,
  );
}

describe("the Tablero's rail counts the seats being edited", () => {
  it("renders no rail at all on a narrow viewport", () => {
    stubWideViewport(false);
    const { container } = renderBoard();
    expect(findRail(container)).toBeNull();
  });

  it("counts the live seats, not the stored ones", () => {
    stubWideViewport();
    const { container } = renderBoard();

    // Gaby is the SAVED Lead of the service being edited. Counting the stored
    // copy as well as the live one would put her at 2.
    expect(railTotal(container, "Gaby")).toBe(1);
    expect(railTotal(container, "Frank")).toBe(1); // her January service, untouched

    // The Lead seat takes two, so this ADDS Frank beside Gaby.
    fireEvent.click(rosterRow("Frank"));
    expect(railTotal(container, "Frank")).toBe(2);
    expect(railTotal(container, "Gaby")).toBe(1);

    // Un-seat Gaby: her only appearance anywhere was this service's live copy,
    // so she leaves the chart entirely. If the saved copy of role-1 were still
    // being counted she would stay at 1 here.
    fireEvent.click(rosterRow("Gaby"));
    expect(railTotal(container, "Gaby")).toBeNull();
    expect(railTotal(container, "Frank")).toBe(2);
  });

  it("labels the board picker's load figure too — its drift is the mirror image", () => {
    // Here the picker still counts the STORED copy of the service being edited
    // (`rankCandidates` gets `windowRoles` untouched) while the rail swaps it for
    // the live seats. Same screen, same person, two honest numbers.
    stubWideViewport();
    renderBoard();
    expect(screen.getAllByText(/Carga para ordenar/).length).toBeGreaterThan(0);
  });

  it("counts a seat added to a service that has no saved copy yet", () => {
    stubWideViewport();
    const { container } = renderBoard({ initial: undefined, windowRoles: [] });
    expect(findRail(container)).not.toBeNull();
    expect(railTotal(container, "Liu")).toBeNull();

    fireEvent.click(rosterRow("Liu"));
    expect(railTotal(container, "Liu")).toBe(1);
  });
});

// ─── The gutter thresholds, as STATED vs as coded ────────────────────────────

/**
 * `ParticipationRail` owns the gutter width, and two other places describe it in
 * prose: the mount-site comment in `SeatBoard`, and the component table in
 * `UTILITIES_AND_COMPONENTS.md`. When the widths last moved, `MIN_WIDTH` and the
 * rail's own header were updated and the prose was not — leaving a reader who
 * derives the gutter arithmetic from a comment with the wrong answer, in a repo
 * where the comments are the design record.
 *
 * A static-analysis sync guard, in the shape `routeMatcher.test.ts` already uses
 * for the middleware matcher: nothing here renders, it just refuses to let the
 * prose and the constant disagree again.
 *
 * The PANEL half of this guard is gone with the panel placement — the planner
 * grid consults no threshold at all now. Its replacement is the layout guard
 * below, which pins the same kind of prose-vs-code drift for the three column
 * widths that took its place.
 */
describe("the stated rail threshold matches MIN_WIDTH", () => {
  const root = process.cwd();
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const railSrc = read("app/components/admin/ParticipationRail.tsx");
  const minWidth = railSrc.match(/MIN_WIDTH[^=]*=\s*\{\s*dialog:\s*(\d+)\s*\}/);

  it("extracts the width from the rail (the guard is worthless if this fails)", () => {
    expect(minWidth, "could not extract MIN_WIDTH from ParticipationRail.tsx").toBeTruthy();
  });

  it("SeatBoard's mount comment states the dialog width", () => {
    const stated = read("app/components/admin/SeatBoard.tsx").match(
      /Below (\d+)px there is no gutter/,
    );
    expect(stated?.[1]).toBe(minWidth![1]);
  });

  it("UTILITIES_AND_COMPONENTS.md states it", () => {
    const stated = read("docs/UTILITIES_AND_COMPONENTS.md").match(/the Tablero \(≥(\d+)px\)/);
    expect(stated?.[1]).toBe(minWidth![1]);
  });

  it("the class the rail renders is the width the arithmetic is stated in", () => {
    // `w-[216px]` is a Tailwind literal and cannot be built from `RAIL_WIDTH` at
    // runtime, so the two can drift. This is the only thing that stops them.
    expect(railSrc).toMatch(new RegExp(`w-\\[${RAIL_WIDTH}px\\]`));
  });

  it("nothing mounts the retired panel placement any more", () => {
    // The one-word change that would quietly put a `position: fixed` element
    // back inside `.brand-admin-shell` — where it lays out, hit-tests and paints
    // nothing in Safari.
    // Matched on the import and the JSX, not on the word: the mount site's
    // comment names the retired component on purpose, so a reader who goes
    // looking for it finds out why it is gone rather than that it never existed.
    expect(railSrc).not.toMatch(/placement === "panel"|panel:\s*\d/);
    const genSrc = read("app/components/admin/MonthGenerator.tsx");
    expect(genSrc).not.toMatch(/import\s*\{[^}]*ParticipationRail/);
    expect(genSrc).not.toMatch(/<ParticipationRail/);
  });
});

/**
 * The three column widths, prose versus code.
 *
 * `PlannerGrid.tsx`'s header derives the fit at 1512 (190 + 12 + 1008 + 12 + 240
 * = 1462 usable), `app/brand.css` repeats the same sum as the justification for
 * lifting the admin frame's 1280px cap, and the component renders two Tailwind
 * literals that cannot be built from either. Three copies of one arithmetic is
 * exactly the drift the retired threshold guard existed to catch, so it is
 * caught the same way.
 *
 * WHAT THIS CANNOT DO, and it is the same limitation the gutter guard had:
 * nothing here proves anything FITS. jsdom lays nothing out. It proves the
 * numbers on screen are the numbers the design record claims.
 */
describe("the planner's three column widths agree wherever they are written", () => {
  const root = process.cwd();
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const gridSrc = read("app/components/admin/PlannerGrid.tsx");
  const cssSrc = read("app/brand.css");

  const CHART = 190;
  const PICKER = 240;

  it("PlannerGrid renders the two side tracks at the stated widths", () => {
    expect(gridSrc).toMatch(new RegExp(`xl:w-\\[${CHART}px\\]`));
    expect(gridSrc).toMatch(new RegExp(`xl:w-\\[${PICKER}px\\]`));
  });

  it("PlannerGrid's header states the sum, and brand.css states the same one", () => {
    const stated = gridSrc.match(/(\d+) \(Participaciones\) \+ 12 \+ (\d+) \(grid\) \+ 12 \+ (\d+) \(picker\) = (\d+)/);
    expect(stated, "could not read the width derivation from PlannerGrid.tsx").toBeTruthy();
    expect(Number(stated![1])).toBe(CHART);
    expect(Number(stated![3])).toBe(PICKER);
    // The sum has to actually add up — a stale total is how a "verified" budget
    // stops describing the thing it was measured from.
    expect(Number(stated![1]) + 12 + Number(stated![2]) + 12 + Number(stated![3])).toBe(
      Number(stated![4]),
    );

    const css = cssSrc.match(/(\d+) \(chart\) \+ 12 \+ (\d+) \(grid\) \+ 12 \+ (\d+) \(picker\)\s+= (\d+)/);
    expect(css, "could not read the width derivation from brand.css").toBeTruthy();
    expect(css![1]).toBe(stated![1]);
    expect(css![2]).toBe(stated![2]);
    expect(css![3]).toBe(stated![3]);
    expect(css![4]).toBe(stated![4]);
  });

  it("the frame widener is scoped to the planner and to desktop only", () => {
    // `:has(.planner-wide)` inside a `min-width: 1280px` media query. Unscoped,
    // it would widen every other admin tab; without the query it would change
    // the padding on a phone, where nothing is side by side anyway.
    expect(cssSrc).toMatch(
      /@media \(min-width: 1280px\) \{[\s\S]*?\.brand-admin-frame:has\(\.planner-wide\)[\s\S]*?\}/,
    );
    expect(read("app/(client)/admin/page.tsx")).toContain("brand-admin-frame");
    expect(gridSrc).toContain("planner-wide");
  });

  it("lifts the LAYOUT's cap too, not just the admin page's", () => {
    // `app/(client)/layout.tsx` wraps every page in `max-w-7xl`. Widening only
    // the admin frame inside it is a silent no-op — the content stays at 1280px
    // and the three columns are back to ~1174px between them. Both caps, or
    // neither.
    expect(cssSrc).toMatch(/\[data-route-main\]:has\(\.planner-wide\)\s*\{\s*max-width:\s*none;/);
    expect(read("app/(client)/layout.tsx")).toContain("data-route-main");
  });
});

/**
 * `MIN_WIDTH` versus `RAIL_WIDTH`, through the formula the header comment
 * actually derives it by — not a regex-vs-import duplicate, which would compare
 * the same declaration to itself and could not fail short of the regex breaking
 * (that failure mode belongs to "extracts the width…" above).
 *
 * The header states: the rail needs `RAIL_WIDTH` + 8px (`left-2`) + 8px of air
 * clear of the container's content before the container's first pixel — 232px
 * today. That clearance feeds the threshold:
 *   • dialog: (W - 896) / 2 >= clearance   (max-w-4xl, no inset)
 * 896 is a page-layout fact (`CueDialog.tsx`'s `max-w-4xl`), not part of this
 * pair — it does not move when the rail's own width does, so it is fixed here
 * rather than re-derived. `RAIL_WIDTH` is the one input that can change (it did,
 * in the commit that stacked the sidebar's header row), and `MIN_WIDTH` must
 * stay at least the minimum that formula demands for whatever `RAIL_WIDTH`
 * currently is. A widened rail with a stale `MIN_WIDTH` is exactly the 47px
 * overlap the header's own history names.
 */
describe("MIN_WIDTH still clears the gutter RAIL_WIDTH actually needs", () => {
  const clearance = RAIL_WIDTH + 8 /* left-2 */ + 8 /* air */;
  const dialogMinRequired = 896 + 2 * clearance;

  it("the dialog threshold clears (W - 896) / 2 >= RAIL_WIDTH + 16", () => {
    expect(MIN_WIDTH.dialog).toBeGreaterThanOrEqual(dialogMinRequired);
  });
});

/**
 * The width FLOOR, against the chart that actually has to fit inside it.
 *
 * `RAIL_WIDTH` is derived from the widest row in `ParticipationSidebar`, and that
 * derivation lives in a comment in a different file from the numbers it derives
 * from — which is exactly how the header row got left out of it and overflowed
 * the rail by 47px onto the planner grid. Widening the bar, the count column or
 * the padding without moving the floor (and the two thresholds that follow from
 * it) fails here rather than on someone's screen.
 */
describe("the rail's width floor still fits the chart inside it", () => {
  const root = process.cwd();
  const sidebarSrc = readFileSync(join(root, "app/components/admin/ParticipationSidebar.tsx"), "utf8");
  const px = (re: RegExp, what: string, scale = 1) => {
    const m = sidebarSrc.match(re);
    expect(m, `could not read ${what} from ParticipationSidebar.tsx`).toBeTruthy();
    return Number(m![1]) * scale;
  };

  it("the member row (bar + gap + count, inside the padding) fits", () => {
    const bar = px(/style=\{\{ width: (\d+), background:/, "the bar's inline width");
    const gap = px(/className="flex items-center gap-([\d.]+)/, "the row gap", 4);
    const count = px(/min-w-\[(\d+)px\]/, "the count column");
    const pad = px(/<aside className="[^"]*\bp-(\d+)\b/, "the aside padding", 4);
    expect(bar + gap + count + 2 * pad).toBeLessThanOrEqual(RAIL_WIDTH);
  });

  it("the header row cannot demand the select's intrinsic width", () => {
    // `w-full` inside a block header. Side by side with the title (the shipped
    // defect) the header's demand is the SUM, and no floor derived from the bar
    // row can hold it — a `<select>` is as wide as its longest option.
    expect(sidebarSrc).toMatch(/<select[\s\S]{0,240}?className="[^"]*\bw-full\b/);
    expect(sidebarSrc).toMatch(/<div data-rail-header className="mb-1">/);
  });
});
