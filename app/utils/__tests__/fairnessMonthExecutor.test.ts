// Solver v3 C2 IF2-22 / WR-16 — the ONE write executor of `fairnessMonth`, against an
// in-memory Content Lake whose reads run the real GROQ builders. Each test asserts the
// MUTATION LOG a decision produced, because "the right refusal with a stray write behind
// it" is exactly the failure the executor exists to rule out. Every name is fictitious.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";
import {
  RECONSTRUCTION_RECORDED_BY,
  buildFairnessMonthDocument,
  contentHashOfWrite,
  executeFairnessMonthWrites,
  fairnessMonthId,
  isIntact,
  type FairnessStamps,
} from "../fairnessMonthWriteRequest";
import type { FairnessMonthWrite, RoleKey, Status } from "../fairnessVocabulary";
import { contentLakeConflict, createFakeFairnessSanity, type FakeDoc } from "./__fixtures__/fakeFairnessSanity";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
};
const roles = (patch: Partial<Record<RoleKey, Status>>) => ({ ...OUT, ...patch });

const MEMBERS: FakeDoc[] = [
  { _id: "m-alma", _type: "teamMembers", member_name: "Alma Ruiz", alias: "Alma", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", _type: "teamMembers", member_name: "Bruno Díaz", memberType: ["voz", "support"], ministries: ["worship"] },
  { _id: "m-kids", _type: "teamMembers", member_name: "Diego Paz", memberType: ["voz", "support"], ministries: ["kids"] },
  { _id: "m-noname", _type: "teamMembers", member_name: "", memberType: ["voz", "support"] },
];

function entry(month: string, patch: Partial<FairnessMonthWrite> = {}): FairnessMonthWrite {
  return {
    month,
    source: "manual",
    expectedRev: null,
    people: [
      { memberId: "m-alma", roles: roles({ "Sun.Lead": "in", "Sun.BGV": "in" }), exactRules: [], exempt: false, blocks: [] },
      { memberId: "m-bruno", roles: roles({ "Sun.BGV": "in", "Sat.Choir": "in" }), exactRules: [], exempt: false, blocks: [] },
    ],
    presence: [],
    ...patch,
  };
}

const ROUTE_STAMPS: FairnessStamps = {
  recordedBy: "m-admin",
  now: "2026-10-20T18:00:00.000Z",
  currentMonth: "2026-10",
  environment: "preview",
  engine: "v3",
};
const RECON_STAMPS: FairnessStamps = {
  recordedBy: RECONSTRUCTION_RECORDED_BY,
  now: "2026-10-20T18:00:00.000Z",
  currentMonth: "2026-10",
  environment: "local",
};

/** A stored record as the executor itself would have written it. */
function storedRecord(body: FairnessMonthWrite, source: "auto" | "manual" | "reconstructed" = "manual"): FakeDoc {
  return buildFairnessMonthDocument({
    body,
    source,
    engine: source === "reconstructed" ? "v2" : "v3",
    environment: "production",
    recordedAt: "2026-09-30T12:00:00.000Z",
    recordedBy: source === "reconstructed" ? RECONSTRUCTION_RECORDED_BY : "m-admin",
    names: new Map([["m-alma", "Alma"], ["m-bruno", "Bruno Díaz"]]),
  }) as unknown as FakeDoc;
}

function route(lake: ReturnType<typeof createFakeFairnessSanity>, months: FairnessMonthWrite[], stamps = ROUTE_STAMPS) {
  return executeFairnessMonthWrites({ clients: lake.clients, actor: "route", op: "write", months, stamps });
}

describe("the read-client contract, asserted before any read (WR-16, A2)", () => {
  it.each([
    ["no token", { perspective: "published", useCdn: false }],
    ["an empty token", { token: "", perspective: "published", useCdn: false }],
    ["no perspective set at creation", { token: "t", useCdn: false }],
    ["the raw perspective", { token: "t", perspective: "raw", useCdn: false }],
    ["the CDN", { token: "t", perspective: "published", useCdn: true }],
  ])("throws with %s, having issued no read", async (_label, config) => {
    const lake = createFakeFairnessSanity(MEMBERS, config);
    await expect(route(lake, [entry("2026-11")])).rejects.toThrow(/read token/);
    expect(lake.reads).toEqual([]);
    expect(lake.commits).toEqual([]);
  });

  it("throws on programming errors before any read", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const clients = lake.clients;
    await expect(route(lake, [entry("2026-11")], { ...ROUTE_STAMPS, engine: undefined })).rejects.toThrow(/v3/);
    await expect(route(lake, [entry("2026-11")], { ...ROUTE_STAMPS, engine: "v2" })).rejects.toThrow(/v3/);
    await expect(
      executeFairnessMonthWrites({ clients, actor: "route", op: "delete", months: [{ month: "2026-11", expectedRev: "r" }], stamps: ROUTE_STAMPS }),
    ).rejects.toThrow(/only the reconstruction actor deletes/);
    await expect(
      executeFairnessMonthWrites({ clients, actor: "reconstruction", op: "write", months: [], stamps: { ...RECON_STAMPS, engine: "v3" } }),
    ).rejects.toThrow(/engine v2/);
    await expect(
      executeFairnessMonthWrites({ clients, actor: "reconstruction", op: "write", months: [], stamps: { ...RECON_STAMPS, recordedBy: "m-alma" } }),
    ).rejects.toThrow(/script marker/);
    expect(lake.reads).toEqual([]);
  });
});

