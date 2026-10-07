/** @vitest-environment jsdom */
// Solver v3 C2 UI-1, UI-2 — the «Equidad · vista previa» disclosure is mounted BESIDE the
// «sin Lead en …» panel at the config step and in the stored editor, closed, and reads
// nothing until opened: no other suite's `fetch` count changes. Every name is fictitious.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../PlannerGrid", () => ({ default: () => <div data-testid="grid" /> }));

import MonthGenerator from "../MonthGenerator";
import { stubFetchWithHistory } from "./derivedHistoryHarness";
import { AdminProviders } from "./providersHarness";
import { readyRules } from "./rulesHarness";
import type { SolverConfig } from "../plannerModel";

const MEMBERS: ComponentProps<typeof MonthGenerator>["members"] = [
  { _id: "m-alma", member_name: "Alma", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno", memberType: ["voz", "sunday_lead"] },
];
const CONFIG: SolverConfig = { sundayLeads: ["m-alma", "m-bruno"], saturdayLeads: [], support: [], restrictions: [], conflicts: [], presence: [] };
const RULES = readyRules(CONFIG);

const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  stubFetchWithHistory((url: string) => {
    calls.push(url);
    return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fairnessCalls = () => calls.filter((u) => u.startsWith("/api/admin/fairness"));

describe("the «Equidad» preview mounts (C2 UI-1, UI-2)", () => {
  it("sits beside «sin Lead en …» at the config step, closed, reading nothing", async () => {
    render(<MonthGenerator members={MEMBERS} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} rules={RULES} />, {
      wrapper: AdminProviders,
    });
    const toggle = await screen.findByRole("button", { name: "Equidad · vista previa" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByText(/sin Lead en/).length).toBeGreaterThan(0);
    expect(fairnessCalls()).toEqual([]);
    fireEvent.click(toggle);
    await waitFor(() => expect(fairnessCalls()).toHaveLength(1));
    expect(fairnessCalls()[0]).toMatch(/^\/api\/admin\/fairness\?month=\d{4}-\d{2}&horizon=1$/);
  });

  it("sits beside the lead history in the stored editor, for the viewed month", async () => {
    render(
      <MonthGenerator
        mode="stored"
        members={MEMBERS}
        existingRoles={[]}
        allRoles={[]}
        initialMonth="2026-11"
        storedSource={{
          roles: [],
          integrity: { targets: [], recordIssues: [], lockIssues: [] },
          rolesStatus: "ready",
          integrityStatus: "ready",
          rolesGeneration: 1,
          integrityGeneration: 1,
          reload: vi.fn(async () => true),
        }}
        rules={RULES}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
      { wrapper: AdminProviders },
    );
    const toggle = await screen.findByRole("button", { name: "Equidad · vista previa" });
    expect(fairnessCalls()).toEqual([]);
    fireEvent.click(toggle);
    await waitFor(() => expect(fairnessCalls()).toEqual(["/api/admin/fairness?month=2026-11&horizon=1"]));
    expect((await screen.findByText("No se pudo leer el saldo de equidad.")).getAttribute("role")).toBe("alert");
  });
});
