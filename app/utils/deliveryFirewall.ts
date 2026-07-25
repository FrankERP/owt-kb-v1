import "server-only";

// Service Readiness A3 §3 — the outbound-delivery firewall.
//
// WHY THIS EXISTS
// ---------------
// The A3 deployed suite signs in as a real admin and MUTATES services on a live
// deployment. Every one of those mutations fans out through
// `serviceMutationSideEffects.ts` into assignment emails and FCM pushes, and
// `EMAIL_ALLOWLIST` defaults to `"*"` — the whole team. A verification run could
// therefore email and push ~30 real people.
//
// Branch-scoped environment variables are NOT proof of that not happening. They
// are an operator claim about a Vercel dashboard, they can be inherited from
// Preview, and they cannot be tested. So the refusal lives in the APP, at the
// TRANSPORT boundary:
//
//   · `app/utils/email.ts`      before the SMTP transport is created and before
//                               `new Resend(...)` is constructed
//   · `app/utils/firebaseAdmin.ts` before `initializeApp(...)`
//   · `app/utils/push.ts`       before `sendEachForMulticast(...)` and before the
//                               dead-token prune writes to Sanity
//
// A2 centralized post-commit effects in `serviceMutationSideEffects.ts`, and that
// is the main fan-out point — but the gate is deliberately NOT only there. A
// future route, cron or script that reaches `sendEmail`/`sendPush` directly gets
// the same refusal, because the refusal is in front of the provider client rather
// than in front of one caller.
//
// THE TWO PROPERTIES
// ------------------
// 1. FAIL CLOSED. `SERVICE_READINESS_DELIVERY_MODE=disabled` blocks everything.
//    So does any value nobody recognizes: `Disabled`, `disable`, `off`, `false`
//    all BLOCK. A typo must never be the thing that mails the whole team.
// 2. PRODUCTION IS UNCHANGED. An absent (or explicitly `normal`) mode allows
//    delivery with the same recipients and the same payloads as before this
//    module existed. This file is on the hot path of every real notification, so
//    that compatibility is a hard requirement, proven by
//    `__tests__/deliveryFirewallTransports.test.ts`.
//
// EVIDENCE
// --------
// A block emits one structured `delivery_blocked` JSON line; the allowed path
// emits one `delivery_attempt` line. The harness
// (`e2e/service-readiness/lib/deliveryEvidence.ts`) reads a COMPLETE recorded log
// (`SR_VERIFY_RUNTIME_LOG_FILE`) and requires at least one run-scoped
// `delivery_blocked` and exactly zero `delivery_attempt`. The field names here
// (`event`, `runId`, `transport`) are the ones that parser reads — there is one
// format, not two.
//
// REDACTION
// ---------
// A record carries the channel, a non-PII recipient COUNT, and the non-secret
// run/deployment/candidate markers when present. Never an email address, never a
// device token, never a secret, and never the raw mode value (a block reason CODE
// is emitted instead, so a "bypass value" someone tried can't be echoed).
//
// BLOCKING IS NOT AN ERROR
// ------------------------
// Delivery is best-effort at-most-once. `blockDelivery` returns a boolean and
// never throws — not even when the log sink does — so a firewall block can never
// roll back committed content or surface as a failed mutation.

import {
  DELIVERY_MODE_DISABLED,
  DELIVERY_MODE_ENV,
  resolveVerificationEnvironment,
  type EnvLike,
} from "./srVerificationIdentity";

/* ------------------------------------------------------------------ *
 * Constants — reused from the A3 identity module, never re-declared
 * ------------------------------------------------------------------ */

export { DELIVERY_MODE_DISABLED, DELIVERY_MODE_ENV };
export type { EnvLike };

/**
 * The one explicitly-normal value. An ABSENT mode is normal too (that is
 * production today); this exists so an operator can state "delivery is on"
 * without the value looking like an unrecognized typo.
 */
export const DELIVERY_MODE_NORMAL = "normal";

/** Event names. Must match `e2e/service-readiness/lib/deliveryEvidence.ts`. */
export const DELIVERY_BLOCKED_EVENT = "delivery_blocked";
export const DELIVERY_ATTEMPT_EVENT = "delivery_attempt";

/**
 * The gated transports.
 *
 *   smtp   — the pooled nodemailer transport
 *   resend — the Resend HTTP client
 *   fcm    — Firebase Admin init + `sendEachForMulticast`
 *   prune  — the dead-device-token Sanity write that follows an FCM response
 */
export type DeliveryChannel = "smtp" | "resend" | "fcm" | "prune";

export const DELIVERY_CHANNELS: readonly DeliveryChannel[] = Object.freeze([
  "smtp",
  "resend",
  "fcm",
  "prune",
] as const);

