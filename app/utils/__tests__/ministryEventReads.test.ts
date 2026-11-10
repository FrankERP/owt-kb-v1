// The read contract of `ministryEvent` (ADR-0081; plan
// `docs/superpowers/plans/2026-10-30-jovenes-events-access.md` §4, guards G2 and G3).
//
// G3 is the one that matters: the query `readMinistryEvents` builds is PARSED AND EVALUATED with
// groq-js (the engine Sanity's own tooling uses; precedent `adminMemberVisibility.test.ts`) over one
// fixture matrix of people × events, the expected visibility is written out by hand, and `mayRead`
// (the same rule in TypeScript) must agree with the GROQ on every pair. No hand-written evaluator:
// a twin of the query would test the twin.
//
// groq-js diverges from Content Lake on `path()` (1.30.2 does not escape the `.`), so the matrix
// holds no id that starts with `ministryEvent` and then a non-dot; `mayRead`'s prefix rule is pinned
// separately on such ids, and the live engine is probed on dev (G6).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (q: string, p?: Record<string, unknown>) => h.fetch(q, p) },
}));
// `accessFromDoc` lives beside the cached reader; nothing here reads through it.
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: vi.fn() } }));

import {
  buildMinistryEventQuery,
  mayRead,
  MinistryEventReadUnavailable,
  readMinistryEvents,
  type MinistryEventMode,
  type StoredMinistryEvent,
} from "../ministryEventReads";
import { accessFromDoc, type MemberAccessDoc } from "../memberAccess";

// ── People ──────────────────────────────────────────────────────────────────

const J = (level: string, groups: string[]) => [{ ministry: "jovenes", level, groups }];

/** Stored member documents, run through the real normalization the guards read. */
const PEOPLE_DOCS: Record<string, MemberAccessDoc> = {
  pastorON: { _id: "p1", ministries: ["jovenes"], ministryRoles: J("member", ["otro-nivel"]) },
  pastorEM: { _id: "p2", ministries: ["jovenes"], ministryRoles: J("member", ["emprendedores"]) },
  pastorTwo: { _id: "p3", ministries: ["jovenes"], ministryRoles: J("member", ["otro-nivel", "invencibles"]) },
  pastorNoGroups: { _id: "p4", ministries: ["jovenes"] },
  pastorUnknownGroup: { _id: "p5", ministries: ["jovenes"], ministryRoles: J("member", ["foo"]) },
  leaderON: { _id: "l1", ministries: ["jovenes"], ministryRoles: J("leader", ["otro-nivel"]) },
  leaderTwo: { _id: "l2", ministries: ["jovenes"], ministryRoles: J("leader", ["otro-nivel", "emprendedores"]) },
  admin: { _id: "a1", ministries: ["jovenes"], ministryRoles: J("admin", []) },
  // The super-admin who is also a leader: member mode reads as their groups, editor mode reads all.
  superLeader: { _id: "s2", role: "super-admin", ministries: ["worship", "jovenes"], ministryRoles: J("leader", ["emprendedores"]) },
  superAdmin: { _id: "s1", role: "super-admin", ministries: ["worship"] },
  inactiveAdmin: { _id: "x1", disabled: true, ministries: ["jovenes"], ministryRoles: J("admin", ["otro-nivel"]) },
  worshipOnly: { _id: "w1", ministries: ["worship"] },
  worshipAdmin: { _id: "w2", role: "admin", ministries: ["worship"] },
  // A level in Jóvenes without being in Jóvenes grants nothing (ADR-0075).
  levelWithoutMinistry: { _id: "w3", ministries: ["kids"], ministryRoles: J("admin", ["otro-nivel"]) },
};
const PEOPLE = Object.fromEntries(Object.entries(PEOPLE_DOCS).map(([k, d]) => [k, accessFromDoc(d)]));

// ── Events ──────────────────────────────────────────────────────────────────

const ev = (key: string, fields: Record<string, unknown>) => ({
  _id: `ministryEvent.${key}`,
  _type: "ministryEvent",
  ministry: "jovenes",
  date: "2026-11-14",
  ...fields,
});
const groups = (...g: unknown[]) => ({ kind: "groups", groups: g });
const PUB = { published: true };
const DRAFT = { published: false };

