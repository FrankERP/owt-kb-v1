import { describe, expect, it } from "vitest";
import {
  SERVICE_CONFLICT_CODES,
  SERVICE_ERROR_CODES,
  isServiceConflictCode,
  serviceDependencyError,
  serviceError,
  serviceErrorStatus,
  type ServiceErrorCode,
} from "@/app/utils/serviceMutation";

describe("service error code registry", () => {
  it("names every conflict code the plan requires", () => {
    expect([...SERVICE_CONFLICT_CODES]).toEqual([
      "idempotency_mismatch",
      "idempotency_key_retired",
      "bootstrap_completed_reload",
      "bootstrap_outcome_unknown",
      "target_has_orphaned_dependencies",
      "role_date_has_dependencies",
      "role_has_dependencies",
      "legacy_approval_unverified",
      "stale_revision",
      "ambiguous_target",
      "integrity_conflict",
    ]);
  });

  it("includes the conflict codes plus the non-conflict codes", () => {
    for (const code of SERVICE_CONFLICT_CODES) {
      expect(SERVICE_ERROR_CODES).toContain(code);
    }
    expect(SERVICE_ERROR_CODES).toContain("invalid_request");
    expect(SERVICE_ERROR_CODES).toContain("forbidden");
    expect(SERVICE_ERROR_CODES).toContain("not_found");
    expect(new Set(SERVICE_ERROR_CODES).size).toBe(SERVICE_ERROR_CODES.length);
  });
});

describe("serviceErrorStatus", () => {
  const statuses: [ServiceErrorCode, number][] = [
    ["idempotency_mismatch", 409],
    ["idempotency_key_retired", 409],
    ["bootstrap_completed_reload", 409],
    ["bootstrap_outcome_unknown", 409],
    ["target_has_orphaned_dependencies", 409],
    ["role_date_has_dependencies", 409],
    ["role_has_dependencies", 409],
    ["legacy_approval_unverified", 409],
    ["stale_revision", 409],
    ["ambiguous_target", 409],
    ["integrity_conflict", 409],
    ["invalid_request", 400],
    ["forbidden", 403],
    ["not_found", 404],
  ];

  it.each(statuses)("maps %s -> %i", (code, status) => {
    expect(serviceErrorStatus(code)).toBe(status);
  });

  it("classifies conflicts consistently with the 409 mapping", () => {
    for (const code of SERVICE_ERROR_CODES) {
      expect(isServiceConflictCode(code)).toBe(serviceErrorStatus(code) === 409);
    }
  });

  it("fails closed to 409 for an unknown code", () => {
    expect(serviceErrorStatus("nope" as ServiceErrorCode)).toBe(409);
    expect(isServiceConflictCode("nope")).toBe(false);
  });
});

describe("serviceError", () => {
  it("builds a consistent body with a default message", () => {
    const { status, body } = serviceError("idempotency_mismatch");
    expect(status).toBe(409);
    expect(body.error).toBe("idempotency_mismatch");
    expect(body.conflict).toBe(true);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
    expect(body.details).toBeUndefined();
  });

  it("gives every registered code a distinct non-empty default message", () => {
    const messages = SERVICE_ERROR_CODES.map((code) => serviceError(code).body.message);
    expect(messages.every((m) => m.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("allows an override message and structured details", () => {
    const { status, body } = serviceError("stale_revision", {
      message: "role revision moved on",
      details: { roleId: "role-1", expectedRev: "a", actualRev: "b" },
    });
    expect(status).toBe(409);
    expect(body).toEqual({
      error: "stale_revision",
      message: "role revision moved on",
      conflict: true,
      details: { roleId: "role-1", expectedRev: "a", actualRev: "b" },
    });
  });

  it("marks non-conflict codes as non-conflicts", () => {
    expect(serviceError("invalid_request").body.conflict).toBe(false);
    expect(serviceError("forbidden")).toMatchObject({ status: 403 });
    expect(serviceError("not_found")).toMatchObject({ status: 404 });
  });

  it("is JSON-serializable with no undefined leakage", () => {
    const { body } = serviceError("bootstrap_completed_reload", { details: { bootstrapped: true } });
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });
});

describe("serviceDependencyError", () => {
  const dependencies = [
    { id: "featuredSongs-1", type: "featuredSongs", kind: "canonical_setlist", scope: "old" as const },
    { id: "prop-1", type: "setlistProposal", kind: "proposal", scope: "new" as const },
  ];

  it("returns the exact ids and types that populate the dependency codes", () => {
    const { status, body } = serviceDependencyError("role_date_has_dependencies", dependencies);
    expect(status).toBe(409);
    expect(body.error).toBe("role_date_has_dependencies");
    expect(body.conflict).toBe(true);
    expect(body.details).toEqual({ dependencies });
  });

  it.each([
    "target_has_orphaned_dependencies",
    "role_date_has_dependencies",
    "role_has_dependencies",
  ] as const)("supports the %s code", (code) => {
    expect(serviceDependencyError(code, dependencies).body.error).toBe(code);
  });

  it("still reports a consistent body when the dependency list is empty", () => {
    const { body } = serviceDependencyError("role_has_dependencies", []);
    expect(body.details).toEqual({ dependencies: [] });
  });
});
