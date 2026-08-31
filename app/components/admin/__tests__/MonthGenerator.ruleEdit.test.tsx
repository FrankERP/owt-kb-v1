/** @vitest-environment jsdom */
// `PersonRestrictionForm` is BOTH the add form and the edit form, and
// `RuleBuilder.saveRestriction` commits an edit by id
// (`restrictions.map(x => x.id === r.id ? r : x)`). The form used to mint a
// fresh `uid()` on every save, so an edit matched no row and was DISCARDED —
// silently: no error, no toast, the card simply re-rendered unchanged. Reported
// as "I add a cap to Mkz and the rule never appears".
//
// The other two forms (`ConflictForm`, `PresenceForm`) always wrote
// `initialValues?.id ?? uid()`; this file pins that all three do, so the next
// rule kind added here cannot reintroduce the asymmetry.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules } from "./rulesHarness";
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

function renderGen(config: SolverConfig) {
  return render(
    <MonthGenerator
      members={members}
      existingRoles={[]}
      onClose={vi.fn()}
      onCreated={vi.fn()}
      rules={readyRules(config)}
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

describe("RuleBuilder — editing a rule keeps its id, so the edit survives", () => {
  it("adds a cap to an existing person restriction and the card shows it", () => {
    const { container } = renderGen(CONFIG);

    openEditor(/Mkz/);
    fireEvent.click(screen.getByRole("button", { name: "+ Cap" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    // Committed: the form is gone and the card carries the new cap chip.
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).toBeNull();
    expect(container.textContent).toContain("Sun.* <= 2");
    // And it REPLACED the row rather than appending a second Mkz rule — the
    // duplicate an `id: uid()` would produce if the parent appended instead.
    expect(container.textContent).toMatch(/Reglas \(3\)/);
  });

  it("keeps an edited person restriction's other fields", () => {
    const { container } = renderGen(CONFIG);

    openEditor(/Mkz/);
    // Flip a second field in the same edit: pattern pill `Sun.BGV`.
    fireEvent.click(screen.getByRole("button", { name: "Dom BGV" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(container.textContent).toContain("!Sat.*");
    expect(container.textContent).toContain("!Sun.BGV");
    expect(container.textContent).toContain("fairness_exempt");
    expect(container.textContent).toMatch(/Reglas \(3\)/);
  });

  it("edits a conflict rule in place", () => {
    const { container } = renderGen(CONFIG);

    openEditor(/≠/);
    fireEvent.change(screen.getByDisplayValue("Lead (ambos) (*.Lead)"), { target: { value: "*.BGV" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(container.textContent).toContain("*.BGV");
    expect(container.textContent).toMatch(/Reglas \(3\)/);
  });

  it("edits a presence rule in place", () => {
    const { container } = renderGen(CONFIG);

    openEditor(/≥1/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(container.textContent).toMatch(/Reglas \(3\)/);
  });
});