/** Keyed by a short name; the expected table below names events by these keys. */
const EVENTS: Record<string, Record<string, unknown>> = {
  ministry: ev("ministry", { ...PUB, audience: { kind: "ministry" } }),
  on: ev("on", { ...PUB, audience: groups("otro-nivel") }),
  inv: ev("inv", { ...PUB, audience: groups("invencibles") }),
  em: ev("em", { ...PUB, audience: groups("emprendedores") }),
  onEm: ev("onEm", { ...PUB, audience: groups("otro-nivel", "emprendedores") }),
  onInv: ev("onInv", { ...PUB, audience: groups("otro-nivel", "invencibles") }),
  invEm: ev("invEm", { ...PUB, audience: groups("invencibles", "emprendedores") }),
  // `kind` decides; stray `groups` on a whole-ministry audience change nothing.
  ministryWithGroups: ev("ministryWithGroups", { ...PUB, audience: { kind: "ministry", groups: ["emprendedores"] } }),
  draftON: ev("draftON", { ...DRAFT, audience: groups("otro-nivel") }),
  draftEM: ev("draftEM", { ...DRAFT, audience: groups("emprendedores") }),
  draftOnEm: ev("draftOnEm", { ...DRAFT, audience: groups("otro-nivel", "emprendedores") }),
  draftMinistry: ev("draftMinistry", { ...DRAFT, audience: { kind: "ministry" } }),
  // `published` absent reads as a draft, never as published.
  publishedAbsentON: ev("publishedAbsentON", { audience: groups("otro-nivel") }),
  // Only the boolean `true` publishes.
  publishedStringON: ev("publishedStringON", { published: "true", audience: groups("otro-nivel") }),
  // Read CLOSED: every malformed audience is no member's.
  noAudience: ev("noAudience", { ...PUB }),
  groupsAbsent: ev("groupsAbsent", { ...PUB, audience: { kind: "groups" } }),
  groupsEmpty: ev("groupsEmpty", { ...PUB, audience: groups() }),
  groupsString: ev("groupsString", { ...PUB, audience: { kind: "groups", groups: "otro-nivel" } }),
  unknownGroup: ev("unknownGroup", { ...PUB, audience: groups("foo") }),
  unknownKind: ev("unknownKind", { ...PUB, audience: { kind: "everyone", groups: ["otro-nivel"] } }),
  audienceString: ev("audienceString", { ...PUB, audience: "ministry" }),
  audienceArray: ev("audienceArray", { ...PUB, audience: [{ kind: "ministry" }] }),
  // A valid group among junk still counts; the junk never does.
  mixedGroups: ev("mixedGroups", { ...PUB, audience: groups("otro-nivel", 3, "otro-nivel", null) }),
  // Never served by the app, to anyone: wrong id shape, wrong type, other ministry.
  undottedId: { ...ev("x", { ...PUB, audience: { kind: "ministry" } }), _id: "jovenes-event-1" },
  draftsId: { ...ev("x", { ...PUB, audience: { kind: "ministry" } }), _id: "drafts.ministryEvent.d1" },
  wrongType: { ...ev("wrongType", { ...PUB, audience: { kind: "ministry" } }), _type: "kidsSchedule" },
  otherMinistry: ev("otherMinistry", { ...PUB, ministry: "kids", audience: { kind: "ministry" } }),
  ministryAbsent: { ...ev("ministryAbsent", { ...PUB, audience: { kind: "ministry" } }), ministry: undefined },
};

const KEY_OF_ID = new Map(Object.entries(EVENTS).map(([k, e]) => [e._id as string, k]));

/** Every well-formed published event of the ministry, as each audience sees it. */
const SEEN_BY_ALL_MEMBERS = ["ministry", "ministryWithGroups"];
const PUBLISHED_FOR = {
  on: [...SEEN_BY_ALL_MEMBERS, "on", "onEm", "onInv", "mixedGroups"],
  em: [...SEEN_BY_ALL_MEMBERS, "em", "onEm", "invEm"],
  onInv: [...SEEN_BY_ALL_MEMBERS, "on", "inv", "onEm", "onInv", "invEm", "mixedGroups"],
  onEm: [...SEEN_BY_ALL_MEMBERS, "on", "em", "onEm", "onInv", "invEm", "mixedGroups"],
};
/** Every event of the ministry with a valid id, published or not, well-formed or not. */
const EVERY_JOVENES_EVENT = Object.keys(EVENTS).filter(
  (k) => !["undottedId", "draftsId", "wrongType", "otherMinistry", "ministryAbsent"].includes(k),
);

