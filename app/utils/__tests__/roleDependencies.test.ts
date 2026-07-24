import { describe, expect, it } from "vitest";
import { PROPOSAL_STATUSES } from "@/app/utils/serviceReadModel";
import {
  inventoryRoleDependencies,
  type RoleDependencyInput,
} from "@/app/utils/roleDependencies";

const OLD = "2026-07-05";
const NEW = "2026-07-12";

const sundayRole = { _id: "role-1", _rev: "rev-1", _type: "sunday_role", week: OLD };
const saturdayRole = { _id: "role-2", _rev: "rev-2", _type: "saturday_role", week: "2026-07-04" };
const specialRole = {
  _id: "sp-1",
  _rev: "rev-3",
  _type: "special_role",
  date: "2026-04-03",
  service_name: "Viernes Santo",
};

function proposal(over: Record<string, unknown> = {}) {
  return {
    _id: "prop-1",
    _rev: "p-rev",
    _type: "setlistProposal",
    service_type: "sunday",
    service_ref: "role-1",
    service_date: OLD,
    status: "pending",
    ...over,
  };
}

function ids(deps: { id: string }[]): string[] {
  return deps.map((d) => d.id);
}

describe("inventoryRoleDependencies — scopes and codes", () => {
  it("uses the create code and a single target scope", () => {
    const result = inventoryRoleDependencies({
      operation: "create",
      target: { roleType: "sunday_role", date: OLD },
    });
    expect(result.code).toBe("target_has_orphaned_dependencies");
    expect(result.usable).toBe(true);
    expect(result.scopes).toEqual([
      {
        scope: "target",
        roleType: "sunday_role",
        date: OLD,
        roleId: null,
        setlistTargetKey: `featuredSongs:${OLD}`,
        proposalTargetKey: `sunday:${OLD}`,
      },
    ]);
  });

  it("uses the move code and inventories BOTH the old and destination dates", () => {
    const result = inventoryRoleDependencies({ operation: "move", role: sundayRole, newDate: NEW });
    expect(result.code).toBe("role_date_has_dependencies");
    expect(result.scopes.map((s) => [s.scope, s.date, s.setlistTargetKey])).toEqual([
      ["old", OLD, `featuredSongs:${OLD}`],
      ["new", NEW, `featuredSongs:${NEW}`],
    ]);
  });

  it("keys a Saturday move to the deliberately misspelled saturdarSongs type", () => {
    const result = inventoryRoleDependencies({
      operation: "move",
      role: saturdayRole,
      newDate: "2026-07-11",
    });
    expect(result.scopes.map((s) => s.setlistTargetKey)).toEqual([
      "saturdarSongs:2026-07-04",
      "saturdarSongs:2026-07-11",
    ]);
  });

  it("uses the delete code and a single old scope", () => {
    const result = inventoryRoleDependencies({ operation: "delete", role: sundayRole });
    expect(result.code).toBe("role_has_dependencies");
    expect(result.scopes.map((s) => s.scope)).toEqual(["old"]);
  });

  it("collapses a same-date move into one scope", () => {
    const result = inventoryRoleDependencies({ operation: "move", role: sundayRole, newDate: OLD });
    expect(result.scopes).toHaveLength(1);
  });

  it("keys special scopes by the role id, not the date", () => {
    const result = inventoryRoleDependencies({
      operation: "move",
      role: specialRole,
      newDate: "2026-04-10",
    });
    expect(result.scopes.map((s) => [s.setlistTargetKey, s.proposalTargetKey])).toEqual([
      ["sp-1", "special:sp-1"],
      ["sp-1", "special:sp-1"],
    ]);
  });

  const unusable: [string, RoleDependencyInput][] = [
    ["a malformed role", { operation: "move", role: { _type: "sunday_role" }, newDate: NEW }],
    ["a non-role document", { operation: "delete", role: { _id: "p1", _type: "post" } }],
    ["a move with no destination", { operation: "move", role: sundayRole, newDate: null }],
    ["a move to a non-calendar date", { operation: "move", role: sundayRole, newDate: "2026-02-30" }],
    ["a create with no target", { operation: "create" }],
    ["a create with a bad date", { operation: "create", target: { roleType: "sunday_role", date: "nope" } }],
  ];

  it.each(unusable)("fails closed (usable=false) for %s", (_label, input) => {
    const result = inventoryRoleDependencies(input);
    expect(result.usable).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe("inventoryRoleDependencies — setlists", () => {
  it("finds the old and destination canonical setlists and ignores unrelated ones", () => {
    const result = inventoryRoleDependencies({
      operation: "move",
      role: sundayRole,
      newDate: NEW,
      canonicalSetlists: [
        { _id: "fs-old", _type: "featuredSongs", week: OLD, songs: [{ _key: "a" }] },
        { _id: "fs-new", _type: "featuredSongs", week: NEW, songs: [] },
        { _id: "fs-other", _type: "featuredSongs", week: "2026-08-02" },
        { _id: "ss-old", _type: "saturdarSongs", week: OLD },
      ],
    });
    expect(ids(result.dependencies)).toEqual(["fs-old", "fs-new"]);
    expect(result.dependencies.map((d) => [d.kind, d.scope])).toEqual([
      ["canonical_setlist", "old"],
      ["canonical_setlist", "new"],
    ]);
    expect(result.hasDependencies).toBe(true);
  });

  it("treats an EMPTY destination setlist as a dependency — history is never adopted", () => {
    const result = inventoryRoleDependencies({
      operation: "create",
      target: { roleType: "sunday_role", date: OLD },
      canonicalSetlists: [{ _id: "fs-orphan", _type: "featuredSongs", week: OLD, songs: [] }],
    });
    expect(result.code).toBe("target_has_orphaned_dependencies");
    expect(ids(result.dependencies)).toEqual(["fs-orphan"]);
  });

  it("finds raw setlist drafts at either date", () => {
    const result = inventoryRoleDependencies({
      operation: "move",
      role: sundayRole,
      newDate: NEW,
      rawSetlistDrafts: [
        { _id: `drafts.fs-old`, _type: "featuredSongs", week: OLD },
        { _id: `drafts.fs-new`, _type: "featuredSongs", week: NEW },
        { _id: `drafts.fs-other`, _type: "featuredSongs", week: "2026-09-06" },
      ],
    });
    expect(ids(result.dependencies)).toEqual(["drafts.fs-old", "drafts.fs-new"]);
    expect(result.dependencies.every((d) => d.kind === "raw_setlist_draft")).toBe(true);
  });

  it("accepts a datetime-prefixed stored week", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      canonicalSetlists: [{ _id: "fs-old", _type: "featuredSongs", week: `${OLD}T12:00:00Z` }],
    });
    expect(ids(result.dependencies)).toEqual(["fs-old"]);
  });

  it("ignores setlist rows with no resolvable target instead of throwing", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      canonicalSetlists: [null, "x", { _id: "fs-x", _type: "featuredSongs" }, { _type: "featuredSongs", week: OLD }],
    });
    expect(result.dependencies).toEqual([]);
  });
});

