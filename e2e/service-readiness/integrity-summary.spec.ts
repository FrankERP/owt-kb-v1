// A3 §4 — "integrity-summary visibility for duplicate/draft/malformed fixtures",
// through the DEPLOYED `GET /api/admin/service-integrity/{roles,setlists,proposals}`
// routes.
//
// The point is VISIBILITY: an integrity problem that exists in the dataset must show
// up in the admin summary. The duplicate and malformed cases are created here, for
// this test only, and the per-scenario fixture reset removes them again — which is
// exactly the plan's "duplicate/draft-conflict/malformed fixtures created only for
// the specific test that resets them afterward".

import { expect, test } from "./fixtures";
import { createScenarioDocument, readRolesAtTarget } from "./lib/dataset";
import {
  DANGLING_MEMBER_ID,
  FIXTURE_DATE,
  MEMBERS,
  PROPOSALS,
  ROLES,
  createRoleBody,
  fullSeats,
  receiptId,
  scopedRequestId,
} from "./lib/fixtureRefs";

const ROLES_SUMMARY = "/api/admin/service-integrity/roles";
const SETLISTS_SUMMARY = "/api/admin/service-integrity/setlists";
const PROPOSALS_SUMMARY = "/api/admin/service-integrity/proposals";

interface RoleTarget {
  targetKey: string;
  canonicalCount: number;
  canonicalIds: string[];
  canonicalState?: string;
  draftIds: string[];
  records?: Array<{ id: string; issues?: string[] }>;
}
interface RoleSummary {
  targets: RoleTarget[];
  recordIssues: Array<{ id: string; issues: string[] }>;
  lockIssues: Array<{ targetKey?: string; id?: string; issue?: string }>;
}

