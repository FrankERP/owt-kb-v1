// Solver v3 C2 — the write-request module, part 1: the body validator (IF2-18; WR-3,
// WR-4, WR-17, REC-3, REC-4, A11, A38), the id and keys (REC-1, REC-3, REC-4), the
// content hash (IF2-19, REC-6), the stored document (IF2-2) and the stored-record parser
// (IF2-20, RD-2, REC-7). Every name below is fictitious (this repository is public).
import { describe, expect, it } from "vitest";

import {
  blockKey,
  buildFairnessMonthDocument,
  canonicalFairnessContent,
  contentHashOfStored,
  contentHashOfWrite,
  exactRuleKey,
  fairnessMonthId,
  isIntact,
  parseStoredFairnessMonth,
  personKey,
  presenceKey,
  validateFairnessMonthWrite,
} from "../fairnessMonthWriteRequest";
import type { FairnessMonthWrite, RoleKey, Status } from "../fairnessVocabulary";

const ALL_OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const roles = (patch: Partial<Record<RoleKey, Status>>): Record<RoleKey, Status> => ({ ...ALL_OUT, ...patch });

/** A valid route body for November 2026: Alma (exact Dom Lead 2), Bruno (cadence), Carmen. */
function body(): FairnessMonthWrite {
  return {
    month: "2026-11",
    source: "auto",
    expectedRev: null,
    people: [
      {
        memberId: "m-carmen",
        roles: roles({ "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in" }),
        exactRules: [],
        exempt: false,
        blocks: [
          { date: "2026-11-15", unavailable: true, excludedRoles: [] },
          { date: "2026-11-08", unavailable: false, excludedRoles: ["Sun.Choir", "Sun.BGV"] },
        ],
      },
      {
        memberId: "m-alma",
        roles: roles({ "Sun.Lead": "exact", "Sat.Lead": "in", "Sun.BGV": "in" }),
        exactRules: [{ roles: ["Sun.Lead"], count: 2 }],
        exempt: true,
        blocks: [],
      },
      {
        memberId: "m-bruno",
        roles: roles({ "Sun.Lead": "in", "Sat.Lead": "in" }),
        exactRules: [],
        sundayCadence: "alternate",
        exempt: false,
        blocks: [],
      },
    ],
    presence: [{ ruleKey: "rule-1", roles: ["Sun.BGV"], members: ["m-carmen", "m-alma"], exclusive: false }],
  };
}

const validate = (b: unknown, current = "2026-10") => validateFairnessMonthWrite(b, "route", current);
const pathsOf = (b: unknown, current = "2026-10") => {
  const r = validate(b, current);
  return r.ok ? [] : r.issues.map((i) => i.path);
};

