// app/utils/__tests__/proposalNotify.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendEmailMock = vi.fn();
vi.mock("../email", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a), SEND_CONCURRENCY: 8, SEND_TIMEOUT_MS: 15_000 }));

const sendPushMock = vi.fn();
vi.mock("../push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));

// assignmentEmail (imported for its pure allowlist helpers) transitively imports
// the real serverClient, which evaluates sanity/env. Stub it so the module loads
// under vitest without real Sanity env vars; proposalNotify itself no longer
// reads through serverClient.
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { create: vi.fn(), patch: vi.fn() },
}));

// Canonical reads go through operationalClient; draft-conflict evidence through
// rawIntegrityClient. Mock both explicitly so a test controls role identity.
const opFetchMock = vi.fn();
const rawFetchMock = vi.fn();
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => opFetchMock(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => rawFetchMock(...a) },
}));

import { buildProposalEmail, notifyProposalSubmitted } from "../proposalNotify";

// A structurally valid canonical role with two Leads (Lead refs drive co-lead
// notification). `validateRole` requires all five seat arrays to be present.
function validRole(leadRefs: string[]) {
  return {
    _id: "r1",
    _rev: "rev1",
    _type: "sunday_role",
    week: "2026-07-05",
    Lead: leadRefs.map((ref, i) => ({ _key: `l${i}`, _type: "reference", _ref: ref })),
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
  };
}

describe("buildProposalEmail", () => {
  it("builds a Spanish subject + body with an absolute admin link", () => {
    process.env.NEXTAUTH_URL = "https://example.com";
    const e = buildProposalEmail({ leadName: "Frank", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(e.subject).toContain("Domingo");
    expect(e.html).toContain("Frank");
    expect(e.html).toContain('href="https://example.com/admin"');
    delete process.env.NEXTAUTH_URL;
  });

  it("escapes HTML in the lead name", () => {
    const e = buildProposalEmail({ leadName: "A & <b>", serviceType: "saturday", serviceDate: "2026-07-11" });
    expect(e.html).toContain("A &amp; &lt;b&gt;");
    expect(e.html).not.toContain("<b>");
  });
});

describe("notifyProposalSubmitted", () => {
  beforeEach(() => {
    sendEmailMock.mockReset(); sendPushMock.mockReset();
    opFetchMock.mockReset(); rawFetchMock.mockReset();
    process.env.EMAIL_ALLOWLIST = "admin@x.com";
    sendPushMock.mockResolvedValue({ sent: 0, pruned: 0 });
    rawFetchMock.mockResolvedValue([]); // no draft overlay by default
  });
  afterEach(() => { delete process.env.EMAIL_ALLOWLIST; });

  // op fetches, in order: [0] canonical role-by-id array, [1] admins+lead combined,
  // [2] admin email rows. raw fetch: drafts.* overlay for the role base id.
  function primeValidRole(leadRefs: string[], admins: string[], adminRows: unknown[] = []) {
    opFetchMock
      .mockResolvedValueOnce([validRole(leadRefs)])
      .mockResolvedValueOnce({ admins, lead: { member_name: "Frank" } })
      .mockResolvedValueOnce(adminRows);
  }

  it("pushes to admins and to co-leads, excluding the submitting lead", async () => {
    primeValidRole(["lead1", "lead2"], ["a1"]);
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });

    const targets = sendPushMock.mock.calls.map((c) => c[0]);
    expect(targets).toContainEqual(["a1"]);        // admins
    expect(targets).toContainEqual(["lead2"]);     // co-lead, NOT lead1 (submitter)
    const coLeadCall = sendPushMock.mock.calls.find((c) => Array.isArray(c[0]) && c[0].includes("lead2"));
    expect(coLeadCall?.[2].path).toBe("/me/propose/r1");
  });

  it("does not push to co-leads when the lead is the only lead", async () => {
    primeValidRole(["lead1"], ["a1"]);
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    // Only the admin push fires.
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(sendPushMock.mock.calls[0][0]).toEqual(["a1"]);
  });

  it("emails an allowlisted admin", async () => {
    primeValidRole(["lead1"], ["a1"], [{ _id: "a1", email: "admin@x.com" }]);
    sendEmailMock.mockResolvedValue({ ok: true });
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe("admin@x.com");
    expect(sendEmailMock.mock.calls[0][0].subject).toContain("Domingo");
  });

  it("does not email a non-allowlisted admin", async () => {
    primeValidRole(["lead1"], ["a1"], [{ _id: "a1", email: "other@x.com" }]);
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips an admin who opted out of email (notifPrefs.email false)", async () => {
    primeValidRole(["lead1"], ["a1"], [{ _id: "a1", email: "admin@x.com", notifPrefs: { email: false } }]);
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips an admin who opted out of proposal email specifically (emailProposals false)", async () => {
    primeValidRole(["lead1"], ["a1"], [{ _id: "a1", email: "admin@x.com", notifPrefs: { emailProposals: false } }]);
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("never throws when the fetch fails", async () => {
    opFetchMock.mockRejectedValueOnce(new Error("boom"));
    await expect(
      notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" }),
    ).resolves.toBeUndefined();
  });

  // ── Fail-closed on non-canonical role identity: sends NOTHING ────────────────
  it("sends nothing when the role does not resolve (missing)", async () => {
    opFetchMock.mockResolvedValueOnce([]); // none
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the role id is ambiguous (duplicate canonical docs)", async () => {
    opFetchMock.mockResolvedValueOnce([validRole(["lead1"]), validRole(["lead2"])]);
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the resolved role is structurally invalid", async () => {
    // Missing seat arrays -> validateRole not groupable.
    opFetchMock.mockResolvedValueOnce([{ _id: "r1", _rev: "v1", _type: "sunday_role", week: "2026-07-05" }]);
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the role is draft-conflicted (a drafts. overlay exists)", async () => {
    opFetchMock.mockResolvedValueOnce([validRole(["lead1", "lead2"])]);
    rawFetchMock.mockResolvedValueOnce([{ _id: "drafts.r1" }]);
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
