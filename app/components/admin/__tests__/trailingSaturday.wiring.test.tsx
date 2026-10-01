/** @vitest-environment jsdom */
// app/components/admin/__tests__/trailingSaturday.wiring.test.tsx
//
// The trailing Saturday WIRED, on the shipped derived path (plan 2026-09-30-planner-trailing-saturday,
// Task 3; spec 2026-09-29 §2). The pure halves are pinned in `trailingSaturday.test.ts`; this proves
// MonthGenerator sends Sat 31 Oct 2026 as week 5, applies what comes back to its column, says so when
// T5 withholds it, keeps a withheld 31st out of the pins (Q1) and out of the confirm's count,
// solves the month again without it when the solver refuses it with the 31st (Q19), and that the
// «Fuera del alcance de Auto» surface is gone.
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
function setup(
  respond: Respond,
  members: object[] = [ANA, LUCIA, BETO],
  rules?: ReturnType<typeof readyRules>,
  beforePreview?: (container: HTMLElement) => void,
) {
  const stub = stubSolve(respond);
  const view = render(
    <Gen rules={rules} members={members as never} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
  );
  setMonthYear(view.container, 10, 2026);
  deselectAll(view.container, "saturday");
  fireEvent.click(view.container.querySelector(`[data-date="${OCT_31}"]`)!);
  selectSundayLead(view.container, "Ana");
  beforePreview?.(view.container);
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
      "El sábado 31 oct no se mandó al solver: ningún líder puede dirigirlo (no disponibles, excluidos o sin sábados libres en su regla). Llénalo a mano.",
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

describe("the trailing Saturday — the Sunday list is the month's, not the calendar's (E21)", () => {
  // 25 Oct deselected: the grid shows three Sundays, but the 31st is still the trailing Saturday
  // of the month's FULL spine (4/11/18/25), week 5. Fed `selectedSundays` (4/11/18) instead, the
  // trailing Saturday would be the 24th, and the 31st no Saturday of any week. Three consumers
  // read that spine and nothing else pinned them: the `requestSaturdayWeeks` memo (the confirm's
  // count), `pinBoard`'s `collectPins` (the chip's «fijo») and `prepareSolve`'s `collectPins`
  // (the pins Auto sends). Swapping any one of them for `selectedSundays` fails this test.
  it("with 25 Oct deselected, the 31st is still week 5: counted, marked fijo, and pinned as week 5", async () => {
    const { bodies, container } = (() => {
      const stub = stubSolve(echoPins);
      const view = render(<Gen members={[ANA, LUCIA, BETO] as never} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
      setMonthYear(view.container, 10, 2026);
      deselectAll(view.container, "saturday");
      fireEvent.click(view.container.querySelector(`[data-date="${OCT_31}"]`)!);
      fireEvent.click(view.container.querySelector('[data-date="2026-10-25"]')!);
      selectSundayLead(view.container, "Ana");
      preview();
      return { ...view, ...stub };
    })();
    expect(container.querySelector('[data-row-id="lead"][data-date="2026-10-25"]')).toBeNull();

    fireEvent.click(fillEmptySwitch());
    fireEvent.click(cellAt(container, "bgv", OCT_31).querySelector("[data-cell-action]") as HTMLElement);
    const picker = screen.getByRole("region", { name: `Candidatos para BGV — ${OCT_31}` });
    fireEvent.click(within(picker).getByRole("button", { name: /Beto/ }));

    // Beto — in no pool, since no rule names him — is a pin on the 31st, and the chip says so.
    const chip = cellAt(container, "bgv", OCT_31).querySelector('[data-occupant="beto"]') as HTMLElement;
    expect(chip.getAttribute("aria-label")).toContain("fijo");

    // Three Sundays (4, 11, 18) × (2 Lead + 3 BGV + 3 Coro) = 24, plus the 31st's 2 Lead + 3 BGV
    // = 29 seats, one of them Beto's: 28 empty. Over the calendar's spine the 31st drops out: 24.
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
    const banner = screen.getByText(/Solo se llenarán/);
    expect(banner.textContent).toContain("los 28 lugares de voz vacíos");
    fireEvent.click(within(banner.closest("div") as HTMLElement).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].weeks).toBe(4);
    expect(bodies[0].weekends_with_saturday).toEqual([5]);
    expect(bodies[0].pinned).toContainEqual({ week: 5, role: "Sat.BGV", person: "Alberto Ruiz Cano" });
  });
});

describe("the trailing Saturday — notice order", () => {
  it("the trailing-Saturday line comes before delivery 3's dropped-pin lines", async () => {
    // The first Auto (switch off) seats Lucía twice on the first Sunday, BGV and Coro — the
    // picker refuses that by hand («Ya asignado en Bgv»), a solve does not. The second Auto,
    // with «Solo llenar vacíos» on, pins her once and says so; Ana is away on the 31st, so T5
    // withholds it both times.
    const twice: Respond = (body, call) => {
      if (call !== 1) return echoPins(body);
      const schedule = emptySchedule(body);
      schedule["1"].Sunday = { Lead: ["Ana Karen Villalobos"], BGV: ["María Lucía Estrada"], Choir: ["María Lucía Estrada"] };
      return { ok: true, schedule, pinned_honored: 0, pin_violations: [], unfilled_seats: [] };
    };
    const { bodies, container } = setup(twice, [ANA_AWAY, LUCIA, BETO]);
    runAuto();
    await waitFor(() => expect(cellAt(container, "coro", OCT_SUNDAYS[0]).textContent).toContain("Lucía"));
    expect(cellAt(container, "bgv", OCT_SUNDAYS[0]).textContent).toContain("Lucía");

    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].weekends_with_saturday).toEqual([]);
    await waitFor(() => expect(noticeLines(container)).toHaveLength(2));
    expect(noticeLines(container)).toEqual([
      "El sábado 31 oct no se mandó al solver: ningún líder puede dirigirlo (no disponibles, excluidos o sin sábados libres en su regla). Llénalo a mano.",
      "Lucía estaba en dos lugares del domingo 4 oct; se fijó solo en BGV.",
    ]);
  });
});