describe("validateFairnessMonthWrite (C2 IF2-18)", () => {
  it("accepts a valid route body", () => {
    expect(validate(body())).toEqual({ ok: true, value: body() });
  });

  it("refuses unknown fields and every server stamp at any level", () => {
    const b = body() as unknown as Record<string, unknown>;
    for (const stamp of ["schemaVersion", "engine", "environment", "recordedAt", "recordedBy", "contentHash", "_key", "name"]) {
      expect(pathsOf({ ...b, [stamp]: "x" }), stamp).toEqual([stamp]);
    }
    const withName = body();
    (withName.people[0] as Record<string, unknown>).name = "Carmen";
    expect(pathsOf(withName)).toEqual(["people[0].name"]);
    const withKey = body();
    (withKey.presence[0] as Record<string, unknown>)._key = "r1";
    expect(pathsOf(withKey)).toEqual(["presence[0]._key"]);
  });

  it("decides the source rule by actor: route needs auto|manual, reconstruction carries none", () => {
    expect(pathsOf({ ...body(), source: "reconstructed" })).toEqual(["source"]);
    const { source: _source, ...noSource } = body();
    void _source;
    expect(pathsOf(noSource)).toEqual(["source"]);
    expect(validateFairnessMonthWrite(noSource, "reconstruction", "2026-12").ok).toBe(true);
    const r = validateFairnessMonthWrite(body(), "reconstruction", "2026-12");
    expect(r.ok ? [] : r.issues.map((i) => i.path)).toEqual(["source"]);
  });

  it("caps the month at the current CDMX month + 12", () => {
    const noBlocks = body();
    noBlocks.people[0].blocks = [];
    expect(pathsOf({ ...noBlocks, month: "2027-10" }, "2026-10")).toEqual([]);
    expect(pathsOf({ ...noBlocks, month: "2027-11" }, "2026-10")).toEqual(["month"]);
    expect(pathsOf({ ...noBlocks, month: "2026-13" })).toEqual(["month"]);
  });

  it("checks expectedRev", () => {
    expect(pathsOf({ ...body(), expectedRev: "rev-1" })).toEqual([]);
    expect(pathsOf({ ...body(), expectedRev: "" })).toEqual(["expectedRev"]);
    expect(pathsOf({ ...body(), expectedRev: "x".repeat(65) })).toEqual(["expectedRev"]);
    const { expectedRev: _rev, ...missing } = body();
    void _rev;
    expect(pathsOf(missing)).toEqual(["expectedRev"]);
  });

  it("limits people to 1–100 with unique member ids", () => {
    expect(pathsOf({ ...body(), people: [], presence: [] })).toEqual(["people"]);
    const many = Array.from({ length: 101 }, (_, i) => ({ ...body().people[2], memberId: `m-${i}` }));
    expect(pathsOf({ ...body(), people: many, presence: [] })).toEqual(["people"]);
    const twice = body();
    twice.people.push({ ...twice.people[0] });
    expect(pathsOf(twice)).toEqual(["people[3].memberId"]);
  });

  it("needs exactly the six role keys, each in|out|exact", () => {
    const missing = body();
    delete (missing.people[0].roles as Partial<Record<RoleKey, Status>>)["Sat.Choir"];
    expect(pathsOf(missing)).toEqual(["people[0].roles"]);
    const bad = body();
    (bad.people[0].roles as Record<string, string>)["Sun.BGV"] = "maybe";
    expect(pathsOf(bad)).toEqual(["people[0].roles.sunBgv"]);
  });

  it("keeps exact rules consistent with the statuses (REC-3)", () => {
    const unlisted = body();
    unlisted.people[1].exactRules = [];
    expect(pathsOf(unlisted)).toEqual(["people[1].roles.sunLead"]);
    const notExact = body();
    notExact.people[1].exactRules = [{ roles: ["Sun.Lead", "Sat.Lead"], count: 2 }];
    expect(pathsOf(notExact)).toEqual(["people[1].exactRules[0].roles"]);
    const count = body();
    count.people[1].exactRules = [{ roles: ["Sun.Lead"], count: 32 }];
    expect(pathsOf(count)).toEqual(["people[1].exactRules[0].count"]);
    count.people[1].exactRules = [{ roles: ["Sun.Lead"], count: 1.5 }];
    expect(pathsOf(count)).toEqual(["people[1].exactRules[0].count"]);
  });

  it("refuses two exact items of one person sharing a role key as overlapping_exact (A38)", () => {
    const b = body();
    b.people[1].roles = roles({ "Sun.Lead": "exact", "Sat.Lead": "exact" });
    b.people[1].exactRules = [
      { roles: ["Sun.Lead"], count: 2 },
      { roles: ["Sun.Lead", "Sat.Lead"], count: 1 },
    ];
    const r = validate(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContainEqual({ path: "people[1]", message: "overlapping_exact" });
  });

  it("refuses «Mes por medio» together with an exact rule covering Sun.Lead (A11)", () => {
    const b = body();
    b.people[1].sundayCadence = "alternate";
    const r = validate(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toEqual([{ path: "people[1].sundayCadence", message: "cadence_and_exact" }]);
  });

  it("keeps blocks inside the month, unique, and never empty", () => {
    const outside = body();
    outside.people[0].blocks = [{ date: "2026-12-01", unavailable: true, excludedRoles: [] }];
    expect(pathsOf(outside)).toEqual(["people[0].blocks[0].date"]);
    const twice = body();
    twice.people[0].blocks = [
      { date: "2026-11-01", unavailable: true, excludedRoles: [] },
      { date: "2026-11-01", unavailable: true, excludedRoles: [] },
    ];
    expect(pathsOf(twice)).toEqual(["people[0].blocks[1].date"]);
    const empty = body();
    empty.people[0].blocks = [{ date: "2026-11-01", unavailable: false, excludedRoles: [] }];
    expect(pathsOf(empty)).toEqual(["people[0].blocks[0]"]);
  });

  it("checks presence rules: key grammar, unique keys, 1–6 roles, 2–12 listed members", () => {
    const badKey = body();
    badKey.presence[0].ruleKey = "has space";
    expect(pathsOf(badKey)).toEqual(["presence[0].ruleKey"]);
    const dup = body();
    dup.presence.push({ ...dup.presence[0] });
    expect(pathsOf(dup)).toEqual(["presence[1].ruleKey"]);
    const unlisted = body();
    unlisted.presence[0].members = ["m-carmen", "m-nadie"];
    expect(pathsOf(unlisted)).toEqual(["presence[0].members"]);
    const noRoles = body();
    noRoles.presence[0].roles = [];
    expect(pathsOf(noRoles)).toEqual(["presence[0].roles"]);
  });

  it("never puts a stored value in a path or a message (key hygiene)", () => {
    const b = body();
    b.people[0].memberId = "m-alma";
    b.presence[0].ruleKey = "d-alma-bruno extra";
    const r = validate(b);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      for (const issue of r.issues) {
        expect(issue.path).not.toMatch(/alma|bruno/);
        expect(issue.message).not.toMatch(/alma|bruno/);
      }
    }
  });
});

describe("the record's id and keys (C2 REC-1, REC-3, REC-4)", () => {
  it("builds the dotted, private id", () => {
    expect(fairnessMonthId("2026-11")).toBe("fairnessMonth.2026-11");
  });

  it("mints keys that never carry a raw id or rule key", () => {
    expect(personKey("m.alma")).toMatch(/^p[0-9a-f]{24}$/);
    expect(personKey("m.alma")).not.toBe(personKey("m.bruno"));
    expect(exactRuleKey(["Sat.Lead", "Sun.Lead"])).toBe(exactRuleKey(["Sun.Lead", "Sat.Lead"]));
    expect(blockKey("2026-11-08")).toBe("d20261108");
    expect(presenceKey("d-alma-bruno")).toMatch(/^r[0-9a-f]{24}$/);
  });
});

const STAMPS = {
  source: "auto" as const,
  engine: "v3" as const,
  environment: "preview" as const,
  recordedAt: "2026-10-20T18:00:00.000Z",
  recordedBy: "m-admin",
  names: new Map([
    ["m-alma", "Alma"],
    ["m-bruno", "Bruno"],
    ["m-carmen", "Carmen"],
  ]),
};

describe("the content hash (C2 IF2-19, REC-6)", () => {
  it("pins the canonical serialization and its digest", () => {
    const b = body();
    const people = b.people.map((p) => ({
      memberId: p.memberId,
      roles: (k: RoleKey) => p.roles[k],
      exactRules: p.exactRules,
      sundayCadence: p.sundayCadence,
      exempt: p.exempt,
      blocks: p.blocks,
    }));
    const text = canonicalFairnessContent({ schemaVersion: 1, month: b.month, people, presence: b.presence });
    expect(text).toBe(
      '{"schemaVersion":1,"month":"2026-11","people":[' +
        '{"memberId":"m-alma","roles":["exact","in","in","out","out","out"],"exactRules":[{"roles":["Sun.Lead"],"count":2}],"sundayCadence":null,"exempt":true,"blocks":[]},' +
        '{"memberId":"m-bruno","roles":["in","in","out","out","out","out"],"exactRules":[],"sundayCadence":"alternate","exempt":false,"blocks":[]},' +
        '{"memberId":"m-carmen","roles":["out","out","in","in","in","in"],"exactRules":[],"sundayCadence":null,"exempt":false,"blocks":[' +
        '{"date":"2026-11-08","unavailable":false,"excludedRoles":["Sun.BGV","Sun.Choir"]},' +
        '{"date":"2026-11-15","unavailable":true,"excludedRoles":[]}]}],' +
        '"presence":[{"ruleKey":"rule-1","roles":["Sun.BGV"],"members":["m-alma","m-carmen"],"exclusive":false}]}',
    );
    expect(contentHashOfWrite("2026-11", b)).toBe(PINNED_DIGEST);
  });

  it("is independent of input order and of source/expectedRev", () => {
    const reordered = body();
    reordered.people.reverse();
    reordered.people[0].blocks.reverse();
    reordered.presence[0].members.reverse();
    reordered.source = "manual";
    reordered.expectedRev = "rev-9";
    expect(contentHashOfWrite("2026-11", reordered)).toBe(contentHashOfWrite("2026-11", body()));
  });

  it("changes with one eligibility, block, rule or flag", () => {
    const base = contentHashOfWrite("2026-11", body());
    const edits: Array<(b: FairnessMonthWrite) => void> = [
      (b) => (b.people[0].roles["Sat.Choir"] = "out"),
      (b) => (b.people[0].blocks[0].unavailable = false),
      (b) => (b.people[1].exactRules[0].count = 3),
      (b) => (b.people[1].exempt = false),
      (b) => delete b.people[2].sundayCadence,
      (b) => (b.presence[0].exclusive = true),
    ];
    for (const edit of edits) {
      const b = body();
      edit(b);
      expect(contentHashOfWrite("2026-11", b)).not.toBe(base);
    }
  });

  it("hashes the document written from a body exactly like the body, and finds it intact", () => {
    const doc = buildFairnessMonthDocument({ body: body(), ...STAMPS });
    expect(doc.contentHash).toBe(contentHashOfWrite("2026-11", body()));
    expect(contentHashOfStored(doc)).toBe(doc.contentHash);
    expect(isIntact(doc)).toBe(true);
  });

  it("finds a stored document with one field edited NOT intact, and still hashes junk", () => {
    const doc = buildFairnessMonthDocument({ body: body(), ...STAMPS });
    const edited = structuredClone(doc);
    (edited.people[0].roles as Record<string, string>).satChoir = "in";
    expect(isIntact(edited)).toBe(false);
    const junkRole = structuredClone(doc);
    ((junkRole.people[0].exactRules as Array<{ roles: string[] }>)[0].roles).push("Sun.Junk");
    expect(isIntact(junkRole)).toBe(false);
    expect(contentHashOfStored({ month: 7, people: "x" })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(contentHashOfStored(null)).toMatch(/^sha256:/);
  });

  it("ignores names, keys and stamps", () => {
    const doc = buildFairnessMonthDocument({ body: body(), ...STAMPS });
    const restamped = { ...structuredClone(doc), source: "manual", recordedBy: "m-other", recordedAt: "x", _rev: "r2" };
    restamped.people[0].name = "Otra";
    restamped.people[0]._key = "pZZ";
    expect(contentHashOfStored(restamped)).toBe(doc.contentHash);
  });
});

/** Pinned on the unchanged implementation; a different digest is a change to REC-6. */
const PINNED_DIGEST = "sha256:4e581e9e542bf96e057017b8b37c0050d9ef65c5476e2d51b555bc16043d2c20";

describe("the stored document (C2 IF2-2)", () => {
  it("sorts and keys every item, stores names from the member read and the role fields undotted", () => {
    const doc = buildFairnessMonthDocument({ body: body(), ...STAMPS });
    expect(doc._id).toBe("fairnessMonth.2026-11");
    expect(doc.people.map((p) => (p.member as { _ref: string })._ref)).toEqual(["m-alma", "m-bruno", "m-carmen"]);
    expect(doc.people[0]).toMatchObject({
      _key: personKey("m-alma"),
      _type: "fairnessPerson",
      member: { _type: "reference", _ref: "m-alma", _weak: true },
      name: "Alma",
      roles: { sunLead: "exact", satLead: "in", sunBgv: "in", satBgv: "out", sunChoir: "out", satChoir: "out" },
      exactRules: [{ _key: exactRuleKey(["Sun.Lead"]), _type: "fairnessExactRule", roles: ["Sun.Lead"], count: 2 }],
      exempt: true,
    });
    expect(doc.people[0]).not.toHaveProperty("sundayCadence");
    expect(doc.people[1]).toHaveProperty("sundayCadence", "alternate");
    expect(doc.people[2].blocks).toEqual([
      { _key: "d20261108", _type: "fairnessBlock", date: "2026-11-08", unavailable: false, excludedRoles: ["Sun.BGV", "Sun.Choir"] },
      { _key: "d20261115", _type: "fairnessBlock", date: "2026-11-15", unavailable: true, excludedRoles: [] },
    ]);
    expect(doc.presence).toEqual([
      { _key: presenceKey("rule-1"), _type: "fairnessPresence", ruleKey: "rule-1", roles: ["Sun.BGV"], members: ["m-alma", "m-carmen"], exclusive: false },
    ]);
  });
});

function storedDoc(): Record<string, unknown> {
  return { ...buildFairnessMonthDocument({ body: body(), ...STAMPS }), _rev: "rev-1", _createdAt: "t", _updatedAt: "t" };
}

describe("parseStoredFairnessMonth (C2 IF2-20, RD-2)", () => {
  it("maps a valid document to the logical record (IF2-3)", () => {
    const parsed = parseStoredFairnessMonth(storedDoc());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record).toMatchObject({
      month: "2026-11",
      rev: "rev-1",
      source: "auto",
      engine: "v3",
      environment: "preview",
      recordedAt: "2026-10-20T18:00:00.000Z",
    });
    expect(parsed.record.people[0]).toEqual({
      memberId: "m-alma",
      name: "Alma",
      roles: roles({ "Sun.Lead": "exact", "Sat.Lead": "in", "Sun.BGV": "in" }),
      exactRules: [{ roles: ["Sun.Lead"], count: 2 }],
      exempt: true,
      blocks: [],
    });
    expect(parsed.record.people[1].sundayCadence).toBe("alternate");
    expect(parsed.record.presence).toEqual([{ ruleKey: "rule-1", roles: ["Sun.BGV"], members: ["m-alma", "m-carmen"], exclusive: false }]);
  });

  it("refuses an unknown schemaVersion", () => {
    const parsed = parseStoredFairnessMonth({ ...storedDoc(), schemaVersion: 2 });
    expect(parsed).toEqual({ ok: false, refusal: "malformed_record", issues: [{ path: "schemaVersion", message: "unknown schemaVersion" }] });
  });

  it.each(["schemaVersion", "month", "_rev", "source", "engine", "environment", "recordedAt", "recordedBy", "contentHash", "people", "presence"])(
    "refuses a document missing %s",
    (key) => {
      const doc = storedDoc();
      delete doc[key];
      const parsed = parseStoredFairnessMonth(doc);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.issues.map((i) => i.path)).toContain(key);
    },
  );

  it("refuses a listed item missing one of its six role fields (REC-7: never read as «out»)", () => {
    const doc = storedDoc();
    delete ((doc.people as Array<{ roles: Record<string, string> }>)[2].roles).satChoir;
    const parsed = parseStoredFairnessMonth(doc);
    expect(parsed).toEqual({
      ok: false,
      refusal: "malformed_record",
      issues: [{ path: "people[2].roles.satChoir", message: "required field missing" }],
    });
  });

  it("refuses an invalid enum", () => {
    const doc = storedDoc();
    doc.source = "imported";
    ((doc.people as Array<{ roles: Record<string, string> }>)[0].roles).sunLead = "maybe";
    const parsed = parseStoredFairnessMonth(doc);
    expect(parsed.ok ? [] : parsed.issues).toEqual([
      { path: "source", message: "invalid enum value" },
      { path: "people[0].roles.sunLead", message: "invalid enum value" },
    ]);
  });

  it("round-trips: a parsed record, names dropped, is a write body with the record's own hash (IF2-3, IF2-19; C6 CF-3)", () => {
    const doc = storedDoc();
    const parsed = parseStoredFairnessMonth(doc);
    if (!parsed.ok) throw new Error("parse");
    const entry = {
      month: parsed.record.month,
      people: parsed.record.people.map(({ name: _name, ...person }) => person),
      presence: parsed.record.presence,
    };
    expect(contentHashOfWrite(entry.month, entry)).toBe(doc.contentHash);
    expect(validateFairnessMonthWrite({ ...entry, source: "auto", expectedRev: "rev-1" }, "route", "2026-10").ok).toBe(true);
  });

  it("leaves intactness to the hash: a refused document can still be hashed", () => {
    const doc = { ...storedDoc(), schemaVersion: 2 };
    expect(parseStoredFairnessMonth(doc).ok).toBe(false);
    expect(contentHashOfStored(doc)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
