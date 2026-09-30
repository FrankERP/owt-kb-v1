/** @vitest-environment jsdom */
// app/components/admin/__tests__/trailingSaturday.wiring.test.tsx
//
// The trailing Saturday WIRED, on the shipped derived path (plan 2026-09-30-planner-trailing-saturday,
// Task 3; spec 2026-09-29 §2). The pure halves are pinned in `trailingSaturday.test.ts`; this proves
// MonthGenerator sends Sat 31 Oct 2026 as week 5, applies what comes back to its column, says so when
// T5 withholds it, keeps a withheld 31st out of the pins (Q1) and out of the confirm's count, and
// that the «Fuera del alcance de Auto» surface is gone.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What ships: derived source, NO history sent (ADR-0046).
const switches = vi.hoisted(() => ({ SOLVER_HISTORY_SOURCE: "derived", SOLVER_SENDS_HISTORY: false }));
vi.mock("../solverHistorySource", () => switches);

import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { echoPins, emptySchedule, stubSolve, type Respond } from "./pinSolveHarness";
import {
  ANA, BETO, Gen, LUCIA, cellAt, deselectAll, fillEmptySwitch, preview, runAuto, selectSundayLead, setMonthYear,
} from "./plannerWiringHarness";
import { readyRules } from "./rulesHarness";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); });

/** October 2026: Sundays 4/11/18/25; the 31st is the trailing Saturday, week 5 (its Sunday is 1 Nov). */
const OCT_SUNDAYS = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];
const OCT_31 = "2026-10-31";
/** Ana is the only lead; with her away on the 31st nobody can lead it, so T5 withholds it. */
const ANA_AWAY = { ...ANA, unavailableDates: [OCT_31] };
const TRAILING_LINE = /^El sábado 31 oct no se mandó al solver/;
const REFUSED = /No se puede usar «Solo llenar vacíos»/;

/** Ana leads the first Sunday; on the 31st (when it is asked for) Ana leads and Lucía sings BGV. */
const roster: Respond = (body) => {
  const schedule = emptySchedule(body);
  schedule["1"].Sunday!.Lead = ["Ana Karen Villalobos"];
  if (schedule["5"]?.Saturday) {
    schedule["5"].Saturday.Lead = ["Ana Karen Villalobos"];
    schedule["5"].Saturday.BGV = ["María Lucía Estrada"];
  }
  return { ok: true, schedule, pinned_honored: 0, pin_violations: [], unfilled_seats: [] };
};

/** October 2026 with ONLY the 31st of its Saturdays selected, Ana ticked as Sunday lead, grid open. */
function setup(respond: Respond, members: object[] = [ANA, LUCIA, BETO], rules?: ReturnType<typeof readyRules>) {
  const stub = stubSolve(respond);
  const view = render(
    <Gen rules={rules} members={members as never} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
  );
  setMonthYear(view.container, 10, 2026);
  deselectAll(view.container, "saturday");
  fireEvent.click(view.container.querySelector(`[data-date="${OCT_31}"]`)!);
  selectSundayLead(view.container, "Ana");
  preview();
  return { ...view, ...stub };
}

const noticeLines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-auto-notices] p")).map((p) => p.textContent ?? "");

describe("the trailing Saturday — Auto staffs it", () => {
  it("sends the 31st as week 5 and writes what comes back into its column", async () => {
    const { bodies, container } = setup(roster);
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].weeks).toBe(4);
    expect(bodies[0].weekends_with_saturday).toEqual([5]);
    await waitFor(() => expect(cellAt(container, "lead", OCT_31).textContent).toContain("Ana"));
    expect(cellAt(container, "bgv", OCT_31).textContent).toContain("Lucía");
    expect(cellAt(container, "lead", OCT_SUNDAYS[0]).textContent).toContain("Ana");
    expect(noticeLines(container).some((l) => TRAILING_LINE.test(l))).toBe(false);
  });
});

describe("the trailing Saturday — T5 withholds it when nobody can lead it", () => {
  it("leaves week 5 out, says why under Auto, and still solves the Sundays", async () => {
    const { bodies, container } = setup(roster, [ANA_AWAY, LUCIA, BETO]);
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].weekends_with_saturday).toEqual([]);
    expect(bodies[0].dsl_rules.some((r) => r.includes("week 5"))).toBe(false);
    await waitFor(() => expect(cellAt(container, "lead", OCT_SUNDAYS[0]).textContent).toContain("Ana"));
    expect(noticeLines(container)).toEqual([
      "El sábado 31 oct no se mandó al solver: ningún líder puede dirigirlo (no disponibles o excluidos). Llénalo a mano.",
    ]);
    // Nothing came back for the 31st, so nothing was written there.
    expect(cellAt(container, "lead", OCT_31).textContent).not.toContain("Ana");
  });

  it("lists the Saturday minimums left out first, then the trailing Saturday", async () => {
    const rules = readyRules({
      ...DEFAULT_SOLVER_CONFIG,
      restrictions: [
        ...DEFAULT_SOLVER_CONFIG.restrictions,
        {
          id: "beto-sat", person: "Beto", excludedPatterns: [], fairness: "none", fairnessSlack: 0, weekExclusions: [],
          caps: [{ id: "c1", pattern: "Sat.*", op: "==", value: 1, relative: false, relOffset: 2 }],
        },
      ],
    });
    const { bodies, container } = setup(roster, [ANA_AWAY, LUCIA, BETO], rules);
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(1));
    // The 31st was the only Saturday and T5 withheld it, so no Saturday is sent at all:
    // Beto's floor is left out under PR #116's month-level sentence.
    const lines = noticeLines(container);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Este mes no tiene sábados que Auto pueda cubrir, así que no se aplicó «Sat.* == 1» a Beto.");
    expect(lines[1]).toMatch(TRAILING_LINE);
  });
});

