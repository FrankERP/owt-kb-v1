// app/utils/smtpProbe.ts
//
// Measures where the time goes on the SMTP path, from wherever this runs, WITHOUT
// sending mail. `transporter.verify()` performs connect → greeting → AUTH → QUIT
// and stops there, so the probe exercises the credentials and the network and
// contacts no member.
//
// It answers the one question the outbox's own logs cannot: when a send takes
// 13 seconds, is that the CONNECTION or the MESSAGE? The two point at opposite
// remedies — a per-connection cost is amortized by pooling and paid once per cold
// function, while a per-message cost is only relieved by sending concurrently —
// and guessing between them is how an afternoon gets spent on the wrong fix.
//
// Read the three numbers together:
//   · `coldMs` is one full setup: TCP, TLS, greeting, AUTH.
//   · `warmMs` is the SAME pooled transport asked again. If pooling works this is
//     near zero; if it is as slow as `coldMs`, the pool is not being reused and
//     every message pays full setup.
//   · `secondColdMs` is a second independent setup, so a one-off (a cold DNS
//     cache, a single slow handshake) is distinguishable from a standing cost.

import "server-only";

import nodemailer from "nodemailer";

import { isDeliveryBlocked } from "./deliveryFirewall";

/** Bound every phase well inside the hosting route's `maxDuration`. */
const PROBE_TIMEOUT_MS = 20_000;

export interface SmtpProbeReport {
  status: "ok" | "unconfigured" | "delivery_blocked";
  host?: string;
  port?: number;
  secure?: boolean;
  /**
   * Where mail is ACTUALLY going right now, or `null` for "to its real
   * recipients". Reported first and unconditionally, because `EMAIL_REDIRECT_TO`
   * is invisible from every other angle: a redirected deployment sends, logs and
   * reports exactly like a healthy one while the team receives nothing, and the
   * outbox consumes those notices anyway. Left set by accident it is silent,
   * total notification loss that still looks green — so the safety valve gets a
   * window, and a rehearsal can confirm it is on BEFORE queueing anything.
   */
  redirectTo?: string | null;
  /** Full setup on a fresh, unpooled transport: TCP + TLS + greeting + AUTH. */
  coldMs?: number | null;
  /** The same pooled transport asked a second time — the reuse cost. */
  warmMs?: number | null;
  /** A second independent setup, to separate a one-off from a standing cost. */
  secondColdMs?: number | null;
  errors?: Record<string, string>;
}

/** `verify()`, timed, and never allowed to hang or throw. */
async function timedVerify(
  transport: { verify: () => Promise<unknown> },
  label: string,
  errors: Record<string, string>,
): Promise<number | null> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const verify = transport.verify().then(
    () => ({ kind: "ok" as const }),
    (err: unknown) => ({ kind: "failed" as const, err }),
  );
  const expiry = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), PROBE_TIMEOUT_MS);
  });
  try {
    const outcome = await Promise.race([verify, expiry]);
    if (outcome.kind === "ok") return Date.now() - started;
    errors[label] =
      outcome.kind === "timeout" ? `timed out after ${PROBE_TIMEOUT_MS}ms` : String(outcome.err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeSmtp(): Promise<SmtpProbeReport> {
  // Read before every early return below, so "where is mail going?" is answered
  // even when the probe cannot reach the server at all.
  const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim() || null;
  // The probe sends nothing, but it does exercise the credentials against the
  // real server. A verification run is supposed to touch NOTHING outbound, so it
  // declines here too rather than making that promise almost true.
  if (isDeliveryBlocked()) return { status: "delivery_blocked", redirectTo };

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return { status: "unconfigured", redirectTo };

  const port = Number(process.env.SMTP_PORT ?? 465);
  const secure = process.env.SMTP_SECURE != null ? process.env.SMTP_SECURE === "true" : port === 465;
  const errors: Record<string, string> = {};
  // Written out at each call rather than spread from a shared object: the
  // `pool` flag is what selects nodemailer's transport overload, and it only
  // does that as an inline literal.
  const timeouts = {
    connectionTimeout: PROBE_TIMEOUT_MS,
    greetingTimeout: PROBE_TIMEOUT_MS,
    socketTimeout: PROBE_TIMEOUT_MS,
  };

  // Deliberately NOT the cached transport from `email.ts`: this must measure a
  // cold path, and borrowing a warm connection would report the reuse cost as
  // the setup cost — the exact confusion the probe exists to remove.
  const pooled = nodemailer.createTransport({
    host, port, secure, auth: { user, pass }, ...timeouts,
    pool: true, maxConnections: 1, maxMessages: 100,
  });
  const coldMs = await timedVerify(pooled, "cold", errors);
  const warmMs = await timedVerify(pooled, "warm", errors);
  pooled.close();

  const fresh = nodemailer.createTransport({
    host, port, secure, auth: { user, pass }, ...timeouts,
  });
  const secondColdMs = await timedVerify(fresh, "secondCold", errors);
  fresh.close();

  return {
    status: "ok",
    redirectTo,
    host, port, secure,
    coldMs, warmMs, secondColdMs,
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}
