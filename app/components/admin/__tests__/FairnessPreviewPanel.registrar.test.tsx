/** @vitest-environment jsdom */
// Solver v3 C2 UI-6, WR-15 — «Registrar elegibilidad de {mes}»: offered under engine v3
// only, for the current month up to 12 months ahead, replaced by a line when the record
// binds; its CueDialog says what is replaced, what is frozen and where the write lands;
// it sends the resolver's body with `source: "manual"` and the revision the panel READ;
// on a 409 it re-reads the GET before any retry; the dialog stays open on every refusal.
// The fetch mock routes by URL and method and only CAPTURES. Every name is fictitious.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FairnessLedgerResponse, LogicalRecord } from "@/app/utils/fairnessVocabulary";
import FairnessPreviewPanel, { type FairnessPreviewPanelProps } from "../FairnessPreviewPanel";
import type { SolverConfig } from "../plannerModel";
import { AdminProviders } from "./providersHarness";

const RECORD: LogicalRecord = {
  month: "2026-11",
  rev: "rev-9",
  contentHash: "sha256:x",
  source: "auto",
  engine: "v3",
  environment: "production",
  recordedAt: "2026-10-03T15:00:00.000Z",
  people: [],
  presence: [],
};

function ledger(patch: Partial<FairnessLedgerResponse> = {}, horizon: Partial<FairnessLedgerResponse["horizon"][number]> = {}): FairnessLedgerResponse {
  return {
    v: 1,
    engine: "v3",
    environment: "production",
    currentMonth: "2026-10",
    target: "2026-11",
    window: [
      { month: "2026-08", record: null },
      { month: "2026-09", record: null },
      { month: "2026-10", record: null },
    ],
    recordsSince: null,
    horizon: [{ month: "2026-11", record: RECORD, storedServices: 0, recordBinds: false, ...horizon }],
    people: [],
    diagnostics: { duplicateTargets: [], notInRecordSeats: 0, unknownMembers: [] },
    ...patch,
  };
}

