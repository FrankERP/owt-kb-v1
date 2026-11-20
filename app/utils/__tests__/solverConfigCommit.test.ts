// Slice R (ADR-0084): the chat's half of the rules writer, over fakes of its read, roster and write. The
// route's half (`saveSolverConfig`) is `solverConfigRoute.test.ts`, unchanged since the move (R1).
// Proved here: the lossless gate (R4) and the absent document refuse before any edit; the check never
// writes; the save re-plans on its own read, writes only when `verify` accepts the FRESH rev and lines,
// writes through the panel's serializer under that rev, maps a 409 to «cambiaron», rethrows anything else,
// and answers «ya estaba» without a write when nothing would change.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: {}, writeClient: {} }));
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: {}, rawIntegrityClient: {} }));

import type { SolverConfig } from "@/app/components/admin/plannerModel";
import { parseSolverConfigWrite } from "@/app/utils/solverConfigWriteRequest";
import type { NewRuleId, RuleEdit, RuleRosterMember } from "@/app/utils/ruleEdits";
import { RULES_MESSAGE, checkRuleEdits, losslessRules, saveRuleEdits, type RuleEditsDeps } from "../solverConfigCommit";

const ROSTER: RuleRosterMember[] = [
  { _id: "m-mkz", member_name: "Marco Kuri", alias: "Mkz", memberType: ["voz", "sunday_lead", "saturday_lead"] },
  { _id: "m-gaby", member_name: "Gabriela Soto", alias: "Gaby", memberType: ["voz", "support"] },
  { _id: "m-pau", member_name: "Paulina Ríos", alias: "Pau", memberType: ["voz", "support"] },
];

const CONFIG: SolverConfig = {
  sundayLeads: ["m-mkz"],
  saturdayLeads: [],
  support: ["m-gaby", "m-pau"],
  restrictions: [
    { id: "r-pau", person: "Pau", excludedPatterns: ["Sat.*"], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [] },
  ],
  conflicts: [],
  presence: [],
};

/** The stored document as the panel's own save would have left it. */
function storedDoc(config: SolverConfig = CONFIG, rev = "rev-1"): Record<string, unknown> {
  const parsed = parseSolverConfigWrite(config);
  if (!parsed.ok) throw new Error("fixture does not parse");
  return { _id: "solverConfig", _type: "solverConfig", _rev: rev, ...parsed.value.fields };
}

const ids: NewRuleId = (prefix, i, j) => `${prefix}-${i}-${j}`;
const newIdFor = () => ids;
const NEVER_SUN_LEAD: RuleEdit[] = [{ op: "never", person: "Gaby", pattern: { day: "domingo", seat: "líder" } }];

function deps(raw: Record<string, unknown> | null = storedDoc(), over: Partial<RuleEditsDeps> = {}) {
  const write = vi.fn<RuleEditsDeps["write"]>(async () => {});
  const d: RuleEditsDeps = {
    loadRaw: vi.fn(async () => raw),
    roster: vi.fn(async () => ROSTER),
    write,
    month: () => "2026-12",
    ...over,
  };
  return { d, write: (over.write as typeof write | undefined) ?? write };
}

const conflict = () =>
  Object.assign(new Error("409"), { statusCode: 409, details: { type: "mutationError", items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }] } });

describe("losslessRules (R4)", () => {
  it("accepts what the panel's own save stores", () => {
    expect(losslessRules(storedDoc())).toMatchObject({ support: ["m-gaby", "m-pau"] });
  });

  it("ignores key order", () => {
    const raw = storedDoc();
    const [r] = raw.restrictions as Record<string, unknown>[];
    const reversed = Object.fromEntries(Object.entries(r!).reverse());
    expect(losslessRules({ ...raw, restrictions: [reversed] })).not.toBeNull();
  });

  it("refuses a stored value the reader would coerce", () => {
    const raw = storedDoc();
    const [r] = raw.restrictions as Record<string, unknown>[];
    expect(losslessRules({ ...raw, restrictions: [{ ...r, fairness: "mystery" }] })).toBeNull();
  });

  it("refuses a stored item the reader would drop", () => {
    const raw = storedDoc();
    expect(losslessRules({ ...raw, conflicts: [{ _key: "x", personA: "Pau" }] })).toBeNull();
  });
});

