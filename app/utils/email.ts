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
export const SEND_TIMEOUT_MS = 20_000;

/*
 * WHY 20 s AND NOT 15. Measured 2026-08-08, two successful sends to external
 * recipients: `msPerSend` 14 413 ms. A 15 s ceiling sits 600 ms above the
 * AVERAGE, so a send only slightly slower than typical is killed — and a killed
 * send is a notification destroyed, because stage 8 consumes regardless. One
 * already died at exactly 15 000 ms. This costs nothing: the admission check in
 * stage 7 reserves the ceiling out of the budget either way, and at 14.4 s per
 * send the count that fits in 40 s is two at 15 s and two at 20 s.
 *
 * The 14.4 s itself is NOT normal and is not ours: the same server accepts a
 * 20 KB message for a LOCAL recipient in 67 ms (`/api/cron/smtp-probe?data=1`).
 * Only remote recipients cost this, which points at the server delivering
 * synchronously instead of queueing. Fixing that upstream makes this constant
 * irrelevant; until then it is what keeps a typical send from being thrown away.
 */

/**
 * How many messages may be in flight at once — the throughput knob, sized from a
 * measurement rather than from caution.
 *
 * `/api/cron/smtp-probe` run against production on 2026-08-07 reported
 * `coldMs:428, warmMs:328, secondColdMs:200`: connect, TLS, greeting and AUTH all
 * complete in well under half a second from Vercel. Yet one send measured ~13.4 s.
 * The cost is therefore in the MESSAGE, not the connection — which is exactly the
 * case pooling cannot help, and the reason `maxConnections: 1` had to go.
 *
 * Serialized, a 17-recipient service needed ~220 s and could not fit in a 60 s
 * function at all; the sweep discharged one email and dropped the rest, because
 * consumption is unconditional. In flight together they need ~3 rounds.
 *
 * Bounded, not unlimited: this dials a shared cPanel/Exim mailbox, which answers
 * a flood with `421 too many connections` rather than with speed.
 */
export const SEND_CONCURRENCY = 1;

/*
 * WHY IT IS BACK TO 1, AND WHAT WOULD JUSTIFY RAISING IT.
 *
 * Raising it to 8 was reasoned from the probe and was WRONG in production. The
 * 2026-08-07 rehearsal ran 16 sends, 8 in flight: every one hit the 15 s ceiling
 * and `emailed` was 0 — worse than the serial run that had at least delivered
 * one. Notably even the FIRST of the eight failed, which is not what a server
 * that merely queues would do; opening the connections together degraded the
 * send that would otherwise have completed in ~13.4 s.
 *
 * That result is CONFOUNDED and should not be over-read: `EMAIL_REDIRECT_TO`
 * pointed every message at one Hotmail address, and Hotmail throttles a burst
 * from one sender hard. So it is evidence against 8-to-one-domain, and says
 * little about 8-to-seventeen-domains, which is the case that actually matters.
 * The redirect is what made the rehearsal safe and is also what spoiled its
 * measurement — worth knowing before designing the next one.
 *
 * 1 is therefore not a conclusion, it is the only setting with a confirmed
 * production success. The wave machinery in stage 7 is unchanged and correct at
 * any value; this constant is the whole knob. Raise it when there is a clean
 * measurement against many recipient domains — or delete the question by moving
 * to the Resend backend below, where a send is an HTTP call and none of this
 * arithmetic applies.
 */

// Reuse pooled SMTP connections across a batch (and across warm invocations)
// instead of opening a fresh auth per email. Setup is cheap here (see the probe
// numbers above), so the pool is no longer what makes a batch fast — it is
// SEND_CONCURRENCY that does. The pool's job now is to hold those connections
// open across the messages of one sweep.
let cachedTransport: { key: string; transport: Transporter } | null = null;
function smtpTransport(host: string, port: number, secure: boolean, user: string, pass: string): Transporter {
  const key = `${host}:${port}:${secure}:${user}`;
  if (cachedTransport?.key === key) return cachedTransport.transport;
  const transport = nodemailer.createTransport({
    host, port, secure, auth: { user, pass },
    pool: true, maxConnections: SEND_CONCURRENCY, maxMessages: 100,
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
 * WHY A TIMED-OUT SEND NO LONGER TEARS DOWN THE POOL.
 *
 * While `maxConnections` was 1, an abandoned `sendMail` owned the only connection
 * and closing the transport was how the next send avoided queueing behind a
 * conversation nobody was waiting for. With sends in flight together that same
 * close is friendly fire: it would drop the connections carrying the other seven
 * recipients, turning one stalled message into eight failures.
 *
 * `socketTimeout` (SEND_TIMEOUT_MS) is what reclaims a stuck connection now, and
 * it does it at the right granularity — nodemailer destroys THAT connection and
 * the pool dials a replacement, while its siblings carry on. The two bounds fire
 * at the same moment by construction, so a send we abandon is a connection the
 * pool is already discarding.
 */

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
      // The pool stays up on purpose — see the note above `sendWithTimeout`.
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