const CONFIG: SolverConfig = { sundayLeads: ["m-alma", "m-kids"], saturdayLeads: [], support: [], restrictions: [], conflicts: [], presence: [] };
const MEMBERS = [
  { _id: "m-alma", member_name: "Alma", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno", memberType: ["voz", "support"] },
  // A super-admin's roster also holds kids-only members (RES-5).
  { _id: "m-kids", member_name: "Kim", memberType: ["voz", "sunday_lead"], ministries: ["kids"] },
];

type Answer = { ok: boolean; status: number; json: () => Promise<unknown> };
const json = (status: number, body: unknown): Answer => ({ ok: status < 300, status, json: async () => body });
const gets: string[] = [];
const puts: Array<{ months: Array<Record<string, unknown>> }> = [];
let getAnswers: Answer[];
let putAnswer: () => Promise<Answer>;

beforeEach(() => {
  gets.length = 0;
  puts.length = 0;
  getAnswers = [json(200, ledger())];
  putAnswer = async () => json(200, { months: [] });
  vi.stubGlobal("fetch", (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      puts.push(JSON.parse(init.body ?? "{}"));
      return putAnswer();
    }
    gets.push(url);
    return Promise.resolve(getAnswers.length > 1 ? getAnswers.shift()! : getAnswers[0]);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openPanel(patch: Partial<FairnessPreviewPanelProps> = {}) {
  render(<FairnessPreviewPanel month="2026-11" config={CONFIG} members={MEMBERS} storedServices={[]} rulesDirty={false} {...patch} />, {
    wrapper: AdminProviders,
  });
  fireEvent.click(screen.getByRole("button", { name: "Equidad · vista previa" }));
  await screen.findByText("Vista previa: Auto todavía no usa este saldo");
}
const registrar = () => screen.queryByRole("button", { name: "Registrar elegibilidad de noviembre" });
const confirmButton = () => screen.getByRole("button", { name: "Registrar" });

describe("when «Registrar» is offered (UI-6)", () => {
  it("is offered under v3 for the current month up to 12 months ahead", async () => {
    await openPanel();
    expect(registrar()).toBeTruthy();
  });

  it.each([
    ["under v2", ledger({ engine: "v2" })],
    ["for a past month", ledger({ currentMonth: "2026-12" })],
    ["more than 12 months ahead", ledger({ currentMonth: "2025-10" })],
  ])("is not offered %s", async (_label, answer) => {
    getAnswers = [json(200, answer)];
    await openPanel();
    expect(registrar()).toBeNull();
  });

  it("is replaced by the month_has_services line when the record binds", async () => {
    getAnswers = [json(200, ledger({}, { storedServices: 4, recordBinds: true }))];
    await openPanel();
    expect(registrar()).toBeNull();
    expect(screen.getByText("Noviembre ya tiene servicios guardados: su registro ya no se puede reemplazar.")).toBeTruthy();
  });
});

describe("the dialog (UI-6, §8)", () => {
  it("names the replacement, unsaved rules and a write from dev", async () => {
    getAnswers = [json(200, ledger({ environment: "preview" }))];
    await openPanel({ rulesDirty: true });
    fireEvent.click(registrar()!);
    expect(await screen.findByText(/Se guarda quién está en cada lista de noviembre/)).toBeTruthy();
    expect(screen.getByText("Las reglas tienen cambios sin guardar; se registran tal como están en pantalla.")).toBeTruthy();
    expect(screen.getByText("Reemplaza el registro guardado el 3 oct.")).toBeTruthy();
    expect(screen.getByText(/Estás en dev: este registro se guarda en los datos reales del equipo/)).toBeTruthy();
  });

  it("warns that an unrecorded month with services gets its frozen record", async () => {
    getAnswers = [json(200, ledger({}, { record: null, storedServices: 3 }))];
    await openPanel();
    fireEvent.click(registrar()!);
    expect(await screen.findByText(/Noviembre ya tiene servicios guardados: este será su registro/)).toBeTruthy();
    expect(screen.queryByText(/Estás en/)).toBeNull();
  });

  it("refuses before any write when the resolver refuses, naming the person", async () => {
    await openPanel({ config: { ...CONFIG, restrictions: [{ id: "r1", person: "Nadie", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [] }] } });
    fireEvent.click(registrar()!);
    expect(await screen.findByText(/nombres que no corresponden a una sola persona: Nadie/)).toBeTruthy();
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
    expect(puts).toEqual([]);
  });
});

describe("the write (UI-6, WR-15)", () => {
  it("sends the resolver's body, source manual, asserting the revision it read — without kids-only members", async () => {
    getAnswers = [json(200, ledger()), json(200, ledger({}, { record: { ...RECORD, rev: "rev-10" } }))];
    await openPanel();
    fireEvent.click(registrar()!);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(puts).toHaveLength(1));
    const [entry] = puts[0].months;
    expect(entry).toMatchObject({ month: "2026-11", source: "manual", expectedRev: "rev-9" });
    expect((entry.people as Array<{ memberId: string }>).map((p) => p.memberId)).toEqual(["m-alma", "m-bruno"]);
    expect(await screen.findByText("Registrado ✓")).toBeTruthy();
    expect(gets).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sends expectedRev null for an unrecorded month", async () => {
    getAnswers = [json(200, ledger({}, { record: null }))];
    await openPanel();
    fireEvent.click(registrar()!);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].months[0].expectedRev).toBeNull();
  });

  it("keeps the dialog open on a 409, re-reads the GET, and retries on the revision it re-read", async () => {
    getAnswers = [json(200, ledger()), json(200, ledger({}, { record: { ...RECORD, rev: "rev-11" } }))];
    putAnswer = async () => json(409, { error: "stale_revision", conflict: true, details: { detail: "stale_revision", months: [] } });
    await openPanel();
    fireEvent.click(registrar()!);
    fireEvent.click(confirmButton());
    expect(await screen.findByText("El registro de noviembre cambió mientras tanto. Recarga y vuelve a intentar.")).toBeTruthy();
    await waitFor(() => expect(gets).toHaveLength(2));
    await waitFor(() => expect((confirmButton() as HTMLButtonElement).disabled).toBe(false));
    putAnswer = async () => json(200, { months: [] });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].months[0].expectedRev).toBe("rev-11");
  });

  it("names record_exists, and anything else with the fallback, without re-reading on a 400", async () => {
    putAnswer = async () => json(409, { details: { detail: "record_exists" } });
    await openPanel();
    fireEvent.click(registrar()!);
    fireEvent.click(confirmButton());
    expect(await screen.findByText("Otro administrador registró noviembre mientras tanto. Recarga para ver su registro.")).toBeTruthy();
    putAnswer = async () => json(400, { error: "invalid_request" });
    await waitFor(() => expect((confirmButton() as HTMLButtonElement).disabled).toBe(false));
    const before = gets.length;
    fireEvent.click(confirmButton());
    expect(await screen.findByText("No se pudo registrar. No se guardó nada; vuelve a intentar.")).toBeTruthy();
    expect(gets).toHaveLength(before);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("survives a network error: the fallback copy, the dialog open, the button usable again", async () => {
    putAnswer = async () => {
      throw new TypeError("Failed to fetch");
    };
    await openPanel();
    fireEvent.click(registrar()!);
    fireEvent.click(confirmButton());
    expect(await screen.findByText("No se pudo registrar. No se guardó nada; vuelve a intentar.")).toBeTruthy();
    await waitFor(() => expect((confirmButton() as HTMLButtonElement).disabled).toBe(false));
  });
});
