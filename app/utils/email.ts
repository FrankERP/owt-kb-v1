import { Resend } from "resend";
import nodemailer, { type Transporter } from "nodemailer";

import { blockDelivery, recordDeliveryAttempt } from "./deliveryFirewall";

/**
 * HARD CEILING ON ONE SEND — the contract that keeps the outbox from wedging
 * itself, so it is stated here rather than left to nodemailer's defaults.
 *
 * `sendEmail` MUST resolve within roughly this budget on every path, because
 * every caller runs inside a Vercel function with `maxDuration = 60`. Nodemailer's
 * own defaults are connection 120 s, greeting 30 s and socket 600 s — each at or
 * far past that ceiling — so an unresponsive or tarpitting SMTP server does not
 * fail the send, it hangs the whole invocation until the platform kills it.
 *
 * That is not hypothetical. On 2026-08-06 sends began stalling mid-conversation,
 * and because the process was killed at 60 s, `sweepOutbox`'s stage 8 never ran:
 * 28 claimed notices stayed `status:"sending"`, the 5-minute lease re-offered the
 * same batch to the next sweep, and it hung in exactly the same place. Zero
 * emails and a red workflow for over a day, from one slow mail server. The bound
 * lives HERE, in the one function that talks to SMTP, so that the sweep's
 * between-sends budget check is once again a valid bound on the stage.
 */
export const SEND_TIMEOUT_MS = 15_000;

// Reuse one pooled SMTP connection across a batch (and across warm invocations)
// instead of opening a fresh auth per email — gentler on the cPanel/MailBaby
// server and much faster when notifying the whole team. maxConnections:1 keeps
// sends serialized over a single connection.
let cachedTransport: { key: string; transport: Transporter } | null = null;
function smtpTransport(host: string, port: number, secure: boolean, user: string, pass: string): Transporter {
  const key = `${host}:${port}:${secure}:${user}`;
  if (cachedTransport?.key === key) return cachedTransport.transport;
  const transport = nodemailer.createTransport({
    host, port, secure, auth: { user, pass },
    pool: true, maxConnections: 1, maxMessages: 100,
    // Every one of these overrides a default that outlives the hosting function.
    // They are the cheap, in-protocol half of the ceiling: they turn a dead peer
    // into a thrown error at a known moment instead of a silent hang.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    // Inactivity, not total duration — which is why it alone is not enough, and
    // why `sendWithTimeout` wraps the whole conversation as well.
    socketTimeout: SEND_TIMEOUT_MS,
  });
  cachedTransport = { key, transport };
  return transport;
}

/**
 * Drop the pooled transport after a send we gave up on.
 *
 * `maxConnections: 1` is what makes this necessary: an abandoned `sendMail` still
 * owns the single connection, so the next send would queue behind a conversation
 * nobody is waiting for and time out too — one stalled peer would cost every
 * remaining recipient in the batch its own full timeout. Closing forces the next
 * call to dial fresh.
 */
function dropTransport(): void {
  const cached = cachedTransport;
  cachedTransport = null;
  try {
    cached?.transport.close();
  } catch {
    // A transport we are already discarding cannot fail in a way that matters.
  }
}

/**
 * `transport.sendMail`, bounded. Resolves within `ms` on every path — sent,
 * rejected, or abandoned — and never rejects.
 *
 * Racing does not cancel the underlying send: a message we abandon may still be
 * delivered. That is the right trade for this outbox, which is best-effort with
 * no retry (spec §1) and where the alternative — blocking until the platform
 * kills the process — loses the whole batch instead of one message.
 */
async function sendWithTimeout(
  transport: Transporter,
  message: { from: string; to: string; subject: string; html: string },
  ms: number,
): Promise<{ ok: boolean; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Settled, never rejected, so abandoning it cannot surface as an unhandled
  // rejection after the race is already decided.
  const send = transport.sendMail(message).then(
    () => ({ kind: "sent" as const }),
    (err: unknown) => ({ kind: "failed" as const, err }),
  );
  const expiry = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), ms);
  });
  try {
    const outcome = await Promise.race([send, expiry]);
    if (outcome.kind === "timeout") {
      const error = `SMTP send timed out after ${ms}ms`;
      console.error("[email] SMTP send timed out:", { timeoutMs: ms, to: message.to });
      dropTransport();
      return { ok: false, error };
    }
    if (outcome.kind === "failed") {
      console.error("[email] SMTP send failed:", outcome.err);
      return { ok: false, error: String(outcome.err) };
    }
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}

// Sends one email. Two backends, chosen by env:
//   1. SMTP (preferred) — when SMTP_HOST + SMTP_USER + SMTP_PASS are set, sends
//      through that mailbox (e.g. contacto@oasis.mx on the cPanel/MailBaby
//      server). Delivers to anyone; no domain verification needed.
//   2. Resend — when RESEND_API_KEY is set (and no SMTP_HOST). Requires a
//      verified sending domain to reach arbitrary recipients.
// EMAIL_FROM is required for both; with neither backend configured the call
// no-ops so the whole email feature stays inert until env is provided.
export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<{ ok: boolean; error?: string }> {
  // A3 §3 outbound-delivery firewall. Checked FIRST — before EMAIL_FROM, before
  // the credential checks, and therefore long before any provider client could be
  // constructed. It sits ahead of the env checks on purpose: the verification
  // deployment carries no SMTP/Resend credentials at all, so a gate placed after
  // them would produce no `delivery_blocked` evidence and the harness would have
  // nothing but fixture absence to reason from. The channel reported is the one
  // this call WOULD have used.
  if (blockDelivery({ channel: process.env.SMTP_HOST ? "smtp" : "resend", recipientCount: 1 })) {
    return { ok: false, error: "delivery blocked" };
  }

  const from = process.env.EMAIL_FROM;
  if (!from) return { ok: false, error: "email disabled" };

  const host = process.env.SMTP_HOST;
  if (host) {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) return { ok: false, error: "email disabled" };
    const port = Number(process.env.SMTP_PORT ?? 465);
    // Implicit TLS on 465; STARTTLS on 587. Override with SMTP_SECURE if needed.
    const secure = process.env.SMTP_SECURE != null ? process.env.SMTP_SECURE === "true" : port === 465;
    try {
      recordDeliveryAttempt({ channel: "smtp", recipientCount: 1 });
      const transport = smtpTransport(host, port, secure, user, pass);
      // Bounded: see SEND_TIMEOUT_MS. Constructing the transport can still throw
      // synchronously (bad options), which is what the catch below is left for.
      return await sendWithTimeout(
        transport,
        { from, to: opts.to, subject: opts.subject, html: opts.html },
        SEND_TIMEOUT_MS,
      );
    } catch (err) {
      console.error("[email] SMTP send failed:", err);
      return { ok: false, error: String(err) };
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "email disabled" };
  try {
    recordDeliveryAttempt({ channel: "resend", recipientCount: 1 });
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to: opts.to, subject: opts.subject, html: opts.html });
    if (error) return { ok: false, error: String((error as { message?: string }).message ?? error) };
    return { ok: true };
  } catch (err) {
    console.error("[email] sendEmail failed:", err);
    return { ok: false, error: String(err) };
  }
}