/** `EMAIL_ALLOWLIST` — read by `assignmentEmail.getAllowlist()`; defaults to `"*"`. */
export const ALLOWLIST_ENV = "EMAIL_ALLOWLIST";

/**
 * Every variable that can make this deployment capable of delivering OUTBOUND to
 * a real person. All five `SMTP_*` are listed, not just the three that are
 * strictly required: the plan's condition is "must not inherit/define
 * production-capable `SMTP_*`", and a stricter list only ever fails closed.
 *
 * `SANITY_WRITE_TOKEN` is deliberately NOT here — see `OBSERVED_ENVS`.
 */
export const PRODUCTION_TRANSPORT_ENVS: readonly string[] = Object.freeze([
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_REDIRECT_TO",
  "FIREBASE_SERVICE_ACCOUNT",
] as const);

/**
 * Reported for completeness, never required to be absent.
 *
 * `SANITY_WRITE_TOKEN` is what the dead-token prune commits with — but it is also
 * what the whole verification run mutates fixtures with, so demanding its absence
 * would make the run impossible. Pruning is held back by the `prune` channel gate
 * in `push.ts`, which is a code refusal rather than a missing credential.
 */
export const OBSERVED_ENVS: readonly string[] = Object.freeze(["SANITY_WRITE_TOKEN"] as const);

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

export type DeliveryModeState = "normal" | "disabled" | "unrecognized";
export type DeliveryBlockReason = "disabled" | "unrecognized_mode";

