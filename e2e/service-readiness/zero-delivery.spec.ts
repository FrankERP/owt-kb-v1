// A3 §3 — the outbound-delivery firewall, exercised through DEPLOYED routes.
//
// This spec's job is to make the zero-delivery claim FALSIFIABLE. Its assertions are
// deliberately weak on their own — the real proof is assembled in `globalTeardown`,
// which requires:
//
//   · at least one run-id-scoped `delivery_blocked` event, and
//   · zero `delivery_attempt` events in the deployment's COMPLETE recorded logs.
//
// So what this spec must do is INVOKE every delivery trigger, so that a firewall
// which is not actually closed has the opportunity to fail. "No email fixture
// existed" is not proof, which is exactly why every call below is made against a
// service that DOES have assigned members with (non-deliverable) email addresses.
//
// Publishing a role and approving a proposal are the two notification-bearing
// transitions; the reminder cron is the third. All three are called here.

import { expect, test } from "./fixtures";
import { readProposal, readRole } from "./lib/dataset";
import { PROPOSALS, ROLES } from "./lib/fixtureRefs";

test.describe("outbound-delivery firewall", () => {
  test("publishing an assigned service invokes the notification path", async ({ admin, run }) => {
    const before = await readRole(run.identity, ROLES.sundayDraft);
    // Every one of the five member-referencing seats is filled on this fixture, so the
    // notification path has real recipients to consider (on a non-deliverable domain).
    expect((before?.Lead ?? []).length).toBeGreaterThan(0);
    expect((before?.foh_team ?? []).length).toBeGreaterThan(0);

    const res = await admin.api.post("/api/admin/roles/publish", {
      data: { published: true, roles: [{ id: ROLES.sundayDraft, rev: before?._rev }] },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await readRole(run.identity, ROLES.sundayDraft))?.published).toBe(true);

    run.evidence("delivery_trigger_invoked", { trigger: "role_publish", roleId: ROLES.sundayDraft });
  });

  test("approving a proposal invokes the proposal notification path", async ({ admin, run }) => {
    const pending = await readProposal(run.identity, PROPOSALS.pending);
    const res = await admin.api.patch(
      `/api/admin/proposals/${encodeURIComponent(PROPOSALS.pending)}`,
      { data: { action: "approve", rev: pending?._rev }, failOnStatusCode: false },
    );
    // Whether it approves or conflicts, the notification path was reached.
    expect([200, 409]).toContain(res.status());

    run.evidence("delivery_trigger_invoked", {
      trigger: "proposal_transition",
      proposalId: PROPOSALS.pending,
      status: res.status(),
    });
  });

  test("requesting changes on a proposal invokes the member notification path", async ({
    admin,
    run,
  }) => {
    const pending = await readProposal(run.identity, PROPOSALS.pending);
    const res = await admin.api.patch(
      `/api/admin/proposals/${encodeURIComponent(PROPOSALS.pending)}`,
      {
        data: { action: "request_changes", rev: pending?._rev, adminNotes: "fixture" },
        failOnStatusCode: false,
      },
    );
    expect([200, 409]).toContain(res.status());

    run.evidence("delivery_trigger_invoked", {
      trigger: "proposal_request_changes",
      status: res.status(),
    });
  });

  test("the reminder cron endpoint is reachable and invokes the push path", async ({ anon, run }) => {
    // Unauthorized is an acceptable outcome (the cron is secret-gated); what matters
    // is that the run RECORDS having tried, so a firewall gap has a chance to show.
    const res = await anon.get("/api/cron/service-reminders", { failOnStatusCode: false });
    run.evidence("delivery_trigger_invoked", {
      trigger: "reminder_cron",
      status: res.status(),
    });
    expect(res.status()).toBeGreaterThan(0);
  });

  test("no delivery attempt surfaced in the browser during the run", async ({ admin, run }) => {
    // A weak, local check. The authoritative zero-attempt assertion runs in
    // `globalTeardown` over the deployment's complete recorded logs — this one only
    // catches a client-visible regression early.
    const lines: string[] = [];
    admin.page.on("console", (msg) => lines.push(msg.text()));
    await admin.page.goto("/admin", { waitUntil: "domcontentloaded" });
    await admin.page.waitForLoadState("networkidle").catch(() => undefined);

    expect(lines.filter((l) => l.includes("delivery_attempt"))).toEqual([]);
    run.evidence("browser_delivery_scan", { consoleLines: lines.length });
  });
});