describe("the trailing Saturday — a pin refusal still shows the floor and trailing lines", () => {
  it("refuses before the fetch, and lists the minimums left out and the withheld 31st under Auto", async () => {
    // Final review m3: `prepareSolve` returned on a pin refusal before it set the notices, so
    // these two lines — true of the request either way — were never shown.
    const rules = readyRules({
      ...DEFAULT_SOLVER_CONFIG,
      restrictions: [
        ...DEFAULT_SOLVER_CONFIG.restrictions,
        {
          id: "lucia-sat", person: "Lucía", excludedPatterns: [], fairness: "none", fairnessSlack: 0, weekExclusions: [],
          caps: [{ id: "c1", pattern: "Sat.*", op: "==", value: 1, relative: false, relOffset: 2 }],
        },
      ],
    });
    const { bodies, container, rerender } = setup(echoPins, [ANA_AWAY, LUCIA, BETO], rules);
    // Beto on the first Sunday's BGV by hand; then he leaves the members list, so his seat no
    // longer resolves and «Solo llenar vacíos» refuses.
    fireEvent.click(cellAt(container, "bgv", OCT_SUNDAYS[0]).querySelector("[data-cell-action]") as HTMLElement);
    const picker = screen.getByRole("region", { name: `Candidatos para BGV — ${OCT_SUNDAYS[0]}` });
    fireEvent.click(within(picker).getByRole("button", { name: /Beto/ }));
    rerender(<Gen rules={rules} members={[ANA_AWAY, LUCIA] as never} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(screen.getByText(
      "No se puede usar «Solo llenar vacíos»: en BGV del domingo 4 oct hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo.",
    )).toBeTruthy());
    expect(bodies).toHaveLength(0);
    expect(noticeLines(container)).toEqual([
      "Este mes no tiene sábados que Auto pueda cubrir, así que no se aplicó «Sat.* == 1» a Lucía.",
      "El sábado 31 oct no se mandó al solver: ningún líder puede dirigirlo (no disponibles, excluidos o sin sábados libres en su regla). Llénalo a mano.",
    ]);
  });
});

