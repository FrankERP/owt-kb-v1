/** @vitest-environment jsdom */
// Solver v3 C3 §6.6 and §6.8 — «Domingo: Normal / Mes por medio» in the rule
// form, its chip on the card, and the «Holgura» notes (T11).
//
// Two kinds of test live here and the difference is load-bearing (C3 §11):
//
//   · CONTROL tests select something in the «Domingo» control. They go away
//     with the UI-only rollback, which removes the control.
//   · EDIT-PATH tests never touch the control: they open a stored restriction,
//     save the form, and assert the restriction came back unchanged. They are
//     what keeps the field alive after that rollback — the form builds its
//     result from its own state (`PersonRestrictionForm`'s `onAdd`), so a form
//     that stopped carrying `sundayCadence` would write the restriction without
//     it on the first edit, and the version guard would not stop it. They must
//     pass UNMODIFIED on the rollback; editing them is a full revert.
//
// Every edit-path test proves the round trip twice: the save bar settles on
// «Guardado» (content-equal, `sameSolverConfig`), and the payload «Guardar
// reglas» posts — after an unrelated pool tick makes it dirty — carries the
// restriction deep-equal to the one opened.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules, type RulesHarness } from "./rulesHarness";
import { AdminProviders } from "./providersHarness";
import { CADENCE_V2_NOTE, SLACK_V3_NOTE } from "@/app/utils/sundayCadence";
import type { PersonRestriction, SolverConfig } from "../plannerModel";

afterEach(cleanup);

const members = [
  { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "support"] },
];

const EVERY_FIELD: PersonRestriction = {
  id: "r-ana", person: "Ana",
  excludedPatterns: ["Sat.*"],
  fairness: "slack", fairnessSlack: 2,
  weekExclusions: [{ id: "w-1", week: 3, pattern: "*.*" }],
  caps: [{ id: "c-1", pattern: "Sun.BGV", op: "<=", value: 0, relative: true, relOffset: 2 }],
  sundayCadence: "alternate",
};
const CADENCE_ONLY: PersonRestriction = {
  id: "r-ana", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1,
  weekExclusions: [], caps: [], sundayCadence: "alternate",
};
const NORMAL: PersonRestriction = {
  id: "r-bruno", person: "Bruno", excludedPatterns: ["Sun.Lead"], fairness: "none", fairnessSlack: 1,
  weekExclusions: [], caps: [],
};
const configWith = (...restrictions: PersonRestriction[]): SolverConfig => ({
  sundayLeads: [], saturdayLeads: [], support: [], restrictions, conflicts: [], presence: [],
});

function renderGen(config: SolverConfig, rules: RulesHarness = readyRules(config)) {
  const view = render(
    <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} rules={rules} />,
    { wrapper: AdminProviders },
  );
  return { ...view, rules };
}

const card = (text: RegExp) => {
  const el = screen.getAllByTitle("Editar")
    .map((b) => b.closest("div.rounded-lg") as HTMLElement)
    .find((e) => text.test(e.textContent ?? ""));
  if (!el) throw new Error(`no rule card matching ${text}`);
  return el;
};
const openEditor = (text: RegExp) => fireEvent.click(within(card(text)).getByTitle("Editar"));
const saveBar = () => screen.getByRole("button", { name: /Guardar reglas|Guardando|Guardado/ });
const domingo = () => screen.getByRole("radiogroup", { name: "Domingo" });

/** Make the document dirty WITHOUT touching any rule, then post it. */
async function postAfterPoolTick(rules: RulesHarness): Promise<SolverConfig> {
  fireEvent.click(screen.getByRole("checkbox", { name: "Ana" }));
  fireEvent.click(saveBar());
  await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(1));
  return rules.save.mock.calls[0][0] as SolverConfig;
}