describe("actor route — create, replace, unchanged (WR-7 … WR-12)", () => {
  it("creates a record with server stamps, names from the member read and the body's hash", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const [result] = await route(lake, [entry("2026-11")]);
    expect(result).toMatchObject({ month: "2026-11", verdict: "created", rev: "tx-1", ownVerdict: "create", recordedAt: ROUTE_STAMPS.now });
    expect(result.contentHash).toBe(contentHashOfWrite("2026-11", entry("2026-11")));
    expect(lake.commits).toHaveLength(1);
    expect(lake.commits[0].map((o) => [o.op, o.id])).toEqual([["create", "fairnessMonth.2026-11"]]);
    const doc = lake.docs.get(fairnessMonthId("2026-11"))!;
    expect(doc).toMatchObject({
      schemaVersion: 1, month: "2026-11", source: "manual", engine: "v3", environment: "preview",
      recordedAt: ROUTE_STAMPS.now, recordedBy: "m-admin",
    });
    expect((doc.people as Array<{ name: string }>).map((p) => p.name)).toEqual(["Alma", "Bruno Díaz"]);
    expect(isIntact(doc)).toBe(true);
  });

  it("creates an unrecorded month that already has stored services (A27)", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, { _id: "sun-1", _type: "sunday_role", week: "2026-11-01" }]);
    const [result] = await route(lake, [entry("2026-11")]);
    expect(result.verdict).toBe("created");
  });

  it("replaces a recorded month with no freezing services as one revision-asserted patch, unsetting stale fields", async () => {
    const old = { ...storedRecord(entry("2026-11")), legacyNote: "hand-added" } as FakeDoc;
    const lake = createFakeFairnessSanity([...MEMBERS, old]);
    const next = entry("2026-11", { expectedRev: "rev-0", source: "auto" });
    next.people[1].roles["Sun.Choir"] = "in";
    const [result] = await route(lake, [next]);
    expect(result).toMatchObject({ verdict: "replaced", ownVerdict: "replace", rev: "tx-1" });
    const ops = lake.commits[0];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "patch", id: "fairnessMonth.2026-11", ifRevisionId: "rev-0", unset: ["legacyNote"] });
    expect(Object.keys((ops[0] as { set: object }).set).sort()).toEqual(
      ["contentHash", "engine", "environment", "month", "people", "presence", "recordedAt", "recordedBy", "schemaVersion", "source"].sort(),
    );
    const doc = lake.docs.get("fairnessMonth.2026-11")!;
    expect(doc).not.toHaveProperty("legacyNote");
    expect(doc).toMatchObject({ source: "auto", recordedAt: ROUTE_STAMPS.now, _createdAt: "2026-01-01T00:00:00Z" });
    expect(isIntact(doc)).toBe(true);
  });

  it("replaces when the month's only service is an UNCOUNTED special, refuses with a counted one (A5)", async () => {
    const old = storedRecord(entry("2026-11"));
    const next = entry("2026-11", { expectedRev: "rev-0" });
    next.people[0].exempt = true;
    const uncounted = createFakeFairnessSanity([...MEMBERS, old, { _id: "s-1", _type: "special_role", date: "2026-11-03" }]);
    expect((await route(uncounted, [next]))[0].verdict).toBe("replaced");
    const counted = createFakeFairnessSanity([
      ...MEMBERS,
      old,
      { _id: "s-1", _type: "special_role", date: "2026-11-03", countsForFairness: true },
    ]);
    const [refused] = await route(counted, [next]);
    expect(refused.verdict).toEqual({ refused: "month_has_services" });
    expect(counted.commits).toEqual([]);
  });

  it("answers an identical replay unchanged with no transaction — before the past-month check", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-09"))]);
    const [result] = await route(lake, [entry("2026-09", { expectedRev: "rev-old" })]);
    expect(result).toMatchObject({ verdict: "unchanged", rev: "rev-0", recordedAt: "2026-09-30T12:00:00.000Z" });
    expect(lake.commits).toEqual([]);
  });

  it("never refuses an unchanged month over a since-deleted member (WR-5 runs on written months only)", async () => {
    const lake = createFakeFairnessSanity([MEMBERS[0], storedRecord(entry("2026-11"))]);
    const [result] = await route(lake, [entry("2026-11", { expectedRev: "rev-0" })]);
    expect(result.verdict).toBe("unchanged");
  });

  it("refuses record_exists with the current record's rev, source and recordedAt", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-11"))]);
    const changed = entry("2026-11");
    changed.people[0].exempt = true;
    const [result] = await route(lake, [changed]);
    expect(result).toMatchObject({
      verdict: { refused: "record_exists" },
      current: { rev: "rev-0", source: "manual", recordedAt: "2026-09-30T12:00:00.000Z" },
    });
  });
});

