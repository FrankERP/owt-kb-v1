// Service Readiness A3 §3 — the outbound-delivery firewall's DECISION and its
// EVIDENCE, proven offline.
//
// Two properties matter more than anything else here, and they pull in opposite
// directions, so both are tested exhaustively:
//
//   1. FAIL CLOSED. `SERVICE_READINESS_DELIVERY_MODE=disabled` blocks; and so does
//      any value nobody recognizes. A typo (`disable`, `Disabled`, `off`, `false`)
//      must NOT become "deliver to the whole team".
//   2. PRODUCTION IS UNCHANGED. An absent mode allows delivery, byte-for-byte.
//      This module is on the path of every real assignment email and every real
//      push, so "unset behaves exactly as before" is a hard compatibility
//      requirement, not a nicety.
//
// The record shape is asserted against the e2e harness's own parser
// (`e2e/service-readiness/lib/deliveryEvidence.ts`) rather than against a second
// hand-written expectation, so the app and the harness cannot drift into two
// formats that each think they agree with the other.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ALLOWLIST_ENV,
  DELIVERY_ATTEMPT_EVENT,
  DELIVERY_BLOCKED_EVENT,
  DELIVERY_CHANNELS,
  DELIVERY_MODE_DISABLED,
  DELIVERY_MODE_ENV,
  DELIVERY_MODE_NORMAL,
  DeliveryBlockedError,
  PRODUCTION_TRANSPORT_ENVS,
  blockDelivery,
  buildDeliveryRecord,
  deliveryPreflight,
  deliveryRunMarkers,
  describeDeliveryPreflight,
  evaluateDelivery,
  recordDeliveryAttempt,
  requireDeliveryAllowed,
  resolveDeliveryMode,
  type DeliveryChannel,
} from "../deliveryFirewall";

import {
  evaluateDeliveryEvidence,
  parseDeliveryEvents,
} from "@/e2e/service-readiness/lib/deliveryEvidence";

/** A logger that captures the exact emitted lines, as a log file would. */
function capture() {
  const lines: string[] = [];
  return { lines, log: (line: string) => void lines.push(line) };
}

const DISABLED = { [DELIVERY_MODE_ENV]: DELIVERY_MODE_DISABLED } as const;

describe("resolveDeliveryMode", () => {
  it("treats an absent mode as normal — production delivers as today", () => {
    expect(resolveDeliveryMode({})).toBe("normal");
    expect(resolveDeliveryMode({ [DELIVERY_MODE_ENV]: undefined })).toBe("normal");
  });

  it("treats an empty / whitespace-only mode as normal (an unset Vercel var)", () => {
    expect(resolveDeliveryMode({ [DELIVERY_MODE_ENV]: "" })).toBe("normal");
    expect(resolveDeliveryMode({ [DELIVERY_MODE_ENV]: "   " })).toBe("normal");
  });

  it("recognizes the one explicit normal value", () => {
    expect(resolveDeliveryMode({ [DELIVERY_MODE_ENV]: DELIVERY_MODE_NORMAL })).toBe("normal");
    expect(resolveDeliveryMode({ [DELIVERY_MODE_ENV]: " normal " })).toBe("normal");
  });

  it("recognizes exactly `disabled`", () => {
    expect(resolveDeliveryMode(DISABLED)).toBe("disabled");
    expect(resolveDeliveryMode({ [DELIVERY_MODE_ENV]: " disabled " })).toBe("disabled");
  });

  it("fails closed on every near-miss — a typo never opens delivery", () => {
    for (const value of [
      "Disabled",
      "DISABLED",
      "disable",
      "disabled=true",
      "off",
      "false",
      "0",
      "enabled",
      "true",
      "sandbox",
      "yes",
    ]) {
      expect(resolveDeliveryMode({ [DELIVERY_MODE_ENV]: value })).toBe("unrecognized");
    }
  });
});

