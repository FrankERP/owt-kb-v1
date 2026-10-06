// `GET /api/admin/fairness` — solver v3 C2 RD-1 … RD-5 through the real route, the real
// reader and the real ledger, over an in-memory Content Lake whose reads run the real
// GROQ builders. The clock is pinned to 20 Oct 2026 (CDMX). Every name is fictitious.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeFairnessSanity, type FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { RECONSTRUCTION_RECORDED_BY, buildFairnessMonthDocument } from "@/app/utils/fairnessMonthWriteRequest";
import type { FairnessMonthWrite, RoleKey, Status } from "@/app/utils/fairnessVocabulary";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  lake: null as unknown as ReturnType<typeof import("@/app/utils/__tests__/__fixtures__/fakeFairnessSanity").createFakeFairnessSanity>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/authGuards", () => ({ requireActiveManager: () => h.requireActiveManager() }));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (query: string, params: Record<string, unknown>) => h.lake.read.fetch(query, params) },
}));

import { GET } from "@/app/api/admin/fairness/route";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
};
const MEMBERS: FakeDoc[] = [
  { _id: "m-alma", _type: "teamMembers", member_name: "Alma Ruiz", alias: "Alma", unavailableDates: [] },
  { _id: "m-bruno", _type: "teamMembers", member_name: "Bruno Díaz" },
  { _id: "m-carmen", _type: "teamMembers", member_name: "Carmen Soto" },
];

function body(month: string, ids = ["m-alma", "m-bruno", "m-carmen"]): FairnessMonthWrite {
  return {
    month,
    source: "auto",
    expectedRev: null,
    people: ids.map((memberId) => ({ memberId, roles: { ...OUT, "Sun.BGV": "in" as Status }, exactRules: [], exempt: false, blocks: [] })),
    presence: [],
  };
}
const stored = (month: string, ids?: string[]): FakeDoc =>
  ({
    ...buildFairnessMonthDocument({
      body: body(month, ids),
      source: "reconstructed",
      engine: "v2",
      environment: "local",
      recordedAt: `${month}-28T12:00:00.000Z`,
      recordedBy: RECONSTRUCTION_RECORDED_BY,
      names: new Map([["m-alma", "Alma"], ["m-bruno", "Bruno"], ["m-carmen", "Carmen"], ["m-gone", "Greta"]]),
    }),
  }) as unknown as FakeDoc;

const SERVICES: FakeDoc[] = [
  { _id: "sun-1004", _type: "sunday_role", week: "2026-10-04", published: false, BGVs: [{ _key: "a", _ref: "m-alma" }, { _key: "b", _ref: "m-bruno" }] },
  { _id: "sun-1011", _type: "sunday_role", week: "2026-10-11", BGVs: [{ _key: "a", _ref: "m-alma" }, { _key: "c", _ref: "m-carmen" }] },
];

const req = (query: string) => ({ nextUrl: new URL(`/api/admin/fairness?${query}`, "http://localhost") }) as unknown as NextRequest;
async function get(query: string) {
  const res = await GET(req(query));
  return { status: res.status, headers: res.headers, body: await res.json() };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T18:00:00.000Z"));
  vi.stubEnv("SANITY_API_READ_TOKEN", "test-read-token");
  vi.stubEnv("OWT_SOLVER_ENGINE", "");
  vi.stubEnv("VERCEL_ENV", "");
  h.requireActiveManager.mockResolvedValue({ user: { role: "admin", sanityId: "m-admin" } });
  h.lake = createFakeFairnessSanity([...MEMBERS, ...SERVICES, stored("2026-10")]);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  errors.mockRestore();
});

describe("the gate and the parameters (RD-4)", () => {
  it("answers 403 with no session and to a content-editor, reading nothing", async () => {
    h.requireActiveManager.mockResolvedValue(null);
    expect((await get("month=2026-11")).status).toBe(403);
    h.requireActiveManager.mockResolvedValue({ user: { role: "content-editor", sanityId: "m-ce" } });
    expect((await get("month=2026-11")).status).toBe(403);
    expect(h.lake.reads).toEqual([]);
  });

  it.each(["", "month=2026-13", "month=nov", "month=2026-11&horizon=3", "month=2026-11&horizon=0"])(
    "answers 400 invalid_request for %j",
    async (query) => {
      expect(await get(query)).toMatchObject({ status: 400, body: { error: "invalid_request" } });
    },
  );

  it("is dynamic", () => {
    expect(readFileSync(path.join(HERE, "../admin/fairness/route.ts"), "utf8")).toContain('export const dynamic = "force-dynamic";');
  });
});