describe("edit path — survives the UI-only rollback unmodified (C3 §11, T11)", () => {
  it("a restriction carrying every field the type has comes back deep-equal", async () => {
    const { rules } = renderGen(configWith(EVERY_FIELD));
    openEditor(/Ana/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(saveBar().textContent).toMatch(/Guardado/);
    const saved = await postAfterPoolTick(rules);
    expect(saved.restrictions).toEqual([EVERY_FIELD]);
  });

  it("a cadence-only restriction can be saved from its editor, and keeps the field", async () => {
    const { rules } = renderGen(configWith(CADENCE_ONLY));
    openEditor(/Ana/);
    const save = screen.getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(saveBar().textContent).toMatch(/Guardado/);
    const saved = await postAfterPoolTick(rules);
    expect(saved.restrictions).toEqual([CADENCE_ONLY]);
  });

  it("«Normal» leaves no key", async () => {
    const { rules } = renderGen(configWith(NORMAL));
    openEditor(/Bruno/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const saved = await postAfterPoolTick(rules);
    expect(saved.restrictions[0]).not.toHaveProperty("sundayCadence");
    expect(saved.restrictions).toEqual([NORMAL]);
  });
});

describe("the «Domingo» control (C3 §6.6, T11 — removed with the control on the UI-only rollback)", () => {
  it("offers Normal / Mes por medio, «Normal» for a new restriction", () => {
    renderGen(configWith());
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    const group = domingo();
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Normal", "Mes por medio"]);
    expect(within(group).getByRole("radio", { name: "Normal" }).getAttribute("aria-checked")).toBe("true");
  });

  it("«Mes por medio» alone makes a new restriction addable, explains itself, and saves the field", async () => {
    const { rules, container } = renderGen(configWith());
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    const add = () => screen.getByRole("button", { name: "Agregar restricción" }) as HTMLButtonElement;
    expect(add().disabled).toBe(true);

    fireEvent.click(within(domingo()).getByRole("radio", { name: "Mes por medio" }));
    expect(add().disabled).toBe(false);
    expect(
      screen.getByText(
        "Solo cambia cuántas veces dirige domingo; en BGV y Coro participa igual que todos. Dirige domingo un mes sí y uno no: le toca el mes siguiente a uno en que no dirigió domingo, si puede al menos un domingo. En el mes que no le toca, de preferencia dirige un sábado. Solo aplica si está en Líderes Domingo. Aplica con el nuevo solver; el solver actual no lo usa.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Aplica con el nuevo solver; el solver actual no lo usa\./)).toBeTruthy();

    fireEvent.click(add());
    expect(container.textContent).toContain("Mes por medio");
    fireEvent.click(saveBar());
    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(1));
    const saved = rules.save.mock.calls[0][0] as SolverConfig;
    expect(saved.restrictions).toHaveLength(1);
    expect(saved.restrictions[0]).toMatchObject({
      person: "Ana", sundayCadence: "alternate", excludedPatterns: [], weekExclusions: [], caps: [], fairness: "none",
    });
  });

  it("is initialised from the edited restriction", () => {
    renderGen(configWith(CADENCE_ONLY));
    openEditor(/Ana/);
    expect(within(domingo()).getByRole("radio", { name: "Mes por medio" }).getAttribute("aria-checked")).toBe("true");
  });

  it("toggling on and back off settles to «Guardado»", () => {
    renderGen(configWith(NORMAL));
    openEditor(/Bruno/);
    fireEvent.click(within(domingo()).getByRole("radio", { name: "Mes por medio" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(saveBar().textContent).toMatch(/Guardar reglas/);

    openEditor(/Bruno/);
    fireEvent.click(within(domingo()).getByRole("radio", { name: "Normal" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(saveBar().textContent).toMatch(/Guardado/);
  });
});

describe("the card and the «Holgura» notes (C3 §6.6, §6.8, T11)", () => {
  it("shows «Mes por medio» followed by its note", () => {
    renderGen(configWith(CADENCE_ONLY));
    const chip = within(card(/Ana/)).getByText("Mes por medio");
    expect(chip.nextElementSibling?.textContent).toBe(CADENCE_V2_NOTE);
  });

  it("shows no cadence chip on a «Normal» card", () => {
    renderGen(configWith(NORMAL));
    expect(within(card(/Bruno/)).queryByText("Mes por medio")).toBeNull();
  });

  it("the Holgura chip says it does not apply to the new solver", () => {
    renderGen(configWith(EVERY_FIELD));
    expect(within(card(/Ana/)).getByText(`holgura 2 · ${SLACK_V3_NOTE}`)).toBeTruthy();
  });

  it("the Holgura help gains «No aplica con el nuevo solver.» and keeps its specials sentence", () => {
    renderGen(configWith(EVERY_FIELD));
    openEditor(/Ana/);
    const help = screen.getByText(/puede alejarse hasta 2 servicios de la del resto/);
    expect(help.textContent).toContain("No aplica con el nuevo solver.");
    expect(help.textContent).toContain("Al llenar especiales cuenta como si llevara 2 más.");
  });
});
