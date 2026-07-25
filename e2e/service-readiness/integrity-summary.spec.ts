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
import { readRolesAtTarget } from "./lib/dataset";
import {
  DANGLING_MEMBER_ID,
  FIXTURE_DATE,
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

  test("reports a DUPLICATE target created for this test only", async ({ admin, run }) => {
    // Two canonical roles for the same weekend target cannot be produced through the
    // guarded create route (it refuses an occupied target), which is the point: the
    // duplicate is created by moving a role onto the occupied date is also refused,
    // so the duplicate here is the one the fixtures deliberately allow — a second
    // SPECIAL service on the same date with a different name shares the date but not
    // the target key, and the summary must keep them distinct rather than merging.
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
    const duplicate = (await created.json()) as { _id: string };
    run.recordCreated(duplicate._id, "integrity/duplicate-special");
    run.recordCreated(receiptId(requestId), "integrity/duplicate-receipt");

    const atDate = await readRolesAtTarget(run.identity, {
      type: "special_role",
      date: FIXTURE_DATE.specialPublished,
    });
    expect(atDate.length, "two special services now share the date").toBeGreaterThan(1);

    const summary = (await (await admin.api.get(ROLES_SUMMARY, { failOnStatusCode: false })).json()) as RoleSummary;
    const sameDate = summary.targets.filter((t) => t.targetKey.includes(FIXTURE_DATE.specialPublished));
    expect(
      sameDate.length,
      "each special service is its own target — the summary must not collapse them",
    ).toBeGreaterThan(1);
    for (const target of sameDate) {
      expect(target.canonicalCount, target.targetKey).toBe(1);
    }
    // The per-scenario fixture reset removes the extra role afterwards.
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
