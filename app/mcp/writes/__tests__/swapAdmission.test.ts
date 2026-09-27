// `swapAdmission.ts`'s pure stages, on the branches the tool's twin fixture
// cannot reach on its own: the S4 source gate running BEFORE existence (a dead
// `roles` read must never read as "not found"), stage 2's weekend-duplicate
// branch (readiness already catches a duplicate weekend target, so only a
// change landing between the snapshot and the occupancy read reaches it), the
// lock-issue kind parsed from `lockIssuesToIntegrity`'s `reason`, and the
// labels the texts use. The end-to-end rows live in
// `app/mcp/tools/__tests__/swapAssignment.test.ts`.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The module's thin loader reaches Sanity through its two loaders; the pure
// stages under test never call it, so the clients only need to exist.
const { noClient } = vi.hoisted(() => ({
  noClient: { fetch: () => Promise.reject(new Error("no read in a pure test")) },
}));
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: noClient, rawIntegrityClient: noClient }));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: noClient, writeClient: noClient }));

import type { AssembledService } from "@/app/utils/publishReadyBundle";
import type { ServiceSourceStates } from "@/app/components/admin/serviceReadiness";
import {
  SWAP_SOURCES_UNREADY_TEXT,
  admitSwapOccupancy,
  admitSwapServices,
  swapServiceLabel,
  type AdmittedService,
  type SwapCandidate,
} from "../swapAdmission";

const READY: ServiceSourceStates = {
  roles: "ready",
  members: "ready",
  proposals: "ready",
  roleTargets: "ready",
  setlistTargets: "ready",
};

/** Only the fields the admission reads; the rest of `AssembledService` is irrelevant here. */
function assembled(over: {
  recordStatus?: string;
  roleTargetStatus?: string;
  danglingRefCount?: number;
  integrityIssues?: { kind: string; blocking: boolean; ids: string[]; reason?: string }[];
  roleType?: string;
  observation?: boolean;
}): AssembledService {
  return {
    readiness: {
      recordStatus: over.recordStatus ?? "valid",
      roleTargetStatus: over.roleTargetStatus ?? "single",
      danglingRefCount: over.danglingRefCount ?? 0,
      integrityIssues: over.integrityIssues ?? [],
    },
    observation: over.observation === false ? null : { roleType: over.roleType ?? "sunday_role" },
  } as unknown as AssembledService;
}

function candidate(serviceId: string, row: Record<string, unknown> | null, a: AssembledService | null): SwapCandidate {
  return { serviceId, row, assembled: a };
}

const SUNDAY_ROW = { _id: "r1", _type: "sunday_role", week: "2028-10-01" };
const SUNDAY_ROW_2 = { _id: "r2", _type: "sunday_role", week: "2028-10-08" };

