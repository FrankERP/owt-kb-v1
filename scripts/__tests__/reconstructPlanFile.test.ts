// Solver v3 C4 — the one gateway to C2's write-request module (IF2-18 … IF2-21 for
// actor `reconstruction`) and the plan file: R14 (the planned action is the
// executor's own verdict), R15 (digests and fingerprint), R17 (determinism), R18
// (delete decisions and backups). Every name is fictitious.
import { describe, expect, it } from "vitest";

import type { LedgerService } from "@/app/utils/fairnessLedger";
import { buildFairnessMonthDocument } from "@/app/utils/fairnessMonthWriteRequest";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import {
  RECORDED_BY,
  decideDelete,
  decideWrite,
  hashOfBody,
  parseRecord,
  summarizeStored,
  validateReconstructionBody,
} from "../lib/reconstructDecide";
import {
  backupText,
  canonicalJson,
  fingerprintOf,
  hashText,
  memberInputDigest,
  parsePlanFile,
  planDifferences,
  serializePlan,
  serviceInputDigest,
  type RollbackPlanContent,
} from "../lib/reconstructPlanFile";

const CURRENT = "2026-10";
const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const body = (month: string, lead: Status = "in"): FairnessMonthBody => ({
  month,
  people: [{ memberId: "m-ana", roles: { ...OUT, "Sun.Lead": lead }, exactRules: [], exempt: false, blocks: [] }],
  presence: [],
});
const stored = (b: FairnessMonthBody, source: "auto" | "manual" | "reconstructed" = "reconstructed"): Record<string, unknown> => ({
  ...buildFairnessMonthDocument({
    body: b,
    source,
    engine: source === "reconstructed" ? "v2" : "v3",
    environment: "local",
    recordedAt: "2026-10-02T00:00:00.000Z",
    recordedBy: RECORDED_BY,
    names: new Map([["m-ana", "Ana E."]]),
  }),
  _rev: "rev-1",
});
/** A hand edit after the write: one role flipped, the stored contentHash left as it was. */
const edited = (doc: Record<string, unknown>): Record<string, unknown> => {
  const copy = structuredClone(doc) as { people: Array<{ roles: Record<string, string> }> };
  copy.people[0].roles.sunLead = copy.people[0].roles.sunLead === "in" ? "out" : "in";
  return copy as unknown as Record<string, unknown>;
};

describe("the write decision, exactly as the executor will take it (R14; C2 IF2-21)", () => {
  const planned = body("2026-08");
  const plan = (doc: Record<string, unknown> | null) =>
    decideWrite({ month: "2026-08", currentMonth: CURRENT, bodyHash: hashOfBody(planned), stored: doc ? summarizeStored(doc) : null, freezing: 3 });

  it("creates when there is no record", () => expect(plan(null)).toBe("create"));
  it("changes nothing when a record holds the same content, whatever its source", () => {
    expect(plan(stored(planned))).toBe("unchanged");
    expect(plan(stored(planned, "manual"))).toBe("unchanged");
  });
  it("replaces an intact reconstructed record whose content differs", () => {
    expect(plan(stored(body("2026-08", "out")))).toBe("replace");
  });
  it("refuses a record another writer made", () => {
    expect(plan(stored(body("2026-08", "out"), "auto"))).toEqual({ refused: "not_reconstruction_owned" });
  });
  it("refuses a reconstructed record edited after it was written", () => {
    expect(plan(edited(stored(body("2026-08", "out"))))).toEqual({ refused: "record_edited" });
  });
  it("never plans a month that is not past", () => {
    expect(decideWrite({ month: "2026-10", currentMonth: CURRENT, bodyHash: hashOfBody(body("2026-10")), stored: null, freezing: 1 })).toEqual({
      refused: "not_past_month",
    });
  });
});

describe("the delete decision (R18; C2 WR-14 D1–D4)", () => {
  const del = (doc: Record<string, unknown> | null) =>
    decideDelete({ month: "2026-08", currentMonth: CURRENT, stored: doc ? summarizeStored(doc) : null });
  it("deletes only an intact record the reconstruction wrote", () => {
    expect(del(stored(body("2026-08")))).toBe("delete");
    expect(del(stored(body("2026-08"), "manual"))).toEqual({ refused: "not_reconstruction_owned" });
    expect(del(edited(stored(body("2026-08"))))).toEqual({ refused: "record_edited" });
    expect(del(null)).toEqual({ refused: "record_missing" });
  });
});

