/** @vitest-environment jsdom */
// `PersonRestrictionForm` is BOTH the add form and the edit form, and
// `RuleBuilder.saveRestriction` commits an edit by id
// (`restrictions.map(x => x.id === r.id ? r : x)`). The form used to mint a
// fresh `uid()` on every save, so an edit matched no row and was DISCARDED —
// silently: no error, no toast, the card simply re-rendered unchanged, and
// `dirty` is content-based so the save bar still read "Guardado". Reported as
// "I add a cap to Mkz and the rule never appears".
//
// EVERY edit test here must CHANGE something and then assert the change is on
// the card. A test that opens an editor and saves an untouched form proves
// nothing: `setEditingId(null)` runs whether or not the id matched, so the form
// closes either way and the rule count is 3 under both the bug and the fix. The
// first draft of this file made exactly that mistake on the presence rule while
// its header claimed all three kinds were pinned — a review caught it by
// reverting `ConflictForm` AND `PresenceForm` to `id: uid()` and watching only
// one test fail. The mutation check is this file's acceptance criterion:
// reverting ANY ONE of the three forms must fail at least one test here.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules, type RulesHarness } from "./rulesHarness";
import type { SolverConfig } from "../plannerModel";

afterEach(cleanup);

const members = [
  { _id: "m-mkz",  member_name: "Mkz",  memberType: ["voz", "sunday_lead"] },
  { _id: "m-ana",  member_name: "Ana",  memberType: ["voz", "sunday_lead"] },
  { _id: "m-beto", member_name: "Beto", memberType: ["voz", "support"] },
];

/** One rule of each kind, so an edit to any of them has a row to land on. */
const CONFIG: SolverConfig = {
  sundayLeads: [], saturdayLeads: [], support: [],
  restrictions: [
    {
      id: "r-mkz", person: "Mkz",
      excludedPatterns: ["Sat.*"],
      fairness: "exempt", fairnessSlack: 1,
      weekExclusions: [], caps: [],
    },
  ],
  conflicts: [{ id: "c-1", personA: "Mkz", personB: "Ana", pattern: "*.Lead" }],
  presence:  [{ id: "p-1", persons: ["Mkz", "Ana"], pattern: "Sun.BGV" }],
};

function renderGen(config: SolverConfig, rules: RulesHarness = readyRules(config)) {
  return render(
    <MonthGenerator
      members={members}
      existingRoles={[]}
      onClose={vi.fn()}
      onCreated={vi.fn()}
      rules={rules}
    />,
  );
}

/** The pencil that swaps a card for its edit form. */
function openEditor(cardText: RegExp) {
  const card = screen.getAllByTitle("Editar")
    .map(b => b.closest("div.rounded-lg") as HTMLElement)
    .find(el => cardText.test(el.textContent ?? ""));
  if (!card) throw new Error(`no rule card matching ${cardText}`);
  fireEvent.click(within(card).getByTitle("Editar"));
}

const saveForm = () => fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

describe("RuleBuilder — editing a rule keeps its id, so the edit survives", () => {
  it("adds a cap to an existing person restriction and the card shows it", () => {
    const { container } = renderGen(CONFIG);

    openEditor(/Mkz/);
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    saveForm();

    // The form closed AND the card carries the new cap chip. Only the second
    // half is load-bearing — the form closes under the bug too.
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).toBeNull();
    expect(container.textContent).toContain("Sun.* <= 2");
  });

  it("keeps an edited person restriction's other fields", () => {
    const { container } = renderGen(CONFIG);

    openEditor(/Mkz/);
    fireEvent.click(screen.getByRole("button", { name: "Dom BGV" }));
    saveForm();

    expect(container.textContent).toContain("!Sat.*");
    expect(container.textContent).toContain("!Sun.BGV");
    expect(container.textContent).toContain("fairness_exempt");
  });

  it("edits a conflict rule in place", () => {
    const { container } = renderGen(CONFIG);

    openEditor(/≠/);
    fireEvent.change(screen.getByDisplayValue("Lead (ambos) (*.Lead)"), { target: { value: "*.BGV" } });
    saveForm();

    // `*.BGV` appears ONLY on the conflict card — the presence rule is on
    // `Sun.BGV`, the restriction on `Sat.*` — so this cannot pass on the wrong
    // card.
    expect(container.textContent).toContain("*.BGV");
  });

  it("edits a presence rule in place", () => {
    const { container } = renderGen(CONFIG);

    // Must CHANGE something: add a third person. `canAdd` needs >= 2 selected,
    // so adding is the only edit a two-person rule offers.
    openEditor(/≥1/);
    // Scoped to the form: `Beto` is also a checkbox in the `Soporte` member
    // pool higher up the panel, and a bare `getByRole` matches both.
    const form = screen.getByText("Al menos uno de (mín. 2)").closest("div.rounded-lg") as HTMLElement;
    fireEvent.click(within(form).getByRole("checkbox", { name: "Beto" }));
    saveForm();

    expect(container.textContent).toContain("Mkz, Ana, Beto");
  });
});

describe("RuleBuilder — adding a rule mints a NEW id, independent of the rest", () => {
  // The branch the fix INTRODUCED (`initialValues?.id ?? uid()`) had no coverage
  // anywhere in the repo — no test added a rule at all. If the `??` fallback
  // ever broke, two restrictions would share an id, `solverConfigFields` would
  // write both under the same Sanity `_key`, and the whole rule-set save would
  // be rejected: one bad rule blocking "Guardar reglas" for every admin.
  const addAnaRule = () => {
    fireEvent.click(screen.getByRole("button", { name: "+ Persona" }));
    fireEvent.change(screen.getByDisplayValue("Mkz"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Sáb Lead" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar restricción" }));
  };

  it("appends a fourth rule", () => {
    const { container } = renderGen(CONFIG);
    addAnaRule();

    expect(container.textContent).toMatch(/Reglas \(4\)/);
    expect(container.textContent).toContain("!Sat.Lead");
  });

  it("gives the added rule its own id — editing one card does not touch the other", () => {
    const { container } = renderGen(CONFIG);
    addAnaRule();

    // Now edit the ORIGINAL. A shared id would rewrite both rows.
    openEditor(/Mkz/);
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    saveForm();

    expect(container.textContent).toContain("Sun.* <= 2");
    expect(container.textContent).toContain("!Sat.Lead");   // Ana's, untouched
    expect(container.textContent).toMatch(/Reglas \(4\)/);
  });
});

describe("RuleBuilder — the preserved id is what reaches Sanity", () => {
  // Why id stability matters beyond the local `map`: `solverConfigFields` writes
  // `_key: r.id` at every level (`app/utils/solverConfigWriteRequest.ts` — "The
  // `_key` IS the `id`, not a second identifier"). The card-text assertions
  // above pin the symptom; this pins the property that crosses the wire.
  it("saves the edited restriction under its ORIGINAL id", async () => {
    const rules = readyRules(CONFIG);
    renderGen(CONFIG, rules);

    openEditor(/Mkz/);
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    saveForm();

    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }));

    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(1));
    const saved = rules.save.mock.calls[0][0] as SolverConfig;
    expect(saved.restrictions).toHaveLength(1);
    expect(saved.restrictions[0].id).toBe("r-mkz");
    expect(saved.restrictions[0].caps).toHaveLength(1);
  });
});
