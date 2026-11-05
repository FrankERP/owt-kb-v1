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
import { AdminProviders } from "./providersHarness";
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
    { wrapper: AdminProviders },
  );
}

/**
 * The pencil that swaps a card for its edit form. A card is known by its SENTENCE (the Admin
 * pass dropped the «≠»/«≥1» kind badges — a rule row is the sentence, the pencil and the «×»).
 */
function openEditor(cardText: RegExp) {
  const card = screen.getAllByTitle("Editar")
    .map(b => b.closest("[data-rule-card]") as HTMLElement)
    .find(el => cardText.test(el.textContent ?? ""));
  if (!card) throw new Error(`no rule card matching ${cardText}`);
  fireEvent.click(within(card).getByTitle("Editar"));
}

const saveForm = () => fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

describe("RuleBuilder — editing a rule keeps its id, so the edit survives", () => {
  it("adds a cap to an existing person restriction and the card shows it", () => {
    const { container } = renderGen(CONFIG);

    openEditor(/Mkz/);
    fireEvent.click(screen.getByRole("button", { name: "+ Tope" }));
    saveForm();

    // The form closed AND the card carries the new cap chip (as a sentence, bloque 2).
    // Only the second half is load-bearing — the form closes under the bug too.
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).toBeNull();
    expect(container.textContent).toContain("Domingos: como máximo 2 al mes");
  });

  it("keeps an edited person restriction's other fields", () => {
    const { container } = renderGen(CONFIG);

    openEditor(/Mkz/);
    fireEvent.click(screen.getByRole("button", { name: "BGV dom" }));
    saveForm();

    expect(container.textContent).toContain("Nunca en sábado");
    expect(container.textContent).toContain("No BGV en domingo");
    expect(container.textContent).toContain("Fuera del balance total");
  });

  it("names the fairness modes in Spanish and says what «Exenta» does — «Holgura» is not offered to a card without one", () => {
    renderGen(CONFIG);

    openEditor(/Mkz/);
    expect(screen.getByText("Equidad")).toBeTruthy();
    expect(screen.getByText("Exenta")).toBeTruthy();
    // Bloque 2: the v3 solver never reads a slack, so a NEW one cannot be made here.
    expect(screen.queryByText("Holgura")).toBeNull();
    // Mkz is exempt in CONFIG, so the explanation is already on screen — and it
    // must say he still counts for each role's fairness, which is what the
    // solver does with a bare `fairness_exempt`.
    expect(screen.getByText(/sigue contando para la equidad de cada rol/i)).toBeTruthy();
  });

  it("«Holgura» (on a card that already has one) states its allowance, and a cleared allowance says it does nothing", () => {
    renderGen({ ...CONFIG, restrictions: CONFIG.restrictions.map(r => r.person === "Mkz" ? { ...r, fairness: "slack" as const, fairnessSlack: 1 } : r) });

    openEditor(/Mkz/);
    fireEvent.click(screen.getByText("Holgura"));
    const row = screen.getByText("Holgura").closest("div") as HTMLElement;
    const allowance = row.querySelector('input[type="number"]') as HTMLInputElement;

    fireEvent.change(allowance, { target: { value: "2" } });
    expect(screen.getByText(/como si llevara 2 más/)).toBeTruthy();

    // `restrictionToDs` emits nothing for a slack of 0, so the sentence must not
    // promise anything for 0 — the person is simply «Normal» once saved.
    fireEvent.change(allowance, { target: { value: "" } });
    expect(screen.getByText(/con 0 no tiene efecto/i)).toBeTruthy();
    expect(screen.queryByText(/como si llevara 0/)).toBeNull();

    // Whole services only — the solver's DSL reads `fairness_slack \d+`.
    fireEvent.change(allowance, { target: { value: "2.5" } });
    expect(screen.getByText(/como si llevara 2 más/)).toBeTruthy();
    fireEvent.change(allowance, { target: { value: "0.5" } });
    expect(allowance.value).toBe("0");
    expect(screen.getByText(/con 0 no tiene efecto/i)).toBeTruthy();
  });

  it("edits a conflict rule in place", () => {
    const { container } = renderGen(CONFIG);

    openEditor(/no coinciden/);
    fireEvent.change(screen.getByDisplayValue("Líder (ambos) (*.Lead)"), { target: { value: "*.BGV" } });
    saveForm();

    // «no coinciden como BGV» appears ONLY on the conflict card — the presence
    // rule reads «BGV de domingo», the restriction «Nunca en sábado» — so this
    // cannot pass on the wrong card.
    expect(container.textContent).toContain("no coinciden como BGV");
  });

  it("edits a presence rule in place", () => {
    const { container } = renderGen(CONFIG);

    // Must CHANGE something. What `canAdd` (>= 2 selected) forbids is REMOVING
    // a person from a two-person rule — adding one is not the only edit
    // available, the pattern select is ungated and would work equally well.
    openEditor(/cada semana/);
    // Scoped to the form: `Beto` is also a checkbox in the `Soporte` member
    // pool higher up the panel, and a bare `getByRole` matches both.
    const form = screen.getByText("Al menos uno de (mín. 2)").closest("div.rounded-lg") as HTMLElement;
    fireEvent.click(within(form).getByRole("checkbox", { name: "Beto" }));
    saveForm();

    expect(container.textContent).toContain("Mkz, Ana o Beto");
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
    fireEvent.click(screen.getByRole("button", { name: "Líder sáb" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar restricción" }));
  };

  // `solverConfigWriteRequest` rejects a rule set on BOTH shapes of a bad id —
  // `id:duplicate` AND `id:missing` (`solverConfigWriteRequest.ts:127,131`).
  // Card text can only ever catch the first, so this asserts on the save
  // payload: a fallback of `?? ""` renders identically and would slip through.
  it("appends a fourth rule under its own non-empty id", async () => {
    const rules = readyRules(CONFIG);
    const { container } = renderGen(CONFIG, rules);
    addAnaRule();

    expect(container.textContent).toMatch(/Reglas · 4/);
    expect(container.textContent).toContain("No líder en sábado");

    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }));

    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(1));
    const saved = rules.save.mock.calls[0][0] as SolverConfig;
    expect(saved.restrictions).toHaveLength(2);
    // The person too: a silently no-op'd select change would still render
    // «No líder en sábado», just on a second Mkz row.
    expect(saved.restrictions[1].person).toBe("Ana");
    expect(saved.restrictions[1].id).toBeTruthy();
    expect(saved.restrictions[1].id).not.toBe("r-mkz");
  });

  it("gives the added rule its own id — editing one card does not touch the other", () => {
    const { container } = renderGen(CONFIG);
    addAnaRule();

    // Now edit the ORIGINAL. A shared id would rewrite both rows.
    openEditor(/Mkz/);
    fireEvent.click(screen.getByRole("button", { name: "+ Tope" }));
    saveForm();

    expect(container.textContent).toContain("Domingos: como máximo 2 al mes");
    expect(container.textContent).toContain("No líder en sábado");   // Ana's, untouched
    expect(container.textContent).toMatch(/Reglas · 4/);
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
    fireEvent.click(screen.getByRole("button", { name: "+ Tope" }));
    saveForm();

    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }));

    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(1));
    const saved = rules.save.mock.calls[0][0] as SolverConfig;
    expect(saved.restrictions).toHaveLength(1);
    expect(saved.restrictions[0].id).toBe("r-mkz");
    expect(saved.restrictions[0].caps).toHaveLength(1);
  });
});