describe("validation and parsing through C2 (IF2-18, IF2-20)", () => {
  it("accepts a reconstruction body with its expectedRev, refuses one without it or with a source", () => {
    expect(validateReconstructionBody({ ...body("2026-08"), expectedRev: null }, CURRENT)).toEqual({ ok: true });
    expect(validateReconstructionBody(body("2026-08") as never, CURRENT).ok).toBe(false);
    expect(validateReconstructionBody({ ...body("2026-08"), expectedRev: null, source: "auto" } as never, CURRENT).ok).toBe(false);
  });
  it("parses a stored record and refuses a malformed one", () => {
    expect(parseRecord(stored(body("2026-08"))).ok).toBe(true);
    expect(parseRecord({ ...stored(body("2026-08")), schemaVersion: 9 }).ok).toBe(false);
  });
  it("summarizes a stored record the way the executor re-reads it, without building anything", () => {
    const doc = stored(body("2026-08"));
    expect(summarizeStored(doc)).toEqual({
      id: "fairnessMonth.2026-08",
      rev: "rev-1",
      source: "reconstructed",
      contentHash: doc.contentHash,
      recomputedHash: doc.contentHash,
      intact: true,
    });
    expect(summarizeStored(edited(doc)).intact).toBe(false);
  });
});

describe("the plan file (R15, R17, R18)", () => {
  const content: RollbackPlanContent = {
    mode: "rollback",
    inputs: { months: ["2026-08"] },
    months: [
      {
        month: "2026-08",
        action: "delete",
        stored: { id: "fairnessMonth.2026-08", rev: "rev-1", source: "reconstructed", contentHash: "sha256:aa", recomputedHash: "sha256:aa" },
        backup: { file: "backup-2026-08.json", hash: "sha256:bb" },
      },
    ],
  };
  const withoutTime = (text: string) => text.split("\n").filter((line) => !line.includes('"generatedAt"')).join("\n");

  it("serializes object keys in codepoint order at every level", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }], u: undefined })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
  it("keeps the generation time out of the fingerprint and round-trips", () => {
    const first = serializePlan(content, "2026-10-20T18:00:00.000Z");
    expect(withoutTime(serializePlan(content, "2026-10-21T09:30:00.000Z"))).toBe(withoutTime(first));
    const parsed = parsePlanFile(first);
    expect(parsed.ok && parsed.plan.fingerprint).toBe(fingerprintOf(content));
    expect(fingerprintOf(content)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses a plan edited after it was written", () => {
    const text = serializePlan(content, "2026-10-20T18:00:00.000Z").replace('"rev-1"', '"rev-2"');
    const parsed = parsePlanFile(text);
    expect(parsed.ok ? "" : parsed.reason).toMatch(/huella no coincide/);
  });
  it("names the parts that differ by position and month only", () => {
    const stale: RollbackPlanContent = {
      ...content,
      months: [{ ...content.months[0], stored: { ...content.months[0].stored!, rev: "rev-2" } }],
    };
    expect(planDifferences(content, stale)).toEqual(["months[0] (2026-08)"]);
    expect(planDifferences(content, content)).toEqual([]);
  });
  it("backs a stored document up as reproducible bytes", () => {
    const doc = stored(body("2026-08"));
    expect(backupText(doc)).toBe(backupText(JSON.parse(JSON.stringify(doc))));
    expect(hashText(backupText(doc))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("the input digests (R15)", () => {
  const service = (patch: Partial<LedgerService> = {}): LedgerService => ({
    _id: "sun-2026-08-02",
    _type: "sunday_role",
    date: "2026-08-02",
    published: true,
    countsForFairness: true,
    Lead: ["m-ana"],
    BGVs: ["m-beto", "m-carla"],
    Chorus: [],
    ...patch,
  });
  it("ignores publishing and the service time; sees stored seat order and the counted flag", () => {
    const base = serviceInputDigest([service()]);
    expect(serviceInputDigest([service({ published: false })])).toBe(base);
    expect(serviceInputDigest([service({ time: "10:00" })])).toBe(base);
    expect(serviceInputDigest([service({ BGVs: ["m-carla", "m-beto"] })])).not.toBe(base);
    expect(serviceInputDigest([service({ countsForFairness: false })])).not.toBe(base);
  });
  it("binds members' availability inside the run's months, and nothing outside them", () => {
    const roster = (dates: string[]) => [{ _id: "m-ana", member_name: "Ana Ejemplo", memberType: ["voz", "sunday_lead"], unavailableDates: dates }];
    const base = memberInputDigest(roster(["2026-08-15"]), ["2026-08"]);
    expect(memberInputDigest(roster(["2026-08-15", "2025-12-25"]), ["2026-08"])).toBe(base);
    expect(memberInputDigest(roster(["2026-08-15", "2026-08-22"]), ["2026-08"])).not.toBe(base);
  });
});
