// `PUT /api/admin/fairness/months` — solver v3 C2 WR-1 … WR-12 through the real route,
// the real commit module and the real executor, over an in-memory Content Lake whose
// reads run the real GROQ builders. The clock is pinned to 20 Oct 2026 (CDMX), so the
// current month is 2026-10. Every name is fictitious (this repository is public).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeFairnessSanity, contentLakeConflict, type FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { buildFairnessMonthDocument } from "@/app/utils/fairnessMonthWriteRequest";
import type { FairnessMonthWrite, RoleKey, Status } from "@/app/utils/fairnessVocabulary";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  lake: null as unknown as ReturnType<typeof import("@/app/utils/__tests__/__fixtures__/fakeFairnessSanity").createFakeFairnessSanity>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/authGuards", () => ({ requireActiveManager: () => h.requireActiveManager() }));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: {
    config: () => h.lake.read.config(),
    fetch: (query: string, params: Record<string, unknown>) => h.lake.read.fetch(query, params),
  },
}));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: () => h.lake.write.transaction() },
}));

import { PUT } from "@/app/api/admin/fairness/months/route";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
};
const MEMBERS: FakeDoc[] = [
  { _id: "m-alma", _type: "teamMembers", member_name: "Alma Ruiz", alias: "Alma", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", _type: "teamMembers", member_name: "Bruno Díaz", memberType: ["voz", "support"] },
];

function entry(month: string, patch: Partial<FairnessMonthWrite> = {}): FairnessMonthWrite {
  return {
    month,
    source: "manual",
    expectedRev: null,
    people: [
      { memberId: "m-alma", roles: { ...OUT, "Sun.Lead": "in" }, exactRules: [], exempt: false, blocks: [] },
      { memberId: "m-bruno", roles: { ...OUT, "Sun.BGV": "in" }, exactRules: [], exempt: false, blocks: [] },
    ],
    presence: [],
    ...patch,
  };
}

function record(body: FairnessMonthWrite): FakeDoc {
  return buildFairnessMonthDocument({
    body,
    source: "auto",
    engine: "v3",
    environment: "production",
    recordedAt: "2026-10-03T15:00:00.000Z",
    recordedBy: "m-other-admin",
    names: new Map([["m-alma", "Alma"], ["m-bruno", "Bruno Díaz"]]),
  }) as unknown as FakeDoc;
}

const req = (body: unknown) =>
  ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;
const badJson = () =>
  ({ json: async () => { throw new SyntaxError("x"); }, headers: new Headers() }) as unknown as NextRequest;

const session = (role: string, sanityId = "m-admin") => ({ user: { role, sanityId } });

async function put(body: unknown) {
  const res = await PUT(req(body));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T18:00:00.000Z"));
  vi.stubEnv("OWT_SOLVER_ENGINE", "v3");
  vi.stubEnv("VERCEL_ENV", "");
  h.requireActiveManager.mockResolvedValue(session("admin"));
  h.lake = createFakeFairnessSanity(MEMBERS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the gate (WR-2)", () => {
  it("answers 403 with no session", async () => {
    h.requireActiveManager.mockResolvedValue(null);
    expect((await put({ months: [entry("2026-11")] })).status).toBe(403);
    expect(h.lake.reads).toEqual([]);
  });

  it("answers 403 forbidden to a content-editor", async () => {
    h.requireActiveManager.mockResolvedValue(session("content-editor"));
    const res = await put({ months: [entry("2026-11")] });
    expect(res).toMatchObject({ status: 403, body: { error: "forbidden" } });
    expect(h.lake.reads).toEqual([]);
  });

  it.each(["admin", "super-admin"])("lets %s write, stamping recordedBy with the session's effective id", async (role) => {
    h.requireActiveManager.mockResolvedValue(session(role, "m-effective"));
    const res = await put({ months: [entry("2026-11")] });
    expect(res.status).toBe(200);
    expect(h.lake.docs.get("fairnessMonth.2026-11")?.recordedBy).toBe("m-effective");
  });
});

describe("the engine gate (WR-6)", () => {
  it("refuses engine_not_v3 under the constant, reading and writing nothing", async () => {
    vi.stubEnv("OWT_SOLVER_ENGINE", "");
    const res = await put({ months: [entry("2026-11")] });
    expect(res).toMatchObject({ status: 409, body: { conflict: true, details: { detail: "engine_not_v3", months: [] } } });
    expect(h.lake.reads).toEqual([]);
  });

  it("ignores the override on production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await put({ months: [entry("2026-11")] })).body.details.detail).toBe("engine_not_v3");
  });
});

