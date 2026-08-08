// app/utils/__tests__/email.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `email.ts` now consults the A3 §3 delivery firewall, which is `import
// "server-only"` guarded; neutralize the marker under vitest's node environment.
vi.mock("server-only", () => ({}));

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
const closeMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock, close: closeMock }));
vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

describe("sendEmail", () => {
  beforeEach(() => { sendMock.mockReset(); sendMailMock.mockReset(); closeMock.mockReset(); createTransportMock.mockClear(); vi.resetModules(); });
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

/**
 * The regression suite for the 2026-08-06 stall: a mail server that accepts the
 * connection and then stops answering. Every assertion here is about `sendEmail`
 * RESOLVING — the outbox can survive an undeliverable message, and cannot survive
 * a send that never comes back.
 */
describe("sendEmail — one send cannot outlive its host function", () => {
  beforeEach(() => {
    sendMock.mockReset(); sendMailMock.mockReset(); closeMock.mockReset();
    createTransportMock.mockClear(); vi.resetModules();
    process.env.EMAIL_FROM = "Oasis <contacto@oasis.mx>";
    process.env.SMTP_HOST = "mail.oasis.mx";
    process.env.SMTP_USER = "contacto@oasis.mx";
    process.env.SMTP_PASS = "secret";
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.EMAIL_FROM; delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  });

  it("overrides every nodemailer default that outlives maxDuration = 60", async () => {
    // The defaults are 120 s / 30 s / 600 s. Asserting "below 60 s" rather than
    // exact values keeps this a statement about the constraint that matters.
    sendMailMock.mockResolvedValue({ messageId: "1" });
    const { sendEmail } = await import("../email");
    await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    // The factory mock takes no declared parameters, so its recorded call tuple
    // is typed empty; read the options through the shape they actually have.
    const calls = createTransportMock.mock.calls as unknown as Record<string, number>[][];
    const opts = calls[0][0];
    for (const key of ["connectionTimeout", "greetingTimeout", "socketTimeout"]) {
      expect(opts[key]).toBeGreaterThan(0);
      expect(opts[key]).toBeLessThan(60_000);
    }
  });

  it("resolves ok:false rather than hanging when the server never answers", async () => {
    vi.useFakeTimers();
    sendMailMock.mockReturnValue(new Promise(() => {})); // never settles
    const { sendEmail, SEND_TIMEOUT_MS } = await import("../email");
    const pending = sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    const r = await pending;
    expect(r.ok).toBe(false);
    expect(r.error).toContain("timed out");
  });

  it("keeps the whole ceiling inside the hosting function's 60 s", async () => {
    const { SEND_TIMEOUT_MS } = await import("../email");
    expect(SEND_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it("leaves the pool up when one send times out, so its siblings survive", async () => {
    // Sends run SEND_CONCURRENCY-wide. Tearing down the shared transport to
    // reclaim one stuck connection would drop the connections carrying the other
    // recipients — one stalled message becoming eight failures. `socketTimeout`
    // reclaims at the right granularity instead: nodemailer destroys that one
    // connection and the pool dials a replacement.
    vi.useFakeTimers();
    sendMailMock.mockReturnValueOnce(new Promise(() => {}));
    sendMailMock.mockResolvedValueOnce({ messageId: "2" });
    const { sendEmail, SEND_TIMEOUT_MS } = await import("../email");

    const first = sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect((await first).ok).toBe(false);
    expect(closeMock).not.toHaveBeenCalled();

    const second = await sendEmail({ to: "c@d.com", subject: "s", html: "<p>h</p>" });
    expect(second.ok).toBe(true);
    // The SAME transport: one abandoned message does not cost the batch its pool.
    expect(createTransportMock).toHaveBeenCalledTimes(1);
  });

  it("opens exactly as many connections as SEND_CONCURRENCY allows", async () => {
    // Deliberately NOT asserting a particular width. 8 was tried in production
    // and delivered nothing where serial delivered one, so the value is an open
    // question; what must hold is that the pool is sized by the constant rather
    // than by a number someone typed in a second place.
    const { SEND_CONCURRENCY } = await import("../email");
    expect(SEND_CONCURRENCY).toBeGreaterThanOrEqual(1);
    sendMailMock.mockResolvedValue({ messageId: "1" });
    const { sendEmail } = await import("../email");
    await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });
    const calls = createTransportMock.mock.calls as unknown as Record<string, number>[][];
    expect(calls[0][0].maxConnections).toBe(SEND_CONCURRENCY);
  });
});
