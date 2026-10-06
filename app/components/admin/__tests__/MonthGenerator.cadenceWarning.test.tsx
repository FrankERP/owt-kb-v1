/** @vitest-environment jsdom */
// Solver v3 C3 §6.6–§6.7 — the name chips on a «Mes por medio» card and the
// «Mes por medio fuera de Líderes Domingo» warning (T10, T11).
//
// The chips read the planner's UNFILTERED roster — never `RuleBuilder`'s
// `voz`-filtered person list (E13) — through `resolveRulePersonId`, which drops
// non-worship members itself, so a super-admin (whose roster includes kids-only
// members, E25) sees the same chips a worship admin does. The warning renders
// only behind an explicit input that defaults to CLOSED: under v2 the cadence
// members sit in «Líderes Sábado» by design, and the warning would invite the
// one action that changes v2. C6 opens it under v3.
import type { ComponentProps } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules } from "./rulesHarness";
import { AdminProviders } from "./providersHarness";
import { CADENCE_OUTSIDE_HEADING, CADENCE_OUTSIDE_SENTENCE } from "@/app/utils/sundayCadence";
import type { PersonRestriction, SolverConfig } from "../plannerModel";

afterEach(cleanup);

type Members = ComponentProps<typeof MonthGenerator>["members"];

// Annotated, so `tsc` refuses `ministries` unless the planner's member type
// carries it (C3 §5: the type stops erasing the field at the resolver's door).
const WORSHIP: Members = [
  { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "support"], ministries: ["worship"] },
  { _id: "m-carla", member_name: "Carla Soto", alias: "Carla", memberType: ["voz", "sunday_lead"], ministries: [] },
];
const KIDS_ANA: Members[number] = { _id: "m-kids-ana", member_name: "Ana Pérez", alias: "Ana", ministries: ["kids"] };
const KIDS_DORA: Members[number] = { _id: "m-kids-dora", member_name: "Dora León", ministries: ["kids"] };

const rule = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...patch,
});
const cadence = (id: string, person: string) => rule(id, person, { sundayCadence: "alternate" });
const configWith = (restrictions: PersonRestriction[], sundayLeads: string[] = []): SolverConfig => ({
  sundayLeads, saturdayLeads: [], support: [], restrictions, conflicts: [], presence: [],
});

function renderGen(config: SolverConfig, members: Members, extra: Partial<ComponentProps<typeof MonthGenerator>> = {}) {
  return render(
    <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} rules={readyRules(config)} {...extra} />,
    { wrapper: AdminProviders },
  );
}
const card = (text: RegExp) => {
  const el = screen.getAllByTitle("Editar")
    .map((b) => b.closest("div.rounded-lg") as HTMLElement)
    .find((e) => text.test(e.textContent ?? ""));
  if (!el) throw new Error(`no rule card matching ${text}`);
  return el;
};

describe("the name chips on a «Mes por medio» card (C3 §6.6, T11)", () => {
  it("«Nombre ambiguo» when the name matches two worship members", () => {
    const twoAnas: Members = [...WORSHIP, { _id: "m-ana2", member_name: "Ana", memberType: ["voz"] }];
    renderGen(configWith([cadence("r-1", "Ana")]), twoAnas);
    expect(within(card(/Ana/)).getByText("Nombre ambiguo: coincide con 2 personas")).toBeTruthy();
  });

  it("counts the unfiltered roster: a namesake with no `voz` still counts", () => {
    const twoAnas: Members = [...WORSHIP, { _id: "m-ana2", member_name: "Ana", memberType: [] }];
    renderGen(configWith([cadence("r-1", "Ana")]), twoAnas);
    expect(within(card(/Ana/)).getByText("Nombre ambiguo: coincide con 2 personas")).toBeTruthy();
  });

  it("no chip for a name shared only with a kids-only member — whoever is viewing", () => {
    renderGen(configWith([cadence("r-1", "Ana")]), [...WORSHIP, KIDS_ANA]); // a super-admin's roster
    expect(within(card(/Ana/)).queryByText(/Nombre ambiguo/)).toBeNull();
    expect(within(card(/Ana/)).queryByText(/Nombre no reconocido/)).toBeNull();
  });

  it("«Nombre no reconocido en Alabanza» when only a kids-only member matches (v2's first-match banner resolves her)", () => {
    renderGen(configWith([cadence("r-1", "Dora León")]), [...WORSHIP, KIDS_DORA]);
    expect(within(card(/Dora/)).getByText("Nombre no reconocido en Alabanza")).toBeTruthy();
  });

  it("no chip on a «Normal» card, even with an ambiguous name (v2's first match is untouched)", () => {
    const twoAnas: Members = [...WORSHIP, { _id: "m-ana2", member_name: "Ana", memberType: ["voz"] }];
    renderGen(configWith([rule("r-1", "Ana", { excludedPatterns: ["Sat.*"] })]), twoAnas);
    expect(within(card(/Ana/)).queryByText(/Nombre ambiguo/)).toBeNull();
  });
});

describe("«Mes por medio fuera de Líderes Domingo» (C3 §6.7, T10)", () => {
  const config = configWith([cadence("r-1", "Ana"), cadence("r-2", "Bruno"), cadence("r-3", "Carla")], ["m-carla"]);

  it("renders nothing while its gate is closed — the default", () => {
    renderGen(config, WORSHIP);
    expect(screen.queryByText(CADENCE_OUTSIDE_HEADING)).toBeNull();
    expect(screen.queryByText(/descansa este mes/)).toBeNull();
  });

  it("lists each resolved cadence member outside the Sunday pool when the gate is open", () => {
    renderGen(config, WORSHIP, { showCadencePoolWarning: true });
    expect(screen.getByText(CADENCE_OUTSIDE_HEADING)).toBeTruthy();
    expect(screen.getByText(CADENCE_OUTSIDE_SENTENCE.not_ticked("Ana"))).toBeTruthy();
    expect(screen.getByText(CADENCE_OUTSIDE_SENTENCE.no_sunday_lead_tipo("Bruno"))).toBeTruthy();
    expect(screen.queryByText(/^Carla /)).toBeNull(); // ticked, with a fitting Tipo
  });

  it("renders nothing, open or not, when nobody is outside", () => {
    renderGen(configWith([cadence("r-3", "Carla")], ["m-carla"]), WORSHIP, { showCadencePoolWarning: true });
    expect(screen.queryByText(CADENCE_OUTSIDE_HEADING)).toBeNull();
  });
});
