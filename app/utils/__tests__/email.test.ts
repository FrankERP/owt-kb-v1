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

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

describe("sendEmail", () => {
  beforeEach(() => { sendMock.mockReset(); sendMailMock.mockReset(); createTransportMock.mockClear(); vi.resetModules(); });
  afterEach(() => {
    delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
    delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
    delete process.env.SMTP_PORT; delete process.env.SMTP_SECURE;
  });

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

  it("prefers SMTP when SMTP_HOST is set, even if Resend is configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Oasis <contacto@oasis.mx>";
    process.env.SMTP_HOST = "mail.oasis.mx";
    process.env.SMTP_USER = "contacto@oasis.mx";
    process.env.SMTP_PASS = "secret";
    sendMailMock.mockResolvedValue({ messageId: "1" });
    const { sendEmail } = await import("../email");
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({
      host: "mail.oasis.mx", port: 465, secure: true,
      auth: { user: "contacto@oasis.mx", pass: "secret" },
    }));
    expect(sendMailMock).toHaveBeenCalledWith({ from: "Oasis <contacto@oasis.mx>", to: "a@b.com", subject: "s", html: "<p>h</p>" });
  });

  it("uses STARTTLS (secure:false) on port 587", async () => {
    process.env.EMAIL_FROM = "Oasis <contacto@oasis.mx>";
    process.env.SMTP_HOST = "mail.oasis.mx";
    process.env.SMTP_USER = "contacto@oasis.mx";
    process.env.SMTP_PASS = "secret";
    process.env.SMTP_PORT = "587";
    sendMailMock.mockResolvedValue({ messageId: "1" });
    const { sendEmail } = await import("../email");
    await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false }));
  });

  it("no-ops when SMTP_HOST is set but credentials are missing", async () => {
    process.env.EMAIL_FROM = "Oasis <contacto@oasis.mx>";
    process.env.SMTP_HOST = "mail.oasis.mx";
    const { sendEmail } = await import("../email");
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(false);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("returns ok:false when SMTP send throws", async () => {
    process.env.EMAIL_FROM = "Oasis <contacto@oasis.mx>";
    process.env.SMTP_HOST = "mail.oasis.mx";
    process.env.SMTP_USER = "contacto@oasis.mx";
    process.env.SMTP_PASS = "secret";
    sendMailMock.mockRejectedValue(new Error("auth failed"));
    const { sendEmail } = await import("../email");
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(false);
  });
});
