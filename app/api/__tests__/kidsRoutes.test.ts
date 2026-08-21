// The `/api/kids/*` surface: pair roster, per-Sunday schedules, month proposal,
// kids member list and the manager-side availability override.
//
// Three properties are worth more than "the field round-trips", and each has a
// specific failure this file exists to make loud:
//
//   1. EVERY handler is behind `requireMinistryManager("kids")`. A worship
//      `admin` is not a Kids manager (two-way isolation, P1) — a route that
//      forgot the guard would hand the whole roster to the wrong ministry with
//      no error anywhere.
//   2. `PUT /api/kids/schedules` writes at the DETERMINISTIC id
//      `kidsSchedule-<date>` via `createIfNotExists` + `patch`. Anything else
//      forks a Sunday into two documents when a regenerate races a manual save,
//      and both look correct in isolation.
//   3. Seat legality is enforced SERVER-side. The planner's dropdowns scope the
//      options; a dropdown is not a control, and a cross-room or retired pair
//      arriving by any other route must be refused.
//
// Reads are not string-matched: the routes' real GROQ is PARSED AND EVALUATED
// with groq-js (the same engine Sanity runs) against a fixture dataset, so a
// filter written against the wrong default fails here rather than in production.
// The fixture carries a LEGACY member with no `ministries` field — every member
// predating the kids feature — because "absent means worship" is the rule the
// kids reads and the availability override must both agree with.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireMinistryManager: vi.fn(),
  created: [] as Record<string, unknown>[],
  createdIfNotExists: [] as Record<string, unknown>[],
  // `unsetCalls` counts the `.unset()` CALLS, which an empty `unset` array cannot
  // distinguish from never calling it — and `.unset([])` reaching the API is the
  // thing under test.
  patches: [] as {
    id: string;
    set: Record<string, unknown>;
    unset: string[];
    unsetCalls: number;
  }[],
  revalidateKidsViews: vi.fn(),
  operationalFetch: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireMinistryManager: (m: string) => h.requireMinistryManager(m),
}));

/** Runs a route's real GROQ against the fixture dataset. */
async function groq(query: string, params: Record<string, unknown> = {}) {
  const value = await evaluate(parse(query), { dataset: DATASET, params });
  return (await value.get()) as unknown;
}

function patchChain(id: string) {
  const record = { id, set: {} as Record<string, unknown>, unset: [] as string[], unsetCalls: 0 };
  h.patches.push(record);
  const chain = {
    set(v: Record<string, unknown>) {
      Object.assign(record.set, v);
      return chain;
    },
    unset(keys: string[]) {
      record.unsetCalls += 1;
      record.unset.push(...keys);
      return chain;
    },
    // The availability override commits under a revision precondition. The
    // ENFORCING fake — stale `_rev` throws a 409 and writes nothing — lives in
    // `kidsAvailabilityConflict.test.ts`; here it only has to not be a crash.
    ifRevisionId(_rev: string) {
      return chain;
    },
    commit: async () => ({ _id: id, _rev: "rev-2", ...record.set }),
  };
  return chain;
}

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (q: string, p?: Record<string, unknown>) => groq(q, p) },
  writeClient: {
    create: async (doc: Record<string, unknown>) => {
      h.created.push(doc);
      return { _id: "kidsPair-new", ...doc };
    },
    createIfNotExists: async (doc: Record<string, unknown>) => {
      h.createdIfNotExists.push(doc);
      return doc;
    },
    patch: (id: string) => patchChain(id),
  },
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (q: string, p?: Record<string, unknown>) => h.operationalFetch(q, p) },
}));

vi.mock("@/app/utils/revalidate", () => ({
  revalidateKidsViews: () => h.revalidateKidsViews(),
}));

const member = (id: string, name: string, ministries?: string[]) => ({
  _id: id,
  // The availability override's `ifRevisionId` precondition reads this.
  _rev: "rev-1",
  _type: "teamMembers",
  member_name: name,
  email: `${id}@example.com`,
  role: "member",
  ...(ministries ? { ministries } : {}),
});

