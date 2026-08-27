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
 * WHY 20 s AND NOT 15. Measured 2026-08-07, two successful sends to external
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
 * How many messages may be in flight at once. **Eight**, since the sender moved
 * to Gmail. The block below is the history, and it matters: this was 1 for three
 * weeks on a MEASURED result, not on caution.
 *
 * It also feeds `maxConnections`, so the pool is exactly as wide as this.
 */
export const SEND_CONCURRENCY = 8;

/*
 * RAISED TO 8 ON 2026-08-27, WITH THE SENDER. Everything below this paragraph
 * was measured against `mail.oasis.mx`, which no longer sends anything: the
 * refutation was a property of THAT server serializing acceptance, not of
 * concurrency. Production now sends through Gmail, which Frank reports handles 8
 * in flight — and the comment below anticipated exactly this, keeping the
 * constant and the wave machinery "because both become correct the moment the
 * server does".
 *
 * TWO THINGS TO KNOW BEFORE TRUSTING THE 8:
 *
 *  - **The number below came from a probe; this one came from a report.** The
 *    2026-08-07 figures are in this file because ADR-0013 demanded measurement
 *    over reasoning — "do not re-derive it from first principles a third time".
 *    Honouring that rule means this value earns a probe of its own against Gmail
 *    (`scripts/measure-send-budget.mjs`), and until it has one, treat 8 as a
 *    decision rather than a datum.
 *  - **Gmail rate-limits per account.** The old server's failure mode was
 *    timeouts, which cost the batch. Gmail's is throttling or a temporary block,
 *    which costs every send from the account until it lifts. That is a worse
 *    failure and it is new.
 *
 * ── The 2026-08-07 measurement, against the RETIRED server ──────────────────
 *
 * TESTED TWICE, AT 8 AND AT 10. CONCURRENCY DID NOT WORK AGAINST THAT SERVER.
 *
 * 2026-08-07, ten messages in flight to TEN DIFFERENT gmail addresses, with the
 * claim phase fixed so stage 7 genuinely ran: `sendMs: 20020`, `emailed: 2`, and
 * eight `SMTP send timed out after 20000ms`. In twenty seconds with ten
 * connections open the server accepted TWO messages — the same ~1-per-12-seconds
 * it manages serially. The earlier 8-wide result was dismissable as a
 * single-domain artifact; this one is not, and the two agree.
 *
 * So the server serializes acceptance for remote recipients at a fixed rate, and
 * concurrency buys nothing while costing a great deal: every message that cannot
 * be accepted inside SEND_TIMEOUT_MS is a notification DESTROYED, because stage 8
 * consumes regardless. Ten wide turned two successes into two successes and eight
 * losses. Serial is not a compromise here, it is strictly better.
 *
 * The consequence for the product requirement is worth stating plainly rather
 * than leaving in the arithmetic: a monthly role publish owes ~20 people one
 * grouped email each, and 20 × ~14 s is far past the hosting function's 60 s
 * ceiling at ANY concurrency. That requirement cannot be met by tuning this
 * file. It needs the ~14 s remote accept fixed on the mail server, or the sweep
 * changed so that notices it never attempted are re-pended instead of consumed.
 *
 * Kept as a named constant, and the wave machinery in stage 7 kept with it,
 * because both become correct the moment the server does — not because the value
 * is in doubt. **That moment arrived on 2026-08-27**, which is why the constant
 * above is 8 and this section is history rather than instruction.
 *
 * Recorded as ADR-0013 (docs/adr/0013-smtp-sends-stay-serial.md), which also
 * carries the two things that would retire it.
 *
 * Historical note on why this was ever raised:
 *
 * The load this exists for is a MONTHLY ROLE PUBLISH: a month's services are
 * generated and published together, so one sweep owes ~20 people an email each
 * covering every service they serve that month. (August 2026: 7 services, 88
 * seats.) Grouping is the product requirement — one email per member listing
 * their month — and grouping only happens for recipients served in the SAME
 * sweep, because stage 6 groups what stage 3 claimed. Per-service singles are
 * fine for setlist notices; they are wrong for a monthly publish.
 *
 * That makes serial sends unusable rather than merely slow. At ~14.4 s each,
 * one 40 s budget serves two people, so a 20-recipient month either fragments
 * across ten sweeps or loses fifteen — and the cap is a choice between those two
 * failures, not a fix for either. Only concurrency reconciles them:
 *
 *     ceil(recipients / SEND_CONCURRENCY) × 14.4 s  <  SEND_BUDGET_MS
 *
 * At 10 wide, 17-20 recipients need two waves (~29 s), inside the 40 s budget
 * with the admission check's 20 s reserve still honoured.
 *
 * The 2026-08-07 run at 8 wide returned zero deliveries, and that is why this is
 * a TEST rather than a settled value: every message in it went to ONE Hotmail
 * address via EMAIL_REDIRECT_TO, which is the shape a provider throttles hardest.
 * It was never evidence about many messages to many domains. Reverting to 1 was
 * right while that was the only data; it is not a reason to leave the product
 * requirement unmet without measuring the case that actually occurs.
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
 * An earlier version closed the whole transport on a timeout. At
 * `maxConnections: 1` that was defensible — the abandoned `sendMail` owned the
 * only connection, and closing was how the next send avoided queueing behind a
 * conversation nobody was waiting for. It stopped being defensible the moment
 * sends could run alongside each other, where the same close is friendly fire:
 * it drops the connections carrying every other recipient in the wave, turning
 * one stalled message into a wave of failures. The width is back to 1 today, but
 * the teardown is not coming back with it — `socketTimeout` is simply the better
 * mechanism at any width.
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
//      through that mailbox — currently Gmail as dev.raccoon.labs@gmail.com,
//      with SMTP_PASS a Google APP PASSWORD. It was contacto@oasis.mx on
//      cPanel/MailBaby until 2026-08. Delivers to anyone; no domain
//      verification needed, which is why the sender moved here after Resend's
//      DNS verification for oasis.mx could not be completed.
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