/** THE visibility table, written by hand. A person/mode missing here sees nothing. */
const EXPECTED: Record<string, Partial<Record<MinistryEventMode, string[]>>> = {
  pastorON: { member: PUBLISHED_FOR.on },
  pastorEM: { member: PUBLISHED_FOR.em },
  pastorTwo: { member: PUBLISHED_FOR.onInv },
  pastorNoGroups: { member: SEEN_BY_ALL_MEMBERS },
  pastorUnknownGroup: { member: SEEN_BY_ALL_MEMBERS },
  leaderON: {
    member: PUBLISHED_FOR.on,
    // Every draft that includes their group — a joint one included, though W3 may refuse its write —
    // and never the Emprendedores-only draft or a whole-ministry draft.
    editor: [...PUBLISHED_FOR.on, "draftON", "draftOnEm", "publishedAbsentON", "publishedStringON"],
  },
  leaderTwo: {
    member: PUBLISHED_FOR.onEm,
    editor: [...PUBLISHED_FOR.onEm, "draftON", "draftEM", "draftOnEm", "publishedAbsentON", "publishedStringON"],
  },
  admin: { member: SEEN_BY_ALL_MEMBERS, editor: EVERY_JOVENES_EVENT },
  superAdmin: { member: SEEN_BY_ALL_MEMBERS, editor: EVERY_JOVENES_EVENT },
  superLeader: { member: PUBLISHED_FOR.em, editor: EVERY_JOVENES_EVENT },
};

// ── Engine ──────────────────────────────────────────────────────────────────

const MEMBER_DOCS = [
  { _id: "p1", _type: "teamMembers", member_name: "Pastor Uno" },
  { _id: "l1", _type: "teamMembers", member_name: "Líder Uno", alias: "Lu" },
];
const DATASET = [...Object.values(EVENTS), ...MEMBER_DOCS];

async function groq(query: string, params: Record<string, unknown> = {}, dataset: unknown[] = DATASET) {
  const value = await evaluate(parse(query), { dataset, params });
  return (await value.get()) as unknown;
}

const WINDOW = { from: "2026-11-01", to: "2026-11-30" };
const MODES: MinistryEventMode[] = ["member", "editor"];

async function visibleKeys(person: string, mode: MinistryEventMode): Promise<string[]> {
  const rows = await readMinistryEvents(PEOPLE[person], { me: "nobody", ministry: "jovenes", mode, ...WINDOW });
  return rows.map((r) => KEY_OF_ID.get(r._id) ?? `?${r._id}`).sort();
}

beforeEach(() => {
  h.fetch.mockReset();
  h.fetch.mockImplementation((q: string, p?: Record<string, unknown>) => groq(q, p));
  vi.stubEnv("SANITY_API_READ_TOKEN", "test-read-token");
});
afterEach(() => vi.unstubAllEnvs());

// ── G3 ──────────────────────────────────────────────────────────────────────

