/** @vitest-environment jsdom */
// The participation panel beside the month grid, the one editing surface left.
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
// from a month nobody is planning: the grid's chart is SCOPED TO THE MONTH BEING
// GENERATED (`participationSaved` in `MonthGenerator`) — the drafts on screen
// plus everything already saved in that month, and nothing from any other. That
// scope is the right baseline for "is this month fair", which is the only
// question this surface asks.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { CHART_COLUMN_WIDTH, PICKER_COLUMN_WIDTH } from "../PlannerGrid";
import { buildColumns, plannerParticipationRoles, type GridCell, type SavedRole } from "../plannerModel";
import { computeParticipation, type ParticipantRole } from "@/app/utils/computeParticipation";
import type { RankMember } from "../candidateRanking";
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
 * The rendered chart, wherever it landed.
 *
 * It is an in-flow column now and always under the render container. The
 * document-level fallback is kept deliberately: a retired gutter placement
 * portalled the chart to `document.body`, and looking in the container first
 * and the document second means these assertions ask the SAME question they
 * asked before that placement existed and after it was removed. If a portal
 * ever comes back, nothing here has to be softened to accommodate it.
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
  const leadCell = (columnId: string, memberId: string, origin: GridCell["origin"] = "manual"): GridCell => ({
    columnId,
    rowId: "lead",
    occupants: [{ memberId }],
    origin,
  });

  it("sums the saved history and the drafts on screen", () => {
    const saved = [savedSunday("2026-01-04", "m1"), savedSunday("2026-01-11", "m1")];
    const cells = [leadCell(columns[0].columnId, "m1")];
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
    const cells = [leadCell(columns[0].columnId, "m1")];
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
    const cells = [leadCell(columns[0].columnId, "m1", "auto")];
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
    const cells = [leadCell(specialColumns[0].columnId, "m1")];
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
    const cells = [leadCell(specialColumns[0].columnId, "m1")];
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
    const cells = [leadCell(columnsFor("Vigilia de Oración")[0].columnId, "m1")];
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

// ─── The planner grid, end to end ────────────────────────────────────────────

/**
 * A wide (or deliberately narrow) viewport.
 *
 * jsdom neither implements `matchMedia` nor lays anything out. The grid's chart
 * consults no threshold at all any more — which is itself asserted below — so
 * the stub's job here is the INVERSE of what it was: it proves the column
 * renders identically at both widths rather than selecting between two
 * placements. It is kept because the retired gutter placement branched on
 * width, and every `goToGrid` test predating the stub only ever rendered the
 * inline branch, which is how a select that overflowed by 47px shipped under a
 * green suite. A width branch reappearing must fail here.
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
      // The bare `w-[216px]` is the retired gutter's unprefixed width; the
      // column's is `xl:`-prefixed, asserted below. Same number, different class.
      for (const cls of ["fixed", "left-2", "top-24", "top-20", `w-[${CHART_COLUMN_WIDTH}px]`]) {
        expect(rail.className.split(/\s+/)).not.toContain(cls);
      }
      // The track width the layout arithmetic is stated in (`PlannerGrid.tsx`'s
      // header, `app/brand.css`), applied only once there is room for a row.
      // Read from the exported constant rather than a literal, so this and the
      // content-floor guard below can never disagree about which number the
      // column is actually rendered at.
      expect(rail.className.split(/\s+/)).toContain(`xl:w-[${CHART_COLUMN_WIDTH}px]`);
      // Placement only: the chart still counts what it always counted.
      expect(railTotal(container, "Frank")).toBe(1);
      seatLead(container, "2026-02-01", "Frank");
      expect(railTotal(container, "Frank")).toBe(2);
    });
  }

  it("consults NO viewport threshold — the column is unconditional", () => {
    // The chart is an ordinary in-flow column and asks `matchMedia` nothing. A
    // query reappearing here means someone put a width branch back, and the
    // 1512px laptop loses the chart again silently — which is exactly how the
    // retired gutter placement failed.
    const queries = stubWideViewport();
    goToGrid([]);
    expect(queries.filter((q) => q.includes("min-width"))).toEqual([]);
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
    //
    // Focus lands on the cell's ACTION rather than the cell box (T5): the box
    // used to be `role="button"` and answered Enter itself, and is a
    // `role="group"` now that it holds focusable chips — so returning focus to
    // the box would land the admin on something inert and cost them the "close,
    // look, reopen" loop the shipped surface had.
    stubWideViewport();
    const { container } = goToGrid([]);
    const cell = container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]') as HTMLElement;
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(container.querySelector("[data-candidate-picker]")).toBeNull();
    expect(document.activeElement).toBe(cell.querySelector("[data-cell-action]"));
    expect(cell.contains(document.activeElement)).toBe(true);
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

  it("keeps the full-screen bar clear of the iOS safe area", () => {
    // `app/(client)/layout.tsx` sets `viewportFit: "cover"`, and this overlay is
    // `inset-0` — so on an iPhone (and in the Capacitor wrap, which is the same
    // engine) the top bar lands under the status bar / Dynamic Island. That bar
    // holds the ONLY exit control, because there is no Escape key there, so a
    // plain `p-4` makes the mode a trap. `CueDialog.tsx` already solves this the
    // same way; left/right are included because the surface is full-bleed
    // horizontally and a landscape iPhone puts the notch on one of those edges.
    stubWideViewport();
    goToGrid([]);
    fireEvent.click(screen.getByRole("button", { name: /Pantalla completa/ }));
    const full = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    const classes = full.className.split(/\s+/);
    // Classes rather than an inline style: `max(…, env(…))` is a value jsdom's
    // CSS parser discards, so an inline version could not be pinned at all.
    for (const [side, prefix] of [
      ["top", "pt"],
      ["bottom", "pb"],
      ["left", "pl"],
      ["right", "pr"],
    ] as const) {
      expect(classes, `padding-${side} must respect the safe area`).toContain(
        `${prefix}-[max(1rem,env(safe-area-inset-${side}))]`,
      );
    }
    // And no blanket `p-4` left behind to fight them.
    expect(classes).not.toContain("p-4");
  });

  it("moves focus into full screen and hands it back on the way out", () => {
    // `role="dialog" aria-modal="true"` was declared with none of this: entering
    // unmounted the button that had focus so it fell to `<body>`, and exiting
    // did the same — a keyboard user restarted at the top of the page in BOTH
    // directions. The same failure `closePicker`'s focus restore exists to
    // prevent, left unhandled on the bigger surface.
    stubWideViewport();
    goToGrid([]);
    const opener = screen.getByRole("button", { name: /Pantalla completa/ });
    opener.focus();
    fireEvent.click(opener);

    const full = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    expect(document.activeElement).toBe(full);

    fireEvent.keyDown(document, { key: "Escape" });
    // Looked up again, not reused: leaving full screen swaps a portal back for a
    // host element, so React rebuilt this subtree and the button focus returns
    // to is a DIFFERENT DOM node from the one that was clicked. A stored ref
    // would restore focus to a detached element, i.e. to nothing.
    const reopened = screen.getByRole("button", { name: /Pantalla completa/ });
    expect(document.activeElement).toBe(reopened);
  });

  it("traps Tab inside full screen, in both directions", () => {
    stubWideViewport();
    goToGrid([]);
    fireEvent.click(screen.getByRole("button", { name: /Pantalla completa/ }));
    const full = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    const focusable = Array.from(
      full.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("locks the page's scroll while full screen is up, and restores what it found", () => {
    // Without it, wheeling past the overlay's own extent scrolled the page
    // underneath and exiting landed somewhere other than where the admin left.
    // The prior INLINE value is restored rather than cleared — `CueDialogProvider`
    // does the identical dance, and a planner opened from inside a dialog would
    // otherwise have that lock wiped on the way out.
    stubWideViewport();
    document.body.style.overflow = "scroll";
    try {
      goToGrid([]);
      fireEvent.click(screen.getByRole("button", { name: /Pantalla completa/ }));
      expect(document.body.style.overflow).toBe("hidden");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(document.body.style.overflow).toBe("scroll");
    } finally {
      document.body.style.overflow = "";
    }
  });

  it("makes aria-modal true — the page behind goes inert, and comes back", () => {
    // `aria-modal="true"` tells assistive tech the rest of the page is hidden.
    // It was tabbable and readable the whole time. The overlay is portalled to
    // `body`, so its SIBLINGS are the page behind it.
    stubWideViewport();
    const sibling = document.createElement("div");
    document.body.appendChild(sibling);
    try {
      goToGrid([]);
      fireEvent.click(screen.getByRole("button", { name: /Pantalla completa/ }));
      const full = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;

      expect(sibling.hasAttribute("inert")).toBe(true);
      expect(full.hasAttribute("inert")).toBe(false); // never the overlay itself

      fireEvent.keyDown(document, { key: "Escape" });
      expect(sibling.hasAttribute("inert")).toBe(false);
    } finally {
      sibling.remove();
    }
  });

  it("leaves Escape alone while the admin is typing a new row's name", () => {
    // The capture-phase listener sees Escape before the field it was typed into
    // does. Unconditional, it answered "undo what I am typing" by closing the
    // picker and yanking focus across the grid to a cell. Scoped to controls
    // with no Escape behaviour of their own, so a field keeps its keystroke and
    // the picker keeps its state.
    stubWideViewport();
    const { container } = goToGrid([]);
    const cell = container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]') as HTMLElement;
    fireEvent.click(cell);
    expect(container.querySelector("[data-candidate-picker]")).not.toBeNull();

    const input = screen.getByPlaceholderText("Nuevo instrumento") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "Cajón" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(container.querySelector("[data-candidate-picker]")).not.toBeNull();
    expect(document.activeElement).toBe(input);

    // And the scoping did not cost Escape its real job: from anywhere that is
    // not such a field, it still closes the picker.
    fireEvent.keyDown(cell, { key: "Escape" });
    expect(container.querySelector("[data-candidate-picker]")).toBeNull();
  });

  it("announces aria-expanded on the active cell's action alone", () => {
    // `aria-expanded={active}` put `aria-expanded="false"` on EVERY cell — ~60
    // "collapsed" announcements on a ten-column month, on a grid whose cells are
    // otherwise just seats. That is unchanged; what moved (T5) is WHICH element
    // carries it. The cell is a `role="group"` now — a labelled container of
    // controls, because it holds focusable chips — and `group` does not support
    // `aria-expanded` in ARIA 1.2, so the property sits on the control that
    // actually opens the picker.
    stubWideViewport();
    const { container } = goToGrid([]);
    expect(container.querySelectorAll("[aria-expanded]").length).toBe(0);

    fireEvent.click(container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]')!);
    const expanded = container.querySelectorAll("[aria-expanded]");
    expect(expanded.length).toBe(1);
    expect(expanded[0].getAttribute("aria-expanded")).toBe("true");
    expect(expanded[0].hasAttribute("data-cell-action")).toBe(true);
    expect(expanded[0].closest("[data-row-id]")?.getAttribute("data-row-id")).toBe("lead");
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

// ─── The gutter thresholds, as STATED vs as coded ────────────────────────────

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

  // From the component's own exported constants, not literals copied here — the
  // Tailwind class is a literal that cannot be built at runtime, so the constant
  // is the single place the number is declared and everything else is compared
  // against it.
  const CHART = CHART_COLUMN_WIDTH;
  const PICKER = PICKER_COLUMN_WIDTH;

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

  it("the shell padding the derivation SPENDS is the padding it applies", () => {
    // The third rule of the three, and the one that was unpinned: a reviewer
    // deleted `.brand-admin-shell:has(.planner-wide) { padding: .75rem }` and
    // every test stayed green. Without it the shell falls back to
    // `clamp(1rem, 2.5vw, 1.75rem)` — 28px a side at 1512 — so the three columns
    // silently lose 32px and the stated `= 1462` stops being true with nothing
    // to notice. It looks like a cosmetic tidy-up; it is load-bearing.
    const rule = cssSrc.match(
      /\.brand-admin-shell:has\(\.planner-wide\)\s*\{\s*padding:\s*([\d.]+)rem;/,
    );
    expect(rule, "could not find the shell padding rule in brand.css").toBeTruthy();
    // Scoped to desktop, like the other two — on a phone nothing is side by side.
    expect(cssSrc).toMatch(
      /@media \(min-width: 1280px\) \{[\s\S]*?\.brand-admin-shell:has\(\.planner-wide\)[\s\S]*?\n\}/,
    );

    const applied = Number(rule![1]) * 16; // one side
    // The comment's first line, in the units it is written in.
    const derived = cssSrc.match(
      /1512 − 24 \(frame px\) − 2 \(shell border\) − (\d+) \(shell padding\) = (\d+)/,
    );
    expect(derived, "could not read the usable-width derivation from brand.css").toBeTruthy();
    expect(Number(derived![1]), "the derivation spends padding the rule does not apply").toBe(
      2 * applied,
    );
    expect(1512 - 24 - 2 - Number(derived![1])).toBe(Number(derived![2]));

    // …and that usable width is what the three columns are budgeted against.
    const columns = cssSrc.match(/\(chart\) \+ 12 \+ \d+ \(grid\) \+ 12 \+ \d+ \(picker\)\s+= (\d+)/);
    expect(columns![1]).toBe(derived![2]);
  });

  it("the page header keeps a cap of its own while the frame loses one", () => {
    // With the frame's `max-w-7xl` lifted, an uncapped header stretched to the
    // full 1512 and sat visibly off the navbar's centred content whenever the
    // planner was open.
    const header = read("app/(client)/admin/page.tsx").match(/<header className="([^"]*)"/);
    expect(header, "could not find the admin page header").toBeTruthy();
    const classes = header![1].split(/\s+/);
    expect(classes).toContain("mx-auto");
    expect(classes).toContain("max-w-7xl");
  });
});

/**
 * The PLANNER COLUMN's width, against the chart that has to fit inside it — the
 * hole that let a 190px column ship.
 *
 * The retired gutter rail had a floor guard of its own, but it pinned the rail's
 * width, and the planner column was a different number in a different file.
 * Nothing tied `CHART_COLUMN_WIDTH` to `ParticipationSidebar` at all: the
 * three-width guard above compares 216/240 against PROSE in two comments, which
 * agree with each other perfectly whatever number they hold. So 190 passed every
 * test while the count column printed itself on top of the bar on every member
 * row. With the rail gone this is the ONLY guard left that reads the chart's
 * real content floor, so it carries the whole weight.
 *
 * WHAT THIS CANNOT DO: prove the overlap is gone. jsdom lays nothing out. It
 * re-derives the floor from the sidebar's own source — the numbers a browser
 * would lay out — and refuses a column narrower than it. A real browser at the
 * chosen width is still the only instrument that can see the pixels.
 */
describe("the planner's chart column is at least the chart's content floor", () => {
  const sidebarSrc = readFileSync(
    join(process.cwd(), "app/components/admin/ParticipationSidebar.tsx"),
    "utf8",
  );
  const px = (re: RegExp, what: string, scale = 1) => {
    const m = sidebarSrc.match(re);
    expect(m, `could not read ${what} from ParticipationSidebar.tsx`).toBeTruthy();
    return Number(m![1]) * scale;
  };

  /**
   * The member row's irreducible width. The bar is an INLINE `width: 150` and
   * cannot shrink; the name block around it is `flex-1 min-w-0` and shrinks
   * instead — so below this the count column is drawn over the bar rather than
   * anything overflowing the box, which is why nothing looked wrong.
   */
  function memberRowFloor(): number {
    const bar = px(/style=\{\{ width: (\d+), background:/, "the bar's inline width");
    const gap = px(/className="flex items-center gap-([\d.]+)/, "the row gap", 4);
    const count = px(/min-w-\[(\d+)px\]/, "the count column");
    const pad = px(/<aside className="[^"]*\bp-(\d+)\b/, "the aside padding", 4);
    // The rows do not sit directly in the aside: they sit in the
    // `max-h-[60vh] overflow-y-auto pr-0.5` scroller, whose right padding is 2px
    // the row never gets. Left out of the arithmetic, the derived floor comes to
    // 210 while a real browser measures 212 — found by measuring, not by
    // reading, which is the whole argument for deriving this from the source
    // instead of restating a number.
    const scrollerPad = px(/max-h-\[60vh\] overflow-y-auto pr-([\d.]+)/, "the scroller's right padding", 4);
    const asideClasses = sidebarSrc.match(/<aside className="([^"]*)"/)![1].split(/\s+/);
    // The 1px border either side is part of the box too, and was left out of the
    // 208 the rail's header used to state.
    expect(asideClasses, "the aside's border is part of the floor").toContain("border");
    return bar + gap + count + 2 * pad + 2 + scrollerPad;
  }

  it("CHART_COLUMN_WIDTH clears it", () => {
    expect(CHART_COLUMN_WIDTH).toBeGreaterThanOrEqual(memberRowFloor());
  });

  it("derives the floor a real browser measured, to the pixel", () => {
    // Chromium at 1512, inside the real `.brand-admin-shell` chain: at a 212px
    // aside the count column's left edge lands exactly on the bar's right edge.
    // If this number ever stops being 212, the two browser measurements quoted
    // in `PlannerGrid.tsx`'s header have stopped describing the code.
    expect(memberRowFloor()).toBe(212);
  });

  it("and would have refused the 190px this shipped at", () => {
    // Non-vacuity, stated rather than assumed: a guard that also passes at the
    // broken width is not a guard. At 190 a real browser put the bar's right
    // edge at x=163 and the count column's left edge at x=151 — a 12px overlap.
    expect(memberRowFloor()).toBeGreaterThan(190);
  });

});

/**
 * The chart's HEADER row, which no width arithmetic can catch.
 *
 * The member row is covered above, derived from the sidebar's own source. The
 * header is a different failure: a `<select>` is as wide as its longest option,
 * so while it sat BESIDE the title the header's demand was the SUM of the two
 * (131 + 8 + 112 + 24 = 275), and no floor derived from the bar row can hold
 * that. A real browser measured the chart at 262px of content in a 216px box,
 * with the select's right edge 47px out over the planner grid. Stacking the
 * header made each row ask for the WIDER of the two rather than their sum.
 *
 * This is a structural pin on `ParticipationSidebar`, not a numeric one — the
 * arithmetic above cannot see it, which is precisely why it shipped broken.
 */
describe("the chart's header row cannot out-demand its column", () => {
  const root = process.cwd();
  const sidebarSrc = readFileSync(join(root, "app/components/admin/ParticipationSidebar.tsx"), "utf8");

  it("the header row cannot demand the select's intrinsic width", () => {
    // `w-full` inside a block header. Side by side with the title (the shipped
    // defect) the header's demand is the SUM, and no floor derived from the bar
    // row can hold it — a `<select>` is as wide as its longest option.
    expect(sidebarSrc).toMatch(/<select[\s\S]{0,240}?className="[^"]*\bw-full\b/);
    expect(sidebarSrc).toMatch(/<div data-rail-header className="mb-1">/);
  });
});