describe("Q19: a month the solver refuses with the 31st is solved again without it", () => {
  // Frank's decision (2026-09-30): sending the 31st can make the solver refuse the WHOLE month,
  // Sundays included, where main (which never sent it) solved it. So when the solver itself
  // refuses a request that sent week 5, Auto re-solves once without it and says so.
  // Spanish only (ruling Q20): the solver's English reason is never quoted in this line.
  const INFEASIBLE = "El sábado 31 oct no se mandó al solver: con él, el mes no tenía solución. Llénalo a mano.";
  const refused = (error: string) => ({ status: 422, ok: false, error });
  /** Beto may not sing the 31st: a week-5 exclusion the first request sends and the retry must not (Q9). */
  const betoOff31 = readyRules({
    ...DEFAULT_SOLVER_CONFIG,
    restrictions: [
      ...DEFAULT_SOLVER_CONFIG.restrictions,
      {
        id: "beto-w5", person: "Beto", excludedPatterns: [], fairness: "none", fairnessSlack: 0,
        weekExclusions: [{ id: "w", week: 5, pattern: "Sat.*" }], caps: [],
      },
    ],
  });
  const solveCount = (fetchMock: ReturnType<typeof stubSolve>["fetchMock"]) =>
    fetchMock.mock.calls.filter(([url]) => url === "/api/admin/solve").length;
  /** A weekday special, added through the real composer on the config step. */
  const addVigil = (container: HTMLElement) => {
    fireEvent.click(container.querySelector('[data-date="2026-10-14"]')!);
    fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: "Vigilia" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
  };

  it("a solver refusal of [5] is retried once without week 5 or any rule naming it, and the Sundays are filled", async () => {
    const { bodies, container, fetchMock } = setup(
      (body, call) => (call === 1 ? refused("x") : roster(body, call)), undefined, betoOff31,
    );
    runAuto();
    await waitFor(() => expect(cellAt(container, "lead", OCT_SUNDAYS[0]).textContent).toContain("Ana"));
    expect(solveCount(fetchMock)).toBe(2);
    expect(bodies[0].weekends_with_saturday).toEqual([5]);
    expect(bodies[0].dsl_rules).toContain("Alberto Ruiz Cano !in week 5 Sat.*");
    expect(bodies[1].weekends_with_saturday).toEqual([]);
    expect(bodies[1].dsl_rules.join("\n")).not.toMatch(/\bweek 5\b/);
    expect(noticeLines(container)).toEqual([INFEASIBLE]);
    expect(container.textContent).not.toMatch(/motivo del solver/i);
    expect(screen.queryByText(/El solver no encontró solución/)).toBeNull();
    // Nothing came back for the 31st, so it is the admin's to fill.
    expect(cellAt(container, "lead", OCT_31).textContent).not.toContain("Ana");
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
  });

  for (const [name, answer, message] of [
    [
      "a refusal the route made itself (transport_error)",
      { status: 422, ok: false, error: "Solver service returned HTTP 503", transport_error: true as const },
      "El solver no encontró solución. Motivo del solver: Solver service returned HTTP 503",
    ],
    ["a non-422 status", { status: 500, ok: false, error: "boom" }, "El solver no encontró solución."],
  ] as const) {
    it(`${name} is never retried: one fetch, and its error shown`, async () => {
      const { bodies, fetchMock } = setup(() => answer);
      runAuto();
      await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
      await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
      expect(solveCount(fetchMock)).toBe(1);
      expect(bodies[0].weekends_with_saturday).toEqual([5]);
    });
  }

  it("a refused request that did not send the 31st is not retried", async () => {
    const { bodies, container, fetchMock } = setup(() => refused("x"), [ANA_AWAY, LUCIA, BETO]);
    runAuto();
    await waitFor(() => expect(screen.getByText("El solver no encontró solución. Motivo del solver: x")).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect(solveCount(fetchMock)).toBe(1);
    expect(bodies[0].weekends_with_saturday).toEqual([]);
    expect(noticeLines(container)).toEqual([
      "El sábado 31 oct no se mandó al solver: ningún líder puede dirigirlo (no disponibles, excluidos o sin sábados libres en su regla). Llénalo a mano.",
    ]);
  });

  it("a retry refused too: two fetches, the retry's refusal and its notices shown, and the special still filled", async () => {
    const { container, fetchMock } = setup(
      (_body, call) => refused(call === 1 ? "x" : "y"), undefined, undefined, addVigil,
    );
    runAuto();
    await waitFor(() => expect(screen.getByText("El solver no encontró solución. Motivo del solver: y")).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect(solveCount(fetchMock)).toBe(2);
    expect(screen.queryByText("El solver no encontró solución. Motivo del solver: x")).toBeNull();
    expect(noticeLines(container)).toEqual([INFEASIBLE]);
    // E5: the special never needed the solver, and fills on this exit too.
    expect(cellAt(container, "lead", "2026-10-14").textContent).toContain("Ana");
    expect(cellAt(container, "lead", OCT_SUNDAYS[0]).textContent).not.toContain("Ana");
  });

  it("«Solo llenar vacíos»: the retry sends no week-5 pin, and Auto stays locked until the second answer", async () => {
    const { bodies, container } = setup((body, call) => (call === 1 ? refused("x") : echoPins(body)));
    // Lucía on the 31st's BGV, Beto on the first Sunday's BGV, both by hand.
    const seat = (date: string, who: RegExp) => {
      fireEvent.click(cellAt(container, "bgv", date).querySelector("[data-cell-action]") as HTMLElement);
      const picker = screen.getByRole("region", { name: `Candidatos para BGV — ${date}` });
      fireEvent.click(within(picker).getByRole("button", { name: who }));
    };
    seat(OCT_31, /Lucía/);
    seat(OCT_SUNDAYS[0], /Beto/);
    // Hold the SECOND solve open once it has been sent.
    const answered = globalThis.fetch as (i: unknown, n?: unknown) => Promise<unknown>;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let solves = 0;
    vi.stubGlobal("fetch", async (input: unknown, init?: unknown) => {
      const out = answered(input, init);
      if (input === "/api/admin/solve" && ++solves === 2) await gate;
      return out;
    });

    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0].weekends_with_saturday).toEqual([5]);
    expect(bodies[0].pinned).toContainEqual({ week: 5, role: "Sat.BGV", person: "María Lucía Estrada" });
    expect(bodies[1].weekends_with_saturday).toEqual([]);
    expect(bodies[1].pinned).toEqual([{ week: 1, role: "Sun.BGV", person: "Alberto Ruiz Cano" }]);
    // The first answer has landed and the second has not: still locked, for the WHOLE of both.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("Calculando...")).toBeTruthy();
    expect((fillEmptySwitch() as HTMLButtonElement).disabled).toBe(true);
    expect((cellAt(container, "bgv", OCT_SUNDAYS[1]).querySelector("[data-cell-action]") as HTMLButtonElement).disabled).toBe(true);

    release();
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect((fillEmptySwitch() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(REFUSED)).toBeNull();
    // The 31st stays exactly as the admin left it, and the pinned Sunday seat holds.
    expect(cellAt(container, "bgv", OCT_31).textContent).toContain("Lucía");
    expect(cellAt(container, "bgv", OCT_SUNDAYS[0]).textContent).toContain("Beto");
    expect(noticeLines(container)).toEqual([INFEASIBLE]);
  });

  it("a network throw on the first fetch is not retried", async () => {
    const { fetchMock } = setup(() => { throw new Error("offline"); });
    runAuto();
    await waitFor(() => expect(screen.getByText("Error de red al llamar al solver.")).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect(solveCount(fetchMock)).toBe(1);
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
