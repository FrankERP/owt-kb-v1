import { describe, expect, it } from "vitest";
import {
  CANONICAL_MEMBER_PROJECTION,
  PROPOSAL_PROJECTION,
  ROLE_PROJECTION,
  canonicalMembersByIdsQuery,
  canonicalProposalsQuery,
  canonicalRolesQuery,
  canonicalSetlistsQuery,
  rawProposalDraftsQuery,
  rawRoleDraftsQuery,
  rawSetlistDraftsQuery,
} from "@/app/utils/serviceReadQueries";
import { ROLE_TYPES, SETLIST_TYPES } from "@/app/utils/serviceReadModel";

describe("projections", () => {
  it("role projection covers all five seat paths and identity/date fields", () => {
    for (const frag of ["_id", "_rev", "_type", "week", "date", "Lead[]", "BGVs[]", "Chorus[]", "instruments[]", "foh_team[]", "person"]) {
      expect(ROLE_PROJECTION).toContain(frag);
    }
  });

  it("member projection includes the canonical availability fields", () => {
    for (const frag of ["_id", "_rev", "member_name", "alias", "unavailableDates", "unavailabilityNotes"]) {
      expect(CANONICAL_MEMBER_PROJECTION).toContain(frag);
    }
  });

  it("proposal projection dereferences service_ref to its id and keeps target metadata", () => {
    expect(PROPOSAL_PROJECTION).toContain('"service_ref": service_ref._ref');
    for (const frag of ["service_type", "service_date", "status", "_createdAt"]) {
      expect(PROPOSAL_PROJECTION).toContain(frag);
    }
  });
});

describe("canonical query builders", () => {
  it("bind protected types as parameters, never interpolated", () => {
    const roles = canonicalRolesQuery();
    expect(roles.params.roleTypes).toEqual([...ROLE_TYPES]);
    expect(roles.query).toContain("$roleTypes");

    const setlists = canonicalSetlistsQuery();
    expect(setlists.params.setlistTypes).toEqual([...SETLIST_TYPES]);
    expect(setlists.query).toContain("$setlistTypes");

    expect(canonicalProposalsQuery().query).toContain('_type == "setlistProposal"');
  });

  it("members-by-ids binds the id list as a parameter", () => {
    const q = canonicalMembersByIdsQuery(["m1", "m2"]);
    expect(q.params.ids).toEqual(["m1", "m2"]);
    expect(q.query).toContain("$ids");
    expect(q.query).toContain('_type == "teamMembers"');
  });

  it("no builder embeds runtime template interpolation", () => {
    const builders = [
      canonicalRolesQuery(),
      canonicalSetlistsQuery(),
      canonicalProposalsQuery(),
      canonicalMembersByIdsQuery(["x"]),
      rawRoleDraftsQuery(),
      rawSetlistDraftsQuery(),
      rawProposalDraftsQuery(),
    ];
    for (const b of builders) expect(b.query.includes("${")).toBe(false);
  });
});

describe("raw-draft inventory builders", () => {
  it("scope strictly to drafts.* documents", () => {
    for (const b of [rawRoleDraftsQuery(), rawSetlistDraftsQuery(), rawProposalDraftsQuery()]) {
      expect(b.query).toContain('path("drafts.**")');
    }
  });
});
