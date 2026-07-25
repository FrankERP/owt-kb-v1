import { Resend } from "resend";
import nodemailer, { type Transporter } from "nodemailer";

import { blockDelivery, recordDeliveryAttempt } from "./deliveryFirewall";

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
  });
  cachedTransport = { key, transport };
  return transport;
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
      await transport.sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html });
      return { ok: true };
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
