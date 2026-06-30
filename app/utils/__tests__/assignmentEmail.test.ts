// app/utils/__tests__/assignmentEmail.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendEmailMock = vi.fn();
vi.mock("../email", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));

const fetchMock = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: (...a: unknown[]) => fetchMock(...a) } }));

import { rolesForMember, buildAssignmentEmail, sendAssignmentEmails, sendAssignmentEmailsBatch } from "../assignmentEmail";

const body = {
  leads: ["m1"], bgvs: ["m2"], chorus: [],
  instruments: [{ instrument: "Guitarra", personId: "m1" }], foh: [],
};

describe("rolesForMember", () => {
  it("lists every role a member holds in the service", () => {
    expect(rolesForMember("m1", body)).toEqual(["Líder", "Guitarra"]);
    expect(rolesForMember("m2", body)).toEqual(["BGV"]);
    expect(rolesForMember("zzz", body)).toEqual([]);
  });
});

describe("buildAssignmentEmail", () => {
  it("builds a Spanish subject and body with an absolute link", () => {
    process.env.NEXTAUTH_URL = "https://example.com";
    const e = buildAssignmentEmail({ name: "Frank", roles: ["Líder"], type: "sunday_role", date: "2026-07-05" });
    expect(e.subject).toContain("Domingo");
    expect(e.html).toContain("Frank");
    expect(e.html).toContain("Líder");
    expect(e.html).toContain('href="https://example.com/me"');
    delete process.env.NEXTAUTH_URL;
  });

  it("escapes HTML in interpolated name/roles", () => {
    const e = buildAssignmentEmail({ name: "A & B", roles: ["<x>"], type: "saturday_role", date: "2026-07-11" });
    expect(e.html).toContain("A &amp; B");
    expect(e.html).toContain("&lt;x&gt;");
    expect(e.html).not.toContain("<x>");
  });

  it("falls back to VERCEL_PROJECT_PRODUCTION_URL (https) when NEXTAUTH_URL is unset", () => {
    delete process.env.NEXTAUTH_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "owt.example.app";
    const e = buildAssignmentEmail({ name: "Frank", roles: ["Líder"], type: "sunday_role", date: "2026-07-05" });
    expect(e.html).toContain('href="https://owt.example.app/me"');
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });

  it("ignores a localhost NEXTAUTH_URL in favor of the Vercel production URL", () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "owt.example.app";
    const e = buildAssignmentEmail({ name: "Frank", roles: ["Líder"], type: "sunday_role", date: "2026-07-05" });
    expect(e.html).toContain('href="https://owt.example.app/me"');
    delete process.env.NEXTAUTH_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });
});

describe("sendAssignmentEmails gating", () => {
  beforeEach(() => { sendEmailMock.mockReset(); fetchMock.mockReset(); process.env.EMAIL_ALLOWLIST = "frank@x.com"; });
  afterEach(() => { delete process.env.EMAIL_ALLOWLIST; });

  it("emails an allowlisted recipient", async () => {
    fetchMock.mockResolvedValue([{ _id: "m1", member_name: "Frank", email: "frank@x.com" }]);
    sendEmailMock.mockResolvedValue({ ok: true });
    await sendAssignmentEmails(["m1"], { type: "sunday_role", date: "2026-07-05", body });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe("frank@x.com");
  });

  it("does NOT email a non-allowlisted recipient", async () => {
    fetchMock.mockResolvedValue([{ _id: "m2", member_name: "Gaby", email: "gaby@x.com" }]);
    await sendAssignmentEmails(["m2"], { type: "sunday_role", date: "2026-07-05", body });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips members with no email", async () => {
    fetchMock.mockResolvedValue([{ _id: "m1", member_name: "Frank" }]);
    await sendAssignmentEmails(["m1"], { type: "sunday_role", date: "2026-07-05", body });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends ONE email listing all roles for a member in multiple sections", async () => {
    // m1 is both Líder and Guitarra in `body`.
    fetchMock.mockResolvedValue([{ _id: "m1", member_name: "Frank", email: "frank@x.com" }]);
    sendEmailMock.mockResolvedValue({ ok: true });
    await sendAssignmentEmails(["m1"], { type: "sunday_role", date: "2026-07-05", body });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const html = sendEmailMock.mock.calls[0][0].html as string;
    expect(html).toContain("Líder, Guitarra");
  });
});

describe("sendAssignmentEmailsBatch", () => {
  beforeEach(() => { sendEmailMock.mockReset(); fetchMock.mockReset(); process.env.EMAIL_ALLOWLIST = "frank@x.com"; });
  afterEach(() => { delete process.env.EMAIL_ALLOWLIST; });

  const svcA = { type: "sunday_role" as const, date: "2026-07-05", body: { leads: ["m1"], bgvs: ["m2"] } };
  const svcB = { type: "saturday_role" as const, date: "2026-07-11", body: { bgvs: ["m1"], instruments: [{ instrument: "Batería", personId: "m1" }] } };

  it("sends ONE email per member covering all their services", async () => {
    fetchMock.mockResolvedValue([{ _id: "m1", member_name: "Frank", email: "frank@x.com" }]);
    sendEmailMock.mockResolvedValue({ ok: true });
    await sendAssignmentEmailsBatch([svcA, svcB]);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe("frank@x.com");
    expect(call.subject).toContain("2 servicios");
    expect(call.html).toContain("Líder");          // from svcA
    expect(call.html).toContain("BGV, Batería");    // combined roles from svcB
  });

  it("uses the single-service template when a member has only one service", async () => {
    fetchMock.mockResolvedValue([{ _id: "m2", member_name: "Gaby", email: "frank@x.com" }]);
    sendEmailMock.mockResolvedValue({ ok: true });
    await sendAssignmentEmailsBatch([svcA, svcB]); // m2 only in svcA
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].subject).toContain("Domingo");
  });

  it("still gates on the allowlist", async () => {
    fetchMock.mockResolvedValue([{ _id: "m1", member_name: "Frank", email: "notallowed@x.com" }]);
    await sendAssignmentEmailsBatch([svcA, svcB]);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("emails the whole team when EMAIL_ALLOWLIST is '*'", async () => {
    process.env.EMAIL_ALLOWLIST = "*";
    fetchMock.mockResolvedValue([
      { _id: "m1", member_name: "Frank", email: "frank@x.com" },
      { _id: "m2", member_name: "Gaby", email: "gaby@y.com" },
    ]);
    sendEmailMock.mockResolvedValue({ ok: true });
    await sendAssignmentEmailsBatch([svcA, svcB]);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const recipients = sendEmailMock.mock.calls.map((c) => c[0].to).sort();
    expect(recipients).toEqual(["frank@x.com", "gaby@y.com"]);
  });
});
