// app/utils/__tests__/assignmentEmail.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendEmailMock = vi.fn();
vi.mock("../email", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));

const fetchMock = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: (...a: unknown[]) => fetchMock(...a) } }));

import { rolesForMember, buildAssignmentEmail, sendAssignmentEmails } from "../assignmentEmail";

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
