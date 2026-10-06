/** @vitest-environment jsdom */
// Parent A38 in the rule UI (solver v3 C3 §6.2, T14): a person has at most one
// exact (`==`) count per role key. The route refuses a body with two; the form
// does not produce one; and a pair saved before C3 is not a dead end — the panel
// marks both cards, and removing either cap lets the next save through. Form,
// panel and route all run `exactCapOverlaps`, so they cannot disagree.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules, type RulesHarness } from "./rulesHarness";
import { AdminProviders } from "./providersHarness";
import { exactOverlapCardMessage, exactOverlapFormMessage } from "../solverConfigSource";
import { exactCapOverlaps } from "@/app/utils/solverConfigWriteRequest";
import type { PersonRestriction, RestrictionCap, SolverConfig } from "../plannerModel";

afterEach(cleanup);

const members = [
  { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "support"] },
];
const cap = (id: string, pattern: string, op: RestrictionCap["op"], value = 1): RestrictionCap => ({
  id, pattern, op, value, relative: false, relOffset: 0,
});
const rule = (id: string, person: string, caps: RestrictionCap[]): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps,
});
const configWith = (...restrictions: PersonRestriction[]): SolverConfig => ({
  sundayLeads: [], saturdayLeads: [], support: [], restrictions, conflicts: [], presence: [],
});

function renderGen(config: SolverConfig, rules: RulesHarness = readyRules(config)) {
  render(
    <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} rules={rules} />,
    { wrapper: AdminProviders },
  );
  return rules;
}
const cards = () => screen.getAllByTitle("Editar").map((b) => b.closest("div.rounded-lg") as HTMLElement);
const openEditor = (index: number) => fireEvent.click(within(cards()[index]).getByTitle("Editar"));
const saveBar = () => screen.getByRole("button", { name: /Guardar reglas|Guardando|Guardado/ });
const operators = () => screen.getAllByLabelText("Operador") as HTMLSelectElement[];
const patterns = () => screen.getAllByLabelText("Patrón") as HTMLSelectElement[];

describe("the form does not produce a second exact count (C3 T14)", () => {
  it("flags a cap row that repeats an exact count on the same card, and blocks «Agregar»", () => {
    renderGen(configWith());
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    fireEvent.change(operators()[0], { target: { value: "==" } });
    fireEvent.change(patterns()[0], { target: { value: "Sun.Lead" } });
    const add = screen.getByRole("button", { name: "Agregar restricción" }) as HTMLButtonElement;
    expect(add.disabled).toBe(false); // `Sun.Lead == 2` beside `Sun.* <= 2`: fine

    fireEvent.change(operators()[1], { target: { value: "==" } }); // `Sun.* == 2` now fixes Sun.Lead too
    expect(screen.getByText(exactOverlapFormMessage({ role: "Sun.Lead", person: "Ana", rule: "Sun.Lead == 2" }))).toBeTruthy();
    expect(add.disabled).toBe(true);

    fireEvent.change(operators()[1], { target: { value: ">=" } });
    expect(screen.queryByText(/Ya hay un número fijo/)).toBeNull();
    expect(add.disabled).toBe(false);
  });

  it("looks across cards with the same person text", () => {
    renderGen(configWith(rule("r-1", "ana", [cap("c-1", "*.Lead", "==")])));
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    fireEvent.change(operators()[0], { target: { value: "==" } }); // `Sun.* == 2` vs the other card's `*.Lead == 1`
    expect(screen.getByText(exactOverlapFormMessage({ role: "Sun.Lead", person: "Ana", rule: "*.Lead == 1" }))).toBeTruthy();
    expect((screen.getByRole("button", { name: "Agregar restricción" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not look at another person's card", () => {
    renderGen(configWith(rule("r-1", "Bruno", [cap("c-1", "*.Lead", "==")])));
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    fireEvent.change(operators()[0], { target: { value: "==" } });
    expect(screen.queryByText(/Ya hay un número fijo/)).toBeNull();
  });
});

describe("a pair stored before C3 is not a dead end (C3 T14)", () => {
  const STORED_PAIR = configWith(
    rule("r-1", "Ana", [cap("c-1", "Sun.*", "==", 2)]),
    rule("r-2", "Bruno", [cap("c-2", "Sun.Lead", "==", 1)]),
    // A second clause, so the card is still a rule once its cap is removed.
    { ...rule("r-3", "Ana", [cap("c-3", "*.Lead", "==", 1)]), excludedPatterns: ["Sat.BGV"] },
  );

  it("marks both cards of the pair, and only those", () => {
    renderGen(STORED_PAIR);
    const message = exactOverlapCardMessage("Sun.Lead");
    expect(within(cards()[0]).getByText(message)).toBeTruthy();
    expect(within(cards()[1]).queryByText(message)).toBeNull();
    expect(within(cards()[2]).getByText(message)).toBeTruthy();
  });

  it("removing either cap clears the marks and lets the save through", async () => {
    const rules = renderGen(STORED_PAIR);
    openEditor(2);
    // The open form flags its own cap row too, and cannot be saved while it does.
    expect(screen.getByText(exactOverlapFormMessage({ role: "Sun.Lead", person: "Ana", rule: "Sun.* == 2" }))).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement).disabled).toBe(true);
    const form = screen.getByRole("button", { name: "Guardar cambios" }).closest("div.rounded-lg") as HTMLElement;
    const capRow = (within(form).getByLabelText("Operador") as HTMLElement).closest("div.flex") as HTMLElement;
    fireEvent.click(within(capRow).getByRole("button", { name: "×" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(screen.queryByText(exactOverlapCardMessage("Sun.Lead"))).toBeNull();

    fireEvent.click(saveBar());
    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(1));
    expect(exactCapOverlaps(rules.save.mock.calls[0][0] as SolverConfig)).toEqual([]);
  });
});