const pair = (id: string, room: string, a: string, b: string, active?: boolean) => ({
  _id: id,
  _type: "kidsPair",
  name: id,
  room,
  ...(active === undefined ? {} : { active }),
  members: [
    { _type: "reference", _ref: a, _key: a },
    { _type: "reference", _ref: b, _key: b },
  ],
});

const ref = (id: string) => ({ _type: "reference", _ref: id });

const DATASET = [
  member("k1", "Kids Uno", ["kids"]),
  member("k2", "Kids Dos", ["kids"]),
  member("k3", "Kids Tres", ["kids"]),
  member("k4", "Kids Cuatro", ["kids"]),
  member("k5", "Kids Cinco", ["kids"]),
  member("k6", "Kids Seis", ["kids"]),
  member("k7", "Kids Siete", ["kids"]),
  member("k8", "Kids Ocho", ["kids"]),
  member("dual", "Ambos", ["worship", "kids"]),
  member("w1", "Solo Alabanza", ["worship"]),
  // No `ministries` field at all: every member predating the kids feature.
  member("legacy", "Ana Legado"),
  // A worship document that also has a `name` field — the shape a blind
  // `patch(id).set({ name })` from the pairs route would happily rename.
  { _id: "author-1", _type: "author", name: "Autor de Alabanza" },
  pair("p-chi-1", "chiquitos", "k1", "k2"),
  pair("p-chi-2", "chiquitos", "k3", "k4"),
  pair("p-med-1", "medianos", "k5", "k6"),
  pair("p-gra-1", "grandes", "k7", "k8"),
  // Retired: keeps its history, out of every rotation.
  pair("p-old", "chiquitos", "dual", "k1", false),
  {
    _id: "kidsSchedule-2026-08-30",
    _type: "kidsSchedule",
    date: "2026-08-30",
    published: true,
    ensenanza: ref("p-chi-1"),
    chiquitos: ref("p-chi-2"),
  },
  {
    _id: "kidsSchedule-2026-09-06",
    _type: "kidsSchedule",
    date: "2026-09-06",
    published: true,
    ensenanza: ref("p-med-1"),
    chiquitos: ref("p-chi-1"),
    medianos: ref("p-med-1"),
    grandes: ref("p-gra-1"),
  },
  // Written before `published` existed on the type — must read as a draft.
  { _id: "kidsSchedule-2026-09-13", _type: "kidsSchedule", date: "2026-09-13" },
];

import { GET as pairsGET, POST as pairsPOST } from "@/app/api/kids/pairs/route";
import { PATCH as pairPATCH } from "@/app/api/kids/pairs/[id]/route";
import { GET as schedulesGET, PUT as schedulesPUT } from "@/app/api/kids/schedules/route";
import {
  POST as generatePOST,
  MAX_SEED,
  MAX_SEED_ATTEMPTS,
} from "@/app/api/kids/generate/route";
import { GET as membersGET } from "@/app/api/kids/members/route";
import { PATCH as availabilityPATCH } from "@/app/api/kids/members/[id]/availability/route";

