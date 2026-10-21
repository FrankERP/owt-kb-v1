// MCP P4 step 7 — key hygiene and timezone, through both tools.
//
// Key hygiene: the name-shaped fixture of `v3KeyHygiene.test.ts` (production's seed SHAPE,
// fictitious names) as the stored rules, plus a record carrying a presence `ruleKey`: no config
// key, `ruleKey`, member id, rules revision or body reaches any answer (text or structured), any
// console line or any error — on success, on a refusal and on a failed write.
//
// TZ: the same calls under America/Mexico_City and UTC give identical answers, at an instant
// where the two zones disagree on the date.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { ALL_IN, NAME_SHAPED, NAME_SHAPED_KEYS, cap, ledgerResponse, record } from "@/app/components/admin/__tests__/v3Fixtures";
import { sources } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import type { SolverConfig } from "@/app/components/admin/plannerModel";
import { applyScheduleResult } from "../applySchedule";
import { solveMonthResult } from "../solveMonth";
import { HANDLE, PRINCIPAL, applyWorld, solveDeps, storedFrom, textOf } from "./monthToolFixtures";
import { checkProposalEditsResult, reviseProposalResult, saveProposalEditsResult } from "../proposalEditor";
import { editorWorld } from "./editorToolFixtures";

const MEMBER_IDS = ["m-ana", "m-bruno", "m-carla", "m-dani", "m-admin"];
const SECRETS = [...NAME_SHAPED_KEYS, ...MEMBER_IDS, "rules-rev-1"];

const presenceRecord = record("2026-11", [
  { memberId: "m-carla", name: "Carla", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] },
  { memberId: "m-dani", name: "Dani", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] },
], { presence: [{ ruleKey: "d-carla-dani", roles: ["Sun.BGV"], members: ["m-carla", "m-dani"], exclusive: false }] });

let consoleCalls: string[];
beforeEach(() => {
  consoleCalls = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { consoleCalls.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(" ")); });
  }
});
afterEach(() => vi.restoreAllMocks());

function nameShapedDeps(rules: SolverConfig = NAME_SHAPED, over: Parameters<typeof solveDeps>[0] = {}) {
  return solveDeps({
    reads: vi.fn(async () => ({ ok: true as const, value: sources({ rules: { rev: "rules-rev-1", config: rules } }) })),
    readLedger: vi.fn(async (months: readonly string[]) =>
      ledgerResponse([...months], { horizon: [{ record: presenceRecord, storedServices: 0, recordBinds: false }] })),
    ...over,
  });
}

const surfaces = (out: CallToolResult) => [textOf(out), JSON.stringify(out.structuredContent ?? {})];

function expectClean(texts: string[]) {
  for (const text of texts) for (const key of SECRETS) expect(text, `«${key}» leaked`).not.toContain(key);
}

describe("key hygiene over a name-shaped config", () => {
  it("solve and apply, on success: no key, id or revision in any answer or log line", async () => {
    const d = nameShapedDeps();
    const solved = await solveMonthResult({ month: "2026-11" }, PRINCIPAL, d);
    expect(solved.isError).toBeFalsy();
    const proposal = storedFrom(d.stored[0]);
    const w = applyWorld(proposal, { rulesRev: "rules-rev-1", sourcesOver: { rules: { rev: "rules-rev-1", config: NAME_SHAPED } } });
    const applied = await applyScheduleResult({ proposal: HANDLE }, PRINCIPAL, w.deps);
    expect(applied.structuredContent).toMatchObject({ complete: true });
    expectClean([...surfaces(solved), ...surfaces(applied), ...consoleCalls]);
    // The handle is for the model, never for a log line.
    for (const line of consoleCalls) expect(line).not.toContain(HANDLE);
  });

  it("a refusal of the request builder names the rule by its card label, never its key", async () => {
    const broken = { ...NAME_SHAPED, restrictions: [{ ...NAME_SHAPED.restrictions[0], caps: [cap("d-ana-sun-lead", "Sun.Lead", "<=", 1.5)] }, NAME_SHAPED.restrictions[1]] };
    const d = nameShapedDeps(broken);
    const out = await solveMonthResult({ month: "2026-11" }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("«Ana · Sun.Lead <= 1.5»");
    expectClean([...surfaces(out), ...consoleCalls]);
  });

  it("failed writes (a thrown store, a thrown PUT, a refused create, a failed state save) leak nothing", async () => {
    const leaky = new Error("request to https://x.api.sanity.io/?ids=m-ana,m-bruno failed (d-ana-sun-lead)");
    const thrown = await solveMonthResult({ month: "2026-11" }, PRINCIPAL, nameShapedDeps(NAME_SHAPED, { createProposal: vi.fn(async () => { throw leaky; }) }));

    const d = nameShapedDeps();
    await solveMonthResult({ month: "2026-11" }, PRINCIPAL, d);
    const proposal = storedFrom(d.stored[0]);
    const w1 = applyWorld(proposal, { sourcesOver: { rules: { rev: "rules-rev-1", config: NAME_SHAPED } } });
    w1.deps.commitRecords.mockRejectedValueOnce(leaky);
    const putThrew = await applyScheduleResult({ proposal: HANDLE }, PRINCIPAL, w1.deps);

    const w2 = applyWorld(proposal, { sourcesOver: { rules: { rev: "rules-rev-1", config: NAME_SHAPED } } });
    w2.deps.createRole.mockResolvedValueOnce({ ok: false, status: 409, body: { error: "integrity_conflict", details: { detail: "target_occupied", roleId: "m-ana" } } });
    w2.deps.writeState.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: leaky });
    const refused = await applyScheduleResult({ proposal: HANDLE }, PRINCIPAL, w2.deps);

    expect(thrown.isError).toBe(true);
    expect(putThrew.isError).toBe(true);
    expect(textOf(refused)).toContain("rechazado");
    expectClean([...surfaces(thrown), ...surfaces(putThrew), ...surfaces(refused), ...consoleCalls]);
  });
});