function trimmed(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

/**
 * Resolve the mode. Absent / empty / `normal` allow; `disabled` blocks; ANYTHING
 * ELSE blocks. The comparison is exact and case-sensitive on purpose — `Disabled`
 * is a typo, and a typo that silently allowed delivery would defeat the point.
 */
export function resolveDeliveryMode(env: EnvLike = process.env as EnvLike): DeliveryModeState {
  const raw = trimmed(env[DELIVERY_MODE_ENV]);
  if (raw === null) return "normal";
  if (raw === DELIVERY_MODE_DISABLED) return "disabled";
  if (raw === DELIVERY_MODE_NORMAL) return "normal";
  return "unrecognized";
}

export interface DeliveryDecision {
  allowed: boolean;
  mode: DeliveryModeState;
  reason: DeliveryBlockReason | null;
}

export function evaluateDelivery(env: EnvLike = process.env as EnvLike): DeliveryDecision {
  const mode = resolveDeliveryMode(env);
  if (mode === "normal") return { allowed: true, mode, reason: null };
  return {
    allowed: false,
    mode,
    reason: mode === "disabled" ? "disabled" : "unrecognized_mode",
  };
}

/** Convenience predicate for a caller that only needs the boolean. */
export function isDeliveryBlocked(env: EnvLike = process.env as EnvLike): boolean {
  return !evaluateDelivery(env).allowed;
}

/* ------------------------------------------------------------------ *
 * Run markers (non-secret provenance)
 * ------------------------------------------------------------------ */

export interface DeliveryRunMarkers {
  runId?: string;
  candidateSha?: string;
  deploymentId?: string;
}

/**
 * The run/deployment/candidate markers, when present.
 *
 * `candidateSha`/`deploymentId` come from `resolveVerificationEnvironment`, so the
 * provider-variable-then-`SR_VERIFY_*`-fallback order is defined in exactly one
 * place. `runId` is the harness's own `SR_VERIFY_RUN_ID`, which is what scopes the
 * evidence to a single run.
 *
 * Absent markers are OMITTED rather than emitted as `null`, so an ordinary
 * production log line stays minimal.
 */
export function deliveryRunMarkers(env: EnvLike = process.env as EnvLike): DeliveryRunMarkers {
  const resolved = resolveVerificationEnvironment(env);
  const runId = trimmed(env.SR_VERIFY_RUN_ID);
  const markers: DeliveryRunMarkers = {};
  if (runId) markers.runId = runId;
  if (resolved.gitCommitSha) markers.candidateSha = resolved.gitCommitSha;
  if (resolved.deploymentId) markers.deploymentId = resolved.deploymentId;
  return markers;
}

/* ------------------------------------------------------------------ *
 * The evidence record
 * ------------------------------------------------------------------ */

export interface DeliveryRecord extends DeliveryRunMarkers {
  event: typeof DELIVERY_BLOCKED_EVENT | typeof DELIVERY_ATTEMPT_EVENT;
  /** The gated transport. Named `transport` because that is the field the harness reads. */
  transport: DeliveryChannel;
  /** How many recipients the call would have reached. A COUNT — never an identity. */
  recipientCount: number;
  /** Present on a block only. A CODE, never the raw mode value. */
  reason?: DeliveryBlockReason;
}

export function buildDeliveryRecord({
  event,
  channel,
  recipientCount,
  reason,
  env = process.env as EnvLike,
}: {
  event: DeliveryRecord["event"];
  channel: DeliveryChannel;
  recipientCount: number;
  reason?: DeliveryBlockReason;
  env?: EnvLike;
}): DeliveryRecord {
  const record: DeliveryRecord = {
    event,
    transport: channel,
    // Never negative, never fractional — a count that looks like an id is a smell.
    recipientCount: Math.max(0, Math.trunc(recipientCount) || 0),
  };
  if (reason) record.reason = reason;
  return { ...record, ...deliveryRunMarkers(env) };
}

/** Minimal sink, so tests can capture the exact emitted lines. */
export type DeliveryLogger = Pick<Console, "log">;

/**
 * Emit one record as a single JSON line.
 *
 * Wrapped in try/catch because emitting EVIDENCE must never become the thing that
 * breaks a mutation: a blocked delivery still has to return quietly.
 */
export function emitDeliveryRecord(
  record: DeliveryRecord,
  logger: DeliveryLogger = console,
): void {
  try {
    logger.log(JSON.stringify(record));
  } catch {
    // Best-effort evidence. A dead log sink cannot be allowed to throw into a
    // caller that has already committed content.
  }
}

/* ------------------------------------------------------------------ *
 * The gates every transport calls
 * ------------------------------------------------------------------ */

export interface DeliveryGateOptions {
  channel: DeliveryChannel;
  /** Recipients this call would reach. A count only. */
  recipientCount: number;
  env?: EnvLike;
  logger?: DeliveryLogger;
}

/**
 * THE gate. Call it immediately before constructing a provider client or issuing
 * a send, and return early when it answers `true`.
 *
 *   · blocked → emits ONE `delivery_blocked` record and returns `true`.
 *   · allowed → emits NOTHING and returns `false`. The caller records the attempt
 *     itself with {@link recordDeliveryAttempt}, at the exact point where it is
 *     really about to talk to the provider, so an "attempt" always means an
 *     attempt.
 *
 * Never throws.
 */
export function blockDelivery({
  channel,
  recipientCount,
  env = process.env as EnvLike,
  logger = console,
}: DeliveryGateOptions): boolean {
  const decision = evaluateDelivery(env);
  if (decision.allowed) return false;
  emitDeliveryRecord(
    buildDeliveryRecord({
      event: DELIVERY_BLOCKED_EVENT,
      channel,
      recipientCount,
      reason: decision.reason ?? "unrecognized_mode",
      env,
    }),
    logger,
  );
  return true;
}

/**
 * Record that a real provider call is about to happen. Emits nothing when
 * delivery is blocked, so a blocked run's logs contain zero `delivery_attempt`
 * lines even if a caller forgets its gate.
 */
export function recordDeliveryAttempt({
  channel,
  recipientCount,
  env = process.env as EnvLike,
  logger = console,
}: DeliveryGateOptions): void {
  if (!evaluateDelivery(env).allowed) return;
  emitDeliveryRecord(
    buildDeliveryRecord({ event: DELIVERY_ATTEMPT_EVENT, channel, recipientCount, env }),
    logger,
  );
}

/**
 * Thrown by the one gate that has no "return early" shape available to it:
 * `firebaseAdmin.getMessaging()`, which must hand back a Messaging instance or
 * nothing at all.
 *
 * Carries the channel name and nothing else. `push.ts` gates before it ever gets
 * here and its existing try/catch swallows anything that does, so this can never
 * surface as a failed mutation.
 */
export class DeliveryBlockedError extends Error {
  readonly channel: DeliveryChannel;
  constructor(channel: DeliveryChannel) {
    super(
      `[deliveryFirewall] outbound delivery is disabled; refusing to initialize the ${channel} transport`,
    );
    this.name = "DeliveryBlockedError";
    this.channel = channel;
  }
}

/** Throwing form of {@link blockDelivery}, for a gate that cannot return a boolean. */
export function requireDeliveryAllowed(options: DeliveryGateOptions): void {
  if (blockDelivery(options)) throw new DeliveryBlockedError(options.channel);
}

/* ------------------------------------------------------------------ *
 * Preflight — names and scopes only, fails closed
 * ------------------------------------------------------------------ */

export type DeliveryPreflightFailureCode =
  | "delivery_mode_not_disabled"
  | "transport_configured"
  | "allowlist_absent"
  | "allowlist_wildcard";

export interface DeliveryPreflightFailure {
  code: DeliveryPreflightFailureCode;
  /** The variable this failure is about, when it is about one. NAME only. */
  envName: string | null;
  message: string;
}

export interface DeliveryPreflightReport {
  ok: boolean;
  failures: DeliveryPreflightFailure[];
  /** `SERVICE_READINESS_DELIVERY_MODE` is exactly `disabled`. */
  deliveryModeDisabled: boolean;
  /** Presence only, per variable. A VALUE never appears in this report. */
  transports: { name: string; set: boolean }[];
  /** Reported for completeness; not required to be absent. */
  observed: { name: string; set: boolean }[];
  /**
   * `present` distinguishes an EXPLICITLY empty allowlist (safe: nothing matches)
   * from an ABSENT one (unsafe: `getAllowlist()` defaults to `"*"`).
   * `entryCount` is a count, never the entries.
   */
  allowlist: { present: boolean; wildcard: boolean; entryCount: number };
}

/**
 * Report whether this environment is safe to run a mutating verification suite in.
 *
 * FAILS CLOSED on every axis. In particular an ABSENT `EMAIL_ALLOWLIST` is a
 * FAILURE, not a pass: `assignmentEmail.getAllowlist()` defaults an absent value
 * to `"*"`, so "we never set it" means "the whole team is deliverable". The
 * allowlist must be explicitly present and free of `*`; an explicitly empty
 * string satisfies that (it matches nobody).
 *
 * Returns NAMES, presence booleans and counts. It never reads a value into the
 * report, so the report itself is safe to print, store and attach as evidence.
 */
export function deliveryPreflight(env: EnvLike = process.env as EnvLike): DeliveryPreflightReport {
  const failures: DeliveryPreflightFailure[] = [];

  const mode = resolveDeliveryMode(env);
  const deliveryModeDisabled = mode === "disabled";
  if (!deliveryModeDisabled) {
    failures.push({
      code: "delivery_mode_not_disabled",
      envName: DELIVERY_MODE_ENV,
      message:
        `${DELIVERY_MODE_ENV} must be exactly "${DELIVERY_MODE_DISABLED}". ` +
        `Resolved mode state: "${mode}". A mutating verification run may not proceed without the ` +
        `transport firewall explicitly closed.`,
    });
  }

  const transports = PRODUCTION_TRANSPORT_ENVS.map((name) => ({
    name,
    set: trimmed(env[name]) !== null,
  }));
  for (const t of transports) {
    if (!t.set) continue;
    failures.push({
      code: "transport_configured",
      envName: t.name,
      message:
        `${t.name} is set, so a production-capable outbound transport is reachable from this deployment. ` +
        `The verification branch must not inherit or define it.`,
    });
  }

  // Raw read, NOT `trimmed`: `EMAIL_ALLOWLIST=""` is explicitly empty (safe),
  // while an absent variable defaults to "*" in getAllowlist() (unsafe).
  const rawAllowlist = env[ALLOWLIST_ENV];
  const present = typeof rawAllowlist === "string";
  const entries = present
    ? rawAllowlist
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const wildcard = entries.includes("*");
  if (!present) {
    failures.push({
      code: "allowlist_absent",
      envName: ALLOWLIST_ENV,
      message:
        `${ALLOWLIST_ENV} is ABSENT. That is not proof of safety: getAllowlist() defaults an absent value to "*", ` +
        `which makes every team member with an email address deliverable. Set it explicitly (an empty string matches nobody).`,
    });
  } else if (wildcard) {
    failures.push({
      code: "allowlist_wildcard",
      envName: ALLOWLIST_ENV,
      message: `${ALLOWLIST_ENV} contains the "*" wildcard, which opens delivery to the whole team.`,
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    deliveryModeDisabled,
    transports,
    observed: OBSERVED_ENVS.map((name) => ({ name, set: trimmed(env[name]) !== null })),
    allowlist: { present, wildcard, entryCount: entries.length },
  };
}

/** Operator-readable rendering. Codes, variable NAMES and counts only. */
export function describeDeliveryPreflight(report: DeliveryPreflightReport): string {
  const lines = [
    "",
    `Service Readiness A3 §3 outbound-delivery preflight — ${report.ok ? "CLOSED (safe)" : "REFUSING"}.`,
    "",
    `  ${DELIVERY_MODE_ENV} is exactly "${DELIVERY_MODE_DISABLED}": ${report.deliveryModeDisabled ? "yes" : "NO"}`,
    `  ${ALLOWLIST_ENV}: present=${report.allowlist.present} wildcard=${report.allowlist.wildcard} entries=${report.allowlist.entryCount}`,
    "  production-capable transports (name → set):",
  ];
  for (const t of report.transports) lines.push(`    ${t.name} → ${t.set}`);
  lines.push("  observed (not required absent):");
  for (const o of report.observed) lines.push(`    ${o.name} → ${o.set}`);
  if (report.failures.length) {
    lines.push("");
    for (const f of report.failures) lines.push(`  ✗ [${f.code}] ${f.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
