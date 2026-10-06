/** @vitest-environment jsdom */
// Solver v3 C2 UI-1 … UI-5, UI-7 — the read-only «Equidad · vista previa» panel: closed by
// default, loads on first open (never before), a skeleton while loading, the fixed error
// with «Reintentar» (never an empty table), the banner, chips and tabs, one decimal through
// the one formatter, the out-group collapsed, and the X1 line for a «Mes por medio» person.
// The fetch mock routes by URL and only CAPTURES — the component catches every throw.
// Every name is fictitious.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FairnessLedgerResponse, FairnessPerson, Figures } from "@/app/utils/fairnessVocabulary";
import FairnessPreviewPanel, { type FairnessPreviewPanelProps } from "../FairnessPreviewPanel";
import type { SolverConfig } from "../plannerModel";
import { AdminProviders } from "./providersHarness";

const fig = (shareTenths: number, seats: number): Figures => ({
  share: shareTenths * 10,
  received: seats * 100,
  balance: shareTenths * 10 - seats * 100,
  seats,
  tenths: { share: shareTenths, balance: shareTenths - seats * 10 },
});

function person(memberId: string, name: string, patch: Partial<FairnessPerson> = {}): FairnessPerson {
  return {
    memberId,
    name,
    exists: true,
    window: {},
    cumulative: {},
    tabs: { window: {}, cumulative: {} },
    sang: 0,
    exempt: false,
    months: ["2026-08", "2026-09", "2026-10"].map((month) => ({ month, recorded: month === "2026-10", listed: true, lines: {}, held: {}, setAsides: [], notes: [] })),
    countedSundayLeads: [],
    firstRecordedIn: {},
    ...patch,
  };
}

function ledger(patch: Partial<FairnessLedgerResponse> = {}): FairnessLedgerResponse {
  return {
    v: 1,
    engine: "v2",
    environment: "production",
    currentMonth: "2026-10",
    target: "2026-11",
    window: [
      { month: "2026-08", record: null },
      { month: "2026-09", record: null },
      { month: "2026-10", record: { rev: "r10", source: "auto", engine: "v3", environment: "production", recordedAt: "2026-10-03T15:00:00Z" } },
    ],
    recordsSince: "2026-10",
    horizon: [{ month: "2026-11", record: null, storedServices: 0, recordBinds: false }],
    people: [
      person("m-alma", "Alma", { tabs: { window: { DL: fig(8, 0), BGV: fig(13, 2) }, cumulative: { DL: fig(8, 0) } } }),
      person("m-bruno", "Bruno", { tabs: { window: { DL: fig(12, 2) }, cumulative: {} } }),
      person("m-diego", "Diego", { countedSundayLeads: ["2026-10-25"] }),
    ],
    diagnostics: { duplicateTargets: [], notInRecordSeats: 0, unknownMembers: [] },
    ...patch,
  };
}

const CONFIG: SolverConfig = {
  sundayLeads: ["m-alma", "m-bruno", "m-diego"],
  saturdayLeads: [],
  support: [],
  restrictions: [{ id: "r1", person: "Diego", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], sundayCadence: "alternate" }],
  conflicts: [],
  presence: [],
};
const MEMBERS = [
  { _id: "m-alma", member_name: "Alma", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno", memberType: ["voz", "sunday_lead"] },
  { _id: "m-diego", member_name: "Diego", memberType: ["voz", "sunday_lead"] },
];

const calls: string[] = [];
let answer: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
beforeEach(() => {
  calls.length = 0;
  answer = async () => ({ ok: true, status: 200, json: async () => ledger() });
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(url);
    return answer();
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPanel = (patch: Partial<FairnessPreviewPanelProps> = {}) =>
  render(
    <FairnessPreviewPanel month="2026-11" config={CONFIG} members={MEMBERS} storedServices={[]} rulesDirty={false} {...patch} />,
    { wrapper: AdminProviders },
  );
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: "Equidad · vista previa" }));

