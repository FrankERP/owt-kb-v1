/** @vitest-environment jsdom */
// app/components/admin/__tests__/fillEmpty.wiring.test.tsx
//
// «Solo llenar vacíos» WIRED, on the shipped derived path (spec 2026-09-29 §3.4). The pure
// halves are pinned in pinModel/pinViolations; this proves MonthGenerator sends the pins,
// checks the handshake, keeps instruments and names what the solver gave up.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What ships: derived source, NO history sent (ADR-0046). The two cases about
// the solve-time history read — which only exists when history is sent — flip
// the switch for themselves; MonthGenerator reads it at call time.
const switches = vi.hoisted(() => ({ SOLVER_HISTORY_SOURCE: "derived", SOLVER_SENDS_HISTORY: false }));
vi.mock("../solverHistorySource", () => switches);

import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { PIN_HANDSHAKE_REFUSAL } from "../pinModel";
import { solverRefusalMessage } from "../plannerModel";
import { echoPins, emptySchedule, stubSolve, type Respond } from "./pinSolveHarness";
import {
  ANA, BETO, Gen, LUCIA, PACO, RODRI, SUNDAYS, cellAt, deselectAll, fillEmptySwitch, preview, runAuto,
  selectSundayLead, setMonthYear,
} from "./plannerWiringHarness";
import { readyRules } from "./rulesHarness";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); switches.SOLVER_SENDS_HISTORY = false; });
beforeEach(() => { localStorage.clear(); });

const MEMBERS = [ANA, LUCIA, BETO, RODRI, PACO];
const TODAY_KEYS = ["weeks", "weekends_with_saturday", "sunday_leads", "saturday_leads", "support", "dsl_rules", "history"];

/** The first Auto of a test: Ana leads week 1, Lucía sings BGV in week 2. */
const firstRoster: Respond = (body) => {
  const schedule = emptySchedule(body);
  schedule["1"].Sunday!.Lead = ["Ana Karen Villalobos"];
  schedule["2"].Sunday!.BGV = ["María Lucía Estrada"];
  return { ok: true, schedule, pinned_honored: 0, pin_violations: [], unfilled_seats: [] };
};

function setup(respond: Respond, members = MEMBERS, rules?: ReturnType<typeof readyRules>) {
  const stub = stubSolve(respond);
  const view = render(<Gen rules={rules} members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
  setMonthYear(view.container, 3, 2026);
  deselectAll(view.container, "saturday");
  selectSundayLead(view.container, "Ana");
  preview();
  return { ...view, ...stub };
}

describe("«Solo llenar vacíos» — the request", () => {
  it("is off by default and sends no `pinned` key — the request is today's", async () => {
    const { bodies } = setup(firstRoster);
    expect(fillEmptySwitch().getAttribute("aria-checked")).toBe("false");
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0])).toEqual(TODAY_KEYS);
  });

  it("with the switch on and an empty board sends no `pinned` key either", async () => {
    const { bodies } = setup(echoPins);
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0])).toEqual(TODAY_KEYS);
  });

  it("pins exactly the occupied voice seats, by member_name, and applies the echoed roster", async () => {
    const { bodies, container } = setup((body, call) => (call === 1 ? firstRoster(body, call) : echoPins(body)));
    runAuto();
    await waitFor(() => expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].pinned).toEqual([
      { week: 1, role: "Sun.Lead", person: "Ana Karen Villalobos" },
      { week: 2, role: "Sun.BGV", person: "María Lucía Estrada" },
    ]);
    expect(Object.keys(bodies[1])).toEqual([...TODAY_KEYS, "pinned"]);
    await waitFor(() => expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Lucía"));
    expect(screen.queryByText(PIN_HANDSHAKE_REFUSAL)).toBeNull();
  });
});

describe("«Solo llenar vacíos» — the handshake", () => {
  const liar = (patch: (r: ReturnType<typeof echoPins>) => ReturnType<typeof echoPins>): Respond =>
    (body, call) => {
      if (call === 1) return firstRoster(body, call);
      const r = patch(echoPins(body));
      r.schedule!["3"].Sunday!.Lead = ["Alberto Ruiz Cano"]; // what must NOT be applied
      return r;
    };

  for (const [name, respond] of [
    ["pinned_honored is missing", liar((r) => ({ ...r, pinned_honored: undefined }))],
    ["pinned_honored is short", liar((r) => ({ ...r, pinned_honored: 1 }))],
    ["a pinned name is missing from the schedule", liar((r) => {
      r.schedule!["2"].Sunday!.BGV = [];
      return r;
    })],
  ] as const) {
    it(`refuses and applies no voices when ${name} — instruments still complete, as on every exit`, async () => {
      const { container } = setup(respond);
      runAuto();
      await waitFor(() => expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));
      fireEvent.click(fillEmptySwitch());
      runAuto();
      await waitFor(() => expect(screen.getByText(PIN_HANDSHAKE_REFUSAL)).toBeTruthy());
      expect(cellAt(container, "lead", SUNDAYS[2]).textContent).not.toContain("Beto");
      expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Lucía");
      expect(cellAt(container, "instrumento:Drums", SUNDAYS[0]).textContent).toMatch(/Paco|Rodri/);
      expect(screen.queryByText(/Motivo del solver/)).toBeNull();
    });
  }
});

