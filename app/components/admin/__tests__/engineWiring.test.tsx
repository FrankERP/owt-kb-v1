/** @vitest-environment jsdom */
// Solver v3 C6 CTL-1 — the surfaces C6 gates on its server-resolved prop: C1's note
// «Cuenta para equidad: aplica con el nuevo solver…» and C3's card-chip note
// (`CADENCE_V2_NOTE`), each shown only under v2. Not gated (C3 owns them, under both engines):
// the «Holgura» note (`SLACK_V3_NOTE`). C7's flip rewrites the «CTL-1 card chip» tests below.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import MonthCalendar from "../MonthCalendar";
import { FairnessEngineNote } from "../FairnessSwitch";
import { FAIRNESS_ENGINE_NOTE } from "../fairnessToggleModel";
import type { PersonRestriction, SolverConfig } from "../plannerModel";
import { AdminProviders } from "./providersHarness";
import { readyRules } from "./rulesHarness";
import { CADENCE_V2_NOTE, SLACK_V3_NOTE } from "@/app/utils/sundayCadence";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-03T18:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const members = [
  { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "support"] },
];
const CADENCE_AND_SLACK: PersonRestriction = {
  id: "r-ana", person: "Ana", excludedPatterns: [], fairness: "slack", fairnessSlack: 2,
  weekExclusions: [], caps: [], sundayCadence: "alternate",
};
const config: SolverConfig = {
  sundayLeads: [], saturdayLeads: [], support: [], restrictions: [CADENCE_AND_SLACK], conflicts: [], presence: [],
};

function renderGenerator(engine: "v2" | "v3") {
  return render(
    <MonthGenerator
      engine={engine}
      members={members}
      existingRoles={[]}
      onClose={vi.fn()}
      onCreated={vi.fn()}
      rules={readyRules(config)}
    />,
    { wrapper: AdminProviders },
  );
}
const card = () =>
  screen.getAllByTitle("Editar").map((b) => b.closest("div.rounded-lg") as HTMLElement)
    .find((e) => /Ana/.test(e.textContent ?? ""))!;

describe("C1's note follows the engine prop", () => {
  it("renders under v2 and nothing under v3", () => {
    const v2 = render(<FairnessEngineNote engine="v2" />);
    expect(v2.container.textContent).toBe(FAIRNESS_ENGINE_NOTE);
    cleanup();
    const v3 = render(<FairnessEngineNote engine="v3" />);
    expect(v3.container.textContent).toBe("");
  });

  it("the special composer shows it under v2 only", () => {
    for (const engine of ["v2", "v3"] as const) {
      const { container } = render(
        <MonthCalendar
          engine={engine}
          year={2026} month={8} selectedSundays={[]} selectedSaturdays={[]} specials={[]} existingRoles={[]}
          onToggleWeekend={vi.fn()} onAddSpecial={vi.fn()} onRemoveSpecial={vi.fn()}
        />,
      );
      fireEvent.click(container.querySelector('[data-date="2026-08-12"]')!);
      expect(screen.queryByText(FAIRNESS_ENGINE_NOTE) !== null).toBe(engine === "v2");
      cleanup();
    }
  });
});

describe("CTL-1 card chip: C3's `CADENCE_V2_NOTE` follows the engine prop", () => {
  it("v2: the chip is followed by its note", () => {
    renderGenerator("v2");
    const chip = within(card()).getByText("Mes por medio");
    expect(chip.nextElementSibling?.textContent).toBe(CADENCE_V2_NOTE);
  });

  it("v3: the chip stays and its note is gone", () => {
    renderGenerator("v3");
    expect(within(card()).getByText("Mes por medio")).toBeTruthy();
    expect(within(card()).queryByText(CADENCE_V2_NOTE)).toBeNull();
  });

  it("the «Holgura» note is C3's under both engines (not gated)", () => {
    for (const engine of ["v2", "v3"] as const) {
      renderGenerator(engine);
      expect(within(card()).getByText(`holgura 2 · ${SLACK_V3_NOTE}`)).toBeTruthy();
      cleanup();
    }
  });
});
