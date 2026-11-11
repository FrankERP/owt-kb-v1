// The planning half of scripts/backfill-jovenes-leader-of.mjs (plan
// docs/superpowers/plans/2026-11-11-jovenes-per-group-leadership.md §6, §11 N4 and N9).
//
// Proved here: only an ABSENT `leaderOf` on a Jóvenes leader is planned, with today's meaning
// (its group ids, de-duplicated, in registry order) at its own `_key`; every other case is reported
// and left alone; a second run plans nothing; the CHECK (L1 vs L2 on normalized reads) is what PR 2
// waits on; and the lib's led groups equal `ledGroupsIn` on the same fixtures (N4).
import { describe, expect, it, vi } from "vitest";

// accessFromDoc is pure; its module also holds the cached fetch, whose client needs env.
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: vi.fn() } }));

import { ABSENT_LEADER_OF, normalizeMinistries, normalizeMinistryRoles } from "@/app/ministries";
import { accessFromDoc } from "@/app/utils/memberAccess";
import { ledGroupsIn } from "@/app/utils/ministryAccess";
import {
  LEADER_OF_QUERY,
  applyPlanned,
  documentKind,
  isAbsent,
  leaderOfCheck,
  ledGroups,
  planLeaderOfBackfill,
} from "../lib/leaderOfBackfill.mjs";

type Doc = { _id: string; _rev: string; member_name?: string; alias?: string; ministries?: unknown; ministryRoles?: unknown };

const item = (p: Record<string, unknown> = {}) => ({ _key: "jovenes", _type: "ministryRole", ministry: "jovenes", level: "leader", groups: ["otro-nivel"], ...p });
const doc = (id: string, p: Partial<Doc> = {}): Doc => ({ _id: id, _rev: `rev-${id}`, member_name: id, ministries: ["jovenes"], ministryRoles: [item()], ...p });

const FIXTURES: Doc[] = [
  // Planned: a legacy leader, out-of-order and repeated groups with junk.
  doc("jacob", { ministryRoles: [item({ groups: ["invencibles", "otro-nivel", "invencibles", "bogus"] })] }),
  doc("drafts.jacob", { ministryRoles: [item({ groups: ["invencibles", "otro-nivel"] })] }),
  doc("nullLeaderOf", { ministryRoles: [item({ leaderOf: null })] }),
  doc("oddKey", { ministryRoles: [item({ _key: "j-1" })] }),
  // Reported, not planned.
  doc("subset", { ministryRoles: [item({ groups: ["otro-nivel", "invencibles"], leaderOf: ["otro-nivel"] })] }),
  doc("equal", { ministryRoles: [item({ leaderOf: ["otro-nivel"] })] }),
  doc("junk", { ministryRoles: [item({ leaderOf: "otro-nivel" })] }),
  doc("noGroups", { ministryRoles: [item({ groups: ["bogus"] })] }),
  doc("noKey", { ministryRoles: [{ ministry: "jovenes", level: "leader", groups: ["otro-nivel"] }] }),
  doc("badKey", { ministryRoles: [item({ _key: 'x"]' })] }),
  doc("twice", { ministryRoles: [item(), item({ _key: "j2", level: "member" })] }),
  doc("notInJovenes", { ministries: ["worship"] }),
  doc("versions.rel1.jacob", { ministryRoles: [item()] }),
  doc("memberWithLeaderOf", { ministryRoles: [item({ level: "member", leaderOf: ["otro-nivel"] })] }),
  // Nothing to say.
  doc("member", { ministryRoles: [item({ level: "member" })] }),
  doc("admin", { ministryRoles: [item({ level: "admin", groups: ["emprendedores", "guerreras"] })] }),
  doc("worshipOnly", { ministries: ["worship"], ministryRoles: [] }),
];

const plan = planLeaderOfBackfill(FIXTURES);
const planned = (id: string) => plan.patches.find((p) => p.id === id);
const skipped = (id: string) => plan.skips.find((s) => s.id === id);

