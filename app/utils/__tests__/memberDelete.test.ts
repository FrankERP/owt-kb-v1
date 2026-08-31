import { describe, expect, it } from "vitest";

import {
  interpretMemberDeleteResponse,
  isSanityReferentialIntegrityError,
  memberIdInSolverPools,
  MEMBER_DELETE_ERROR,
  MEMBER_HAS_REFERENCES_MESSAGE,
  MEMBER_POOL_CLEANUP_FAILED_MESSAGE,
  solverPoolCleanupPatch,
} from "@/app/utils/memberDelete";

describe("isSanityReferentialIntegrityError", () => {
  it("recognizes referential delete rejection by message", () => {
    expect(
      isSanityReferentialIntegrityError({
        statusCode: 409,
        message: 'Document "m1" cannot be deleted as there are references to it from "role-1"',
      }),
    ).toBe(true);
  });

  it("recognizes referential delete rejection by mutation item type", () => {
    expect(
      isSanityReferentialIntegrityError({
        statusCode: 409,
        details: {
          type: "mutationError",
          items: [{ error: { type: "referenceConstraintError", description: "blocked" } }],
        },
      }),
    ).toBe(true);
  });

  it("does not treat revision conflicts as referential integrity", () => {
    expect(
      isSanityReferentialIntegrityError({
        statusCode: 409,
        details: {
          type: "mutationError",
          items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }],
        },
      }),
    ).toBe(false);
  });

  it("rejects unrelated errors", () => {
    expect(isSanityReferentialIntegrityError(new Error("network"))).toBe(false);
    expect(isSanityReferentialIntegrityError({ statusCode: 401 })).toBe(false);
  });
});

describe("solver pool cleanup helpers", () => {
  const doc = {
    sundayLeads: ["a", "b"],
    saturdayLeads: ["b"],
    support: ["c"],
  };

  it("detects member id in any pool", () => {
    expect(memberIdInSolverPools(doc, "b")).toBe(true);
    expect(memberIdInSolverPools(doc, "z")).toBe(false);
  });

  it("returns null patch when id absent from pools", () => {
    expect(solverPoolCleanupPatch(doc, "z")).toBeNull();
  });

  it("removes id from all three pools", () => {
    expect(solverPoolCleanupPatch(doc, "b")).toEqual({
      sundayLeads: ["a"],
      saturdayLeads: [],
      support: ["c"],
    });
  });
});

describe("interpretMemberDeleteResponse", () => {
  it("maps success", () => {
    expect(interpretMemberDeleteResponse(true, {})).toEqual({ kind: "success" });
  });

  it("maps R8 referential integrity", () => {
    expect(
      interpretMemberDeleteResponse(false, {
        error: MEMBER_DELETE_ERROR.HAS_REFERENCES,
        message: MEMBER_HAS_REFERENCES_MESSAGE,
      }),
    ).toEqual({
      kind: "references",
      message: MEMBER_HAS_REFERENCES_MESSAGE,
    });
  });

  it("maps R9b partial delete with list refresh", () => {
    expect(
      interpretMemberDeleteResponse(false, {
        error: MEMBER_DELETE_ERROR.POOL_CLEANUP_FAILED,
        message: MEMBER_POOL_CLEANUP_FAILED_MESSAGE,
        deleted: true,
      }),
    ).toEqual({
      kind: "partial",
      message: MEMBER_POOL_CLEANUP_FAILED_MESSAGE,
      refreshList: true,
    });
  });

  it("maps generic failure", () => {
    expect(interpretMemberDeleteResponse(false, { error: "other" })).toEqual({ kind: "generic" });
  });
});
