import { describe, expect, it } from "vitest";
import {
  buildProposalSummary,
  buildRoleTargets,
  buildSetlistTargets,
  collectRoleMemberRefs,
} from "@/app/utils/serviceReadSummary";
import type { CanonicalMember } from "@/app/utils/serviceReadModel";

// ── Fixtures ────────────────────────────────────────────────────────────────

function member(id: string, over: Partial<CanonicalMember> = {}): CanonicalMember {
  return { _id: id, _rev: `rev-${id}`, member_name: id, ...over };
}

function membersMap(...members: CanonicalMember[]): Map<string, CanonicalMember> {
  const m = new Map<string, CanonicalMember>();
  for (const mem of members) m.set(mem._id, mem);
  return m;
}

function ref(refId: string, key = `k-${refId}`) {
  return { _key: key, _type: "reference", _ref: refId };
}

function instrument(personRef: string, key = `i-${personRef}`) {
  return {
    _key: key,
    _type: "instrument_slot",
    instrument: "guitar",
    person: { _type: "reference", _ref: personRef },
  };
}

function foh(personRef: string, key = `f-${personRef}`) {
  return {
    _key: key,
    _type: "foh_slot",
    role: "sound",
    person: { _type: "reference", _ref: personRef },
  };
}

function sundayRole(over: Record<string, unknown> = {}) {
  return {
    _id: "role-sun-1",
    _rev: "r1",
    _type: "sunday_role",
    week: "2026-07-26",
    published: true,
    Lead: [ref("mem-lead")],
    BGVs: [ref("mem-bgv")],
    Chorus: [ref("mem-chorus")],
    instruments: [instrument("mem-inst")],
    foh_team: [foh("mem-foh")],
    ...over,
  };
}