describe("the body (WR-3, WR-4)", () => {
  it("answers 400 on a body that is not JSON", async () => {
    const res = await PUT(badJson());
    expect(res.status).toBe(400);
  });

  it.each([
    ["an unknown top-level field", { months: [entry("2026-11")], force: true }, ["force"]],
    ["no months", { months: [] }, ["months"]],
    ["three months", { months: [entry("2026-11"), entry("2026-12"), entry("2027-01")] }, ["months"]],
    ["two months that are not consecutive", { months: [entry("2026-11"), entry("2027-01")] }, ["months[1].month"]],
    ["two months out of order", { months: [entry("2026-12"), entry("2026-11")] }, ["months[1].month"]],
    ["a server stamp", { months: [{ ...entry("2026-11"), recordedBy: "m-alma" }] }, ["months[0].recordedBy"]],
    ["source reconstructed", { months: [{ ...entry("2026-11"), source: "reconstructed" }] }, ["months[0].source"]],
    ["a month past current + 12", { months: [entry("2027-11")] }, ["months[0].month"]],
  ])("answers 400 invalid_request on %s, naming each path", async (_label, body, paths) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.details.issues.map((i: { path: string }) => i.path)).toEqual(paths);
    expect(h.lake.reads).toEqual([]);
  });
});

