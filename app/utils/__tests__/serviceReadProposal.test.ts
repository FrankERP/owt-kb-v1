import { describe, expect, it } from "vitest";
import {
  indexProposals,
  orderProposals,
  validateProposal,
} from "@/app/utils/serviceReadModel";

// Canonical role the proposal points at (sunday, week 2026-07-26).
function roleFor(over: Record<string, unknown> = {}) {
  return {
    _id: "role-1",
    _rev: "r1",
    _type: "sunday_role",
    week: "2026-07-26",
    Lead: [{ _key: "k1", _type: "reference", _ref: "m1" }],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
}

function proposalDoc(over: Record<string, unknown> = {}) {
  return {
    _id: "prop-1",
    _rev: "pr1",
    _createdAt: "2026-07-01T10:00:00Z",
    service_type: "sunday",
    service_ref: "role-1",
    service_date: "2026-07-26",
    status: "pending",
    songs: [{ _key: "s1", play_key: "G", song: { _type: "reference", _ref: "song-1" } }],
    ...over,
  };
}

describe("validateProposal", () => {
  it("accepts a well-formed proposal whose role/type/date agree", () => {
    const r = validateProposal(proposalDoc(), roleFor());
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.targetKey).toBe("sunday:2026-07-26");
    expect(r.serviceRef).toBe("role-1");
    expect(r.contentState).toBe("ready");
  });

  it("validates content separately from grouping validity", () => {
    // Groupable/valid, but a dangling-keyless song makes content invalid.
    const r = validateProposal(proposalDoc({ songs: [{ play_key: "G", song: { _type: "reference", _ref: "x" } }] }), roleFor());
    expect(r.valid).toBe(true);
    expect(r.contentState).toBe("invalid");
  });

  it.each([
    ["identity", { _id: "" }],
    ["service_type", { service_type: "midweek" }],
    ["service_ref", { service_ref: "" }],
    ["date", { service_date: "2026-7-1" }],
    ["status", { status: "archived" }],
  ])("flags %s", (tag, over) => {
    const r = validateProposal(proposalDoc(over), roleFor());
    expect(r.valid).toBe(false);
    expect(r.issues).toContain(tag);
  });

  it("flags an unresolved role", () => {
    const r = validateProposal(proposalDoc(), null);
    expect(r.valid).toBe(false);
    expect(r.issues).toContain("role_unresolved");
  });

  it("flags a role that is not groupable", () => {
    const r = validateProposal(proposalDoc(), roleFor({ week: "bad-date" }));
    expect(r.valid).toBe(false);
    expect(r.issues).toContain("role_not_groupable");
  });

  it("flags a role type that disagrees with service_type", () => {
    const r = validateProposal(
      proposalDoc({ service_type: "saturday", service_date: "2026-07-26" }),
      roleFor({ _type: "sunday_role" }),
    );
    expect(r.valid).toBe(false);
    expect(r.issues).toContain("role_type_mismatch");
  });

  it("flags a service_date that disagrees with the role's date", () => {
    const r = validateProposal(proposalDoc({ service_date: "2026-08-02" }), roleFor({ week: "2026-07-26" }));
    expect(r.valid).toBe(false);
    expect(r.issues).toContain("date_mismatch");
  });

  it("resolves a special proposal against a special role's date", () => {
    const r = validateProposal(
      proposalDoc({ service_type: "special", service_ref: "sp-1", service_date: "2026-07-30" }),
      roleFor({ _id: "sp-1", _type: "special_role", week: undefined, date: "2026-07-30" }),
    );
    expect(r.valid).toBe(true);
    expect(r.targetKey).toBe("special:sp-1");
  });
});

describe("orderProposals", () => {
  it("orders pending, changes_requested, draft, approved, then oldest first", () => {
    const mk = (status: string, createdAt: string) => ({ status, createdAt, serviceRef: "x", targetKey: "t", valid: true });
    const ordered = orderProposals([
      mk("approved", "2026-01-01T00:00:00Z"),
      mk("draft", "2026-01-01T00:00:00Z"),
      mk("pending", "2026-06-02T00:00:00Z"),
      mk("pending", "2026-06-01T00:00:00Z"),
      mk("changes_requested", "2026-01-01T00:00:00Z"),
    ] as never[]);
    expect(ordered.map((p: { status: string }) => p.status)).toEqual([
      "pending",
      "pending",
      "changes_requested",
      "draft",
      "approved",
    ]);
    // Within pending, oldest createdAt first.
    expect((ordered[0] as { createdAt: string }).createdAt).toBe("2026-06-01T00:00:00Z");
  });
});

describe("indexProposals", () => {
  it("indexes only valid proposals, by service_ref and by target key", () => {
    const valid = validateProposal(proposalDoc(), roleFor());
    const invalid = validateProposal(proposalDoc({ _id: "prop-2", status: "archived" }), roleFor());
    const { byServiceRef, byTargetKey } = indexProposals([valid, invalid]);
    expect(byServiceRef.get("role-1")).toHaveLength(1);
    expect(byTargetKey.get("sunday:2026-07-26")).toHaveLength(1);
  });

  it("surfaces a grouping conflict as multiple valid entries under one key", () => {
    const a = validateProposal(proposalDoc({ _id: "prop-a" }), roleFor());
    const b = validateProposal(proposalDoc({ _id: "prop-b" }), roleFor());
    const { byTargetKey } = indexProposals([a, b]);
    expect(byTargetKey.get("sunday:2026-07-26")).toHaveLength(2);
  });
});