describe("the disclosure (UI-2, UI-3)", () => {
  it("is closed by default and reads nothing until opened", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Equidad · vista previa" }).getAttribute("aria-expanded")).toBe("false");
    expect(calls).toEqual([]);
  });

  it("reads the viewed month once, on first open", async () => {
    renderPanel();
    openPanel();
    expect(await screen.findByText("Vista previa: Auto todavía no usa este saldo")).toBeTruthy();
    expect(calls).toEqual(["/api/admin/fairness?month=2026-11&horizon=1"]);
    openPanel();
    openPanel();
    expect(calls).toHaveLength(1);
  });

  it("shows a skeleton while loading", async () => {
    let release: () => void = () => {};
    answer = () => new Promise((resolve) => (release = () => resolve({ ok: true, status: 200, json: async () => ledger() })));
    renderPanel();
    openPanel();
    expect(screen.getByLabelText("Cargando el saldo de equidad…")).toBeTruthy();
    // UI-3: the banner is always visible while open, not only once the figures arrive.
    expect(screen.getByText("Vista previa: Auto todavía no usa este saldo")).toBeTruthy();
    release();
    await screen.findByText("Vista previa: Auto todavía no usa este saldo");
  });

  it("shows the fixed error with «Reintentar» on a failed read — never an empty table", async () => {
    answer = async () => ({ ok: false, status: 500, json: async () => ({ error: "fairness_unavailable" }) });
    renderPanel();
    openPanel();
    expect((await screen.findByText("No se pudo leer el saldo de equidad.")).getAttribute("role")).toBe("alert");
    expect(screen.getByText("Vista previa: Auto todavía no usa este saldo")).toBeTruthy();
    expect(document.querySelector("[data-fairness-table]")).toBeNull();
    answer = async () => ({ ok: true, status: 200, json: async () => ledger() });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText("Vista previa: Auto todavía no usa este saldo");
    expect(calls).toHaveLength(2);
  });
});

describe("the content (UI-3, UI-4, UI-5)", () => {
  it("shows the window chips and the subheader", async () => {
    renderPanel();
    openPanel();
    expect(await screen.findByText("oct: registrado")).toBeTruthy();
    expect(screen.getByText("ago: sin registro, no cuenta")).toBeTruthy();
    expect(screen.getByText('Saldo de ago–oct 2026 (3 meses). "Le deben" = le tocaba más de lo que tuvo.')).toBeTruthy();
  });

  it("lists the Dom Lead tab most owed first, one decimal, in words", async () => {
    renderPanel();
    openPanel();
    const table = (await screen.findAllByRole("table"))[0];
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["Alma", "Bruno"]);
    expect(within(rows[0]).getAllByRole("cell").map((c) => c.textContent).slice(1, 5)).toEqual(["0.8", "0", "le deben 0.8", "le deben 0.8"]);
    expect(within(rows[1]).getAllByRole("cell")[3].textContent).toBe("0.8 de más");
  });

  it("switches tabs through the segmented control", async () => {
    renderPanel();
    openPanel();
    await screen.findByText("oct: registrado");
    fireEvent.click(screen.getByRole("radio", { name: "BGV" }));
    const table = screen.getAllByRole("table")[0];
    expect(within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["Alma"]);
  });

  it("keeps the out-group collapsed, with Diego's X1 line on the Dom Lead tab", async () => {
    renderPanel();
    openPanel();
    const toggle = await screen.findByRole("button", { name: "Fuera de esta línea (1)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("En nov descansa: dirigió domingo el 25 oct.").length).toBeGreaterThan(0);
  });

  it("says when no month is recorded yet", async () => {
    answer = async () => ({ ok: true, status: 200, json: async () => ledger({ recordsSince: null, window: ledger().window.map((w) => ({ ...w, record: null })) }) });
    renderPanel();
    openPanel();
    expect(await screen.findByText("Todavía no hay meses registrados: el saldo empieza con el primer registro.")).toBeTruthy();
  });

  it("offers no «Registrar» under v2", async () => {
    renderPanel();
    openPanel();
    await screen.findByText("oct: registrado");
    expect(screen.queryByRole("button", { name: /Registrar elegibilidad/ })).toBeNull();
  });
});
