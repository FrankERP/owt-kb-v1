// app/utils/smtpPhases.ts
//
// Times each SMTP command separately, so "a send takes 13 seconds" becomes a
// statement about WHICH PART takes 13 seconds. Nodemailer cannot answer that:
// `sendMail` performs MAIL FROM, RCPT TO and DATA as one opaque operation, and
// those three point at completely different causes on the server.
//
// IT DELIVERS NOTHING. The conversation stops at RCPT TO and sends QUIT — DATA
// is never issued, so no message is ever submitted. What that still exercises is
// everything the server does BEFORE accepting content: sender verification,
// recipient verification, and any callout to the recipient's own MTA.
//
// HOW TO READ IT (`mail.oasis.mx` is cPanel/Exim):
//
//   · `rcptToMs` large, and larger for an EXTERNAL recipient than a local one
//     → Exim is doing recipient callout verification: connecting to the
//       recipient's mail server to check the address before accepting. Classic
//       multi-second stall, and it explains a per-message cost that connection
//       pooling cannot touch. Fix is server-side: `verify = recipient/callout`.
//
//   · every phase here fast, yet a real send is slow
//     → the cost is in DATA, i.e. content scanning on submission (SpamAssassin,
//       ClamAV, rspamd). Also server-side, also fixable.
//
//   · `mailFromMs` large
//     → sender verification or a sender-side callout.
//
// Either way the answer is a setting on our own server, not a reason to rent
// someone else's.

import "server-only";

import tls from "node:tls";

/** Bound the whole conversation well inside the hosting route's maxDuration. */
const PHASE_TIMEOUT_MS = 20_000;

export interface SmtpPhaseReport {
  status: "ok" | "unconfigured" | "failed";
  /** The address RCPT TO asked about — echoed so a reading is interpretable. */
  recipient?: string;
  /** TCP + TLS + the 220 greeting. */
  connectMs?: number;
  ehloMs?: number;
  authMs?: number;
  mailFromMs?: number;
  /** The one to watch: recipient verification and any callout happen here. */
  rcptToMs?: number;
  /** Final SMTP reply codes, in order. Codes only — never the credentials. */
  codes?: string[];
  error?: string;
}

/**
 * One SMTP conversation, with a reply reader that understands continuation
 * lines (`250-` continues, `250 ` ends) — reading a multiline EHLO as several
 * replies would misattribute every subsequent timing.
 */
function converse(
  host: string,
  port: number,
  user: string,
  pass: string,
  from: string,
  recipient: string,
): Promise<SmtpPhaseReport> {
  return new Promise((resolve) => {
    const codes: string[] = [];
    const phases: Record<string, number> = {};
    let settled = false;
    let buffer = "";
    let waiting: ((reply: string) => void) | null = null;
    let started = Date.now();

    const socket = tls.connect({ host, port, servername: host });
    socket.setEncoding("utf8");

    const finish = (report: SmtpPhaseReport) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      try {
        socket.destroy();
      } catch {
        // Already gone; the report is what matters.
      }
      resolve(report);
    };

    const guard = setTimeout(
      () => finish({ status: "failed", recipient, ...phases, codes, error: `timed out after ${PHASE_TIMEOUT_MS}ms` }),
      PHASE_TIMEOUT_MS,
    );

    socket.on("error", (err) =>
      finish({ status: "failed", recipient, ...phases, codes, error: String(err) }),
    );

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      // A reply ends on a line whose 4th character is a space, not a hyphen.
      const lines = buffer.split(/\r?\n/);
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const reply = lines.slice(0, i + 1).join("\n");
          buffer = lines.slice(i + 1).join("\n");
          const cb = waiting;
          waiting = null;
          cb?.(reply);
          return;
        }
      }
    });

    /** Send a command (or nothing, to await the greeting) and time the reply. */
    const step = (name: string, command: string | null): Promise<string> =>
      new Promise((res) => {
        started = Date.now();
        waiting = (reply) => {
          phases[name] = Date.now() - started;
          codes.push(reply.slice(0, 3));
          res(reply);
        };
        if (command !== null) socket.write(command + "\r\n");
      });

    const ok = (reply: string, ...accepted: string[]) =>
      accepted.some((code) => reply.startsWith(code));

    void (async () => {
      try {
        const greeting = await step("connectMs", null);
        if (!ok(greeting, "220")) throw new Error(`greeting: ${greeting.slice(0, 80)}`);

        const ehlo = await step("ehloMs", "EHLO owt-backstage.vercel.app");
        if (!ok(ehlo, "250")) throw new Error(`EHLO: ${ehlo.slice(0, 80)}`);

        // AUTH PLAIN in one command: \0user\0pass, base64. The credential is
        // never logged, never returned, and never placed in `codes`.
        const authArg = Buffer.from(`\0${user}\0${pass}`).toString("base64");
        const auth = await step("authMs", `AUTH PLAIN ${authArg}`);
        if (!ok(auth, "235")) throw new Error(`AUTH rejected: ${auth.slice(0, 40)}`);

        const mailFrom = await step("mailFromMs", `MAIL FROM:<${from}>`);
        if (!ok(mailFrom, "250")) throw new Error(`MAIL FROM: ${mailFrom.slice(0, 80)}`);

        // The measurement this file exists for. Anything the server does to
        // verify the recipient — including a callout to their MTA — is paid here.
        const rcptTo = await step("rcptToMs", `RCPT TO:<${recipient}>`);
        // A refusal is still a timing, and still worth reporting.
        codes[codes.length - 1] = rcptTo.slice(0, 3);

        // QUIT, never DATA. Nothing is submitted and nobody receives anything.
        socket.write("QUIT\r\n");
        finish({ status: "ok", recipient, ...phases, codes });
      } catch (err) {
        finish({
          status: "failed",
          recipient,
          ...phases,
          codes,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });
}

/**
 * @param recipient Whose address RCPT TO asks about. Defaults to the sending
 * mailbox itself — a LOCAL address, which the server can verify without leaving
 * the building. Comparing that against an external address is what separates
 * "recipient callout" from "everything is slow".
 */
export async function probeSmtpPhases(recipient?: string): Promise<SmtpPhaseReport> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.SMTP_USER;
  if (!host || !user || !pass || !from) return { status: "unconfigured" };

  const port = Number(process.env.SMTP_PORT ?? 465);
  return converse(host, port, user, pass, from, recipient?.trim() || user);
}