describe("evaluateDelivery", () => {
  it("allows an absent mode, with no block reason", () => {
    expect(evaluateDelivery({})).toEqual({ allowed: true, mode: "normal", reason: null });
  });

  it("blocks `disabled` with the `disabled` reason", () => {
    expect(evaluateDelivery(DISABLED)).toEqual({
      allowed: false,
      mode: "disabled",
      reason: "disabled",
    });
  });

  it("blocks an unrecognized mode with the `unrecognized_mode` reason", () => {
    expect(evaluateDelivery({ [DELIVERY_MODE_ENV]: "Disabled" })).toEqual({
      allowed: false,
      mode: "unrecognized",
      reason: "unrecognized_mode",
    });
  });
});

describe("deliveryRunMarkers", () => {
  it("omits every marker that is absent", () => {
    expect(deliveryRunMarkers({})).toEqual({});
  });

  it("carries run id, candidate SHA and deployment id when present", () => {
    expect(
      deliveryRunMarkers({
        SR_VERIFY_RUN_ID: "srvrun-0123456789abcdef",
        VERCEL_GIT_COMMIT_SHA: "abc123",
        VERCEL_DEPLOYMENT_ID: "dpl_1",
      }),
    ).toEqual({
      runId: "srvrun-0123456789abcdef",
      candidateSha: "abc123",
      deploymentId: "dpl_1",
    });
  });

  it("falls back to the explicitly configured SR_VERIFY_* provenance", () => {
    expect(
      deliveryRunMarkers({
        SR_VERIFY_RUN_ID: "srvrun-1",
        SR_VERIFY_CANDIDATE_SHA: "def456",
        SR_VERIFY_DEPLOYMENT_ID: "dpl_2",
      }),
    ).toEqual({ runId: "srvrun-1", candidateSha: "def456", deploymentId: "dpl_2" });
  });
});