describe("key hygiene through the proposal editor (check, save, revise, apply)", () => {
  it("the board, the findings, the waivers, the month check and apply's waiver gate name no key, id or revision", async () => {
    const w = await editorWorld({ config: NAME_SHAPED });
    const nov1 = w.sid("2026-11-01");
    // Bruno next to Ana on Nov 1 breaks the name-shaped pair rule: forced from the screen.
    const edits = [{ op: "place" as const, service: nov1, row: "bgv", member: w.tok("m-bruno"), force: true }];
    const checked = await checkProposalEditsResult({ proposal: HANDLE, edits }, PRINCIPAL, w.deps);
    const diff = (checked.structuredContent as { rules: { diff: Array<Record<string, unknown>> } }).rules.diff;
    expect(diff).toHaveLength(1);
    const confirms = diff.map(({ kind, rule, service, row, members }) => ({ kind, rule, service, row, members })) as never;
    const saved = await saveProposalEditsResult({ proposal: HANDLE, edits, confirms, saveId: "save-hygiene" }, PRINCIPAL, w.deps);
    const child = (saved.structuredContent as { proposal: string }).proposal;
    const revised = await reviseProposalResult({ proposal: child, edits: [{ op: "place", service: "2026-11-08", seat: "BGV", member: "Dani" }] }, PRINCIPAL, w.deps);
    const grandchild = (revised.structuredContent as { proposal: string }).proposal;
    const refused = await applyScheduleResult({ proposal: grandchild }, PRINCIPAL, w.applyDeps);
    const waivers = (refused.structuredContent as { expectedWaivers: unknown[] }).expectedWaivers;
    const applied = await applyScheduleResult({ proposal: grandchild, waivers } as never, PRINCIPAL, w.applyDeps);
    expect(applied.structuredContent).toMatchObject({ complete: true, revision: 3 });
    const all = [checked, saved, revised, refused, applied];
    expectClean([...all.flatMap(surfaces), ...consoleCalls]);
    for (const line of consoleCalls) for (const h of [HANDLE, child, grandchild]) expect(line).not.toContain(h);
  });
});

describe("TZ — identical answers in both zones", () => {
  const original = process.env.TZ;
  afterEach(() => { process.env.TZ = original; });

  // 03:00 UTC on the 21st is 21:00 on the 20th in CDMX.
  const AT = Date.parse("2026-10-21T03:00:00.000Z");

  async function run(tz: string) {
    process.env.TZ = tz;
    const d = solveDeps({ nowMs: () => AT, todayIso: () => "2026-10-20" });
    const solved = await solveMonthResult({ month: "2026-11", months: 2, specials: [{ date: "2026-11-18", name: "Noche de alabanza" }] }, PRINCIPAL, d);
    const proposal = storedFrom(d.stored[0]);
    const w = applyWorld(proposal, { todayIso: "2026-10-20" });
    w.clock.t = AT;
    const applied = await applyScheduleResult({ proposal: HANDLE }, PRINCIPAL, w.deps);
    return { solved, applied, created: w.deps.createRole.mock.calls.map(([b]) => ({ ...b, creationRequestId: null })) };
  }

  it("solve_month and apply_schedule", async () => {
    const cdmx = await run("America/Mexico_City");
    const utc = await run("UTC");
    expect(new Date(AT).getDate()).toBe(21);                          // the zone did switch
    expect(textOf(utc.solved)).toBe(textOf(cdmx.solved));
    expect(utc.solved.structuredContent).toEqual(cdmx.solved.structuredContent);
    expect(textOf(utc.applied)).toBe(textOf(cdmx.applied));
    expect(utc.applied.structuredContent).toEqual(cdmx.applied.structuredContent);
    expect(utc.created).toEqual(cdmx.created);
    expect(textOf(cdmx.solved)).toContain("(vence 27 de octubre, 21:00)");
  });
});
