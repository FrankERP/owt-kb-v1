// Solver v3 C6 KH-1, KH-3, RQ-5 — the name-shaped fixture (production's seed SHAPE, fictitious
// names) through the builder: the serialized request, every notice and refusal line, every console
// call and KH-3's table carry no config key or ruleKey; ids are byte-identical across two runs;
// KH-3's ordinals follow the config, and shift when an earlier restriction is deleted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildV3SolveRequest, type V3BuildInput } from "../v3SolveRequest";
import { renderRuleRefTable } from "../v3RuleIds";
import { buildColumns, buildRows } from "../plannerModel";
import { ALL_IN, MEMBERS, NAME_SHAPED, NAME_SHAPED_KEYS, cap, figures, ledgerPerson, ledgerResponse, record } from "./v3Fixtures";

// Sorts after "d-carla-dani" in codepoint order, so the card's rule mints r1 and this carried-only key r2.
const CARRIED_ONLY = "d-dani-old";
const SECRETS = [...NAME_SHAPED_KEYS, CARRIED_ONLY];
let consoleCalls: string[];
beforeEach(() => {
  consoleCalls = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { consoleCalls.push(a.map(String).join(" ")); });
  }
});
afterEach(() => vi.restoreAllMocks());

const presenceRecord = record("2026-11", [
  { memberId: "m-carla", name: "Carla", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] },
  { memberId: "m-dani", name: "Dani", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] },
  { memberId: "m-ana", name: "Ana", roles: { ...ALL_IN, "Sun.Lead": "exact" }, exactRules: [{ roles: ["Sun.Lead"], count: 1 }], exempt: false, blocks: [] },
], { presence: [{ ruleKey: "d-carla-dani", roles: ["Sun.BGV"], members: ["m-carla", "m-dani"], exclusive: false }] });

const input = (config = NAME_SHAPED): V3BuildInput => ({
  months: ["2026-11"], currentMonth: "2026-10",
  ledger: ledgerResponse(["2026-11"], {
    horizon: [{ record: presenceRecord, storedServices: 1, recordBinds: true }],
    people: [ledgerPerson("m-carla", "Carla", { window: { "P:d-carla-dani": figures(40), [`P:${CARRIED_ONLY}`]: figures(-10) } })],
  }),
  config, members: MEMBERS, storedRoles: [],
  planned: { columns: buildColumns({ sundayDates: ["2026-11-01", "2026-11-08"], activeSatDates: [] }), cells: [], rows: buildRows() },
  savedWindow: [], fillEmpty: false, seed: 9, requestId: "req-kh",
});

describe("key hygiene over a name-shaped config", () => {
  it("no config key or ruleKey in the request, the notices, the console or KH-3's table", () => {
    const out = buildV3SolveRequest(input());
    if (!out.ok) throw new Error(out.lines.join("\n"));
    const surfaces = [JSON.stringify(out.request), ...out.notices, ...consoleCalls, renderRuleRefTable(out.snapshot.requestId, out.snapshot.ruleTable)];
    for (const text of surfaces) for (const key of SECRETS) expect(text).not.toContain(key);
    expect(out.request.people.find((p) => p.id === "m-carla")!.carried).toEqual({ "P:r1": 40, "P:r2": -10 });
  });

  it("a refusal line names rules by their card label, never their key", () => {
    const broken = { ...NAME_SHAPED, restrictions: [{ ...NAME_SHAPED.restrictions[0], caps: [cap("d-ana-sun-lead", "Sun.Lead", "<=", 1.5)] }, NAME_SHAPED.restrictions[1]] };
    const out = buildV3SolveRequest(input(broken));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      for (const line of out.lines) for (const key of SECRETS) expect(line).not.toContain(key);
      expect(out.lines[0]).toContain("«Ana · Sun.Lead <= 1.5»");
    }
  });

  it("the same config gives a byte-identical request and table on two runs", () => {
    const a = buildV3SolveRequest(input());
    const b = buildV3SolveRequest(input());
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(JSON.stringify(a.request)).toBe(JSON.stringify(b.request));
    expect(a.snapshot.ruleTable).toEqual(b.snapshot.ruleTable);
  });

  it("KH-3: one entry per sent id and per rewritten P: key, each with its config ordinal", () => {
    const out = buildV3SolveRequest(input());
    if (!out.ok) throw new Error("expected ok");
    const byOrdinal = new Map(out.snapshot.ruleTable.map((e) => [e.ordinal, e]));
    expect(byOrdinal.get("restrictions[1].caps[2]")?.kind).toBe("count");
    expect(byOrdinal.get("conflicts[0]")?.kind).toBe("pair");
    expect(out.snapshot.ruleTable.filter((e) => e.ordinal === "presence[0]").map((e) => e.wire).sort()).toEqual(["P:r1", "r1"]);
    expect(out.snapshot.ruleTable.some((e) => e.wire === "P:r2" && e.ordinal.startsWith("sin tarjeta"))).toBe(true);
    expect(out.snapshot.ruleTable.some((e) => e.ordinal === "sin tarjeta, 2026-11 m-ana Sun.Lead")).toBe(true);
    const sent = new Set(out.request.rules.map((r) => r.id));
    for (const id of sent) expect(out.snapshot.ruleTable.some((e) => e.wire === id)).toBe(true);
  });

  it("deleting an earlier restriction shifts the next run's ordinals", () => {
    const shifted = { ...NAME_SHAPED, restrictions: [NAME_SHAPED.restrictions[1]] };
    const out = buildV3SolveRequest(input(shifted));
    if (!out.ok) throw new Error("expected ok");
    expect(out.snapshot.ruleTable.some((e) => e.ordinal === "restrictions[0].caps[2]")).toBe(true);
    expect(out.snapshot.ruleTable.some((e) => e.ordinal === "restrictions[1].caps[2]")).toBe(false);
  });
});
