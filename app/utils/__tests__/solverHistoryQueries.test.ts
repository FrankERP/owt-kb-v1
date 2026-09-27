// R9 — the three additive read builders the solver-history loader (Task 3)
// composes: weekend roles in a date range, every member's current name, and
// weekend role-creation receipts. New file so the existing
// serviceReadQueries.test.ts stays untouched (task-2 brief).

import { describe, expect, it } from "vitest";
import {
  ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION,
  ROLE_CREATION_RECEIPT_PROJECTION,
  canonicalMemberNamesQuery,
  canonicalWeekendRolesInRangeQuery,
  weekendRoleCreationReceiptsQuery,
} from "@/app/utils/serviceReadQueries";

const WEEKEND_TYPES = ["sunday_role", "saturday_role"];

describe("canonicalWeekendRolesInRangeQuery", () => {
  it("binds the weekend-only role types and the range bounds as parameters", () => {
    const q = canonicalWeekendRolesInRangeQuery("2026-07-01", "2026-08-01");
    expect(q.params.roleTypes).toEqual(WEEKEND_TYPES);
    expect(q.params.from).toBe("2026-07-01");
    expect(q.params.to).toBe("2026-08-01");
    expect(q.query).toContain("$roleTypes");
    expect(q.query).toContain("$from");
    expect(q.query).toContain("$to");
  });

  it("never names special_role — weekend-only", () => {
    const q = canonicalWeekendRolesInRangeQuery("2026-07-01", "2026-08-01");
    expect(q.params.roleTypes).not.toContain("special_role");
  });

  it("carries no `published` filter clause — prior-month drafts count (R3)", () => {
    const q = canonicalWeekendRolesInRangeQuery("2026-07-01", "2026-08-01");
    expect(q.query).not.toMatch(/published\s*!=\s*false/);
    expect(q.query).not.toMatch(/published\s*==\s*true/);
  });

  it("leaves no unresolved `${` template placeholder in the built query", () => {
    const q = canonicalWeekendRolesInRangeQuery("2026-07-01", "2026-08-01");
    expect(q.query).not.toContain("${");
  });

  it("filters week with a half-open range: >= from, < to", () => {
    const q = canonicalWeekendRolesInRangeQuery("2026-07-01", "2026-08-01");
    expect(q.query).toContain("week >= $from");
    expect(q.query).toContain("week < $to");
  });
});

describe("canonicalMemberNamesQuery", () => {
  it("reads every teamMembers document with no ministry filter (R7)", () => {
    const q = canonicalMemberNamesQuery();
    expect(q.query).toContain('_type == "teamMembers"');
    expect(q.query).not.toMatch(/ministries/);
    expect(q.params).toEqual({});
  });

  it("projects only _id and member_name", () => {
    const q = canonicalMemberNamesQuery();
    expect(q.query).toContain("_id");
    expect(q.query).toContain("member_name");
  });

  it("leaves no unresolved `${` template placeholder", () => {
    expect(canonicalMemberNamesQuery().query).not.toContain("${");
  });
});

describe("ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION", () => {
  it("carries createdAt and updatedAt on top of every existing receipt field", () => {
    for (const frag of ["createdAt", "updatedAt"]) {
      expect(ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION).toContain(frag);
    }
  });

  it("is additive — every field of the existing receipt projection is still present", () => {
    const existingFields = ROLE_CREATION_RECEIPT_PROJECTION
      .replace(/[{}]/g, "")
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    for (const field of existingFields) {
      expect(ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION).toContain(field);
    }
  });
});

describe("weekendRoleCreationReceiptsQuery", () => {
  it("binds the weekend-only role types as a parameter, filtering roleType", () => {
    const q = weekendRoleCreationReceiptsQuery();
    expect(q.params.roleTypes).toEqual(WEEKEND_TYPES);
    expect(q.query).toContain("$roleTypes");
    expect(q.query).toContain('_type == "roleCreationReceipt"');
    expect(q.query).toContain("roleType in $roleTypes");
  });

  it("never names special_role — weekend-only", () => {
    expect(weekendRoleCreationReceiptsQuery().params.roleTypes).not.toContain("special_role");
  });

  it("projects createdAt, so the evidence projection (not the plain one) backs this read", () => {
    expect(weekendRoleCreationReceiptsQuery().query).toContain("createdAt");
  });

  it("leaves no unresolved `${` template placeholder in the built query", () => {
    expect(weekendRoleCreationReceiptsQuery().query).not.toContain("${");
  });

  it("carries no `published` clause — roleCreationReceipt has no publish state", () => {
    expect(weekendRoleCreationReceiptsQuery().query).not.toMatch(/published/);
  });
});