function req(body?: unknown, url = "http://localhost/api/kids"): NextRequest {
  return { json: async () => body, nextUrl: new URL(url) } as unknown as NextRequest;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function asManager() {
  h.requireMinistryManager.mockResolvedValue({ user: { sanityId: "kids-boss", role: "member" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.created.length = 0;
  h.createdIfNotExists.length = 0;
  h.patches.length = 0;
  h.operationalFetch.mockResolvedValue([]);
  asManager();
});

describe("/api/kids/* — the ministry guard", () => {
  // Named so a failure says which handler lost its guard.
  const handlers: [string, () => Promise<Response>][] = [
    ["GET /pairs", () => pairsGET()],
    ["POST /pairs", () => pairsPOST(req({ name: "X", room: "chiquitos", memberIds: ["k1", "k2"] }))],
    ["PATCH /pairs/[id]", () => pairPATCH(req({ active: false }), params("p-chi-1"))],
    ["GET /schedules", () => schedulesGET(req(undefined, "http://x/?month=2026-09"))],
    ["PUT /schedules", () => schedulesPUT(req({ date: "2026-09-06", seats: {} }))],
    ["POST /generate", () => generatePOST(req({ month: "2026-09" }))],
    ["GET /members", () => membersGET()],
    [
      "PATCH /members/[id]/availability",
      () => availabilityPATCH(req({ unavailableDates: [] }), params("k1")),
    ],
  ];

  it.each(handlers)("%s is 403 without kids management, and writes nothing", async (_n, call) => {
    h.requireMinistryManager.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(403);
    expect(h.created).toHaveLength(0);
    expect(h.patches).toHaveLength(0);
    expect(h.revalidateKidsViews).not.toHaveBeenCalled();
  });

  it.each(handlers)("%s asks for the kids ministry specifically", async (_n, call) => {
    await call();
    expect(h.requireMinistryManager).toHaveBeenCalledWith("kids");
  });
});

describe("GET /api/kids/pairs", () => {
  it("returns every pair, retired ones included and flagged", async () => {
    const body = (await (await pairsGET()).json()) as { id: string; active: boolean }[];
    expect(body.map((p) => p.id).sort()).toEqual([
      "p-chi-1",
      "p-chi-2",
      "p-gra-1",
      "p-med-1",
      "p-old",
    ]);
    expect(body.find((p) => p.id === "p-old")!.active).toBe(false);
    // Absent `active` (Studio's initialValue never ran) must read as active,
    // not as a pair silently dropped from every rotation.
    expect(body.find((p) => p.id === "p-chi-1")!.active).toBe(true);
  });

  it("projects the rotation shape the planner consumes", async () => {
    const body = (await (await pairsGET()).json()) as Record<string, unknown>[];
    expect(body.find((p) => p.id === "p-chi-1")).toMatchObject({
      id: "p-chi-1",
      room: "chiquitos",
      memberIds: ["k1", "k2"],
    });
  });
});

describe("POST /api/kids/pairs", () => {
  it("writes each member reference WITH a `_key` — the repo's array invariant", async () => {
    const res = await pairsPOST(req({ name: "Nueva", room: "medianos", memberIds: ["k1", "k5"] }));
    expect(res.status).toBe(201);
    expect(h.created[0]).toMatchObject({
      _type: "kidsPair",
      name: "Nueva",
      room: "medianos",
      active: true,
      members: [
        { _type: "reference", _ref: "k1", _key: "k1" },
        { _type: "reference", _ref: "k5", _key: "k5" },
      ],
    });
    expect(h.revalidateKidsViews).toHaveBeenCalled();
  });

  it("rejects an unknown room", async () => {
    const res = await pairsPOST(req({ name: "Nueva", room: "bebes", memberIds: ["k1", "k2"] }));
    expect(res.status).toBe(400);
    expect(h.created).toHaveLength(0);
  });

  it("rejects a repeated member — it would also collide the two `_key`s", async () => {
    const res = await pairsPOST(req({ name: "Nueva", room: "grandes", memberIds: ["k1", "k1"] }));
    expect(res.status).toBe(400);
    expect(h.created).toHaveLength(0);
  });

  it("rejects a pair that is not exactly two people", async () => {
    for (const memberIds of [["k1"], ["k1", "k2", "k3"], "k1", []]) {
      const res = await pairsPOST(req({ name: "Nueva", room: "grandes", memberIds }));
      expect(res.status).toBe(400);
    }
    expect(h.created).toHaveLength(0);
  });

  it("rejects a blank name", async () => {
    const res = await pairsPOST(req({ name: "   ", room: "grandes", memberIds: ["k1", "k2"] }));
    expect(res.status).toBe(400);
    expect(h.created).toHaveLength(0);
  });

  // A pair seat is a REFERENCE: two well-formed strings are not two people, and
  // the ids of the worship roster are enumerable by anyone who can call this.
  it("refuses to seat anyone who is not a kids member", async () => {
    for (const memberIds of [
      ["k1", "w1"], // a worship member
      ["k1", "legacy"], // absent `ministries` means worship
      ["k1", "ghost"], // not a document at all
      ["k1", "author-1"], // not even a member
    ]) {
      const res = await pairsPOST(req({ name: "Nueva", room: "grandes", memberIds }));
      expect(res.status).toBe(400);
    }
    expect(h.created).toHaveLength(0);
  });

  it("seats a dual-ministry member", async () => {
    const res = await pairsPOST(req({ name: "Nueva", room: "grandes", memberIds: ["k1", "dual"] }));
    expect(res.status).toBe(201);
  });
});

describe("PATCH /api/kids/pairs/[id]", () => {
  it("retires a pair without touching anything else", async () => {
    const res = await pairPATCH(req({ active: false }), params("p-chi-1"));
    expect(res.status).toBe(200);
    expect(h.patches[0]).toMatchObject({ id: "p-chi-1", set: { active: false } });
    expect(h.patches[0].set).not.toHaveProperty("name");
    expect(h.patches[0].set).not.toHaveProperty("members");
    expect(h.revalidateKidsViews).toHaveBeenCalled();
  });

  it("re-keys members on a swap", async () => {
    await pairPATCH(req({ memberIds: ["k3", "k7"] }), params("p-chi-1"));
    expect(h.patches[0].set.members).toEqual([
      { _type: "reference", _ref: "k3", _key: "k3" },
      { _type: "reference", _ref: "k7", _key: "k7" },
    ]);
  });

  it("rejects an unknown room and an empty body", async () => {
    expect((await pairPATCH(req({ room: "bebes" }), params("p-chi-1"))).status).toBe(400);
    expect((await pairPATCH(req({}), params("p-chi-1"))).status).toBe(400);
    expect(h.patches).toHaveLength(0);
  });

  // The id arrives in the PATH. Unchecked, `set({ name })` renames whatever it
  // points at — an `author` and a `tag` both carry a real `name`, and a Kids
  // manager reaches no worship data by design. 404, never 403: the answer must
  // not confirm the document exists.
  it("404s for an id that is not a kidsPair, and writes nothing", async () => {
    for (const id of ["author-1", "k1", "kidsSchedule-2026-09-06"]) {
      const res = await pairPATCH(req({ name: "Renombrado" }), params(id));
      expect(res.status).toBe(404);
    }
    expect(h.patches).toHaveLength(0);
  });

  it("404s for an id that does not exist, instead of throwing a 500", async () => {
    const res = await pairPATCH(req({ name: "Renombrado" }), params("ghost"));
    expect(res.status).toBe(404);
    expect(h.patches).toHaveLength(0);
  });

  it("refuses a swap that seats someone who is not a kids member", async () => {
    for (const memberIds of [["k1", "w1"], ["k1", "legacy"], ["k1", "ghost"]]) {
      const res = await pairPATCH(req({ memberIds }), params("p-chi-1"));
      expect(res.status).toBe(400);
    }
    expect(h.patches).toHaveLength(0);
  });
});

describe("GET /api/kids/schedules", () => {
  it("returns the month's Sundays with their seats", async () => {
    const res = await schedulesGET(req(undefined, "http://x/?month=2026-09"));
    const body = (await res.json()) as { date: string; seats: Record<string, string>; published: boolean }[];
    // August's row is a different month and must not leak into September.
    expect(body.map((r) => r.date)).toEqual(["2026-09-06", "2026-09-13"]);
    expect(body[0].seats).toEqual({
      ensenanza: "p-med-1",
      chiquitos: "p-chi-1",
      medianos: "p-med-1",
      grandes: "p-gra-1",
    });
    expect(body[0].published).toBe(true);
  });

  it("reads a document written before `published` existed as a DRAFT", async () => {
    const res = await schedulesGET(req(undefined, "http://x/?month=2026-09"));
    const body = (await res.json()) as { date: string; published: boolean; seats: object }[];
    const bare = body.find((r) => r.date === "2026-09-13")!;
    expect(bare.published).toBe(false);
    expect(bare.seats).toEqual({});
  });

  it("rejects a missing or malformed month", async () => {
    for (const url of ["http://x/", "http://x/?month=2026-9", "http://x/?month=2026-13"]) {
      expect((await schedulesGET(req(undefined, url))).status).toBe(400);
    }
  });
});

describe("PUT /api/kids/schedules", () => {
  const seats = {
    ensenanza: "p-chi-1",
    chiquitos: "p-chi-2",
    medianos: "p-med-1",
    grandes: "p-gra-1",
  };

  it("upserts at the deterministic id, so a regenerate cannot fork a Sunday", async () => {
    const res = await schedulesPUT(req({ date: "2026-09-20", seats, published: true }));
    expect(res.status).toBe(200);
    expect(h.createdIfNotExists[0]).toMatchObject({
      _id: "kidsSchedule-2026-09-20",
      _type: "kidsSchedule",
      date: "2026-09-20",
      published: false,
    });
    expect(h.patches[0].id).toBe("kidsSchedule-2026-09-20");
    expect(h.patches[0].set).toMatchObject({
      date: "2026-09-20",
      published: true,
      ensenanza: { _type: "reference", _ref: "p-chi-1" },
      grandes: { _type: "reference", _ref: "p-gra-1" },
    });
    expect(h.patches[0].unset).toEqual([]);
    expect(h.revalidateKidsViews).toHaveBeenCalled();
  });

  it("UNSETS an emptied seat instead of leaving a stale reference", async () => {
    await schedulesPUT(req({ date: "2026-09-20", seats: { ensenanza: "p-chi-1" } }));
    expect(h.patches[0].unsetCalls).toBe(1);
    expect(h.patches[0].unset).toEqual(["chiquitos", "medianos", "grandes"]);
    expect(h.patches[0].set).not.toHaveProperty("chiquitos");
  });

  // A full Sunday is the COMMON path, and `.unset([])` would be serialized into
  // the mutation verbatim. Nothing here proves the API rejects it — which is
  // exactly why the empty call must never be made.
  it("does not call `.unset()` at all when every seat is filled", async () => {
    await schedulesPUT(req({ date: "2026-09-20", seats }));
    expect(h.patches[0].unsetCalls).toBe(0);
    expect(h.patches[0].unset).toEqual([]);
  });

  it("leaves `published` alone when the body does not mention it", async () => {
    await schedulesPUT(req({ date: "2026-09-20", seats }));
    expect(h.patches[0].set).not.toHaveProperty("published");
  });

  it("refuses a cross-room seat — the dropdown is not the control", async () => {
    const res = await schedulesPUT(
      req({ date: "2026-09-20", seats: { chiquitos: "p-med-1" } }),
    );
    expect(res.status).toBe(400);
    expect(h.createdIfNotExists).toHaveLength(0);
    expect(h.patches).toHaveLength(0);
  });

  it("accepts ANY active pair for enseñanza, whatever its room", async () => {
    const res = await schedulesPUT(req({ date: "2026-09-20", seats: { ensenanza: "p-gra-1" } }));
    expect(res.status).toBe(200);
  });

  it("refuses a retired pair", async () => {
    const res = await schedulesPUT(req({ date: "2026-09-20", seats: { ensenanza: "p-old" } }));
    expect(res.status).toBe(400);
    expect(h.patches).toHaveLength(0);
  });

  it("refuses a pair id that does not exist", async () => {
    const res = await schedulesPUT(req({ date: "2026-09-20", seats: { ensenanza: "ghost" } }));
    expect(res.status).toBe(400);
    expect(h.patches).toHaveLength(0);
  });

  it("refuses the same pair in two seats on one Sunday", async () => {
    const res = await schedulesPUT(
      req({ date: "2026-09-20", seats: { ensenanza: "p-chi-1", chiquitos: "p-chi-1" } }),
    );
    expect(res.status).toBe(400);
    expect(h.patches).toHaveLength(0);
  });

  it("refuses an unknown seat name and a non-ISO date", async () => {
    expect(
      (await schedulesPUT(req({ date: "2026-09-20", seats: { bebes: "p-chi-1" } }))).status,
    ).toBe(400);
    expect((await schedulesPUT(req({ date: "20/09/2026", seats }))).status).toBe(400);
    expect((await schedulesPUT(req({ seats }))).status).toBe(400);
    expect(h.patches).toHaveLength(0);
  });
});

describe("POST /api/kids/generate", () => {
  it("proposes exactly the month's Sundays and writes NOTHING", async () => {
    const res = await generatePOST(req({ month: "2026-09" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      proposal: { date: string; seats: Record<string, string> }[];
    };
    // September 2026: the 6th, 13th, 20th and 27th — computed from a UTC-noon
    // anchor, so no timezone can shift one into the neighbouring day.
    expect(body.proposal.map((p) => p.date)).toEqual([
      "2026-09-06",
      "2026-09-13",
      "2026-09-20",
      "2026-09-27",
    ]);
    expect(h.created).toHaveLength(0);
    expect(h.createdIfNotExists).toHaveLength(0);
    expect(h.patches).toHaveLength(0);
    expect(h.revalidateKidsViews).not.toHaveBeenCalled();
  });

  it("seats room seats from their own room and never the retired pair", async () => {
    const res = await generatePOST(req({ month: "2026-09" }));
    const body = (await res.json()) as { proposal: { seats: Record<string, string> }[] };
    for (const { seats } of body.proposal) {
      expect(seats.chiquitos ?? "p-chi-1").toMatch(/^p-chi-/);
      expect(seats.medianos ?? "p-med-1").toBe("p-med-1");
      expect(Object.values(seats)).not.toContain("p-old");
    }
  });

  it("asks the worship read for PUBLISHED services only", async () => {
    await generatePOST(req({ month: "2026-09" }));
    expect(h.operationalFetch).toHaveBeenCalled();
    for (const [query] of h.operationalFetch.mock.calls) {
      expect(query).toMatch(/published\s*!=\s*false/);
    }
  });

  it("warns — never blocks — when a seated member also serves worship", async () => {
    h.operationalFetch.mockImplementation(async (_q: string, p: Record<string, unknown>) =>
      p.day === "2026-09-06" ? ["k5", "k6"] : [],
    );
    const res = await generatePOST(req({ month: "2026-09" }));
    const body = (await res.json()) as {
      proposal: { date: string; seats: Record<string, string> }[];
      warnings: { date: string; memberId: string; kind: string }[];
    };
    const first = body.proposal[0];
    expect(Object.keys(first.seats).length).toBeGreaterThan(0);
    expect(body.warnings.every((w) => w.kind === "worship-overlap")).toBe(true);
    if (Object.values(first.seats).includes("p-med-1")) {
      expect(body.warnings.some((w) => w.date === "2026-09-06" && w.memberId === "k5")).toBe(true);
    }
  });

  it("rejects a malformed month", async () => {
    expect((await generatePOST(req({ month: "septiembre" }))).status).toBe(400);
    expect((await generatePOST(req({}))).status).toBe(400);
  });

  // "Otra opción". The rotation is deterministic by design, so without a seed the
  // planner shows one month and no amount of clicking ever shows a second one.
  type Proposal = {
    proposal: { date: string; seats: Record<string, string> }[];
    seed: number;
    fingerprint: string | null;
    exhausted: boolean;
  };
  const propose = async (body: Record<string, unknown>) =>
    (await (await generatePOST(req({ month: "2026-09", ...body }))).json()) as Proposal;

  it("carries the seed, the plan's fingerprint and the exhausted flag", async () => {
    const body = await propose({});
    expect(body.seed).toBe(0);
    expect(typeof body.fingerprint).toBe("string");
    expect(body.exhausted).toBe(false);
  });

  it("seed 0 is the strict plan and is served even when already rejected", async () => {
    // The FAIREST month is what "Generar mes" means. Asking for it again must
    // return it, never search past it — only "otra opción" searches.
    const first = await propose({});
    const again = await propose({ seed: 0, exclude: [first.fingerprint] });
    expect(again.exhausted).toBe(false);
    expect(again.fingerprint).toBe(first.fingerprint);
  });

  it("an alternative never hands back a month the admin already rejected", async () => {
    const seen: string[] = [(await propose({})).fingerprint!];
    for (let ask = 1; ask <= 4; ask++) {
      const next = await propose({ seed: ask, exclude: seen });
      if (next.exhausted) {
        // Honest exhaustion: no proposal at all, so the board is left alone
        // rather than being redrawn with something already declined.
        expect(next.proposal).toEqual([]);
        expect(next.fingerprint).toBeNull();
        break;
      }
      expect(seen).not.toContain(next.fingerprint);
      expect(next.proposal.map((p) => p.date)).toEqual([
        "2026-09-06",
        "2026-09-13",
        "2026-09-20",
        "2026-09-27",
      ]);
      seen.push(next.fingerprint!);
    }
  });

  it("reports exhaustion, and says where to resume rather than dying there", async () => {
    // Named honestly: excluding seeds 0..24 is a SUPERSET of the window the route
    // walks, so reaching the exhausted branch here is arranged, not discovered.
    // What it pins is the branch's contract — no proposal, no fingerprint, and a
    // resume point past the searched window so a second ask is not the same ask.
    const seen = new Set<string>();
    for (let seed = 0; seed <= 24; seed++) {
      const body = await propose({ seed, exclude: [] });
      if (body.fingerprint) seen.add(body.fingerprint);
    }
    const body = await propose({ seed: 1, exclude: [...seen] });
    expect(body.exhausted).toBe(true);
    expect(body.proposal).toEqual([]);
    expect(body.fingerprint).toBeNull();
    // EXACTLY one past the window that was searched — not merely "further on".
    // A resume that advances by less re-tests seeds already known to be excluded,
    // and the admin gets "no hay más opciones" over and over while the search
    // crawls forward one seat at a time.
    expect(body.seed).toBe(1 + MAX_SEED_ATTEMPTS);
  });

  it("refuses a malformed seed instead of quietly serving the fairest month", async () => {
    // Coercing to 0 would hand back the board the admin is already looking at,
    // labelled `exhausted: false` — a dead button that reports success.
    //
    // `null` is in this list deliberately: it is the wire form of a client-side
    // NaN cursor (`JSON.stringify({seed: NaN})` → `{"seed":null}`), so refusing
    // it here is what makes this guard independent of the planner's own.
    for (const seed of ["3", -1, Number.NaN, Number.POSITIVE_INFINITY, {}, null]) {
      const res = await generatePOST(req({ month: "2026-09", seed }));
      expect(res.status).toBe(400);
    }
    // An OMITTED seed keeps meaning "the fairest month".
    expect((await generatePOST(req({ month: "2026-09" }))).status).toBe(200);
  });

  it("keeps the whole search window on distinct integers at the seed ceiling", async () => {
    // Past 2^53 the spacing between doubles is 2, so an unclamped ceiling would
    // collapse the 12-seed walk onto ~6 values: duplicates re-tested, and
    // exhaustion reported while alternatives remain.
    const window = Array.from({ length: MAX_SEED_ATTEMPTS }, (_, i) => MAX_SEED + i);
    expect(new Set(window).size).toBe(MAX_SEED_ATTEMPTS);
    expect(Number.isSafeInteger(MAX_SEED + MAX_SEED_ATTEMPTS)).toBe(true);

    // And a seed above the ceiling is clamped rather than refused.
    const body = await propose({ seed: Number.MAX_SAFE_INTEGER, exclude: [] });
    expect(body.seed).toBeLessThanOrEqual(MAX_SEED);
  });

  it("writes nothing under a seed either — the alternative is still a proposal", async () => {
    await propose({ seed: 3, exclude: [] });
    expect(h.created).toHaveLength(0);
    expect(h.createdIfNotExists).toHaveLength(0);
    expect(h.patches).toHaveLength(0);
    expect(h.revalidateKidsViews).not.toHaveBeenCalled();
  });
});

describe("GET /api/kids/members", () => {
  it("returns kids members only — a worship member is not one of them", async () => {
    const body = (await (await membersGET()).json()) as { _id: string }[];
    const ids = body.map((m) => m._id);
    expect(ids).toContain("k1");
    // Dual membership counts.
    expect(ids).toContain("dual");
    expect(ids).not.toContain("w1");
    // Absent `ministries` normalizes to worship-only, never to kids.
    expect(ids).not.toContain("legacy");
  });

  it("projects the fields the picker and availability panel need", async () => {
    const body = (await (await membersGET()).json()) as Record<string, unknown>[];
    expect(body[0]).toHaveProperty("member_name");
    expect(body[0]).toHaveProperty("unavailableDates");
  });
});

describe("PATCH /api/kids/members/[id]/availability", () => {
  it("stores only well-formed dates, and notes keyed by their date", async () => {
    const res = await availabilityPATCH(
      req({
        _rev: "rev-1",
        unavailableDates: ["2026-09-06", "no-es-fecha", "2026-09-20"],
        unavailabilityNotes: [
          { date: "2026-09-06", note: "  Viaje  " },
          { date: "2026-09-13", note: "sin fecha válida" },
          { date: "2026-09-06", note: "duplicada" },
        ],
      }),
      params("k1"),
    );
    expect(res.status).toBe(200);
    expect(h.patches[0]).toMatchObject({
      id: "k1",
      set: {
        unavailableDates: ["2026-09-06", "2026-09-20"],
        unavailabilityNotes: [{ _key: "2026-09-06", date: "2026-09-06", note: "Viaje" }],
      },
    });
    expect(h.revalidateKidsViews).toHaveBeenCalled();
  });

  it("404s for a worship member — a kids manager may not touch them", async () => {
    const res = await availabilityPATCH(req({ unavailableDates: ["2026-09-06"] }), params("w1"));
    expect(res.status).toBe(404);
    expect(h.patches).toHaveLength(0);
  });

  it("404s for a member with NO `ministries` field — absent means worship", async () => {
    const res = await availabilityPATCH(req({ unavailableDates: [] }), params("legacy"));
    expect(res.status).toBe(404);
    expect(h.patches).toHaveLength(0);
  });

  it("404s for an id that does not exist", async () => {
    const res = await availabilityPATCH(req({ unavailableDates: [] }), params("ghost"));
    expect(res.status).toBe(404);
    expect(h.patches).toHaveLength(0);
  });

  it("accepts a dual-ministry member", async () => {
    const res = await availabilityPATCH(
      req({ _rev: "rev-1", unavailableDates: ["2026-09-06"] }),
      params("dual"),
    );
    expect(res.status).toBe(200);
    expect(h.patches[0].id).toBe("dual");
  });

  it("rejects a body without an array of dates, before writing", async () => {
    const res = await availabilityPATCH(
      req({ _rev: "rev-1", unavailableDates: "2026-09-06" }),
      params("k1"),
    );
    expect(res.status).toBe(400);
    expect(h.patches).toHaveLength(0);
  });
});