describe("inventoryRoleDependencies — proposals", () => {
  it.each(PROPOSAL_STATUSES)("blocks a %s proposal on the old date", (status) => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      canonicalProposals: [proposal({ status })],
    });
    expect(ids(result.dependencies)).toEqual(["prop-1"]);
    expect(result.dependencies[0]).toMatchObject({
      kind: "proposal",
      type: "setlistProposal",
      detail: `status:${status}`,
    });
  });

  it("matches by service_ref even when the proposal's own date drifted", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      canonicalProposals: [proposal({ _id: "prop-drift", service_date: "2026-01-04" })],
    });
    expect(ids(result.dependencies)).toEqual(["prop-drift"]);
  });

  it("blocks a destination proposal that references ANOTHER role", () => {
    const result = inventoryRoleDependencies({
      operation: "move",
      role: sundayRole,
      newDate: NEW,
      canonicalProposals: [
        proposal({ _id: "prop-dest", service_ref: "role-9", service_date: NEW }),
      ],
    });
    expect(ids(result.dependencies)).toEqual(["prop-dest"]);
    expect(result.dependencies[0].scope).toBe("new");
  });

  it("blocks a destination proposal whose referenced role is missing entirely", () => {
    const result = inventoryRoleDependencies({
      operation: "move",
      role: sundayRole,
      newDate: NEW,
      canonicalProposals: [proposal({ _id: "prop-dangling", service_ref: undefined, service_date: NEW })],
    });
    expect(ids(result.dependencies)).toEqual(["prop-dangling"]);
    expect(result.dependencies[0].kind).toBe("malformed_proposal");
  });

  it("does not match a proposal for a different service kind on the same date", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      canonicalProposals: [
        proposal({ _id: "prop-sat", service_type: "saturday", service_ref: "role-2", service_date: OLD }),
      ],
    });
    expect(result.dependencies).toEqual([]);
  });

  it("blocks a malformed proposal that lands on a scope date", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      canonicalProposals: [
        proposal({ _id: "prop-bad", service_type: "unknown", service_ref: "role-7", service_date: OLD }),
      ],
    });
    expect(result.dependencies).toEqual([
      expect.objectContaining({ id: "prop-bad", kind: "malformed_proposal", scope: "old" }),
    ]);
  });

  it("ignores a malformed proposal that touches neither the role nor a scope date", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      canonicalProposals: [
        proposal({ _id: "prop-far", service_type: "unknown", service_ref: "role-7", service_date: "2025-01-05" }),
      ],
    });
    expect(result.dependencies).toEqual([]);
  });

  it("finds raw proposal drafts by the same rules", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      rawProposalDrafts: [
        proposal({ _id: "drafts.prop-1" }),
        proposal({ _id: "drafts.prop-far", service_ref: "role-9", service_date: "2025-02-01" }),
      ],
    });
    expect(ids(result.dependencies)).toEqual(["drafts.prop-1"]);
    expect(result.dependencies[0].kind).toBe("raw_proposal_draft");
  });

  it("reports a proposal once even when it matches both scopes of a special move", () => {
    const result = inventoryRoleDependencies({
      operation: "move",
      role: specialRole,
      newDate: "2026-04-10",
      canonicalProposals: [
        proposal({ _id: "prop-sp", service_type: "special", service_ref: "sp-1", service_date: "2026-04-03" }),
      ],
    });
    expect(ids(result.dependencies)).toEqual(["prop-sp"]);
    expect(result.dependencies[0].scope).toBe("old");
  });

  it("survives malformed proposal rows without throwing", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      canonicalProposals: [null, 7, {}, { _id: "" }],
    });
    expect(result.dependencies).toEqual([]);
  });
});