describe("actor route — the live-member checks (WR-5)", () => {
  it.each([
    ["member_unknown: no member document", "m-ghost", "member_unknown"],
    ["member_unknown: a member document that yields no display name", "m-noname", "member_unknown"],
    ["member_not_worship: a kids-only member", "m-kids", "member_not_worship"],
  ])("%s", async (_label, memberId, refusal) => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const body = entry("2026-11");
    body.people[1] = { ...body.people[1], memberId };
    const [result] = await route(lake, [body]);
    expect(result).toMatchObject({ verdict: { refused: refusal }, ownVerdict: refusal, memberIds: [memberId] });
    expect(lake.commits).toEqual([]);
  });

  it("tipo_mismatch: a role marked in that the member's current Tipo does not fit", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const body = entry("2026-11");
    body.people[1].roles["Sun.Lead"] = "in"; // Bruno is voz + support
    const [result] = await route(lake, [body]);
    expect(result).toMatchObject({ verdict: { refused: "tipo_mismatch" }, memberIds: ["m-bruno"] });
  });
});

describe("actor route — all or nothing (WR-9)", () => {
  it("writes nothing when one month is refused, and reports each month's own verdict", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-12"))]);
    const dec = entry("2026-12");
    dec.people[0].exempt = true;
    const results = await route(lake, [entry("2026-11"), dec]);
    expect(results.map((r) => [r.month, r.ownVerdict, r.verdict])).toEqual([
      ["2026-11", "create", { refused: "record_exists" }],
      ["2026-12", "record_exists", { refused: "record_exists" }],
    ]);
    expect(lake.commits).toEqual([]);
  });

  it("commits two writes in ONE transaction", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const results = await route(lake, [entry("2026-11"), entry("2026-12")]);
    expect(results.map((r) => r.verdict)).toEqual(["created", "created"]);
    expect(lake.commits).toHaveLength(1);
    expect(lake.commits[0].map((o) => o.id)).toEqual(["fairnessMonth.2026-11", "fairnessMonth.2026-12"]);
  });

  it.each([
    ["documentAlreadyExistsError", "record_exists", undefined],
    ["documentRevisionIDDoesNotMatchError", "stale_revision", undefined],
    [undefined, "stale_revision", "commit_conflict"],
  ] as const)("maps a commit 409 (%s) onto every written month, unchanged months stay unchanged", async (type, refusal, cause) => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-11"))]);
    lake.failNext.commit = contentLakeConflict(type);
    const results = await route(lake, [entry("2026-11", { expectedRev: "rev-0" }), entry("2026-12")]);
    expect(results[0]).toMatchObject({ verdict: "unchanged", ownVerdict: "unchanged" });
    expect(results[1]).toMatchObject({ verdict: { refused: refusal }, ownVerdict: refusal, ...(cause ? { cause } : {}) });
  });

  it("loses a real race to a concurrent create as record_exists, discarding nothing (L3)", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const theirs = storedRecord(entry("2026-11"));
    lake.hooks.beforeCommit = () => lake.put(theirs);
    const [result] = await route(lake, [entry("2026-11")]);
    expect(result.verdict).toEqual({ refused: "record_exists" });
    expect(lake.docs.get("fairnessMonth.2026-11")?.contentHash).toBe(theirs.contentHash);
  });

  it("throws an error that is not a 409 mutation conflict", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    lake.failNext.commit = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    await expect(route(lake, [entry("2026-11")])).rejects.toThrow("Unauthorized");
  });

  it("refuses an invalid entry as invalid_body with index-based issues, reading nothing", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const bad = { ...entry("2026-12"), name: "x" } as unknown as FairnessMonthWrite;
    const results = await route(lake, [entry("2026-11"), bad]);
    expect(results[1].verdict).toEqual({ refused: "invalid_body", issues: [{ path: "name", message: "unknown field" }] });
    expect(results[0].verdict).toEqual({ refused: "invalid_body", issues: [] });
    expect(lake.reads).toEqual([]);
  });
});

