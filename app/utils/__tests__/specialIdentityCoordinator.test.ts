import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const operationalFetch = vi.fn();

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...args: unknown[]) => operationalFetch(...args) },
}));

import {
  SPECIAL_IDENTITY_COORDINATOR_ID,
  SPECIAL_IDENTITY_COORDINATOR_TYPE,
  loadSpecialIdentityCoordinator,
  planSpecialIdentityCoordinatorClaim,
  specialIdentityCoordinatorQuery,
  validateSpecialIdentityCoordinator,
} from "../specialIdentityCoordinator";

const NOW = "2026-08-04T18:00:00.000Z";

function coordinator(over: Record<string, unknown> = {}) {
  return {
    _id: SPECIAL_IDENTITY_COORDINATOR_ID,
    _rev: "coord-rev-7",
    _type: SPECIAL_IDENTITY_COORDINATOR_TYPE,
    version: 7,
    claimNonce: "nonce-7",
    updatedAt: "2026-08-04T17:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  operationalFetch.mockReset();
});

describe("special identity coordinator identity and read", () => {
  it("uses one deterministic id and a bound published operational query", async () => {
    operationalFetch.mockResolvedValue([]);
    const result = await loadSpecialIdentityCoordinator();
    expect(result).toEqual({ ok: true, coordinator: null });

    const bound = specialIdentityCoordinatorQuery();
    expect(bound.params).toEqual({ id: SPECIAL_IDENTITY_COORDINATOR_ID });
    expect(bound.query).toContain('_type == "specialIdentityCoordinator"');
    expect(bound.query).toContain("_id == $id");
    expect(operationalFetch).toHaveBeenCalledWith(bound.query, bound.params);
  });

  it("returns the one valid stored coordinator", async () => {
    operationalFetch.mockResolvedValue([coordinator()]);
    await expect(loadSpecialIdentityCoordinator()).resolves.toEqual({
      ok: true,
      coordinator: coordinator(),
    });
  });

  it("fails closed on malformed results and duplicate rows", async () => {
    operationalFetch.mockResolvedValue(null);
    await expect(loadSpecialIdentityCoordinator()).resolves.toEqual({
      ok: false,
      issues: ["query_result"],
    });

    operationalFetch.mockResolvedValue([coordinator(), coordinator({ _rev: "other" })]);
    await expect(loadSpecialIdentityCoordinator()).resolves.toEqual({
      ok: false,
      issues: ["cardinality"],
    });

    operationalFetch.mockResolvedValue([coordinator({ version: 0 })]);
    await expect(loadSpecialIdentityCoordinator()).resolves.toEqual({
      ok: false,
      issues: ["version"],
    });
  });
});

describe("special identity coordinator validation and claims", () => {
  it.each([
    ["id", { _id: "wrong" }],
    ["rev", { _rev: "" }],
    ["type", { _type: "wrong" }],
    ["version", { version: 1.5 }],
    ["version", { version: Number.MAX_SAFE_INTEGER + 1 }],
    ["claimNonce", { claimNonce: "" }],
    ["updatedAt", { updatedAt: "not-a-datetime" }],
  ])("refuses malformed %s state rather than repairing it", (issue, over) => {
    expect(validateSpecialIdentityCoordinator(coordinator(over))).toEqual({
      ok: false,
      issues: [issue],
    });
    expect(
      planSpecialIdentityCoordinatorClaim(coordinator(over), {
        claimNonce: () => "nonce-8",
        now: () => NOW,
      }),
    ).toEqual({ ok: false, issues: [issue] });
  });

  it("plans first use as a deterministic version-1 create with a fresh nonce", () => {
    expect(
      planSpecialIdentityCoordinatorClaim(null, {
        claimNonce: () => "nonce-1",
        now: () => NOW,
      }),
    ).toEqual({
      ok: true,
      kind: "create",
      claimNonce: "nonce-1",
      document: {
        _id: SPECIAL_IDENTITY_COORDINATOR_ID,
        _type: SPECIAL_IDENTITY_COORDINATOR_TYPE,
        version: 1,
        claimNonce: "nonce-1",
        updatedAt: NOW,
      },
    });
  });

  it("plans later use under the observed revision and advances version plus nonce", () => {
    expect(
      planSpecialIdentityCoordinatorClaim(coordinator(), {
        claimNonce: () => "nonce-8",
        now: () => NOW,
      }),
    ).toEqual({
      ok: true,
      kind: "patch",
      id: SPECIAL_IDENTITY_COORDINATOR_ID,
      ifRevisionId: "coord-rev-7",
      claimNonce: "nonce-8",
      set: { version: 8, claimNonce: "nonce-8", updatedAt: NOW },
    });
  });

  it("refuses an equal nonce instead of producing a no-op claim", () => {
    expect(
      planSpecialIdentityCoordinatorClaim(coordinator(), {
        claimNonce: () => "nonce-7",
        now: () => NOW,
      }),
    ).toEqual({ ok: false, issues: ["claimNonce_not_fresh"] });
  });

  it("refuses version exhaustion instead of producing an unsafe increment", () => {
    expect(
      planSpecialIdentityCoordinatorClaim(coordinator({ version: Number.MAX_SAFE_INTEGER }), {
        claimNonce: () => "nonce-next",
        now: () => NOW,
      }),
    ).toEqual({ ok: false, issues: ["version_exhausted"] });
  });

  it("refuses invalid newly generated claim metadata", () => {
    expect(
      planSpecialIdentityCoordinatorClaim(coordinator(), {
        claimNonce: () => "nonce-8",
        now: () => "not-a-datetime",
      }),
    ).toEqual({ ok: false, issues: ["newUpdatedAt"] });
  });

  it("makes two claims from one revision mutually exclusive", () => {
    const first = planSpecialIdentityCoordinatorClaim(coordinator(), {
      claimNonce: () => "nonce-a",
      now: () => NOW,
    });
    const second = planSpecialIdentityCoordinatorClaim(coordinator(), {
      claimNonce: () => "nonce-b",
      now: () => NOW,
    });
    expect(first.ok && first.kind).toBe("patch");
    expect(second.ok && second.kind).toBe("patch");
    if (!first.ok || first.kind !== "patch" || !second.ok || second.kind !== "patch") return;

    let storedRev = "coord-rev-7";
    const commit = (expectedRev: string) => {
      if (storedRev !== expectedRev) return false;
      storedRev = "coord-rev-8";
      return true;
    };
    expect([commit(first.ifRevisionId), commit(second.ifRevisionId)]).toEqual([true, false]);
  });
});