describe("the trailing Saturday — «Solo llenar vacíos» (Q1)", () => {
  it("a hand-filled 31st that T5 withholds is not pinned, so Auto is not refused", async () => {
    const { bodies, container } = setup(echoPins, [ANA_AWAY, LUCIA, BETO]);
    // Seat Lucía on the 31st's BGV by hand.
    fireEvent.click(cellAt(container, "bgv", OCT_31).querySelector("[data-cell-action]") as HTMLElement);
    const picker = screen.getByRole("region", { name: `Candidatos para BGV — ${OCT_31}` });
    fireEvent.click(within(picker).getByRole("button", { name: /Lucía/ }));
    expect(cellAt(container, "bgv", OCT_31).textContent).toContain("Lucía");

    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(screen.queryByText(REFUSED)).toBeNull();
    expect(bodies[0].weekends_with_saturday).toEqual([]);
    // Her seat was the board's only one, and it is on a column Auto does not write: no pins.
    expect(bodies[0].pinned).toBeUndefined();
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    // The 31st stays exactly as the admin left it.
    expect(cellAt(container, "bgv", OCT_31).textContent).toContain("Lucía");
    expect(noticeLines(container).some((l) => TRAILING_LINE.test(l))).toBe(true);
  });

  it("the board marks no pin on a withheld 31st", () => {
    const seatBeto = (container: HTMLElement) => {
      fireEvent.click(cellAt(container, "bgv", OCT_31).querySelector("[data-cell-action]") as HTMLElement);
      const picker = screen.getByRole("region", { name: `Candidatos para BGV — ${OCT_31}` });
      fireEvent.click(within(picker).getByRole("button", { name: /Beto/ }));
    };
    const chip = (container: HTMLElement) =>
      cellAt(container, "bgv", OCT_31).querySelector('[data-occupant="beto"]') as HTMLElement;

    // Control: with the 31st sent, Beto — in no pool, since no rule names him — is a pin, and says so.
    const sent = setup(echoPins);
    seatBeto(sent.container);
    fireEvent.click(fillEmptySwitch());
    expect(chip(sent.container).getAttribute("aria-label")).toContain("(fijo: fuera de los grupos del solver)");
    sent.unmount();

    // Withheld: the same seat is the admin's, not a pin, so the board says nothing about it.
    const { container } = setup(echoPins, [ANA_AWAY, LUCIA, BETO]);
    seatBeto(container);
    fireEvent.click(fillEmptySwitch());
    expect(chip(container).getAttribute("aria-label")).not.toContain("fijo");
  });

  it("the confirm counts the 31st's empty seats only when the request would send it", () => {
    const openConfirm = () => {
      fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
      return screen.getByText(/Solo se llenarán/);
    };
    const { rerender } = setup(roster);
    fireEvent.click(fillEmptySwitch());
    // Four Sundays × (2 Lead + 3 BGV + 3 Coro) = 32, plus the 31st's 2 Lead + 3 BGV.
    const banner = openConfirm();
    expect(banner.textContent).toContain("los 37 lugares de voz vacíos");
    fireEvent.click(within(banner.closest("div") as HTMLElement).getByRole("button", { name: "Cancelar" }));

    rerender(<Gen members={[ANA_AWAY, LUCIA, BETO] as never} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    // T5 now withholds the 31st: its five seats are the admin's, not Auto's.
    expect(openConfirm().textContent).toContain("los 32 lugares de voz vacíos");
  });
});

describe("the trailing Saturday — the grid judges its rules as week 5", () => {
  // MonthGenerator hands the grid `sundayDatesForColumn = ruleContextForTarget(...)?.sundayDates`;
  // `PlannerGrid.test.tsx` copies that lambda, and this renders the real one. Over November's
  // spine (the Sunday after the 31st is 1 Nov) the 31st read as week 1 — the opposite of the solver.
  const excludedIn = (week: number) => readyRules({
    ...DEFAULT_SOLVER_CONFIG,
    restrictions: [
      ...DEFAULT_SOLVER_CONFIG.restrictions,
      {
        id: "beto-week", person: "Beto", excludedPatterns: [], fairness: "none", fairnessSlack: 0,
        weekExclusions: [{ id: "w", week, pattern: "Sat.*" }], caps: [],
      },
    ],
  });
  const betoOn31stLead = (container: HTMLElement) => {
    fireEvent.click(cellAt(container, "lead", OCT_31).querySelector("[data-cell-action]") as HTMLElement);
    const picker = screen.getByRole("region", { name: `Candidatos para Lead — ${OCT_31}` });
    return within(picker).getByText("Beto").closest("li") as HTMLElement;
  };

  it("a week-5 exclusion blocks Beto in the 31st's Lead picker, and a week-1 one does not", () => {
    const week5 = setup(roster, undefined, excludedIn(5));
    const blocked = betoOn31stLead(week5.container);
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    expect(within(blocked).getByText("Regla: excluido en la semana 5 (Sat.*)")).toBeTruthy();
    week5.unmount();

    const week1 = setup(roster, undefined, excludedIn(1));
    expect(betoOn31stLead(week1.container).getAttribute("aria-disabled")).toBeNull();
  });
});

describe("the «Fuera del alcance de Auto» surface is gone", () => {
  it("shows no badge on the 31st's column and no clause in the confirm", () => {
    const { container } = setup(roster);
    expect(cellAt(container, "lead", OCT_31)).toBeTruthy();
    expect(screen.queryByText(/fuera del alcance/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
    expect(screen.getByText(/Esto reemplazará toda asignación de voz/).textContent).not.toMatch(/fuera del alcance/i);
  });
});
