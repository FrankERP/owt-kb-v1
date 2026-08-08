// app/utils/__tests__/smtpPhases.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("server-only", () => ({}));

/** A scriptable stand-in for the TLS socket: replies to each written command. */
class FakeSocket extends EventEmitter {
  written: string[] = [];
  destroyed = false;
  constructor(private replies: string[]) {
    super();
  }
  setEncoding() {}
  destroy() {
    this.destroyed = true;
  }
  write(data: string) {
    this.written.push(data.trim());
    const next = this.replies.shift();
    if (next !== undefined) queueMicrotask(() => this.emit("data", next + "\r\n"));
    return true;
  }
  /** The 220 banner arrives unprompted. */
  greet(line: string) {
    queueMicrotask(() => this.emit("data", line + "\r\n"));
  }
}

let socket: FakeSocket;
const connectMock = vi.fn(() => socket);
vi.mock("node:tls", () => ({ default: { connect: (...a: unknown[]) => connectMock(...(a as [])) } }));

const OK_SCRIPT = [
  "250-mail.oasis.mx Hello\r\n250 AUTH PLAIN", // EHLO (multiline)
  "235 Authentication succeeded", // AUTH
  "250 OK", // MAIL FROM
  "250 Accepted", // RCPT TO
];

describe("probeSmtpPhases", () => {
  beforeEach(() => {
    connectMock.mockClear();
    vi.resetModules();
    process.env.SMTP_HOST = "mail.oasis.mx";
    process.env.SMTP_USER = "contacto@oasis.mx";
    process.env.SMTP_PASS = "s3cret";
    process.env.EMAIL_FROM = "Oasis <contacto@oasis.mx>";
  });
  afterEach(() => {
    delete process.env.SMTP_HOST; delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS; delete process.env.EMAIL_FROM;
  });

  it("NEVER issues DATA — it stops at RCPT TO and quits", async () => {
    // The property that makes this safe to run against production at will.
    socket = new FakeSocket([...OK_SCRIPT]);
    const { probeSmtpPhases } = await import("../smtpPhases");
    const run = probeSmtpPhases("someone@example.com");
    socket.greet("220 mail.oasis.mx ESMTP Exim");
    await run;
    expect(socket.written).not.toContain("DATA");
    expect(socket.written.at(-1)).toBe("QUIT");
  });

  it("times each command separately, which sendMail cannot", async () => {
    socket = new FakeSocket([...OK_SCRIPT]);
    const { probeSmtpPhases } = await import("../smtpPhases");
    const run = probeSmtpPhases("someone@example.com");
    socket.greet("220 mail.oasis.mx ESMTP Exim");
    const r = await run;
    expect(r.status).toBe("ok");
    for (const phase of ["connectMs", "ehloMs", "authMs", "mailFromMs", "rcptToMs"]) {
      expect(typeof (r as unknown as Record<string, unknown>)[phase]).toBe("number");
    }
    expect(r.codes).toEqual(["220", "250", "235", "250", "250"]);
  });

  it("reads a multiline EHLO as ONE reply", async () => {
    // Counting `250-` as its own reply would shift every later phase onto the
    // wrong command and quietly misattribute the number this file exists to find.
    socket = new FakeSocket([...OK_SCRIPT]);
    const { probeSmtpPhases } = await import("../smtpPhases");
    const run = probeSmtpPhases("someone@example.com");
    socket.greet("220 mail.oasis.mx ESMTP Exim");
    const r = await run;
    expect(r.codes).toHaveLength(5);
    expect(socket.written).toEqual([
      "EHLO owt-backstage.vercel.app",
      expect.stringContaining("AUTH PLAIN"),
      "MAIL FROM:<contacto@oasis.mx>",
      "RCPT TO:<someone@example.com>",
      "QUIT",
    ]);
  });

  it("never puts the credential in the report", async () => {
    socket = new FakeSocket([...OK_SCRIPT]);
    const { probeSmtpPhases } = await import("../smtpPhases");
    const run = probeSmtpPhases("someone@example.com");
    socket.greet("220 mail.oasis.mx ESMTP Exim");
    const r = await run;
    expect(JSON.stringify(r)).not.toContain("s3cret");
    expect(JSON.stringify(r)).not.toContain(Buffer.from("\0contacto@oasis.mx\0s3cret").toString("base64"));
  });

  it("defaults RCPT TO to the sending mailbox — a LOCAL address needing no callout", async () => {
    socket = new FakeSocket([...OK_SCRIPT]);
    const { probeSmtpPhases } = await import("../smtpPhases");
    const run = probeSmtpPhases();
    socket.greet("220 mail.oasis.mx ESMTP Exim");
    const r = await run;
    expect(r.recipient).toBe("contacto@oasis.mx");
    expect(socket.written).toContain("RCPT TO:<contacto@oasis.mx>");
  });

  it("keeps the timings it collected when a phase is rejected", async () => {
    socket = new FakeSocket([
      "250 mail.oasis.mx Hello",
      "535 Incorrect authentication data",
    ]);
    const { probeSmtpPhases } = await import("../smtpPhases");
    const run = probeSmtpPhases("someone@example.com");
    socket.greet("220 mail.oasis.mx ESMTP Exim");
    const r = await run;
    expect(r.status).toBe("failed");
    expect(r.error).toContain("AUTH rejected");
    expect(typeof r.connectMs).toBe("number");
    expect(typeof r.ehloMs).toBe("number");
  });

  it("reports unconfigured rather than dialing with half a credential set", async () => {
    delete process.env.SMTP_PASS;
    const { probeSmtpPhases } = await import("../smtpPhases");
    expect((await probeSmtpPhases()).status).toBe("unconfigured");
    expect(connectMock).not.toHaveBeenCalled();
  });
});