function specialRole(over: Record<string, unknown> = {}) {
  return {
    _id: "role-spec-1",
    _rev: "s1",
    _type: "special_role",
    date: "2026-12-24",
    published: true,
    Lead: [ref("mem-lead")],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
}

function songEntry(over: Record<string, unknown> = {}) {
  return {
    _key: `song-${Math.random().toString(36).slice(2, 7)}`,
    play_key: "G",
    song: { _type: "reference", _ref: "post-1" },
    ...over,
  };
}

function featured(over: Record<string, unknown> = {}) {
  return {
    _id: "sl-sun-1",
    _rev: "slr1",
    _type: "featuredSongs",
    week: "2026-07-26",
    songs: [songEntry()],
    ...over,
  };
}

function proposal(over: Record<string, unknown> = {}) {
  return {
    _id: "prop-1",
    _rev: "pr1",
    _createdAt: "2026-07-01T00:00:00Z",
    service_type: "sunday",
    service_ref: "role-sun-1",
    service_date: "2026-07-26",
    status: "pending",
    songs: [songEntry()],
    ...over,
  };
}

// ── collectRoleMemberRefs ─────────────────────────────────────────────────────

describe("collectRoleMemberRefs", () => {
  it("gathers unique refs across all five seat paths", () => {
    const refs = collectRoleMemberRefs([sundayRole()]);
    expect(new Set(refs)).toEqual(
      new Set(["mem-lead", "mem-bgv", "mem-chorus", "mem-inst", "mem-foh"]),
    );
  });

  it("ignores invalid (non-groupable) roles", () => {
    const refs = collectRoleMemberRefs([sundayRole({ week: "not-a-date" })]);
    expect(refs).toEqual([]);
  });

  it("dedupes across multiple roles", () => {
    const refs = collectRoleMemberRefs([sundayRole(), specialRole()]);
    // mem-lead appears in both
    expect(refs.filter((r) => r === "mem-lead")).toHaveLength(1);
  });
});

// ── buildRoleTargets ──────────────────────────────────────────────────────────

describe("buildRoleTargets", () => {
  it("single clean role becomes one target with resolved members", () => {
    const members = membersMap(
      member("mem-lead"),
      member("mem-bgv"),
      member("mem-chorus"),
      member("mem-inst"),
      member("mem-foh"),
    );
    const out = buildRoleTargets([sundayRole()], [], members);
    expect(out.targets).toHaveLength(1);
    const t = out.targets[0];
    expect(t.targetKey).toBe("sunday_role:2026-07-26");
    expect(t.canonicalCount).toBe(1);
    expect(t.canonicalIds).toEqual(["role-sun-1"]);
    expect(t.canonicalState).toBe("single");
    expect(t.publicState).toBe("single");
    expect(t.memberVisibleCount).toBe(1);
    expect(t.draftIds).toEqual([]);
    expect(t.records[0].published).toBe(true);
    expect(t.records[0].members.map((m) => m._id).sort()).toEqual(
      ["mem-bgv", "mem-chorus", "mem-foh", "mem-inst", "mem-lead"],
    );
    expect(t.records[0].danglingRefs).toEqual([]);
    expect(out.recordIssues).toEqual([]);
  });

  it("special role keys by its own id", () => {
    const out = buildRoleTargets([specialRole()], [], membersMap(member("mem-lead")));
    expect(out.targets[0].targetKey).toBe("role-spec-1");
    expect(out.targets[0].type).toBe("special_role");
  });

  it("two canonical roles on same key is a duplicate target, not two targets", () => {
    const a = sundayRole({ _id: "role-a" });
    const b = sundayRole({ _id: "role-b" });
    const out = buildRoleTargets([a, b], [], new Map());
    expect(out.targets).toHaveLength(1);
    expect(out.targets[0].canonicalState).toBe("duplicate");
    expect(out.targets[0].canonicalCount).toBe(2);
    expect(new Set(out.targets[0].canonicalIds)).toEqual(new Set(["role-a", "role-b"]));
  });

  it("published:false lowers member-visible count but not canonical count", () => {
    const out = buildRoleTargets([sundayRole({ published: false })], [], new Map());
    expect(out.targets[0].canonicalCount).toBe(1);
    expect(out.targets[0].memberVisibleCount).toBe(0);
    expect(out.targets[0].records[0].published).toBe(false);
  });

  it("published missing counts as member-visible (published !== false)", () => {
    const role = sundayRole();
    delete (role as Record<string, unknown>).published;
    const out = buildRoleTargets([role], [], new Map());
    expect(out.targets[0].memberVisibleCount).toBe(1);
    expect(out.targets[0].records[0].published).toBe(true);
  });

  it("dangling refs surface across all five seat paths, never dropped", () => {
    const out = buildRoleTargets([sundayRole()], [], new Map());
    const rec = out.targets[0].records[0];
    expect(rec.members).toEqual([]);
    expect(new Set(rec.danglingRefs)).toEqual(
      new Set(["mem-lead", "mem-bgv", "mem-chorus", "mem-inst", "mem-foh"]),
    );
  });

  it("invalid canonical role is a record issue, never a target", () => {
    const out = buildRoleTargets([sundayRole({ week: "2026-13-40" })], [], new Map());
    expect(out.targets).toHaveLength(0);
    expect(out.recordIssues).toHaveLength(1);
    expect(out.recordIssues[0].kind).toBe("invalid_role");
    expect(out.recordIssues[0].issues).toContain("date");
  });

  it("raw draft attaches to its canonical target by normalized base id -> draft_conflict", () => {
    const drafts = [sundayRole({ _id: "drafts.role-sun-1" })];
    const out = buildRoleTargets([sundayRole()], drafts, new Map());
    expect(out.targets[0].draftIds).toEqual(["drafts.role-sun-1"]);
    expect(out.targets[0].publicState).toBe("draft_conflict");
  });

  it("draft with no canonical base is a draft-only record issue (zero live targets)", () => {
    const drafts = [sundayRole({ _id: "drafts.role-orphan", week: "2026-08-02" })];
    const out = buildRoleTargets([], drafts, new Map());
    expect(out.targets).toHaveLength(0);
    expect(out.recordIssues).toHaveLength(1);
    expect(out.recordIssues[0].kind).toBe("draft_only");
    expect(out.recordIssues[0].baseId).toBe("role-orphan");
  });

  it("draft attached to an invalid canonical role stays on that record issue, not a target", () => {
    const invalid = sundayRole({ week: "bad" });
    const drafts = [sundayRole({ _id: "drafts.role-sun-1", week: "2026-08-09" })];
    const out = buildRoleTargets([invalid], drafts, new Map());
    expect(out.targets).toHaveLength(0);
    const issue = out.recordIssues.find((i) => i.kind === "invalid_role");
    expect(issue?.draftIds).toEqual(["drafts.role-sun-1"]);
  });

  it("one malformed record does not throw the whole domain", () => {
    const out = buildRoleTargets([null, sundayRole()], [], new Map());
    expect(out.targets).toHaveLength(1);
    expect(out.recordIssues.some((i) => i.kind === "invalid_role")).toBe(true);
  });
});

// ── buildSetlistTargets ───────────────────────────────────────────────────────

describe("buildSetlistTargets", () => {
  it("single featuredSongs is a ready target keyed by type:week", () => {
    const out = buildSetlistTargets([featured()], []);
    expect(out.targets).toHaveLength(1);
    const t = out.targets[0];
    expect(t.targetKey).toBe("featuredSongs:2026-07-26");
    expect(t.type).toBe("featuredSongs");
    expect(t.canonicalState).toBe("single");
    expect(t.contentState).toBe("ready");
    expect(t.songCount).toBe(1);
    expect(t.songKeys).toHaveLength(1);
  });

  it("saturdarSongs typo type is honored as a setlist target", () => {
    const out = buildSetlistTargets(
      [featured({ _id: "sl-sat", _type: "saturdarSongs" })],
      [],
    );
    expect(out.targets[0].targetKey).toBe("saturdarSongs:2026-07-26");
  });

  it("empty songs is content state empty", () => {
    const out = buildSetlistTargets([featured({ songs: [] })], []);
    expect(out.targets[0].contentState).toBe("empty");
    expect(out.targets[0].songCount).toBe(0);
  });

  it("blank play_key is incomplete", () => {
    const out = buildSetlistTargets([featured({ songs: [songEntry({ play_key: "" })] })], []);
    expect(out.targets[0].contentState).toBe("incomplete");
  });

  it("duplicate key entry is invalid content with invalid-entry issue", () => {
    const dup = [songEntry({ _key: "dup" }), songEntry({ _key: "dup" })];
    const out = buildSetlistTargets([featured({ songs: dup })], []);
    expect(out.targets[0].contentState).toBe("invalid");
    expect(out.targets[0].invalidEntries.length).toBeGreaterThan(0);
  });

  it("missing song ref is invalid content with an invalid-entry issue", () => {
    const out = buildSetlistTargets(
      [featured({ songs: [songEntry({ song: { _type: "reference" } })] })],
      [],
    );
    expect(out.targets[0].contentState).toBe("invalid");
    expect(out.targets[0].invalidEntries.some((e) => e.reasons.includes("missing_song_ref"))).toBe(true);
  });

  it("two setlists on one key is a duplicate target", () => {
    const out = buildSetlistTargets([featured({ _id: "a" }), featured({ _id: "b" })], []);
    expect(out.targets).toHaveLength(1);
    expect(out.targets[0].canonicalState).toBe("duplicate");
    expect(out.targets[0].contentState).toBe("invalid");
  });

  it("bad week is a record issue, not a target", () => {
    const out = buildSetlistTargets([featured({ week: "nope" })], []);
    expect(out.targets).toHaveLength(0);
    expect(out.recordIssues[0].kind).toBe("invalid_setlist");
  });

  it("raw setlist draft attaches by base id -> draft_conflict", () => {
    const drafts = [featured({ _id: "drafts.sl-sun-1" })];
    const out = buildSetlistTargets([featured()], drafts);
    expect(out.targets[0].draftIds).toEqual(["drafts.sl-sun-1"]);
    expect(out.targets[0].publicState).toBe("draft_conflict");
  });

  it("orphan setlist draft is a draft-only record issue", () => {
    const out = buildSetlistTargets([], [featured({ _id: "drafts.sl-orphan", week: "2026-09-06" })]);
    expect(out.targets).toHaveLength(0);
    expect(out.recordIssues[0].kind).toBe("draft_only");
    expect(out.recordIssues[0].baseId).toBe("sl-orphan");
  });

  it("special role songs are a target keyed by role id", () => {
    const special = specialRole({ songs: [songEntry()] });
    const out = buildSetlistTargets([], [], [special]);
    expect(out.targets).toHaveLength(1);
    expect(out.targets[0].targetKey).toBe("role-spec-1");
    expect(out.targets[0].type).toBe("special_role");
    expect(out.targets[0].contentState).toBe("ready");
  });

  it("special role without a songs array is not a setlist target", () => {
    const special = specialRole();
    delete (special as Record<string, unknown>).songs;
    const out = buildSetlistTargets([], [], [special]);
    expect(out.targets).toHaveLength(0);
  });

  it("one malformed setlist record does not throw the domain", () => {
    const out = buildSetlistTargets([null, featured()], []);
    expect(out.targets).toHaveLength(1);
  });
});

// ── buildProposalSummary ──────────────────────────────────────────────────────

describe("buildProposalSummary", () => {
  const resolveTo = (role: unknown) => () => role;

  it("valid proposal appears in both indexes with referenced-role metadata", () => {
    const out = buildProposalSummary([proposal()], [], resolveTo(sundayRole()));
    const rec = out.records[0];
    expect(rec.valid).toBe(true);
    expect(rec.targetKey).toBe("sunday:2026-07-26");
    expect(rec.referencedRole).toEqual({
      id: "role-sun-1",
      type: "sunday_role",
      serviceDate: "2026-07-26",
    });
    expect(out.serviceRefConflicts).toEqual([]);
    expect(out.targetKeyConflicts).toEqual([]);
    expect(rec.contentState).toBe("ready");
  });

  it("proposal whose role type disagrees with service_type is invalid and excluded from indexes", () => {
    const p = proposal({ service_type: "saturday" });
    const out = buildProposalSummary([p], [], resolveTo(sundayRole()));
    expect(out.records[0].valid).toBe(false);
    expect(out.records[0].issues).toContain("role_type_mismatch");
    expect(out.recordIssues).toHaveLength(1);
    expect(out.serviceRefConflicts).toEqual([]);
  });

  it("proposal whose date disagrees with the role is invalid", () => {
    const p = proposal({ service_date: "2026-08-02" });
    const out = buildProposalSummary([p], [], resolveTo(sundayRole()));
    expect(out.records[0].issues).toContain("date_mismatch");
  });

  it("unresolved role reference is a record issue, not an index candidate", () => {
    const out = buildProposalSummary([proposal()], [], () => null);
    expect(out.records[0].valid).toBe(false);
    expect(out.records[0].issues).toContain("role_unresolved");
    expect(out.serviceRefConflicts).toEqual([]);
    expect(out.targetKeyConflicts).toEqual([]);
  });

  it("two valid proposals on one target key is a conflict in both indexes", () => {
    const a = proposal({ _id: "prop-a" });
    const b = proposal({ _id: "prop-b" });
    const out = buildProposalSummary([a, b], [], resolveTo(sundayRole()));
    expect(out.targetKeyConflicts).toHaveLength(1);
    expect(new Set(out.targetKeyConflicts[0].ids)).toEqual(new Set(["prop-a", "prop-b"]));
    expect(out.serviceRefConflicts).toHaveLength(1);
    expect(new Set(out.serviceRefConflicts[0].ids)).toEqual(new Set(["prop-a", "prop-b"]));
  });

  it("raw proposal draft is tracked as a draft id", () => {
    const out = buildProposalSummary(
      [proposal()],
      [proposal({ _id: "drafts.prop-1" })],
      resolveTo(sundayRole()),
    );
    expect(out.draftIds).toEqual(["drafts.prop-1"]);
  });

  it("one malformed proposal record does not throw the domain", () => {
    const out = buildProposalSummary([null, proposal()], [], resolveTo(sundayRole()));
    expect(out.records.some((r) => r.valid)).toBe(true);
    expect(out.records.length).toBe(2);
  });

  it("resolveRole is called with the proposal's service_ref", () => {
    const seen: string[] = [];
    buildProposalSummary([proposal()], [], (ref) => {
      seen.push(ref);
      return sundayRole();
    });
    expect(seen).toEqual(["role-sun-1"]);
  });
});
