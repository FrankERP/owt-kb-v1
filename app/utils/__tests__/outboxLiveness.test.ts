import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// `assignmentEmail` reaches `sanity/env`, which asserts on real project vars this
// suite has no reason to carry. Stubbed rather than set, so the test declares its
// own independence from the deployment's configuration.
vi.mock("@/sanity/env", () => ({
  apiVersion: "2024-07-23",
  dataset: "test",
  projectId: "test",
}));

const operationalFetch = vi.fn();
const sendEmailMock = vi.fn();

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn() },
}));
vi.mock("@/app/utils/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmailMock(...a),
}));

import { reportDestroyedMail } from "../outboxLiveness";

const SUPER_ADMIN = [{ _id: "m1", email: "owner@example.com" }];

beforeEach(() => {
  vi.restoreAllMocks();
  operationalFetch.mockReset();
  sendEmailMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.EMAIL_ALLOWLIST = "*";
  delete process.env.EMAIL_REDIRECT_TO;
  operationalFetch.mockResolvedValue(SUPER_ADMIN);
  sendEmailMock.mockResolvedValue({ ok: true });
});

describe("reportDestroyedMail", () => {
  it("stays quiet when the sweep destroyed nothing", async () => {
    const r = await reportDestroyedMail({ failed: 0, lost: 0 });
    expect(r).toEqual({ destroyed: 0, alerted: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("alerts a super-admin when a send failed", async () => {
    const r = await reportDestroyedMail({ failed: 2, lost: 0 });
    expect(r).toEqual({ destroyed: 2, alerted: true });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe("owner@example.com");
  });

  it("counts `lost` too, and sums both classes", async () => {
    const r = await reportDestroyedMail({ failed: 1, lost: 3 });
    expect(r.destroyed).toBe(4);
  });

  // A single failed send is one bad address; a `lost` is the budget discarding
  // recipients. The mail has to say which, because they send you to different
  // places — so the copy is asserted, not just the count.
  it("names the two classes distinctly in the email body", async () => {
    await reportDestroyedMail({ failed: 2, lost: 0 });
    const onlyFailed = sendEmailMock.mock.calls[0][0].html as string;
    expect(onlyFailed).toContain("no los aceptó");
    expect(onlyFailed).not.toContain("sin haberse intentado");

    sendEmailMock.mockClear();
    await reportDestroyedMail({ failed: 0, lost: 2 });
    const onlyLost = sendEmailMock.mock.calls[0][0].html as string;
    expect(onlyLost).toContain("sin haberse intentado");
  });

  // `alerted` follows the MAILBOX, not the attempt — the same rule the stale
  // alarm uses. A run that logged loudly and reached nobody has not alerted.
  it("reports alerted:false when every send fails", async () => {
    sendEmailMock.mockResolvedValue({ ok: false, error: "boom" });
    const r = await reportDestroyedMail({ failed: 3, lost: 0 });
    expect(r).toEqual({ destroyed: 3, alerted: false });
  });

  it("reports alerted:false when there is no super-admin to reach", async () => {
    operationalFetch.mockResolvedValue([]);
    const r = await reportDestroyedMail({ failed: 3, lost: 0 });
    expect(r).toEqual({ destroyed: 3, alerted: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  // The daily cron must never fail because its alarm could not run.
  it("never throws when the super-admin lookup fails", async () => {
    operationalFetch.mockRejectedValue(new Error("groq down"));
    await expect(reportDestroyedMail({ failed: 1, lost: 0 })).resolves.toEqual({
      destroyed: 0,
      alerted: false,
    });
  });

  // The sweep may have thrown, in which case the route passes `{error}` — a
  // shape with neither counter. That is not destroyed mail.
  it("treats a sweep that threw as nothing destroyed", async () => {
    const r = await reportDestroyedMail({} as { failed?: number; lost?: number });
    expect(r).toEqual({ destroyed: 0, alerted: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