describe("buildDeliveryRecord", () => {
  const env = {
    ...DISABLED,
    SR_VERIFY_RUN_ID: "srvrun-0123456789abcdef",
    VERCEL_GIT_COMMIT_SHA: "abc123",
    VERCEL_DEPLOYMENT_ID: "dpl_1",
  };

  it("carries the run/deployment/candidate markers, the channel and a count", () => {
    expect(
      buildDeliveryRecord({
        event: DELIVERY_BLOCKED_EVENT,
        channel: "smtp",
        recipientCount: 7,
        reason: "disabled",
        env,
      }),
    ).toEqual({
      event: DELIVERY_BLOCKED_EVENT,
      transport: "smtp",
      recipientCount: 7,
      reason: "disabled",
      runId: "srvrun-0123456789abcdef",
      candidateSha: "abc123",
      deploymentId: "dpl_1",
    });
  });

  it("never carries an address, a token, a secret or the raw mode value", () => {
    const record = buildDeliveryRecord({
      event: DELIVERY_BLOCKED_EVENT,
      channel: "fcm",
      recipientCount: 3,
      reason: "unrecognized_mode",
      env: {
        ...env,
        [DELIVERY_MODE_ENV]: "PLEASE-DELIVER-ANYWAY",
        EMAIL_ALLOWLIST: "frank@oasis.mx",
        EMAIL_REDIRECT_TO: "frank@oasis.mx",
        SMTP_PASS: "s3cret",
        RESEND_API_KEY: "re_live_key",
        FIREBASE_SERVICE_ACCOUNT: '{"private_key":"-----BEGIN"}',
        SANITY_WRITE_TOKEN: "sk-token",
      },
    });
    const serialized = JSON.stringify(record);
    for (const forbidden of [
      "@",
      "s3cret",
      "re_live_key",
      "BEGIN",
      "sk-token",
      "PLEASE-DELIVER-ANYWAY",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("keeps `reason` off the allowed-path attempt record", () => {
    const record = buildDeliveryRecord({
      event: DELIVERY_ATTEMPT_EVENT,
      channel: "resend",
      recipientCount: 1,
      env: {},
    });
    expect(record).toEqual({
      event: DELIVERY_ATTEMPT_EVENT,
      transport: "resend",
      recipientCount: 1,
    });
    expect("reason" in record).toBe(false);
  });
});

describe("blockDelivery", () => {
  it("returns false and emits NOTHING when the mode is absent", () => {
    const logger = capture();
    for (const channel of DELIVERY_CHANNELS) {
      expect(blockDelivery({ channel, recipientCount: 2, env: {}, logger })).toBe(false);
    }
    expect(logger.lines).toEqual([]);
  });

  it("returns true and emits ONE delivery_blocked record per channel when disabled", () => {
    const logger = capture();
    for (const channel of DELIVERY_CHANNELS) {
      expect(blockDelivery({ channel, recipientCount: 2, env: DISABLED, logger })).toBe(true);
    }
    expect(logger.lines).toHaveLength(DELIVERY_CHANNELS.length);
    const events = logger.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.map((e) => e.event)).toEqual(DELIVERY_CHANNELS.map(() => DELIVERY_BLOCKED_EVENT));
    expect(events.map((e) => e.transport)).toEqual([...DELIVERY_CHANNELS]);
  });

  it("blocks on an unrecognized mode too", () => {
    const logger = capture();
    expect(
      blockDelivery({
        channel: "smtp",
        recipientCount: 1,
        env: { [DELIVERY_MODE_ENV]: "off" },
        logger,
      }),
    ).toBe(true);
    expect(JSON.parse(logger.lines[0]).reason).toBe("unrecognized_mode");
  });

  it("never emits a delivery_attempt when blocked", () => {
    const logger = capture();
    blockDelivery({ channel: "fcm", recipientCount: 4, env: DISABLED, logger });
    expect(logger.lines.join("\n")).not.toContain(DELIVERY_ATTEMPT_EVENT);
  });

  it("never throws, even when the logger does — a block is not a caller error", () => {
    const exploding = {
      log: () => {
        throw new Error("log sink is down");
      },
    };
    expect(() =>
      blockDelivery({ channel: "prune", recipientCount: 1, env: DISABLED, logger: exploding }),
    ).not.toThrow();
    expect(blockDelivery({ channel: "prune", recipientCount: 1, env: DISABLED, logger: exploding })).toBe(
      true,
    );
  });
});

describe("recordDeliveryAttempt", () => {
  it("emits exactly one delivery_attempt record on the allowed path", () => {
    const logger = capture();
    recordDeliveryAttempt({ channel: "smtp", recipientCount: 1, env: {}, logger });
    expect(logger.lines).toHaveLength(1);
    const parsed = JSON.parse(logger.lines[0]) as Record<string, unknown>;
    expect(parsed.event).toBe(DELIVERY_ATTEMPT_EVENT);
    expect(parsed.transport).toBe("smtp");
    expect(parsed.recipientCount).toBe(1);
  });

  it("emits nothing when delivery is blocked — a blocked run has no attempts", () => {
    const logger = capture();
    recordDeliveryAttempt({ channel: "smtp", recipientCount: 1, env: DISABLED, logger });
    expect(logger.lines).toEqual([]);
  });
});

describe("requireDeliveryAllowed", () => {
  it("is a no-op on the allowed path", () => {
    expect(() =>
      requireDeliveryAllowed({ channel: "fcm", recipientCount: 1, env: {}, logger: capture() }),
    ).not.toThrow();
  });

  it("throws DeliveryBlockedError naming only the channel", () => {
    const logger = capture();
    let thrown: unknown;
    try {
      requireDeliveryAllowed({ channel: "fcm", recipientCount: 1, env: DISABLED, logger });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DeliveryBlockedError);
    expect((thrown as DeliveryBlockedError).channel).toBe("fcm");
    expect((thrown as Error).message).toContain("fcm");
    expect((thrown as Error).message).not.toContain("@");
    expect(JSON.parse(logger.lines[0]).event).toBe(DELIVERY_BLOCKED_EVENT);
  });
});

describe("the emitted record shape is what the e2e zero-delivery helper parses", () => {
  const runId = "srvrun-0123456789abcdef";
  const env = {
    ...DISABLED,
    SR_VERIFY_RUN_ID: runId,
    VERCEL_GIT_COMMIT_SHA: "abc123",
    VERCEL_DEPLOYMENT_ID: "dpl_1",
  };

  it("produces a run-scoped delivery_blocked verdict the harness accepts", () => {
    const logger = capture();
    for (const channel of DELIVERY_CHANNELS) {
      blockDelivery({ channel, recipientCount: 3, env, logger });
    }
    const events = parseDeliveryEvents("runtime.log", logger.lines.join("\n"));
    expect(events).toHaveLength(DELIVERY_CHANNELS.length);
    expect(events.every((e) => e.event === DELIVERY_BLOCKED_EVENT)).toBe(true);
    expect(events.every((e) => e.runId === runId)).toBe(true);
    expect(events.map((e) => e.transport)).toEqual([...DELIVERY_CHANNELS]);

    const verdict = evaluateDeliveryEvidence({
      events,
      runId,
      completeLogSources: ["runtime.log"],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.attempts).toEqual([]);
    expect(verdict.blocked).toHaveLength(DELIVERY_CHANNELS.length);
  });

  it("a blocked line is never mis-parsed as an attempt", () => {
    const logger = capture();
    blockDelivery({ channel: "smtp", recipientCount: 1, env, logger });
    const events = parseDeliveryEvents("runtime.log", logger.lines.join("\n"));
    expect(events.filter((e) => e.event === DELIVERY_ATTEMPT_EVENT)).toEqual([]);
  });

  it("an allowed-path attempt line IS detected by the harness parser", () => {
    const logger = capture();
    recordDeliveryAttempt({ channel: "smtp", recipientCount: 1, env: { SR_VERIFY_RUN_ID: runId }, logger });
    const events = parseDeliveryEvents("runtime.log", logger.lines.join("\n"));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe(DELIVERY_ATTEMPT_EVENT);
    const verdict = evaluateDeliveryEvidence({
      events,
      runId,
      completeLogSources: ["runtime.log"],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.code)).toContain("delivery_attempt_observed");
  });
});

describe("deliveryPreflight", () => {
  /** A branch environment that satisfies every condition. */
  function safeEnv(over: Record<string, string | undefined> = {}) {
    return { ...DISABLED, [ALLOWLIST_ENV]: "", ...over };
  }

  it("passes only when the mode is disabled AND no transport is reachable AND the allowlist is explicit", () => {
    const report = deliveryPreflight(safeEnv());
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.deliveryModeDisabled).toBe(true);
    expect(report.allowlist).toEqual({ present: true, wildcard: false, entryCount: 0 });
  });

  it("accepts an explicitly non-matching allowlist", () => {
    const report = deliveryPreflight(safeEnv({ [ALLOWLIST_ENV]: "nobody@invalid.test" }));
    expect(report.ok).toBe(true);
    expect(report.allowlist.entryCount).toBe(1);
  });

  it("fails closed on an ABSENT allowlist — absence is not proof of safety", () => {
    const report = deliveryPreflight(safeEnv({ [ALLOWLIST_ENV]: undefined }));
    expect(report.ok).toBe(false);
    expect(report.failures.map((f) => f.code)).toContain("allowlist_absent");
    expect(report.allowlist.present).toBe(false);
  });

  it("fails on a wildcard allowlist", () => {
    for (const value of ["*", " * ", "frank@oasis.mx,*"]) {
      const report = deliveryPreflight(safeEnv({ [ALLOWLIST_ENV]: value }));
      expect(report.ok).toBe(false);
      expect(report.failures.map((f) => f.code)).toContain("allowlist_wildcard");
    }
  });

  it("fails when the delivery mode is anything but exactly `disabled`", () => {
    for (const value of [undefined, "", "normal", "Disabled", "off"]) {
      const report = deliveryPreflight(safeEnv({ [DELIVERY_MODE_ENV]: value }));
      expect(report.ok).toBe(false);
      expect(report.failures.map((f) => f.code)).toContain("delivery_mode_not_disabled");
      expect(report.deliveryModeDisabled).toBe(false);
    }
  });

  it("fails once per reachable production transport variable, naming it", () => {
    for (const name of PRODUCTION_TRANSPORT_ENVS) {
      const report = deliveryPreflight(safeEnv({ [name]: "set" }));
      expect(report.ok).toBe(false);
      const transportFailures = report.failures.filter((f) => f.code === "transport_configured");
      expect(transportFailures.map((f) => f.envName)).toEqual([name]);
    }
  });

  it("covers the whole documented outbound inventory", () => {
    expect([...PRODUCTION_TRANSPORT_ENVS].sort()).toEqual(
      [
        "EMAIL_FROM",
        "EMAIL_REDIRECT_TO",
        "FIREBASE_SERVICE_ACCOUNT",
        "RESEND_API_KEY",
        "SMTP_HOST",
        "SMTP_PASS",
        "SMTP_PORT",
        "SMTP_SECURE",
        "SMTP_USER",
      ].sort(),
    );
  });

  it("reports names and presence only — never a value", () => {
    const report = deliveryPreflight(
      safeEnv({
        SMTP_PASS: "s3cret",
        RESEND_API_KEY: "re_live_key",
        FIREBASE_SERVICE_ACCOUNT: '{"private_key":"-----BEGIN"}',
        [ALLOWLIST_ENV]: "frank@oasis.mx",
        SANITY_WRITE_TOKEN: "sk-token",
      }),
    );
    const serialized = JSON.stringify(report) + describeDeliveryPreflight(report);
    for (const forbidden of ["s3cret", "re_live_key", "BEGIN", "frank@oasis.mx", "sk-token"]) {
      expect(serialized).not.toContain(forbidden);
    }
    // The variable NAMES are the point of the report, so they must be present.
    expect(serialized).toContain("SMTP_PASS");
    expect(serialized).toContain(ALLOWLIST_ENV);
  });

  it("observes the prune writer's variable without demanding its absence", () => {
    // SANITY_WRITE_TOKEN must stay SET on the verification deployment — the run
    // mutates fixtures with it. Dead-token pruning is held back by the firewall's
    // `prune` channel, not by making the deployment unable to write at all.
    const report = deliveryPreflight(safeEnv({ SANITY_WRITE_TOKEN: "sk-token" }));
    expect(report.ok).toBe(true);
    expect(report.observed.find((o) => o.name === "SANITY_WRITE_TOKEN")).toEqual({
      name: "SANITY_WRITE_TOKEN",
      set: true,
    });
  });

  it("collects every failure at once rather than one per run", () => {
    const report = deliveryPreflight({
      [DELIVERY_MODE_ENV]: "off",
      SMTP_HOST: "mail.oasis.mx",
      RESEND_API_KEY: "re_live",
      [ALLOWLIST_ENV]: "*",
    });
    const codes = report.failures.map((f) => f.code);
    expect(codes).toContain("delivery_mode_not_disabled");
    expect(codes).toContain("allowlist_wildcard");
    expect(codes.filter((c) => c === "transport_configured")).toHaveLength(2);
  });
});

describe("channel inventory", () => {
  it("names exactly the four gated transports", () => {
    const expected: DeliveryChannel[] = ["smtp", "resend", "fcm", "prune"];
    expect([...DELIVERY_CHANNELS]).toEqual(expected);
  });
});

describe("process.env is the default source", () => {
  const original = process.env[DELIVERY_MODE_ENV];
  beforeEach(() => {
    if (original === undefined) delete process.env[DELIVERY_MODE_ENV];
    else process.env[DELIVERY_MODE_ENV] = original;
  });

  it("reads the live process environment when no env is passed", () => {
    process.env[DELIVERY_MODE_ENV] = DELIVERY_MODE_DISABLED;
    try {
      expect(resolveDeliveryMode()).toBe("disabled");
      expect(evaluateDelivery().allowed).toBe(false);
    } finally {
      delete process.env[DELIVERY_MODE_ENV];
    }
    expect(resolveDeliveryMode()).toBe("normal");
  });
});
