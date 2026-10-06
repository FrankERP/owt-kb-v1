/** @vitest-environment jsdom */
// Solver v3 C3 §6.2 — the rule panel and the config version (T6).
//
// A tab whose server speaks another config version cannot save the rules.
// Reached in C3's own release only in tests (a C3 bundle always meets a C3
// server); it is what makes the NEXT bump, or a rollback, humane: the admin is
// told to reload instead of having a save refused after the fact. And when the
// route does refuse a save for its version, the message says so and offers no
// «Recargar reglas» — a re-read through this bundle cannot fix it.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules, type RulesHarness } from "./rulesHarness";
import { AdminProviders } from "./providersHarness";
import { PLANNER_UPDATED_MESSAGE, SAVE_OUTDATED_TAB_MESSAGE } from "../solverConfigSource";

afterEach(cleanup);

const members = [{ _id: "m-ana", member_name: "Ana", memberType: ["voz", "sunday_lead"] }];
const saveButton = () => screen.getByRole("button", { name: /Guardar reglas|Guardando|Guardado/ });

function renderWith(rules: RulesHarness) {
  render(
    <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} rules={rules} />,
    { wrapper: AdminProviders },
  );
  return rules;
}

describe("«Guardar reglas» and the config version (C3 T6)", () => {
  it("is disabled, says why, and posts nothing when the server speaks another version", () => {
    const rules = renderWith(readyRules(undefined, { configVersion: 1 }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ana" }));
    const button = saveButton() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(PLANNER_UPDATED_MESSAGE);
    expect(screen.getByText(PLANNER_UPDATED_MESSAGE)).toBeTruthy();
    fireEvent.click(button);
    expect(rules.save).not.toHaveBeenCalled();
  });

  it("works as before when the versions match", () => {
    renderWith(readyRules());
    fireEvent.click(screen.getByRole("checkbox", { name: "Ana" }));
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(PLANNER_UPDATED_MESSAGE)).toBeNull();
  });

  it("shows the route's version refusal and offers NO «Recargar reglas»", async () => {
    renderWith(readyRules(undefined, {
      save: async () => ({ ok: false, message: SAVE_OUTDATED_TAB_MESSAGE, stale: false }),
    }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ana" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText(SAVE_OUTDATED_TAB_MESSAGE).getAttribute("role")).toBe("alert"));
    expect(screen.queryByRole("button", { name: "Recargar reglas" })).toBeNull();
  });
});