describe("the decision and the commit (WR-7 … WR-12)", () => {
  it("creates and answers each month's outcome, revision, hash and recordedAt", async () => {
    const res = await put({ months: [entry("2026-11"), entry("2026-12")] });
    expect(res.status).toBe(200);
    expect(res.body.months.map((m: { outcome: string; rev: string }) => [m.outcome, m.rev])).toEqual([
      ["created", "tx-1"],
      ["created", "tx-1"],
    ]);
    expect(res.body.months[0]).toMatchObject({ month: "2026-11", recordedAt: "2026-10-20T18:00:00.000Z" });
    expect(res.body.months[0].contentHash).toMatch(/^sha256:/);
    expect(h.lake.docs.get("fairnessMonth.2026-11")).toMatchObject({ environment: "local", engine: "v3" });
  });

  it("creates an unrecorded month with stored weekend services and a counted special (A27)", async () => {
    h.lake = createFakeFairnessSanity([
      ...MEMBERS,
      { _id: "sun-1", _type: "sunday_role", week: "2026-11-01" },
      { _id: "spc-1", _type: "special_role", date: "2026-11-04", countsForFairness: true },
    ]);
    expect((await put({ months: [entry("2026-11")] })).body.months[0].outcome).toBe("created");
  });

  it("replaces a recorded month whose only service is an uncounted special; refuses with a counted one (A5, A6)", async () => {
    const changed = entry("2026-11", { expectedRev: "rev-0" });
    changed.people[1].exempt = true;
    h.lake = createFakeFairnessSanity([...MEMBERS, record(entry("2026-11")), { _id: "spc-1", _type: "special_role", date: "2026-11-04" }]);
    expect((await put({ months: [changed] })).body.months[0].outcome).toBe("replaced");
    h.lake = createFakeFairnessSanity([
      ...MEMBERS,
      record(entry("2026-11")),
      { _id: "spc-1", _type: "special_role", date: "2026-11-04", countsForFairness: true },
    ]);
    const refused = await put({ months: [changed] });
    expect(refused).toMatchObject({ status: 409, body: { error: "integrity_conflict", details: { detail: "month_has_services" } } });
  });

  it("refuses record_exists with the current record's rev, source and recordedAt", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, record(entry("2026-11"))]);
    const changed = entry("2026-11");
    changed.people[0].exempt = true;
    const res = await put({ months: [changed] });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: "stale_revision",
      conflict: true,
      details: {
        detail: "record_exists",
        months: [{ month: "2026-11", verdict: "record_exists" }],
        rev: "rev-0",
        source: "auto",
        recordedAt: "2026-10-03T15:00:00.000Z",
      },
    });
  });

  it("writes nothing when the months' verdicts differ, and names the earlier month's (WR-9)", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, record(entry("2026-11"))]);
    const nov = entry("2026-11", { expectedRev: "rev-stale" });
    nov.people[0].exempt = true;
    const dec = entry("2026-12");
    dec.people[1] = { ...dec.people[1], memberId: "m-ghost" };
    const res = await put({ months: [nov, dec] });
    expect(res.body.details).toMatchObject({
      detail: "stale_revision",
      months: [
        { month: "2026-11", verdict: "stale_revision" },
        { month: "2026-12", verdict: "member_unknown" },
      ],
    });
    expect(h.lake.commits).toEqual([]);
  });

  it("refuses a member whose Tipo does not fit as integrity_conflict tipo_mismatch, with the ids (WR-5)", async () => {
    const body = entry("2026-11");
    body.people[1].roles["Sun.Lead"] = "in";
    const res = await put({ months: [body] });
    expect(res).toMatchObject({
      status: 409,
      body: { error: "integrity_conflict", details: { detail: "tipo_mismatch", memberIds: ["m-bruno"] } },
    });
  });

  it("answers an identical replay 200 unchanged with no transaction, even across a month boundary", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, record(entry("2026-09"))]);
    const res = await put({ months: [entry("2026-09", { expectedRev: "rev-0" })] });
    expect(res).toMatchObject({ status: 200, body: { months: [{ month: "2026-09", outcome: "unchanged", rev: "rev-0" }] } });
    expect(h.lake.commits).toEqual([]);
  });

  it("reports a transaction's 409 on every written month, never as a server fault (WR-11)", async () => {
    h.lake.failNext.commit = contentLakeConflict();
    const res = await put({ months: [entry("2026-11"), entry("2026-12")] });
    expect(res).toMatchObject({
      status: 409,
      body: {
        error: "stale_revision",
        details: {
          detail: "stale_revision",
          cause: "commit_conflict",
          months: [
            { month: "2026-11", verdict: "stale_revision" },
            { month: "2026-12", verdict: "stale_revision" },
          ],
        },
      },
    });
  });

  it("maps a commit's already_exists to record_exists", async () => {
    h.lake.failNext.commit = contentLakeConflict("documentAlreadyExistsError");
    const res = await put({ months: [entry("2026-11")] });
    expect(res.body.details).toMatchObject({ detail: "record_exists", months: [{ month: "2026-11", verdict: "record_exists" }] });
    expect(res.body.details).not.toHaveProperty("rev");
  });

  it("omits rev/source/recordedAt on a commit-time record_exists whose first month is a replace (IF2-5)", async () => {
    const changed = entry("2026-11", { expectedRev: "rev-0" });
    changed.people[1].exempt = true;
    h.lake = createFakeFairnessSanity([...MEMBERS, record(entry("2026-11"))]);
    h.lake.failNext.commit = contentLakeConflict("documentAlreadyExistsError");
    const res = await put({ months: [changed, entry("2026-12")] });
    expect(res.status).toBe(409);
    expect(res.body.details.detail).toBe("record_exists");
    for (const k of ["rev", "source", "recordedAt"]) expect(res.body.details).not.toHaveProperty(k);
  });

  it("throws (500) on an error that is not a 409 mutation conflict", async () => {
    h.lake.failNext.commit = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    await expect(PUT(req({ months: [entry("2026-11")] }))).rejects.toThrow("Unauthorized");
  });

  it("throws (500) before any read when the read token is missing", async () => {
    h.lake = createFakeFairnessSanity(MEMBERS, { perspective: "published", useCdn: false });
    await expect(PUT(req({ months: [entry("2026-11")] }))).rejects.toThrow(/read token/);
    expect(h.lake.reads).toEqual([]);
  });
});

describe("the route's own shape (WR-1, WR-13, WR-14)", () => {
  const SOURCE = readFileSync(path.join(HERE, "../admin/fairness/months/route.ts"), "utf8");

  it("delegates to the commit module and is wrapped in the run context", () => {
    expect(SOURCE).toMatch(/export const PUT = withVerificationRunContext\(putHandler\);/);
    expect(SOURCE).toContain('from "@/app/utils/fairnessMonthCommit"');
  });

  it("never selects the reconstruction actor and exports no DELETE", () => {
    const commit = readFileSync(path.join(HERE, "../../utils/fairnessMonthCommit.ts"), "utf8");
    expect(commit).toMatch(/actor: "route"/);
    expect(commit).not.toMatch(/actor: "reconstruction"|op: "delete"/);
    expect(SOURCE).not.toMatch(/export (const|async function) DELETE/);
  });
});