describe("«Solo llenar vacíos» — every failure exit completes instruments with the switch's flag", () => {
  const HISTORY_ROUTE = "/api/admin/solver-history?";
  /** From the next call on, the fairness-history read answers 500 (the Auto one, not the display's). */
  function failHistoryReads() {
    const answered = globalThis.fetch as (i: unknown, n?: unknown) => Promise<unknown>;
    vi.stubGlobal("fetch", async (input: unknown, init?: unknown) => {
      if (typeof input === "string" && input.startsWith(HISTORY_ROUTE)) return { ok: false, status: 500, json: async () => ({}) };
      return answered(input, init);
    });
  }

  const exits: { name: string; second: Respond; message: string; historyFails?: boolean }[] = [
    { name: "the handshake refusal", second: (body) => ({ ...echoPins(body), pinned_honored: undefined }), message: PIN_HANDSHAKE_REFUSAL },
    { name: "a 422 solver refusal", second: () => ({ ok: false, error: "INFEASIBLE", status: 422 }), message: solverRefusalMessage("INFEASIBLE") },
    { name: "a thrown fetch", second: () => { throw new Error("offline"); }, message: "Error de red al llamar al solver." },
    {
      name: "a failed history read", second: echoPins, historyFails: true,
      message: "No se pudo leer el historial de equidad. Auto no corrió; reintenta.",
    },
  ];

  for (const exit of exits) {
    it(`${exit.name}: fills the empty drum seat and leaves every seated one byte-identical`, async () => {
      // Nobody can drum the last Sunday on the first Auto, so that seat is left empty.
      const drummers = [RODRI, PACO].map((x) => ({ ...x, unavailableDates: [SUNDAYS[4]] }));
      const { container, rerender, bodies } = setup(
        (body, call) => (call === 1 ? firstRoster(body, call) : exit.second(body, call)),
        [ANA, LUCIA, BETO, ...drummers],
      );
      runAuto();
      await waitFor(() => expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));
      const drums = (date: string) => cellAt(container, "instrumento:Drums", date);
      expect(drums(SUNDAYS[4]).textContent).not.toMatch(/Paco|Rodri/);
      const seated = (drums(SUNDAYS[2]).textContent ?? "").includes("Paco") ? PACO : RODRI;
      // Both can now drum the last Sunday, and week 3's drummer can no longer come. An exit that
      // skips `applySpecialFill` leaves the last Sunday empty; one that drops the flag takes the
      // vacate path, which re-seats week 3 with the other drummer.
      const members = MEMBERS.map((x) => (x._id === seated._id ? { ...x, unavailableDates: [SUNDAYS[2]] } : x));
      rerender(<Gen members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
      fireEvent.click(fillEmptySwitch());
      const seatedDays = SUNDAYS.slice(0, 4);
      const before = seatedDays.map((d) => drums(d).outerHTML);
      // A failed history read is an exit only when a history is read at all.
      if (exit.historyFails) { switches.SOLVER_SENDS_HISTORY = true; failHistoryReads(); }
      runAuto();
      await waitFor(() => expect(screen.getByText(exit.message)).toBeTruthy());
      await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
      expect(bodies).toHaveLength(exit.historyFails ? 1 : 2);
      expect(drums(SUNDAYS[4]).textContent).toMatch(/Paco|Rodri/);
      expect(seatedDays.map((d) => drums(d).outerHTML)).toEqual(before);
    });
  }
});

