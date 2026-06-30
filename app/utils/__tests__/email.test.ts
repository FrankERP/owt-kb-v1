// app/utils/__tests__/email.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  // Mock `new Resend(apiKey)` so the instance exposes `emails.send`. Uses a
  // constructor function (assigns to `this`) with an explicit `this` type so it
  // both runs correctly under `new` and satisfies noImplicitThis.
  Resend: vi.fn(function (this: { emails: { send: typeof sendMock } }) {
    this.emails = { send: sendMock };
  }),
}));

describe("sendEmail", () => {
  beforeEach(() => { sendMock.mockReset(); vi.resetModules(); });
  afterEach(() => { delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; });

  it("no-ops when env is unset", async () => {
    const { sendEmail } = await import("../email");
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends via Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Oasis <onboarding@resend.dev>";
    sendMock.mockResolvedValue({ data: { id: "1" }, error: null });
    const { sendEmail } = await import("../email");
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledWith({ from: "Oasis <onboarding@resend.dev>", to: "a@b.com", subject: "s", html: "<p>h</p>" });
  });

  it("returns ok:false when Resend reports an error", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Oasis <onboarding@resend.dev>";
    sendMock.mockResolvedValue({ data: null, error: { message: "bad" } });
    const { sendEmail } = await import("../email");
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(false);
  });
});
