/** @vitest-environment jsdom */
// app/components/admin/__tests__/fillEmpty.wiring.test.tsx
//
// «Solo llenar vacíos» WIRED, on the shipped derived path (spec 2026-09-29 §3.4). The pure
// halves are pinned in pinModel/pinViolations; this proves MonthGenerator sends the pins,
// checks the handshake, keeps instruments and names what the solver gave up.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { PIN_HANDSHAKE_REFUSAL } from "../pinModel";
import { echoPins, emptySchedule, stubSolve, type Respond } from "./pinSolveHarness";
import {
  ANA, BETO, Gen, LUCIA, PACO, RODRI, SUNDAYS, cellAt, deselectAll, fillEmptySwitch, preview, runAuto,
  selectSundayLead, setMonthYear,
} from "./plannerWiringHarness";
import { readyRules } from "./rulesHarness";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); });

const MEMBERS = [ANA, LUCIA, BETO, RODRI, PACO];
const TODAY_KEYS = ["weeks", "weekends_with_saturday", "sunday_leads", "saturday_leads", "support", "dsl_rules", "history"];

/** The first Auto of a test: Ana leads week 1, Lucía sings BGV in week 2. */
const firstRoster: Respond = (body) => {
  const schedule = emptySchedule(body);
  schedule["1"].Sunday.Lead = ["Ana Karen Villalobos"];
  schedule["2"].Sunday.BGV = ["María Lucía Estrada"];
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
      r.schedule!["3"].Sunday.Lead = ["Alberto Ruiz Cano"]; // what must NOT be applied
      return r;
    };

  for (const [name, respond] of [
    ["pinned_honored is missing", liar((r) => ({ ...r, pinned_honored: undefined }))],
    ["pinned_honored is short", liar((r) => ({ ...r, pinned_honored: 1 }))],
    ["a pinned name is missing from the schedule", liar((r) => {
      r.schedule!["2"].Sunday.BGV = [];
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
});
