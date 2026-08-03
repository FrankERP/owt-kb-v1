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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
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

/** The big number the sidebar renders for a member, or `null` when absent. */
function railTotal(container: HTMLElement, name: string): number | null {
  const rail = container.querySelector("[data-participation-rail]");
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
 * `MonthGenerator` step 1 → step 2, on a month with a single Sunday column so
 * the grid is small enough to reason about. February 2026 starts on a Sunday.
 */
function goToGrid(
  allRoles: ParticipantRole[],
  existingRoles: { _id: string; _type: string; date: string }[] = [],
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
    // One saved January Sunday led by Frank, inside D12's 56-day lookback.
    const { container } = goToGrid([savedSunday("2026-01-04", "m1")]);

    expect(railTotal(container, "Frank")).toBe(1); // saved only
    seatLead(container, "2026-02-01", "Frank");
    // THE ASSERTION THIS FILE EXISTS FOR. Deleting the draft half of the union
    // in `plannerParticipationRoles` leaves this at 1 and fails here.
    expect(railTotal(container, "Frank")).toBe(2);
  });

  it("shows a member who exists only in a draft, and one who exists only in history", () => {
    const { container } = goToGrid([savedSunday("2026-01-04", "m2")]);

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
    // invisible. This is the `|| date.slice(0,7) === prefix` half of
    // `participationSaved`, and it is the only thing that makes Gaby appear.
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
 * The rail is gutter-only (`ParticipationRail`), and jsdom's `matchMedia`
 * reports `matches: false` for everything — so a Tablero test has to say it is
 * on a wide screen. Stubbing it is also what proves the narrow case: without
 * this the board renders no rail at all, which is exactly what the other 40-odd
 * `SeatBoard` tests observe.
 */
function stubWideViewport(wide = true) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: wide,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
}

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

function renderBoard(props: Partial<React.ComponentProps<typeof SeatBoard>> = {}) {
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
  );
}

describe("the Tablero's rail counts the seats being edited", () => {
  it("renders no rail at all on a narrow viewport", () => {
    stubWideViewport(false);
    const { container } = renderBoard();
    expect(container.querySelector("[data-participation-rail]")).toBeNull();
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
    expect(container.querySelector("[data-participation-rail]")).not.toBeNull();
    expect(railTotal(container, "Liu")).toBeNull();

    fireEvent.click(rosterRow("Liu"));
    expect(railTotal(container, "Liu")).toBe(1);
  });
});

// ─── The gutter thresholds, as STATED vs as coded ────────────────────────────

/**
 * `ParticipationRail` owns the two widths, and three other places describe them
 * in prose: the mount-site comments in `MonthGenerator` and `SeatBoard`, and the
 * component table in `UTILITIES_AND_COMPONENTS.md`. When the widths last moved,
 * `MIN_WIDTH` and the rail's own header were updated and all three of those were
 * not — leaving a reader who derives the gutter arithmetic from a comment with
 * the wrong answer, in a repo where the comments are the design record.
 *
 * A static-analysis sync guard, in the shape `routeMatcher.test.ts` already uses
 * for the middleware matcher: nothing here renders, it just refuses to let the
 * prose and the constant disagree again.
 */
describe("the stated rail thresholds match MIN_WIDTH", () => {
  const root = process.cwd();
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const railSrc = read("app/components/admin/ParticipationRail.tsx");
  const minWidth = railSrc.match(/MIN_WIDTH[^=]*=\s*\{\s*panel:\s*(\d+),\s*dialog:\s*(\d+)\s*\}/);

  it("extracts both widths from the rail (the guard is worthless if this fails)", () => {
    expect(minWidth, "could not extract MIN_WIDTH from ParticipationRail.tsx").toBeTruthy();
  });

  it("MonthGenerator's mount comment states the panel width", () => {
    const stated = read("app/components/admin/MonthGenerator.tsx").match(
      /Above (\d+)px it is `position: fixed`/,
    );
    expect(stated?.[1]).toBe(minWidth![1]);
  });

  it("SeatBoard's mount comment states the dialog width", () => {
    const stated = read("app/components/admin/SeatBoard.tsx").match(
      /Below (\d+)px there is no gutter/,
    );
    expect(stated?.[1]).toBe(minWidth![2]);
  });

  it("UTILITIES_AND_COMPONENTS.md states both", () => {
    const stated = read("docs/UTILITIES_AND_COMPONENTS.md").match(
      /planner grid \(≥(\d+)px\) and the Tablero \(≥(\d+)px\)/,
    );
    expect(stated?.[1]).toBe(minWidth![1]);
    expect(stated?.[2]).toBe(minWidth![2]);
  });
});
