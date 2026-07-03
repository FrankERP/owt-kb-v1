// app/utils/__tests__/proposalNotify.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendEmailMock = vi.fn();
vi.mock("../email", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));

const sendPushMock = vi.fn();
vi.mock("../push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));

const fetchMock = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: (...a: unknown[]) => fetchMock(...a) } }));

import { buildProposalEmail, notifyProposalSubmitted } from "../proposalNotify";

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
    sendEmailMock.mockReset(); sendPushMock.mockReset(); fetchMock.mockReset();
    process.env.EMAIL_ALLOWLIST = "admin@x.com";
    sendPushMock.mockResolvedValue({ sent: 0, pruned: 0 });
  });
  afterEach(() => { delete process.env.EMAIL_ALLOWLIST; });

  // First fetch = combined admins/coLeads/lead; second fetch = admin email rows.
  function primeFetch(combined: unknown, adminRows: unknown[] = []) {
    fetchMock.mockResolvedValueOnce(combined).mockResolvedValueOnce(adminRows);
  }

  it("pushes to admins and to co-leads, excluding the submitting lead", async () => {
    primeFetch({ admins: ["a1"], coLeads: ["lead1", "lead2"], lead: { member_name: "Frank" } });
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });

    const targets = sendPushMock.mock.calls.map((c) => c[0]);
    expect(targets).toContainEqual(["a1"]);        // admins
    expect(targets).toContainEqual(["lead2"]);     // co-lead, NOT lead1 (submitter)
    const coLeadCall = sendPushMock.mock.calls.find((c) => Array.isArray(c[0]) && c[0].includes("lead2"));
    expect(coLeadCall?.[2].path).toBe("/me/propose/r1");
  });

  it("does not push to co-leads when the lead is the only lead", async () => {
    primeFetch({ admins: ["a1"], coLeads: ["lead1"], lead: { member_name: "Frank" } });
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    // Only the admin push fires.
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(sendPushMock.mock.calls[0][0]).toEqual(["a1"]);
  });

  it("emails an allowlisted admin", async () => {
    primeFetch(
      { admins: ["a1"], coLeads: [], lead: { alias: "Frank" } },
      [{ _id: "a1", email: "admin@x.com" }],
    );
    sendEmailMock.mockResolvedValue({ ok: true });
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe("admin@x.com");
    expect(sendEmailMock.mock.calls[0][0].subject).toContain("Domingo");
  });

  it("does not email a non-allowlisted admin", async () => {
    primeFetch(
      { admins: ["a1"], coLeads: [], lead: { member_name: "Frank" } },
      [{ _id: "a1", email: "other@x.com" }],
    );
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips an admin who opted out of email (emailPref false)", async () => {
    primeFetch(
      { admins: ["a1"], coLeads: [], lead: { member_name: "Frank" } },
      [{ _id: "a1", email: "admin@x.com", emailPref: false }],
    );
    await notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("never throws when the fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    await expect(
      notifyProposalSubmitted({ leadId: "lead1", roleId: "r1", serviceType: "sunday", serviceDate: "2026-07-05" }),
    ).resolves.toBeUndefined();
  });
});