describe("G3: isolation matrix on the real engine", () => {
  for (const person of Object.keys(PEOPLE)) {
    for (const mode of MODES) {
      const expected = [...(EXPECTED[person]?.[mode] ?? [])].sort();

      it(`${person} in ${mode} mode reads exactly ${expected.length ? expected.join(", ") : "nothing"}`, async () => {
        expect(await visibleKeys(person, mode)).toEqual(expected);
      });

      it(`${person} in ${mode} mode: mayRead agrees with the GROQ on every event`, () => {
        for (const [key, event] of Object.entries(EVENTS)) {
          expect([key, mayRead(PEOPLE[person], event as StoredMinistryEvent, mode)]).toEqual([
            key,
            expected.includes(key),
          ]);
        }
      });
    }
  }

  it("the Otro Nivel leader sees the joint draft but not the Emprendedores-only one, and no pastor sees either", async () => {
    expect(await visibleKeys("leaderON", "editor")).toContain("draftOnEm");
    expect(await visibleKeys("leaderON", "editor")).not.toContain("draftEM");
    for (const p of ["pastorON", "pastorEM", "pastorTwo"]) {
      expect(await visibleKeys(p, "member")).not.toContain("draftOnEm");
    }
  });

  it("the date window is a page range: an event outside it is not returned, but mayRead ignores it", async () => {
    const late = ev("late", { ...PUB, audience: { kind: "ministry" }, date: "2026-12-05" });
    h.fetch.mockImplementation((q: string, p?: Record<string, unknown>) => groq(q, p, [late]));
    expect(await readMinistryEvents(PEOPLE.admin, { me: "a1", ministry: "jovenes", mode: "editor", ...WINDOW })).toEqual([]);
    expect(mayRead(PEOPLE.pastorON, late, "member")).toBe(true);
  });

  it("orders by date then time", async () => {
    const rows = [
      ev("b", { ...PUB, audience: { kind: "ministry" }, date: "2026-11-14", time: "19:00" }),
      ev("c", { ...PUB, audience: { kind: "ministry" }, date: "2026-11-07" }),
      ev("a", { ...PUB, audience: { kind: "ministry" }, date: "2026-11-14", time: "17:00" }),
    ];
    h.fetch.mockImplementation((q: string, p?: Record<string, unknown>) => groq(q, p, rows));
    const got = await readMinistryEvents(PEOPLE.pastorON, { me: "p1", ministry: "jovenes", mode: "member", ...WINDOW });
    expect(got.map((r) => r._id)).toEqual(["ministryEvent.c", "ministryEvent.a", "ministryEvent.b"]);
  });

  it("R7: «mine» is decided by member id in the projection, and names come from the reference", async () => {
    const meeting = ev("seated", {
      ...PUB,
      audience: { kind: "ministry" },
      seats: [
        { _key: "s1", role: "encargado", member: { _ref: "p1", _weak: true } },
        { _key: "s2", role: "apoyo", member: { _ref: "l1", _weak: true } },
        { _key: "s3", role: "apoyo", member: { _ref: "gone", _weak: true } },
      ],
      program: [{ _key: "g1", label: "Oración", member: { _ref: "l1", _weak: true }, note: "5 min" }],
      createdBy: { _ref: "l1", _weak: true },
    });
    h.fetch.mockImplementation((q: string, p?: Record<string, unknown>) => groq(q, p, [meeting, ...MEMBER_DOCS]));
    const [row] = await readMinistryEvents(PEOPLE.pastorON, { me: "p1", ministry: "jovenes", mode: "member", ...WINDOW });
    expect(row.seats).toEqual([
      { _key: "s1", role: "encargado", memberId: "p1", name: "Pastor Uno", mine: true },
      { _key: "s2", role: "apoyo", memberId: "l1", name: "Lu", mine: false },
      { _key: "s3", role: "apoyo", memberId: "gone", name: null, mine: false },
    ]);
    expect(row.program).toEqual([{ _key: "g1", label: "Oración", note: "5 min", memberId: "l1", name: "Lu", mine: false }]);
    expect([row.createdById, row.createdByName, row.published]).toEqual(["l1", "Lu", true]);
  });
  it("a typed seat name reads as its text, never «mine»; a member's live name wins; the place reads back", async () => {
    const meeting = ev("typed", {
      ...PUB,
      audience: { kind: "ministry" },
      place: "Oasis Tlalpan",
      seats: [
        { _key: "s1", role: "encargado", name: "Emprendedores" },
        { _key: "s2", role: "comparte", name: "Ana" },
        { _key: "s3", role: "apoyo", member: { _ref: "p1", _weak: true } },
        { _key: "s4", role: "apoyo" },
      ],
    });
    h.fetch.mockImplementation((q: string, p?: Record<string, unknown>) => groq(q, p, [meeting, ...MEMBER_DOCS]));
    const [row] = await readMinistryEvents(PEOPLE.pastorON, { me: "p1", ministry: "jovenes", mode: "member", ...WINDOW });
    expect(row.place).toBe("Oasis Tlalpan");
    expect(row.seats).toEqual([
      { _key: "s1", role: "encargado", memberId: null, name: "Emprendedores", mine: false },
      { _key: "s2", role: "comparte", memberId: null, name: "Ana", mine: false },
      { _key: "s3", role: "apoyo", memberId: "p1", name: "Pastor Uno", mine: true },
      { _key: "s4", role: "apoyo", memberId: null, name: null, mine: false },
    ]);
  });
});

// ── mayRead's id rule, where groq-js and Content Lake disagree ──────────────

describe("mayRead: the id prefix is Content Lake's path(\"ministryEvent.*\")", () => {
  const base = { _type: "ministryEvent", ministry: "jovenes", published: true, audience: { kind: "ministry" } };
  it.each([
    ["ministryEvent.abc", true],
    ["ministryEvent-f", false],
    ["ministryEventX.abc", false],
    ["ministryEvent.a.b", false],
    ["ministryEvent.", false],
    ["drafts.ministryEvent.abc", false],
    ["versions.r1.ministryEvent.abc", false],
  ])("%s → %s", (id, expected) => {
    expect(mayRead(PEOPLE.admin, { ...base, _id: id }, "editor")).toBe(expected);
    expect(mayRead(PEOPLE.pastorON, { ...base, _id: id }, "member")).toBe(expected);
  });

  it("an id that is not a string is never readable", () => {
    expect(mayRead(PEOPLE.admin, { ...base, _id: 42 }, "editor")).toBe(false);
    expect(mayRead(PEOPLE.admin, { ...base }, "editor")).toBe(false);
  });
});

