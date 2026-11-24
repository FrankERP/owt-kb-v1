// ADR-0092: the one writer core. Proved here: an ordinary save never writes or clears `personTokens`
// (only `setMarker` does), it writes under the read's revision, a refusal writes nothing, and the
// lossless gate holds for a clean id-mode document and refuses a coerced one.
import { describe, expect, it, vi } from "vitest";

import type { SolverConfig } from "@/app/components/admin/plannerModel";
import { losslessRules, prepareSolverConfigWrite, writeSolverConfig } from "@/app/utils/solverConfigWrite";
import { solverConfigFields, type RulePeopleRosterMember } from "@/app/utils/solverConfigWriteRequest";

const ROSTER: RulePeopleRosterMember[] = [
  { _id: "m-pau-0000000000000001", member_name: "Paulina Ríos", alias: "Pau" },
  { _id: "m-mkz-0000000000000001", member_name: "Marco Kuri", alias: "Mkz" },
];
const NAMES: SolverConfig = {
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [{ id: "r1", person: "Pau", excludedPatterns: ["Sat.*"], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [] }],
  conflicts: [{ id: "c1", personA: "Pau", personB: "Mkz", pattern: "*.LeadBGV" }],
  presence: [],
};
const IDS: SolverConfig = {
  ...NAMES,
  restrictions: [{ ...NAMES.restrictions[0], person: "m-pau-0000000000000001" }],
  conflicts: [{ ...NAMES.conflicts[0], personA: "m-pau-0000000000000001", personB: "m-mkz-0000000000000001" }],
};
const doc = (c: SolverConfig, ids: boolean): Record<string, unknown> => ({ _id: "solverConfig", _rev: "rev-1", ...solverConfigFields(c), ...(ids ? { personTokens: "id" } : {}) });

function fakeClient() {
  const calls: Array<{ op: string; arg: unknown }> = [];
  const chain = {
    ifRevisionId: (rev: string) => (calls.push({ op: "ifRevisionId", arg: rev }), chain),
    set: (v: unknown) => (calls.push({ op: "set", arg: v }), chain),
    unset: (v: unknown) => (calls.push({ op: "unset", arg: v }), chain),
    commit: vi.fn(async () => ({})),
  };
  const client = { patch: (id: string) => (calls.push({ op: "patch", arg: id }), chain) };
  return { client: client as never, calls, chain };
}

describe("writeSolverConfig", () => {
  it("an ordinary save sets the six fields only, never the marker, in either mode", async () => {
    for (const ids of [false, true]) {
      const { client, calls } = fakeClient();
      const out = await writeSolverConfig(client, { config: NAMES, stored: doc(ids ? IDS : NAMES, ids), roster: ROSTER, rev: "rev-1", stamp: { updatedAt: "t" } });
      expect(out.ok).toBe(true);
      const set = calls.find((c) => c.op === "set")?.arg as Record<string, unknown>;
      expect(Object.keys(set).sort()).toEqual(["conflicts", "presence", "restrictions", "saturdayLeads", "sundayLeads", "support", "updatedAt"]);
      expect(calls.some((c) => c.op === "unset")).toBe(false);
      expect(calls.find((c) => c.op === "ifRevisionId")?.arg).toBe("rev-1");
      expect((set.restrictions as Array<{ person: string }>)[0].person).toBe(ids ? "m-pau-0000000000000001" : "Pau");
    }
  });

  it("setMarker \"id\" sets the marker with the ids; null writes names and unsets it", async () => {
    const a = fakeClient();
    await writeSolverConfig(a.client, { config: NAMES, stored: doc(NAMES, false), roster: ROSTER, setMarker: "id", rev: "rev-1", stamp: { updatedAt: "t" } });
    const setA = a.calls.find((c) => c.op === "set")?.arg as Record<string, unknown>;
    expect(setA.personTokens).toBe("id");
    expect(setA.restrictions).toEqual(solverConfigFields(IDS).restrictions);

    const b = fakeClient();
    await writeSolverConfig(b.client, { config: NAMES, stored: doc(IDS, true), roster: ROSTER, setMarker: null, rev: "rev-1", stamp: { updatedAt: "t" } });
    const setB = b.calls.find((c) => c.op === "set")?.arg as Record<string, unknown>;
    expect(setB.personTokens).toBeUndefined();
    expect(setB.restrictions).toEqual(solverConfigFields(NAMES).restrictions);
    expect(b.calls.find((c) => c.op === "unset")?.arg).toEqual(["personTokens"]);
  });

  it("a refusal writes nothing", async () => {
    const { client, calls } = fakeClient();
    const out = await writeSolverConfig(client, {
      config: { ...NAMES, restrictions: [{ ...NAMES.restrictions[0], person: "Paulina" }] },
      stored: doc(IDS, true),
      roster: ROSTER,
      rev: "rev-1",
      stamp: { updatedAt: "t" },
    });
    expect(out).toMatchObject({ ok: false, kind: "person", refusal: { reason: "person_changed" } });
    expect(calls).toEqual([]);
  });

  it("prepares without a client, and refuses a body the parser refuses", () => {
    expect(prepareSolverConfigWrite({ config: { restrictions: "x" }, stored: doc(NAMES, false), roster: ROSTER })).toMatchObject({ ok: false, kind: "invalid" });
  });
});

describe("losslessRules in id mode", () => {
  it("passes a clean id-mode document and answers its names", () => {
    expect(losslessRules(doc(IDS, true), ROSTER)?.restrictions[0].person).toBe("Pau");
  });

  it("is lossy for a coerced value (an unknown cap op)", () => {
    const raw = doc(IDS, true);
    const [r] = raw.restrictions as Record<string, unknown>[];
    const coerced = { ...raw, restrictions: [{ ...r, caps: [{ _key: "k", id: "k", pattern: "Sun.Lead", op: "~", value: 1, relative: false, relOffset: 0 }] }] };
    expect(losslessRules(coerced, ROSTER)).toBeNull();
  });

  it("keeps a name an older client wrote into an id document, and reads it as someone who left (§5.4)", () => {
    const view = losslessRules(doc(NAMES, true), ROSTER);
    expect(view?.restrictions[0].person).toBe("persona que ya no está en Alabanza (2)");
  });
});