describe("admitSwapServices", () => {
  it("S4 runs before existence: a failed roles read is «no se pudo comprobar», never not_found", () => {
    const result = admitSwapServices({ ...READY, roles: "error" }, [candidate("r1", null, null), candidate("r2", null, null)]);
    expect(result).toEqual({
      ok: false,
      refusal: { kind: "gate", code: "integrity_conflict", detail: "sources:roles", text: SWAP_SOURCES_UNREADY_TEXT },
    });
  });

  it("names every unready source the swap control needs, and ignores the ones it does not", () => {
    const blocked = admitSwapServices({ ...READY, members: "loading", roleTargets: "error" }, []);
    expect(blocked.ok ? null : blocked.refusal).toMatchObject({ detail: "sources:members,roleTargets" });
    // Proposals and setlists are not the swap control's sources.
    const fine = admitSwapServices({ ...READY, proposals: "error", setlistTargets: "error" }, [
      candidate("r1", SUNDAY_ROW, assembled({})),
      candidate("r2", SUNDAY_ROW_2, assembled({})),
    ]);
    expect(fine.ok).toBe(true);
  });

  it("an invalid record is refused, before anything else about it", () => {
    const result = admitSwapServices(READY, [candidate("r1", SUNDAY_ROW, assembled({ recordStatus: "invalid", observation: false }))]);
    expect(result.ok ? null : result.refusal).toMatchObject({ code: "integrity_conflict", detail: "invalid_record", serviceId: "r1" });
  });

  it("a role target that is neither single, duplicate nor a draft conflict is refused by its status", () => {
    const result = admitSwapServices(READY, [candidate("r1", SUNDAY_ROW, assembled({ roleTargetStatus: "invalid" }))]);
    expect(result.ok ? null : result.refusal).toMatchObject({ code: "integrity_conflict", detail: "role_target_invalid" });
  });

  it("reads the lock issue's kind from `reason` (`kind` or `kind: detail`)", () => {
    const lock = (reason: string) =>
      admitSwapServices(READY, [
        candidate("r1", SUNDAY_ROW, assembled({ integrityIssues: [{ kind: "lock", blocking: true, ids: [], reason }] })),
      ]);
    const wrong = lock("wrong_owner: role owns sunday_role|2028-10-08");
    expect(wrong.ok ? null : wrong.refusal).toMatchObject({ detail: "lock:wrong_owner" });
    const missing = lock("missing_lock");
    expect(missing.ok ? null : missing.refusal).toMatchObject({
      detail: "lock:missing_lock",
      text: "El domingo 2028-10-01 es un servicio antiguo sin su dato de coordinación; guárdalo una vez desde el planner de /admin y vuelve a leer.",
    });
  });

  it("a non-lock integrity issue (a setlist or proposal problem) is NOT a swap gate", () => {
    const result = admitSwapServices(READY, [
      candidate("r1", SUNDAY_ROW, assembled({ integrityIssues: [{ kind: "setlist_duplicate", blocking: true, ids: [] }] })),
      candidate("r2", SUNDAY_ROW_2, assembled({ integrityIssues: [{ kind: "proposal_conflict", blocking: true, ids: [] }] })),
    ]);
    expect(result.ok).toBe(true);
  });

  it("S1 compares the stored day strings' YYYY-MM only", () => {
    const sameMonth = admitSwapServices(READY, [
      candidate("r1", { ...SUNDAY_ROW, week: "2028-10-31" }, assembled({})),
      candidate("r2", { ...SUNDAY_ROW_2, week: "2028-10-01" }, assembled({})),
    ]);
    expect(sameMonth.ok).toBe(true);
    const crossMonth = admitSwapServices(READY, [
      candidate("r1", { ...SUNDAY_ROW, week: "2028-10-31" }, assembled({})),
      candidate("r2", { ...SUNDAY_ROW_2, week: "2028-11-01" }, assembled({})),
    ]);
    expect(crossMonth.ok ? null : crossMonth.refusal).toMatchObject({ code: "invalid_request", detail: "cross_month" });
  });
});

describe("admitSwapOccupancy", () => {
  const weekend: AdmittedService = {
    serviceId: "r1",
    roleType: "sunday_role",
    special: false,
    date: "2028-10-01",
    serviceName: null,
    label: "el domingo 2028-10-01",
  };
  const special: AdmittedService = {
    serviceId: "s1",
    roleType: "special_role",
    special: true,
    date: "2028-10-02",
    serviceName: "Vigilia",
    label: "el especial «Vigilia» del 2028-10-02",
  };
  const clear = { canonicalRoleIds: [], rawDraftIds: [] };

  it("another canonical role at a WEEKEND target is duplicate_weekend_target (S2a)", () => {
    const result = admitSwapOccupancy([weekend, special], [{ canonicalRoleIds: ["r9"], rawDraftIds: [] }, clear]);
    expect(result.ok ? null : result.refusal).toMatchObject({
      code: "ambiguous_target",
      detail: "duplicate_weekend_target",
      serviceId: "r1",
    });
  });

  it("another same-name special is duplicate_special_identity (S2b)", () => {
    const result = admitSwapOccupancy([weekend, special], [clear, { canonicalRoleIds: ["s9"], rawDraftIds: [] }]);
    expect(result.ok ? null : result.refusal).toMatchObject({ detail: "duplicate_special_identity", serviceId: "s1" });
  });

  it("a raw draft at the target is raw_draft (S2c); a clear pair is admitted", () => {
    const drafted = admitSwapOccupancy([weekend, special], [clear, { canonicalRoleIds: [], rawDraftIds: ["drafts.x"] }]);
    expect(drafted.ok ? null : drafted.refusal).toMatchObject({ code: "integrity_conflict", detail: "raw_draft" });
    expect(admitSwapOccupancy([weekend, special], [clear, clear])).toEqual({ ok: true, value: [weekend, special] });
  });
});

describe("swapServiceLabel", () => {
  it("names a service by kind, date and (for a special) name — never by id", () => {
    expect(swapServiceLabel({ _type: "saturday_role", week: "2028-10-07" })).toBe("el sábado 2028-10-07");
    expect(swapServiceLabel({ _type: "special_role", date: "2028-10-03", service_name: "  " })).toBe(
      "el especial sin nombre del 2028-10-03",
    );
    expect(swapServiceLabel(null)).toBe("el servicio");
  });
});