// ── G2 ──────────────────────────────────────────────────────────────────────

describe("G2: query shape", () => {
  const opts = { me: "p1", ministry: "jovenes" as const, ...WINDOW };

  it("the member query carries the id prefix, the ministry, published == true and the audience arm", () => {
    const built = buildMinistryEventQuery(PEOPLE.pastorON, { ...opts, mode: "member" });
    expect(built).not.toBeNull();
    const { query, params } = built!;
    expect(query).toContain('_type == "ministryEvent"');
    expect(query).toContain('_id in path("ministryEvent.*")');
    expect(query).toContain("ministry == $ministry");
    expect(query).toContain("date >= $from && date <= $to");
    expect(query).toContain("published == true");
    expect(query).toContain('audience.kind == "ministry"');
    expect(query).toContain("audience.groups[@ in $groups]");
    expect(params).toEqual({ ministry: "jovenes", from: WINDOW.from, to: WINDOW.to, me: "p1", groups: ["otro-nivel"] });
  });

  it("the reader's groups are a parameter, never interpolated", () => {
    for (const person of ["pastorON", "pastorTwo", "leaderTwo"]) {
      for (const mode of MODES) {
        const built = buildMinistryEventQuery(PEOPLE[person], { ...opts, mode });
        if (!built) continue;
        for (const g of ["otro-nivel", "invencibles", "emprendedores"]) expect(built.query).not.toContain(g);
      }
    }
  });

  it("the leader's editor query adds only the drafts of their groups; the admin's has no audience arm", () => {
    const leader = buildMinistryEventQuery(PEOPLE.leaderON, { ...opts, mode: "editor" })!;
    expect(leader.query).toContain("published != true");
    expect(leader.query).toContain("audience.groups[@ in $led]");
    expect(leader.params.led).toEqual(["otro-nivel"]);
    const admin = buildMinistryEventQuery(PEOPLE.admin, { ...opts, mode: "editor" })!;
    expect(admin.query).toContain('_id in path("ministryEvent.*")');
    expect(admin.query).not.toContain("$groups");
    expect(admin.params).not.toHaveProperty("groups");
  });

  it("a group the registry does not know never reaches the parameter", () => {
    const built = buildMinistryEventQuery(PEOPLE.pastorUnknownGroup, { ...opts, mode: "member" })!;
    expect(built.params.groups).toEqual([]);
  });

  it.each([
    ["inactiveAdmin", "member"],
    ["inactiveAdmin", "editor"],
    ["worshipOnly", "member"],
    ["worshipAdmin", "editor"],
    ["levelWithoutMinistry", "editor"],
    ["pastorON", "editor"],
  ] as const)("%s in %s mode: no query and no fetch", async (person, mode) => {
    expect(buildMinistryEventQuery(PEOPLE[person], { ...opts, mode })).toBeNull();
    vi.stubEnv("SANITY_API_READ_TOKEN", "");
    expect(await readMinistryEvents(PEOPLE[person], { ...opts, mode })).toEqual([]);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("a ministry that is not leveled is never read", () => {
    expect(buildMinistryEventQuery(PEOPLE.superAdmin, { ...opts, ministry: "kids", mode: "editor" })).toBeNull();
    expect(buildMinistryEventQuery(PEOPLE.superAdmin, { ...opts, ministry: "worship", mode: "member" })).toBeNull();
  });

  it("R4: without the read token, a reader with access throws instead of answering «no events»", async () => {
    vi.stubEnv("SANITY_API_READ_TOKEN", "");
    await expect(
      readMinistryEvents(PEOPLE.pastorON, { ...opts, mode: "member" }),
    ).rejects.toBeInstanceOf(MinistryEventReadUnavailable);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("a malformed row (no date, bad date, no id) is dropped, not rendered", async () => {
    h.fetch.mockResolvedValue([
      { _id: "ministryEvent.ok", ministry: "jovenes", date: "2026-11-14" },
      { _id: "ministryEvent.nodate", ministry: "jovenes" },
      { _id: "ministryEvent.baddate", ministry: "jovenes", date: "14/11/2026" },
      { ministry: "jovenes", date: "2026-11-14" },
      null,
      "x",
    ]);
    const rows = await readMinistryEvents(PEOPLE.pastorON, { ...opts, mode: "member" });
    expect(rows.map((r) => r._id)).toEqual(["ministryEvent.ok"]);
    expect(rows[0]).toMatchObject({ published: false, seats: [], program: [], audience: null, title: null });
  });
});