describe("«Solo llenar vacíos» — a hand-placed waiver survives the pinned Auto", () => {
  it("keeps the override's manual origin and its «Regla anulada» marker when the solver hands the pin back", async () => {
    const rules = readyRules({
      ...DEFAULT_SOLVER_CONFIG,
      restrictions: [
        ...DEFAULT_SOLVER_CONFIG.restrictions,
        { id: "beto-bgv", person: "Beto", excludedPatterns: ["Sun.BGV"], fairness: "none", fairnessSlack: 0, weekExclusions: [], caps: [] },
      ],
    });
    const { container } = setup((body, call) => (call === 1 ? firstRoster(body, call) : echoPins(body)), MEMBERS, rules);
    runAuto();
    await waitFor(() => expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));
    // Beto is rule-blocked from Sunday BGV: seat him in week 3 through the override.
    fireEvent.click(cellAt(container, "bgv", SUNDAYS[2]).querySelector("[data-cell-action]") as HTMLElement);
    const picker = screen.getByRole("region", { name: `Candidatos para BGV — ${SUNDAYS[2]}` });
    // Scoped to Beto's row: the default rules also block Lucía in week 3.
    const beto = within(picker).getByText("Beto").closest("li") as HTMLElement;
    fireEvent.click(within(beto).getByRole("button", { name: "Asignar de todos modos" }));
    const waiver = () => within(cellAt(container, "bgv", SUNDAYS[2])).queryByText(/^Regla anulada — Beto: /);
    expect(waiver()).toBeTruthy();

    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect(screen.queryByText(PIN_HANDSHAKE_REFUSAL)).toBeNull();
    expect(cellAt(container, "bgv", SUNDAYS[2]).textContent).toContain("Beto");
    expect(waiver()).toBeTruthy();
    // `origin` has one reader on screen: «Borrar»'s month dialog counts the hand-placed seats.
    // Beto's is the only one — Ana's and Lucía's came from the first Auto.
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Voces (3)" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Aproximadamente 1 se pusieron a mano\./)).toBeTruthy();
  });
});

describe("«Solo llenar vacíos» — instruments are completed, never re-seated", () => {
  it("leaves every instrument cell byte-identical across a second Auto, even when a re-seat would pick someone else", async () => {
    const { container, rerender } = setup(echoPins);
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(cellAt(container, "instrumento:Drums", SUNDAYS[2]).textContent).toMatch(/Paco|Rodri/));
    const drumsWeek3 = cellAt(container, "instrumento:Drums", SUNDAYS[2]).textContent ?? "";
    const seated = drumsWeek3.includes("Paco") ? PACO : RODRI;
    // Make the week-3 drummer unavailable: a re-seat (the vacate path) would now pick the other one.
    const members = MEMBERS.map((x) => (x._id === seated._id ? { ...x, unavailableDates: [SUNDAYS[2]] } : x));
    const before = SUNDAYS.map((d) => cellAt(container, "instrumento:Drums", d).outerHTML);
    rerender(<Gen members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    runAuto();
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect(SUNDAYS.map((d) => cellAt(container, "instrumento:Drums", d).outerHTML)).toEqual(before);
  });
});

describe("«Solo llenar vacíos» — what the admin is told", () => {
  it("shows the left-out Saturday floor AND the solver's give-ups, in that order, and marks the leaderless seat", async () => {
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
    // Ana — the only lead — is pinned into week 1; week 2 comes back leaderless.
    const { container } = setup((body, call) => {
      if (call === 1) return firstRoster(body, call);
      return {
        ...echoPins(body),
        pin_violations: ["builtin:mandatory_lead:W2:Sun"],
        violation_ceiling_proven: false,
        unfilled_seats: ["W2 Sunday Sun.Lead #1", "W2 Sunday Sun.Lead #2"],
      };
    }, MEMBERS, rules);
    runAuto();
    await waitFor(() => expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(screen.getByText(/quedó sin líder/)).toBeTruthy());
    const lines = Array.from(container.querySelectorAll("[data-auto-notices] p")).map((p) => p.textContent);
    expect(lines).toEqual([
      "Este mes no tiene sábados que Auto pueda cubrir, así que no se aplicó «Sat.* == 1» a Beto.",
      "El domingo 8 mar quedó sin líder — lo cedió el solver para acomodar lo que ya estaba puesto.",
      "Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.",
    ]);
    expect(cellAt(container, "lead", SUNDAYS[1]).textContent).toContain("Sin cubrir");
  });

  it("names a pin violation's day over the month's FULL Sunday list, even with the first Sunday deselected (E21)", async () => {
    // 1 Mar deselected: the grid shows 8/15/22/29, but the solver's week 3 is still the month's
    // third Sunday, 15 mar. Read over the calendar's list (`selectedSundays`) it would be 22 mar.
    const { bodies } = stubSolve((body, call) => {
      if (call === 1) {
        const schedule = emptySchedule(body);
        schedule["2"].Sunday!.Lead = ["Ana Karen Villalobos"];
        return { ok: true, schedule, pinned_honored: 0, pin_violations: [], unfilled_seats: [] };
      }
      return { ...echoPins(body), pin_violations: ["builtin:mandatory_lead:W3:Sun"], violation_ceiling_proven: true };
    });
    const view = render(<Gen members={MEMBERS} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    setMonthYear(view.container, 3, 2026);
    deselectAll(view.container, "saturday");
    fireEvent.click(view.container.querySelector(`[data-date="${SUNDAYS[0]}"]`)!);
    selectSundayLead(view.container, "Ana");
    preview();
    expect(cellAt(view.container, "lead", SUNDAYS[0])).toBeNull();
    runAuto();
    await waitFor(() => expect(cellAt(view.container, "lead", SUNDAYS[1]).textContent).toContain("Ana"));

    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].pinned).toEqual([{ week: 2, role: "Sun.Lead", person: "Ana Karen Villalobos" }]);
    await waitFor(() => expect(screen.getByText(/quedó sin líder/)).toBeTruthy());
    expect(Array.from(view.container.querySelectorAll("[data-auto-notices] p")).map((p) => p.textContent)).toEqual([
      "El domingo 15 mar quedó sin líder — lo cedió el solver para acomodar lo que ya estaba puesto.",
    ]);
  });
});