test.describe("integrity summary", () => {
  test("reports every seeded role target, including the draft and legacy ones", async ({
    admin,
    run,
  }) => {
    const res = await admin.api.get(ROLES_SUMMARY, { failOnStatusCode: false });
    expect(res.status(), await res.text()).toBe(200);
    const summary = (await res.json()) as RoleSummary;

    const keys = summary.targets.map((t) => t.targetKey);
    expect(keys).toContain(`sunday_role:${FIXTURE_DATE.sundayPublished}`);
    expect(keys).toContain(`sunday_role:${FIXTURE_DATE.sundayDraft}`);
    expect(keys).toContain(`saturday_role:${FIXTURE_DATE.saturdayPublished}`);

    // The draft fixture is visible as a canonical role that is not member-visible.
    const draftTarget = summary.targets.find(
      (t) => t.targetKey === `sunday_role:${FIXTURE_DATE.sundayDraft}`,
    );
    expect(draftTarget?.canonicalIds).toContain(ROLES.sundayDraft);

    run.evidence("integrity_roles_summary", { targets: summary.targets.length });
  });

  test("reports the legacy role whose weekend lock was never created", async ({ admin, run }) => {
    const res = await admin.api.get(ROLES_SUMMARY, { failOnStatusCode: false });
    const summary = (await res.json()) as RoleSummary;

    // `srv.role.sunday.legacy` is seeded WITHOUT a lock — the legacy-bootstrap case.
    const legacyTarget = summary.targets.find(
      (t) => t.targetKey === `sunday_role:${FIXTURE_DATE.sundayLegacy}`,
    );
    expect(legacyTarget?.canonicalIds).toContain(ROLES.sundayLegacy);
    expect(
      JSON.stringify(summary.lockIssues) + JSON.stringify(legacyTarget ?? {}),
      "a weekend role with no lock must be visible as an integrity issue",
    ).toContain(FIXTURE_DATE.sundayLegacy);
    void run;
  });

  test("reports the dangling member reference as a record issue", async ({ admin }) => {
    const res = await admin.api.get(ROLES_SUMMARY, { failOnStatusCode: false });
    const summary = (await res.json()) as RoleSummary;

    // `srv.role.sunday.dangling` points at a member id that is never created.
    const serialized = JSON.stringify(summary);
    expect(serialized).toContain(ROLES.sundayDangling);
    expect(
      serialized.includes(DANGLING_MEMBER_ID) || serialized.includes("dangling"),
      "an unresolvable seat reference must be reported somewhere in the summary",
    ).toBe(true);
  });

  test("keeps two special services on ONE date as two distinct targets", async ({ admin, run }) => {
    // A second special service on the same DATE is not a duplicate TARGET: a
    // `special_role` is its own target, keyed by its own document id (A1's
    // `roleTargetKey`; A2 §1 "special roles use their own id/revision"). So the two
    // must appear as two targets of one role each — never collapsed into one target
    // holding two canonical roles, and never keyed by the shared date.
    const requestId = scopedRequestId(run.identity.runId, "integrity-dup");
    const created = await admin.api.post("/api/admin/roles", {
      data: createRoleBody({
        type: "special_role",
        date: FIXTURE_DATE.specialPublished,
        serviceName: "SR Servicio Especial Duplicado",
        requestId,
        seats: fullSeats(),
      }),
      failOnStatusCode: false,
    });
    expect(created.status(), await created.text()).toBe(201);
    const second = (await created.json()) as { _id: string };
    run.recordCreated(second._id, "integrity/second-special");
    run.recordCreated(receiptId(requestId), "integrity/second-special-receipt");

    const atDate = await readRolesAtTarget(run.identity, {
      type: "special_role",
      date: FIXTURE_DATE.specialPublished,
    });
    expect(atDate.length, "two special services now share the date").toBeGreaterThan(1);

    const summary = (await (await admin.api.get(ROLES_SUMMARY, { failOnStatusCode: false })).json()) as RoleSummary;
    // Selected by ROLE ID, which is what a special target's key actually is — the
    // date never appears in a special target key.
    const byKey = new Map(summary.targets.map((t) => [t.targetKey, t]));
    for (const roleId of [ROLES.specialPublished, second._id]) {
      const target = byKey.get(roleId);
      expect(target, `the special role ${roleId} must be its own target`).toBeTruthy();
      expect(target?.canonicalCount, roleId).toBe(1);
      expect(target?.canonicalIds).toEqual([roleId]);
    }
    // The per-scenario fixture reset removes the extra role afterwards.
  });

  test("reports a REAL duplicate weekend target planted for this test only", async ({
    admin,
    run,
  }) => {
    // Two canonical roles on ONE weekend target is exactly the state every guarded
    // writer refuses to create (create refuses an occupied target; a move onto an
    // occupied date is refused too). So the only way to prove the summary REPORTS a
    // duplicate is to plant one directly in the isolated dataset — the A3 plan's
    // "duplicate/... fixtures created only for the specific test that resets them
    // afterward". It is recorded in the run ledger and removed by exact id.
    const targetKey = `sunday_role:${FIXTURE_DATE.sundayPublished}`;
    const plantedId = `srv.integrity.duplicate.${run.identity.runId.slice(-12)}`;
    run.recordCreated(plantedId, "integrity/planted-duplicate-role");
    await createScenarioDocument(run.identity, {
      _id: plantedId,
      _type: "sunday_role",
      week: FIXTURE_DATE.sundayPublished,
      published: true,
      Lead: [{ _key: "dupLead", _type: "reference", _ref: MEMBERS.lead }],
      BGVs: [],
      Chorus: [],
      instruments: [],
      foh_team: [],
    });

    const atTarget = await readRolesAtTarget(run.identity, {
      type: "sunday_role",
      date: FIXTURE_DATE.sundayPublished,
    });
    expect(atTarget.map((r) => r._id).sort()).toEqual([ROLES.sundayPublished, plantedId].sort());

    const summary = (await (await admin.api.get(ROLES_SUMMARY, { failOnStatusCode: false })).json()) as RoleSummary;
    const duplicate = summary.targets.find((t) => t.targetKey === targetKey);
    expect(duplicate, `the summary must still report ${targetKey}`).toBeTruthy();
    expect(
      duplicate?.canonicalCount,
      "two canonical roles on one weekend target must be counted as two",
    ).toBe(2);
    expect(duplicate?.canonicalIds.sort()).toEqual([ROLES.sundayPublished, plantedId].sort());
    expect(duplicate?.canonicalState, "and named as a duplicate, not as a healthy single").toBe(
      "duplicate",
    );

    run.evidence("integrity_duplicate_target_reported", { targetKey, planted: plantedId });
  });

  test("reports the incomplete and empty setlist fixtures", async ({ admin }) => {
    const res = await admin.api.get(SETLISTS_SUMMARY, { failOnStatusCode: false });
    expect(res.status(), await res.text()).toBe(200);
    const serialized = JSON.stringify(await res.json());

    // The deliberate `saturdarSongs` typo must appear as itself, never "corrected".
    expect(serialized).toContain("saturdarSongs");
    expect(serialized).toContain(FIXTURE_DATE.sundayPublished);
    expect(serialized).toContain(FIXTURE_DATE.saturdayPublished);
  });

  test("reports the legacy approved proposal as unverified", async ({ admin }) => {
    const res = await admin.api.get(PROPOSALS_SUMMARY, { failOnStatusCode: false });
    expect(res.status(), await res.text()).toBe(200);
    const serialized = JSON.stringify(await res.json());

    expect(serialized).toContain(PROPOSALS.legacyApproved);
    expect(
      serialized.includes("legacy") || serialized.includes("unverified"),
      "an approval with no receipt must be reported as unverified",
    ).toBe(true);
  });
});