describe("planLeaderOfBackfill", () => {
  it("reads every document kind, raw (the script passes perspective raw)", () => {
    expect(LEADER_OF_QUERY).toContain('_type == "teamMembers"');
    expect(LEADER_OF_QUERY).toContain("defined(ministryRoles)");
    expect(LEADER_OF_QUERY).not.toMatch(/drafts|versions|path\(/);
    expect([documentKind("a"), documentKind("drafts.a"), documentKind("versions.r.a")]).toEqual(["published", "draft", "version"]);
  });

  it("plans a legacy leader: its group ids, de-duplicated, in registry order, at its own _key", () => {
    expect(planned("jacob")).toMatchObject({ rev: "rev-jacob", kind: "published", path: 'ministryRoles[_key=="jovenes"].leaderOf', leaderOf: ["otro-nivel", "invencibles"] });
    expect(planned("drafts.jacob")).toMatchObject({ kind: "draft", leaderOf: ["otro-nivel", "invencibles"] });
    expect(planned("oddKey")?.path).toBe('ministryRoles[_key=="j-1"].leaderOf');
  });

  it("a stored leaderOf of null is absent (§4.4's one meaning): planned", () => {
    expect(planned("nullLeaderOf")?.leaderOf).toEqual(["otro-nivel"]);
    expect([isAbsent(undefined), isAbsent(null), isAbsent([]), isAbsent(""), isAbsent(0)]).toEqual([true, true, false, false, false]);
  });

  it("leaves every other case alone and reports it", () => {
    for (const id of ["subset", "equal", "junk", "noGroups", "noKey", "badKey", "twice", "notInJovenes", "versions.rel1.jacob", "memberWithLeaderOf"]) {
      expect(planned(id), id).toBeUndefined();
      expect(skipped(id), id).toBeDefined();
    }
    expect(skipped("versions.rel1.jacob")).toMatchObject({ kind: "version" });
    for (const id of ["member", "admin", "worshipOnly"]) {
      expect(planned(id), id).toBeUndefined();
      expect(skipped(id), id).toBeUndefined();
    }
    expect(plan.totals).toMatchObject({ documents: FIXTURES.length, planned: 4, skipped: 10 });
  });

  it("never touches anything but leaderOf on the planned item", () => {
    const after = applyPlanned(FIXTURES, plan.patches);
    for (const [i, before] of FIXTURES.entries()) {
      const a = after[i];
      const roles = (d: Doc) => (d.ministryRoles as Array<Record<string, unknown>>).map(({ leaderOf: _l, ...rest }) => rest);
      expect({ ...a, ministryRoles: roles(a) }).toEqual({ ...before, ministryRoles: roles(before) });
    }
  });

  it("is idempotent: once applied, a second run plans nothing", () => {
    const again = planLeaderOfBackfill(applyPlanned(FIXTURES, plan.patches) as Doc[]);
    expect(again.patches).toEqual([]);
  });

  it("changes nobody's access under L1 (what production reads)", () => {
    const after = applyPlanned(FIXTURES, plan.patches) as Doc[];
    // The same SET of groups (the stored order of `groups` and the registry order may differ).
    const sorted = (d: Doc) => [...ledGroups(d)].sort();
    for (const [i, before] of FIXTURES.entries()) expect(sorted(after[i]), before._id).toEqual(sorted(before));
  });
});

describe("the CHECK: documents whose led groups differ between L1 and L2", () => {
  it("today: every legacy leader with groups, plus the unaddressable and the Content Release ones", () => {
    expect(plan.check.map((c: { id: string }) => c.id).sort()).toEqual(
      ["badKey", "drafts.jacob", "jacob", "noKey", "nullLeaderOf", "oddKey", "versions.rel1.jacob"].sort(),
    );
  });

  it("after the planned patches only the cases a person must fix remain (no _key, Content Release)", () => {
    expect(plan.checkAfter.map((c: { id: string }) => c.id).sort()).toEqual(["badKey", "noKey", "versions.rel1.jacob"]);
    expect(leaderOfCheck(applyPlanned(FIXTURES, plan.patches) as Doc[])).toEqual(plan.checkAfter);
  });

  it("is 0 on data with no legacy leader", () => {
    const clean = FIXTURES.filter((d) => !["badKey", "noKey", "versions.rel1.jacob"].includes(d._id));
    expect(planLeaderOfBackfill(applyPlanned(clean, planLeaderOfBackfill(clean).patches) as Doc[]).check).toEqual([]);
  });
});

describe("N4: the lib's led groups are ledGroupsIn's, on the same fixtures", () => {
  it("under the switch's PR 1 value (L1), for every fixture, before and after the plan", () => {
    expect(ABSENT_LEADER_OF).toBe("all");
    for (const d of [...FIXTURES, ...(applyPlanned(FIXTURES, plan.patches) as Doc[])]) {
      expect(ledGroups(d), d._id).toEqual(ledGroupsIn(accessFromDoc(d), "jovenes"));
    }
  });

  it("under L2, the same normalizer with the switch flipped", () => {
    for (const d of FIXTURES) {
      const ministries = normalizeMinistries(d.ministries);
      const item = ministries.includes("jovenes")
        ? normalizeMinistryRoles(d.ministryRoles, ministries, "none").find((r) => r.ministry === "jovenes")
        : undefined;
      expect(ledGroups(d, "none"), d._id).toEqual(item?.level === "leader" ? item.leaderOf : []);
    }
  });
});