const recon = (lake: ReturnType<typeof createFakeFairnessSanity>, op: "write" | "delete", months: unknown[]) =>
  executeFairnessMonthWrites({
    clients: lake.clients,
    actor: "reconstruction",
    op,
    months: months as FairnessMonthWrite[],
    stamps: RECON_STAMPS,
  });
const reconBody = (month: string, patch: Partial<FairnessMonthWrite> = {}) => {
  const { source: _source, ...body } = entry(month, patch);
  void _source;
  return body;
};

describe("actor reconstruction (WR-14)", () => {
  it("creates a past month stamped reconstructed, v2 and the script marker, without reading services", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const [result] = await recon(lake, "write", [reconBody("2026-08")]);
    expect(result.verdict).toBe("created");
    expect(lake.docs.get("fairnessMonth.2026-08")).toMatchObject({
      source: "reconstructed", engine: "v2", environment: "local", recordedBy: RECONSTRUCTION_RECORDED_BY,
    });
    expect(lake.reads.some((r) => r.query.includes("countedSpecials"))).toBe(false);
  });

  it("refuses the current month as not_past_month", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    expect((await recon(lake, "write", [reconBody("2026-10")]))[0].verdict).toEqual({ refused: "not_past_month" });
  });

  it("refuses a body carrying source as invalid_body, and handles each month on its own", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const results = await recon(lake, "write", [entry("2026-07"), reconBody("2026-08")]);
    expect(results[0].verdict).toMatchObject({ refused: "invalid_body" });
    expect(results[1].verdict).toBe("created");
  });

  it("replaces only an intact record it wrote, under its revision", async () => {
    const mine = storedRecord(entry("2026-08"), "reconstructed");
    const lake = createFakeFairnessSanity([...MEMBERS, mine]);
    const next = reconBody("2026-08", { expectedRev: "rev-0" });
    next.people[0].exempt = true;
    expect((await recon(lake, "write", [next]))[0].verdict).toBe("replaced");
    expect(lake.commits[0][0]).toMatchObject({ op: "patch", ifRevisionId: "rev-0" });
  });

  it("refuses a record the route wrote, and one edited after reconstruction", async () => {
    const theirs = storedRecord(entry("2026-08"), "manual");
    const edited = { ...storedRecord(entry("2026-07"), "reconstructed") } as FakeDoc;
    (edited.people as Array<{ exempt: boolean }>)[0].exempt = true;
    const lake = createFakeFairnessSanity([...MEMBERS, theirs, edited]);
    const b8 = reconBody("2026-08", { expectedRev: "rev-0" });
    b8.people[0].exempt = true;
    const results = await recon(lake, "write", [reconBody("2026-07", { expectedRev: "rev-0" }), b8]);
    expect(results.map((r) => r.verdict)).toEqual([{ refused: "record_edited" }, { refused: "not_reconstruction_owned" }]);
    expect(lake.commits).toEqual([]);
  });

  it("refuses member_unknown for a member with no document — its only live-member check", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const body = reconBody("2026-08");
    body.people[1] = { ...body.people[1], memberId: "m-ghost" };
    const kidsOk = reconBody("2026-07");
    kidsOk.people[1] = { ...kidsOk.people[1], memberId: "m-kids", roles: roles({ "Sun.Lead": "in" }) };
    const results = await recon(lake, "write", [kidsOk, body]);
    expect(results[0].verdict).toBe("created");
    expect(results[1]).toMatchObject({ verdict: { refused: "member_unknown" }, memberIds: ["m-ghost"] });
  });

  it("deletes as ONE transaction: a revision-asserting no-op patch, then the delete", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-08"), "reconstructed")]);
    const [result] = await recon(lake, "delete", [{ month: "2026-08", expectedRev: "rev-0" }]);
    expect(result.verdict).toBe("deleted");
    expect(lake.commits).toEqual([
      [
        { op: "patch", id: "fairnessMonth.2026-08", ifRevisionId: "rev-0", set: { month: "2026-08" } },
        { op: "delete", id: "fairnessMonth.2026-08" },
      ],
    ]);
    expect(lake.docs.has("fairnessMonth.2026-08")).toBe(false);
  });

  it("rolls a delete back when the revision moved", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-08"), "reconstructed")]);
    lake.failNext.commit = contentLakeConflict("documentRevisionIDDoesNotMatchError");
    const [result] = await recon(lake, "delete", [{ month: "2026-08", expectedRev: "rev-0" }]);
    expect(result.verdict).toEqual({ refused: "stale_revision" });
    expect(lake.docs.has("fairnessMonth.2026-08")).toBe(true);
  });

  it.each([
    ["D1: no record", [], "record_missing"],
    ["D2: a route-written record", [storedRecord(entry("2026-08"), "auto")], "not_reconstruction_owned"],
  ] as const)("refuses a delete — %s", async (_label, extra, refusal) => {
    const lake = createFakeFairnessSanity([...MEMBERS, ...extra]);
    const [result] = await recon(lake, "delete", [{ month: "2026-08", expectedRev: "rev-0" }]);
    expect(result.verdict).toEqual({ refused: refusal });
    expect(lake.commits).toEqual([]);
  });
});