describe("the payload (RD-1, RD-3, RD-5)", () => {
  it("answers the ledger with the engine, environment, current month, window and horizon, no-store", async () => {
    const res = await get("month=2026-11");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.body).toMatchObject({
      v: 1,
      engine: "v2",
      environment: "local",
      currentMonth: "2026-10",
      target: "2026-11",
      recordsSince: "2026-10",
      horizon: [{ month: "2026-11", record: null, storedServices: 0, recordBinds: false }],
    });
    expect(res.body.window.map((w: { month: string; record: unknown }) => [w.month, w.record !== null])).toEqual([
      ["2026-08", false],
      ["2026-09", false],
      ["2026-10", true],
    ]);
    // The draft (published: false) counts: Alma sat both Sundays, Bruno and Carmen one each.
    const alma = res.body.people.find((p: { memberId: string }) => p.memberId === "m-alma");
    expect(alma).toMatchObject({ name: "Alma", exists: true });
    expect(alma.window.BGV).toEqual({ share: 133, received: 200, balance: -67, seats: 2, tenths: { share: 13, balance: -7 } });
    expect(alma.months[2]).toMatchObject({ month: "2026-10", recorded: true, listed: true, held: { "Sun.BGV": 2 } });
    expect(alma).toMatchObject({ sang: 2, exempt: false, countedSundayLeads: [], firstRecordedIn: { "Sun.BGV": "2026-10" } });
    expect(res.body.people.map((p: { memberId: string }) => p.memberId)).toEqual(["m-alma", "m-bruno", "m-carmen"]);
  });

  it("names the horizon's records and decides recordBinds from freezing services only (A5, A6)", async () => {
    h.lake = createFakeFairnessSanity([
      ...MEMBERS,
      ...SERVICES,
      stored("2026-10"),
      stored("2026-11"),
      stored("2026-12"),
      { _id: "spc-1104", _type: "special_role", date: "2026-11-04" },
      { _id: "sun-1206", _type: "sunday_role", week: "2026-12-06" },
    ]);
    const res = await get("month=2026-11&horizon=2");
    expect(res.body.horizon.map((h: { month: string; storedServices: number; recordBinds: boolean }) => [h.month, h.storedServices, h.recordBinds])).toEqual([
      ["2026-11", 0, false],
      ["2026-12", 1, true],
    ]);
    expect(res.body.horizon[0].record).toMatchObject({ month: "2026-11", rev: "rev-0", source: "reconstructed", engine: "v2" });
    expect(res.body.horizon[0].record.people[0]).toMatchObject({ memberId: "m-alma", name: "Alma" });
  });

  it("is not a failure for a month without a record (F3)", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, ...SERVICES]);
    const res = await get("month=2026-11");
    expect(res.status).toBe(200);
    expect(res.body.recordsSince).toBeNull();
    expect(res.body.people.every((p: { window: object }) => Object.keys(p.window).length === 0)).toBe(true);
  });

  it("names a deleted member from her record and lists her as unknown", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, ...SERVICES, stored("2026-10", ["m-alma", "m-bruno", "m-carmen", "m-gone"])]);
    const res = await get("month=2026-11");
    expect(res.body.people.find((p: { memberId: string }) => p.memberId === "m-gone")).toMatchObject({ name: "Greta", exists: false });
    expect(res.body.diagnostics.unknownMembers).toEqual(["m-gone"]);
  });

  it("gives a byte-identical payload for the same data (determinism)", async () => {
    const first = JSON.stringify((await get("month=2026-11&horizon=2")).body);
    expect(JSON.stringify((await get("month=2026-11&horizon=2")).body)).toBe(first);
  });

  it("stays bounded at the limits: 100 people listed in three recorded months", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `m-${String(i).padStart(3, "0")}`);
    const members: FakeDoc[] = ids.map((id) => ({ _id: id, _type: "teamMembers", member_name: `Persona ${id}` }));
    const services: FakeDoc[] = ["2026-08-02", "2026-09-06", "2026-10-04"].map((week, i) => ({
      _id: `sun-${i}`,
      _type: "sunday_role",
      week,
      BGVs: ids.slice(0, 3).map((id, k) => ({ _key: `k${k}`, _ref: id })),
    }));
    const records = ["2026-08", "2026-09", "2026-10"].map((m) =>
      ({ ...buildFairnessMonthDocument({ body: body(m, ids), source: "auto", engine: "v3", environment: "production", recordedAt: "x", recordedBy: "m-admin", names: new Map(ids.map((id) => [id, id])) }) }) as unknown as FakeDoc,
    );
    h.lake = createFakeFairnessSanity([...members, ...services, ...records]);
    const res = await get("month=2026-11");
    expect(res.status).toBe(200);
    expect(res.body.people).toHaveLength(100);
    expect(JSON.stringify(res.body).length).toBeLessThan(1_000_000);
  });
});

describe("fail closed (RD-2)", () => {
  it.each(["", undefined])("refuses with the read token %j before any read, and has no people key", async (token) => {
    vi.stubEnv("SANITY_API_READ_TOKEN", token as string);
    const res = await get("month=2026-11");
    expect(res).toEqual(expect.objectContaining({ status: 500, body: { error: "fairness_unavailable", message: "No se pudo leer el saldo de equidad." } }));
    expect(h.lake.reads).toEqual([]);
  });

  it("refuses a rejected read, logging the error's class and status only", async () => {
    h.lake.failNext.fetch = Object.assign(new Error("request to https://x.api.sanity.io/?$ids=m-alma failed"), { statusCode: 503 });
    const res = await get("month=2026-11");
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty("people");
    const logged = errors.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain("Error 503");
    expect(logged).not.toContain("m-alma");
  });

  it("refuses a stored record missing a role field, logging an index-based path and no stored value (REC-7)", async () => {
    const broken = stored("2026-10");
    delete ((broken.people as Array<{ roles: Record<string, string> }>)[1].roles).sunBgv;
    h.lake = createFakeFairnessSanity([...MEMBERS, ...SERVICES, broken]);
    const res = await get("month=2026-11");
    expect(res.status).toBe(500);
    const logged = errors.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain("people[1].roles.sunBgv required field missing");
    expect(logged).not.toMatch(/m-alma|m-bruno|Alma|Bruno/);
  });

  it("refuses an unknown schemaVersion", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, ...SERVICES, { ...stored("2026-10"), schemaVersion: 2 }]);
    expect((await get("month=2026-11")).status).toBe(500);
  });
});