describe("«Solo llenar vacíos» — locked while Auto is pending", () => {
  it("disables the switch and every cell during the history read, and a click there cannot change the pins sent", async () => {
    switches.SOLVER_SENDS_HISTORY = true; // the read window exists only when history is sent
    const { bodies } = stubSolve((body, call) => (call === 1 ? firstRoster(body, call) : echoPins(body)));
    // Hold the NEXT history read open (the Auto one), then let it through.
    const answered = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let hold = false;
    vi.stubGlobal("fetch", async (input: unknown, init?: unknown) => {
      if (hold && typeof input === "string" && input.startsWith("/api/admin/solver-history?")) await gate;
      return (answered as (i: unknown, n?: unknown) => Promise<unknown>)(input, init);
    });
    const view = render(<Gen members={MEMBERS} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    setMonthYear(view.container, 3, 2026);
    deselectAll(view.container, "saturday");
    selectSundayLead(view.container, "Ana");
    preview();
    runAuto();
    await waitFor(() => expect(cellAt(view.container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));

    fireEvent.click(fillEmptySwitch());
    hold = true;
    runAuto();
    await waitFor(() => expect(screen.getByText("Calculando...")).toBeTruthy());
    expect((fillEmptySwitch() as HTMLButtonElement).disabled).toBe(true);
    expect((cellAt(view.container, "bgv", SUNDAYS[3]).querySelector("[data-cell-action]") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(fillEmptySwitch()); // disabled: nothing happens

    release();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].pinned).toEqual([
      { week: 1, role: "Sun.Lead", person: "Ana Karen Villalobos" },
      { week: 2, role: "Sun.BGV", person: "María Lucía Estrada" },
    ]);
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect(fillEmptySwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("with no history sent (what ships), stays locked for the whole solve request", async () => {
    // The only pending window on the shipped path is the POST itself: nothing is
    // read first (ADR-0046). An Auto that stopped awaiting the solve would drop
    // «Calculando...» and unlock the switch and the cells mid-solve.
    const { bodies } = stubSolve((body, call) => (call === 1 ? firstRoster(body, call) : echoPins(body)));
    const answered = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let hold = false;
    vi.stubGlobal("fetch", async (input: unknown, init?: unknown) => {
      if (hold && input === "/api/admin/solve") await gate;
      return (answered as (i: unknown, n?: unknown) => Promise<unknown>)(input, init);
    });
    const view = render(<Gen members={MEMBERS} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
    setMonthYear(view.container, 3, 2026);
    deselectAll(view.container, "saturday");
    selectSundayLead(view.container, "Ana");
    preview();
    runAuto();
    await waitFor(() => expect(cellAt(view.container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));

    fireEvent.click(fillEmptySwitch());
    hold = true;
    runAuto();
    await waitFor(() => expect(screen.getByText("Calculando...")).toBeTruthy());
    // Give a non-awaiting Auto every chance to settle before asserting the lock.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("Calculando...")).toBeTruthy();
    expect((fillEmptySwitch() as HTMLButtonElement).disabled).toBe(true);
    expect((cellAt(view.container, "bgv", SUNDAYS[3]).querySelector("[data-cell-action]") as HTMLButtonElement).disabled).toBe(true);

    release();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].history).toEqual([]);
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
  });
});

describe("«Solo llenar vacíos» — pin conflicts on the board", () => {
  it("names an unavailable pinned occupant on the chip and under the cell, only while the switch is on", async () => {
    const away = { ...LUCIA, unavailableDates: [SUNDAYS[1]] };
    const { container } = setup(firstRoster, [ANA, away, BETO, RODRI, PACO]);
    runAuto();
    await waitFor(() => expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Lucía"));
    const chip = () => cellAt(container, "bgv", SUNDAYS[1]).querySelector('[data-occupant="lucia"]') as HTMLElement;
    expect(chip().getAttribute("aria-label")).not.toContain("fijo");
    fireEvent.click(fillEmptySwitch());
    expect(chip().getAttribute("aria-label")).toContain("(fijo: no disponible ese día)");
    expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Lucía: marcó este día como no disponible");
  });
});