describe("the module's own boundaries (WR-11, WR-13, WR-16)", () => {
  const SOURCE = stripComments(readFileSync(path.join(HERE, "../fairnessMonthWriteRequest.ts"), "utf8"));

  it("never calls createOrReplace", () => {
    expect(SOURCE).not.toMatch(/createOrReplace/);
  });

  it("has no side effect: imports nothing that notifies, queues or revalidates, and calls no after()", () => {
    const specifiers = [...SOURCE.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(specifiers).toEqual(
      [
        "node:crypto",
        "./fairnessVocabulary",
        "./serviceReadModel",
        "@/app/ministries",
        "@/app/components/admin/plannerModel",
        "./memberRuleNames",
        "./roleWriteRequest",
        "./serviceReadQueries",
        "@sanity/client",
      ].sort(),
    );
    expect(SOURCE).not.toMatch(/\brevalidate\w*\(|\bafter\(/);
  });

  it("holds no module-level client: Sanity enters as a TYPE only, and no server-only", () => {
    expect(SOURCE).not.toMatch(/from\s+["'](@\/)?sanity\/lib\//);
    expect(SOURCE).not.toMatch(/next-sanity|server-only|use client|createClient/);
    expect(SOURCE).toMatch(/import type \{ SanityClient, Transaction \} from "@sanity\/client";/);
  });
});