describe("inventoryRoleDependencies — special embedded songs", () => {
  it("treats non-empty embedded songs as a dependency on DELETE", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: { ...specialRole, songs: [{ _key: "a", song: { _ref: "post-1" } }] },
    });
    expect(result.dependencies).toEqual([
      expect.objectContaining({ id: "sp-1", type: "special_role", kind: "special_songs", scope: "role" }),
    ]);
  });

  it("keeps embedded songs on a special date MOVE (not a dependency)", () => {
    const result = inventoryRoleDependencies({
      operation: "move",
      role: { ...specialRole, songs: [{ _key: "a", song: { _ref: "post-1" } }] },
      newDate: "2026-04-10",
    });
    expect(result.dependencies).toEqual([]);
  });

  it("does not flag an empty or missing songs array on delete", () => {
    expect(
      inventoryRoleDependencies({ operation: "delete", role: { ...specialRole, songs: [] } }).dependencies,
    ).toEqual([]);
    expect(inventoryRoleDependencies({ operation: "delete", role: specialRole }).dependencies).toEqual([]);
  });

  it("never treats a weekend role's own songs field as an embedded dependency", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: { ...sundayRole, songs: [{ _key: "a" }] },
    });
    expect(result.dependencies).toEqual([]);
  });
});

describe("inventoryRoleDependencies — unknown strong references", () => {
  it("reports references that are not already inventoried", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      canonicalProposals: [proposal()],
      unknownReferences: [
        { _id: "prop-1", _type: "setlistProposal" },
        { _id: "mystery-1", _type: "someFutureType" },
        { _id: "role-1", _type: "sunday_role" },
      ],
    });
    // prop-1 is already reported as a proposal; the role itself is never a dependency.
    expect(ids(result.dependencies)).toEqual(["prop-1", "mystery-1"]);
    expect(result.dependencies[1]).toMatchObject({ kind: "unknown_reference", scope: "role" });
  });

  it("ignores unusable reference rows", () => {
    const result = inventoryRoleDependencies({
      operation: "delete",
      role: sundayRole,
      unknownReferences: [null, {}, { _id: "" }, "x"],
    });
    expect(result.dependencies).toEqual([]);
  });
});

describe("inventoryRoleDependencies — dependency-free path", () => {
  it("reports no dependencies when nothing touches either scope", () => {
    const result = inventoryRoleDependencies({
      operation: "move",
      role: sundayRole,
      newDate: NEW,
      canonicalSetlists: [{ _id: "fs-other", _type: "featuredSongs", week: "2026-08-02" }],
      rawSetlistDrafts: [{ _id: "drafts.fs-other", _type: "featuredSongs", week: "2026-08-02" }],
      canonicalProposals: [proposal({ _id: "prop-other", service_ref: "role-9", service_date: "2026-08-02" })],
      rawProposalDrafts: [],
      unknownReferences: [],
    });
    expect(result.usable).toBe(true);
    expect(result.hasDependencies).toBe(false);
    expect(result.dependencies).toEqual([]);
  });

  it("defaults every corpus to empty and reports a clean delete", () => {
    const result = inventoryRoleDependencies({ operation: "delete", role: sundayRole });
    expect(result).toMatchObject({ usable: true, hasDependencies: false, dependencies: [] });
  });
});