describe("checkRuleEdits", () => {
  it("answers the lines and the fields, and never writes", async () => {
    const { d, write } = deps();
    const plan = await checkRuleEdits(NEVER_SUN_LEAD, newIdFor, d);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rev).toBe("rev-1");
    expect(plan.lines.join("\n")).toContain("Gaby");
    expect(Object.keys(plan.fields).sort()).toEqual(["conflicts", "presence", "restrictions", "saturdayLeads", "sundayLeads", "support"]);
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses an absent document with the panel as the remedy", async () => {
    const { d } = deps(null);
    expect(await checkRuleEdits(NEVER_SUN_LEAD, newIdFor, d)).toMatchObject({ ok: false, status: 404, code: "absent", message: RULES_MESSAGE.absent });
  });

  it("refuses a lossy document before applying anything", async () => {
    const raw = storedDoc();
    const { d } = deps({ ...raw, conflicts: [{ _key: "x", personA: "Pau" }] });
    expect(await checkRuleEdits(NEVER_SUN_LEAD, newIdFor, d)).toMatchObject({ ok: false, code: "lossy", message: RULES_MESSAGE.lossy });
  });

  it("passes an edit's refusal through", async () => {
    const { d } = deps();
    const plan = await checkRuleEdits([{ op: "never", person: "Nadie", pattern: { day: "domingo", seat: "todo" } }], newIdFor, d);
    expect(plan).toMatchObject({ ok: false, status: 422, code: "edit" });
  });

  it("a failed read throws (the tool's unknown-outcome path), never a refusal", async () => {
    const { d } = deps(storedDoc(), { loadRaw: vi.fn(async () => { throw new Error("network"); }) });
    await expect(checkRuleEdits(NEVER_SUN_LEAD, newIdFor, d)).rejects.toThrow("network");
  });
});

describe("saveRuleEdits", () => {
  it("writes the six fields under the FRESH rev, after verify accepted that rev and those lines", async () => {
    const { d, write } = deps(storedDoc(CONFIG, "rev-7"));
    const verify = vi.fn(() => null);
    const out = await saveRuleEdits(NEVER_SUN_LEAD, newIdFor, { actorId: "m-admin", verify }, d);
    expect(out).toMatchObject({ ok: true, unchanged: false });
    expect(verify).toHaveBeenCalledTimes(1);
    const [rev, lines] = verify.mock.calls[0] as unknown as [string, string[]];
    expect(rev).toBe("rev-7");
    expect(lines.join("\n")).toContain("Gaby");
    expect(write).toHaveBeenCalledTimes(1);
    const [wRev, fields, actor] = write.mock.calls[0]!;
    expect(wRev).toBe("rev-7");
    expect(actor).toBe("m-admin");
    // What reaches Sanity is the panel's serializer output, so the panel reads it back unchanged.
    expect(losslessRules({ _rev: "rev-8", ...fields })).not.toBeNull();
    expect(JSON.stringify(fields.restrictions)).toContain("Sun.Lead");
  });

  it("never writes when verify refuses", async () => {
    const { d, write } = deps();
    const out = await saveRuleEdits(NEVER_SUN_LEAD, newIdFor, { actorId: "m-admin", verify: () => "no" }, d);
    expect(out).toEqual({ ok: false, status: 409, code: "not_the_checked", message: "no" });
    expect(write).not.toHaveBeenCalled();
  });

  it("answers «ya estaba» without verifying or writing when nothing would change", async () => {
    const { d, write } = deps();
    const verify = vi.fn(() => "should not be asked");
    const out = await saveRuleEdits([{ op: "never", person: "Pau", pattern: { day: "sábado", seat: "todo" } }], newIdFor, { actorId: "m-admin", verify }, d);
    expect(out).toEqual({ ok: true, unchanged: true, lines: [] });
    expect(verify).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("maps a lost race (409) to «cambiaron»", async () => {
    const { d } = deps(storedDoc(), { write: vi.fn(async () => { throw conflict(); }) });
    const out = await saveRuleEdits(NEVER_SUN_LEAD, newIdFor, { actorId: "m-admin", verify: () => null }, d);
    expect(out).toMatchObject({ ok: false, status: 409, code: "changed", message: RULES_MESSAGE.changed });
  });

  it("rethrows any other write failure (unknown outcome for the tool)", async () => {
    const { d } = deps(storedDoc(), { write: vi.fn(async () => { throw new Error("token expired"); }) });
    await expect(saveRuleEdits(NEVER_SUN_LEAD, newIdFor, { actorId: "m-admin", verify: () => null }, d)).rejects.toThrow("token expired");
  });

  it("refuses an absent or lossy document on the save's own read, without writing", async () => {
    for (const raw of [null, { ...storedDoc(), presence: [{ _key: "p", persons: "x" }] }]) {
      const { d, write } = deps(raw);
      const out = await saveRuleEdits(NEVER_SUN_LEAD, newIdFor, { actorId: "m-admin", verify: () => null }, d);
      expect(out.ok).toBe(false);
      expect(write).not.toHaveBeenCalled();
    }
  });
});
