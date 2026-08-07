// app/utils/__tests__/smtpProbe.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const verifyMock = vi.fn();
const closeMock = vi.fn();
const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({
  verify: verifyMock,
  close: closeMock,
  sendMail: sendMailMock,
}));
vi.mock("nodemailer", () => ({ default: { createTransport: createTransportMock } }));

const blockedMock = vi.fn(() => false);
vi.mock("@/app/utils/deliveryFirewall", () => ({ isDeliveryBlocked: () => blockedMock() }));

describe("probeSmtp", () => {
  beforeEach(() => {
    verifyMock.mockReset(); closeMock.mockReset(); sendMailMock.mockReset();
    createTransportMock.mockClear(); blockedMock.mockReturnValue(false);
    vi.resetModules();
    process.env.SMTP_HOST = "mail.oasis.mx";
    process.env.SMTP_USER = "contacto@oasis.mx";
    process.env.SMTP_PASS = "secret";
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SMTP_HOST; delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS; delete process.env.SMTP_PORT;
  });

  it("NEVER sends mail", async () => {
    // The whole basis for running this against production whenever the outbox
    // looks wrong. If this assertion ever fails, the probe has become a thing
    // that can contact the team.
    verifyMock.mockResolvedValue(true);
    const { probeSmtp } = await import("../smtpProbe");
    await probeSmtp();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("measures a cold setup, a pooled reuse, and a second independent setup", async () => {
    verifyMock.mockResolvedValue(true);
    const { probeSmtp } = await import("../smtpProbe");
    const r = await probeSmtp();
    expect(r.status).toBe("ok");
    expect(verifyMock).toHaveBeenCalledTimes(3);
    for (const phase of [r.coldMs, r.warmMs, r.secondColdMs]) {
      expect(typeof phase).toBe("number");
    }
    // Cold and warm must come from the SAME transport, or "reuse" measures a
    // fresh connection and the number means nothing.
    expect(createTransportMock).toHaveBeenCalledTimes(2);
  });

  it("reports a phase that fails without losing the phases that worked", async () => {
    verifyMock
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("535 Incorrect authentication data"))
      .mockResolvedValueOnce(true);
    const { probeSmtp } = await import("../smtpProbe");
    const r = await probeSmtp();
    expect(r.status).toBe("ok");
    expect(typeof r.coldMs).toBe("number");
    expect(r.warmMs).toBeNull();
    expect(r.errors?.warm).toContain("535");
    expect(typeof r.secondColdMs).toBe("number");
  });

  it("declines when the A3 firewall blocks delivery", async () => {
    blockedMock.mockReturnValue(true);
    const { probeSmtp } = await import("../smtpProbe");
    const r = await probeSmtp();
    expect(r.status).toBe("delivery_blocked");
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("reports unconfigured rather than dialing with half a credential set", async () => {
    delete process.env.SMTP_PASS;
    const { probeSmtp } = await import("../smtpProbe");
    const r = await probeSmtp();
    expect(r.status).toBe("unconfigured");
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("cannot hang past its own timeout", async () => {
    vi.useFakeTimers();
    verifyMock.mockReturnValue(new Promise(() => {}));
    const { probeSmtp } = await import("../smtpProbe");
    const pending = probeSmtp();
    // Three phases, each bounded independently.
    await vi.advanceTimersByTimeAsync(20_000 * 3);
    const r = await pending;
    expect(r.coldMs).toBeNull();
    expect(r.errors?.cold).toContain("timed out");
  });
});

describe("probeSmtp — the redirect window", () => {
  beforeEach(() => {
    verifyMock.mockReset(); createTransportMock.mockClear();
    blockedMock.mockReturnValue(false); vi.resetModules();
    process.env.SMTP_HOST = "mail.oasis.mx";
    process.env.SMTP_USER = "contacto@oasis.mx";
    process.env.SMTP_PASS = "secret";
  });
  afterEach(() => {
    delete process.env.SMTP_HOST; delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS; delete process.env.EMAIL_REDIRECT_TO;
  });

  it("reports null when mail goes to its real recipients", async () => {
    verifyMock.mockResolvedValue(true);
    const { probeSmtp } = await import("../smtpProbe");
    expect((await probeSmtp()).redirectTo).toBeNull();
  });

  it("names the address when EMAIL_REDIRECT_TO is diverting the team's mail", async () => {
    // Invisible from every other angle: a redirected deployment sends, logs and
    // reports exactly like a healthy one while nobody receives anything.
    process.env.EMAIL_REDIRECT_TO = "  someone@example.com  ";
    verifyMock.mockResolvedValue(true);
    const { probeSmtp } = await import("../smtpProbe");
    expect((await probeSmtp()).redirectTo).toBe("someone@example.com");
  });

  it("answers even when the server cannot be reached at all", async () => {
    process.env.EMAIL_REDIRECT_TO = "someone@example.com";
    delete process.env.SMTP_PASS;
    const { probeSmtp } = await import("../smtpProbe");
    const r = await probeSmtp();
    expect(r.status).toBe("unconfigured");
    expect(r.redirectTo).toBe("someone@example.com");
  });
});
