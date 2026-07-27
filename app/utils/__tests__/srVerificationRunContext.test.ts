// Service Readiness A3 §3 — the request-scoped verification run context, and the
// run-scoped delivery evidence it makes possible.
//
// The gap this closes: `delivery_blocked` records used to take their markers from
// the DEPLOYMENT's `process.env`, where `SR_VERIFY_RUN_ID` does not and cannot
// exist. The teardown's `no_run_scoped_delivery_blocked` check was therefore
// unsatisfiable. Markers now come from the in-flight request's already-validated
// `x-sr-verification-*` ticket instead.
//
// What these tests defend, in order of how badly each would hurt:
//
//   1. BLOCKING IS NEVER CONDITIONAL ON A CONTEXT. With no request context at all —
//      an `after()` callback that outlived its scope, the reminder cron, a script —
//      delivery is still blocked and `delivery_blocked` is still emitted. A safety
//      control that only works during a test is not a safety control.
//   2. PRODUCTION IS BYTE-FOR-BYTE UNCHANGED. An unmarked request emits exactly the
//      record it emits with no context established at all.
//   3. WHOLE OR NOTHING. Every individual gate failure yields a record with NO
//      markers — never a partially-trusted stamp assembled from the parts that
//      happened to validate.
//   4. NO LEAK BETWEEN RUNS. Concurrent requests keep separate stores. (This is why
//      the store is established with `run()` and never with `enterWith()`, whose
//      mutation escapes its frame and would let one run's id stamp another's
//      evidence — the precise failure this evidence exists to rule out.)
//   5. IT ACTUALLY SATISFIES THE HARNESS. The emitted line round-trips through the
//      harness's own parser and produces an `ok` verdict for the run.

import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DELIVERY_ATTEMPT_EVENT,
  DELIVERY_BLOCKED_EVENT,
  DELIVERY_CHANNELS,
  DELIVERY_MODE_DISABLED,
  DELIVERY_MODE_ENV,
  blockDelivery,
  buildDeliveryRecord,
  deliveryRunMarkers,
  recordDeliveryAttempt,
} from "../deliveryFirewall";
import { VERIFICATION_HEADERS } from "../srVerificationLoginEvent";
import {
  currentVerificationRun,
  runWithVerificationRun,
  verificationRunMarkersFor,
  withVerificationRunContext,
  type VerificationRunMarkers,
} from "../srVerificationRunContext";

import {
  evaluateDeliveryEvidence,
  parseDeliveryEvents,
} from "@/e2e/service-readiness/lib/deliveryEvidence";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const MARKER = "owt-service-readiness-verification-v1";
const RUN_ID = "srvrun-0123456789abcdef";
const ATTEMPT_ID = "srvatt-0123456789ab";
const SHA = "c".repeat(40);
const DEPLOYMENT_ID = "dpl_9aBcDeFgHiJkLmNo";

/** A deployment that IS the isolated verification deployment. */
const DEPLOYMENT_ENV = Object.freeze({
  NEXT_PUBLIC_SANITY_PROJECT_ID: "scbxomq9",
  NEXT_PUBLIC_SANITY_DATASET: "service-readiness-verification",
  SERVICE_READINESS_VERIFICATION_MARKER: MARKER,
  ALLOW_SERVICE_READINESS_E2E_WRITES: "true",
  [DELIVERY_MODE_ENV]: DELIVERY_MODE_DISABLED,
  VERCEL_GIT_COMMIT_SHA: SHA,
  VERCEL_DEPLOYMENT_ID: DEPLOYMENT_ID,
});

/** The five headers the harness sends, as `verificationHeaders()` builds them. */
function ticketHeaders(over: Record<string, string | string[] | undefined> = {}) {
  return {
    [VERIFICATION_HEADERS.marker]: MARKER,
    [VERIFICATION_HEADERS.runId]: RUN_ID,
    [VERIFICATION_HEADERS.attemptId]: ATTEMPT_ID,
    [VERIFICATION_HEADERS.candidateSha]: SHA,
    [VERIFICATION_HEADERS.deploymentId]: DEPLOYMENT_ID,
    ...over,
  };
}

const EXPECTED_MARKERS: VerificationRunMarkers = {
  runId: RUN_ID,
  candidateSha: SHA,
  deploymentId: DEPLOYMENT_ID,
};

/** A logger that captures the exact emitted lines, as a log file would. */
function capture() {
  const lines: string[] = [];
  return { lines, log: (line: string) => void lines.push(line) };
}

function warnings() {
  const lines: string[] = [];
  return { lines, warn: (line: string) => void lines.push(line) };
}

/** Set real `process.env` keys for the handful of tests that exercise the defaults. */
const ENV_KEYS = [...Object.keys(DEPLOYMENT_ENV)];
function withProcessEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const key of new Set([...ENV_KEYS, ...Object.keys(env)])) {
    saved.set(key, process.env[key]);
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

afterEach(() => {
  expect(currentVerificationRun(), "a test leaked a run context into the next one").toBeNull();
});

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

describe("verificationRunMarkersFor — the gate", () => {
  it("attaches the three run markers when the full ticket validates", () => {
    const logger = warnings();
    expect(
      verificationRunMarkersFor({ headers: ticketHeaders(), env: DEPLOYMENT_ENV, logger }),
    ).toEqual(EXPECTED_MARKERS);
    expect(logger.lines).toEqual([]);
  });

  it("reads a real `Headers` instance as well as a plain record", () => {
    expect(
      verificationRunMarkersFor({
        headers: new Headers(ticketHeaders() as Record<string, string>),
        env: DEPLOYMENT_ENV,
      }),
    ).toEqual(EXPECTED_MARKERS);
  });

  it("never carries the attempt id — evidence is scoped to the RUN, not a sign-in", () => {
    const markers = verificationRunMarkersFor({ headers: ticketHeaders(), env: DEPLOYMENT_ENV });
    expect(Object.keys(markers ?? {}).sort()).toEqual([
      "candidateSha",
      "deploymentId",
      "runId",
    ]);
    expect(JSON.stringify(markers)).not.toContain(ATTEMPT_ID);
  });

  it("returns null for an UNMARKED request, and logs nothing at all", () => {
    const logger = warnings();
    for (const headers of [undefined, null, {}, new Headers(), { "user-agent": "curl" }]) {
      expect(verificationRunMarkersFor({ headers, env: DEPLOYMENT_ENV, logger })).toBeNull();
    }
    expect(logger.lines).toEqual([]);
  });

  /**
   * Every gate, one at a time. Each case must produce NO markers — not a subset,
   * not a partial stamp — and a reason CODE.
   */
  const REFUSALS: Array<{
    name: string;
    reason: string;
    headers: Record<string, string | string[] | undefined>;
    env?: Record<string, string | undefined>;
  }> = [
    {
      name: "the marker header is absent (partial ticket)",
      reason: "incomplete_ticket",
      headers: ticketHeaders({ [VERIFICATION_HEADERS.marker]: undefined }),
    },
    {
      name: "the marker header is not the published value",
      reason: "marker_mismatch",
      headers: ticketHeaders({ [VERIFICATION_HEADERS.marker]: "owt-service-readiness-v0" }),
    },
    {
      name: "the run id is missing",
      reason: "incomplete_ticket",
      headers: ticketHeaders({ [VERIFICATION_HEADERS.runId]: undefined }),
    },
    {
      name: "the run id is repeated (ambiguous claim)",
      reason: "incomplete_ticket",
      headers: ticketHeaders({ [VERIFICATION_HEADERS.runId]: [RUN_ID, "srvrun-other0000"] }),
    },
    {
      name: "an id is malformed",
      reason: "malformed_ticket",
      headers: ticketHeaders({ [VERIFICATION_HEADERS.runId]: "../../etc/passwd" }),
    },
    {
      name: "an id is too short to be collision-resistant",
      reason: "malformed_ticket",
      headers: ticketHeaders({ [VERIFICATION_HEADERS.runId]: "short" }),
    },
    {
      name: "an id smuggles the lease-owner separator",
      reason: "malformed_ticket",
      headers: ticketHeaders({ [VERIFICATION_HEADERS.runId]: `${RUN_ID}:${SHA}` }),
    },
    {
      name: "the claimed candidate SHA is not this deployment's",
      reason: "candidate_sha_mismatch",
      headers: ticketHeaders({ [VERIFICATION_HEADERS.candidateSha]: "d".repeat(40) }),
    },
    {
      name: "the claimed deployment id is a FOREIGN deployment",
      reason: "foreign_deployment",
      headers: ticketHeaders({ [VERIFICATION_HEADERS.deploymentId]: "dpl_someoneElses000" }),
    },
    {
      name: "the deployment is not a verification deployment (no marker configured)",
      reason: "environment_refused",
      headers: ticketHeaders(),
      env: { ...DEPLOYMENT_ENV, SERVICE_READINESS_VERIFICATION_MARKER: undefined },
    },
    {
      name: "the deployment targets the PRODUCTION dataset",
      reason: "environment_refused",
      headers: ticketHeaders(),
      env: { ...DEPLOYMENT_ENV, NEXT_PUBLIC_SANITY_DATASET: "production" },
    },
    {
      name: "the deployment targets the PRODUCTION project",
      reason: "environment_refused",
      headers: ticketHeaders(),
      env: { ...DEPLOYMENT_ENV, NEXT_PUBLIC_SANITY_PROJECT_ID: "ebb8vcnk" },
    },
    {
      name: "the deployment has not opted into E2E writes",
      reason: "environment_refused",
      headers: ticketHeaders(),
      env: { ...DEPLOYMENT_ENV, ALLOW_SERVICE_READINESS_E2E_WRITES: undefined },
    },
    {
      name: "the deployment's delivery firewall is not closed",
      reason: "environment_refused",
      headers: ticketHeaders(),
      env: { ...DEPLOYMENT_ENV, [DELIVERY_MODE_ENV]: undefined },
    },
    {
      name: "the deployment cannot say what commit it is",
      reason: "candidate_sha_unavailable",
      headers: ticketHeaders(),
      env: { ...DEPLOYMENT_ENV, VERCEL_GIT_COMMIT_SHA: undefined },
    },
    {
      name: "the deployment cannot say which deployment it is",
      reason: "deployment_id_unavailable",
      headers: ticketHeaders(),
      env: { ...DEPLOYMENT_ENV, VERCEL_DEPLOYMENT_ID: undefined },
    },
  ];

  for (const refusal of REFUSALS) {
    it(`refuses with NO markers when ${refusal.name}`, () => {
      const logger = warnings();
      const markers = verificationRunMarkersFor({
        headers: refusal.headers,
        env: refusal.env ?? DEPLOYMENT_ENV,
        logger,
      });
      // Not a subset, not a partial stamp — nothing.
      expect(markers).toBeNull();
      expect(logger.lines).toHaveLength(1);
      expect(logger.lines[0]).toContain(refusal.reason);
    });
  }

  it("logs a reason CODE only — never a header value, an id or a secret", () => {
    const logger = warnings();
    verificationRunMarkersFor({
      headers: ticketHeaders({ [VERIFICATION_HEADERS.marker]: "s3cret-bypass-value" }),
      env: { ...DEPLOYMENT_ENV, SANITY_WRITE_TOKEN: "sk-token" },
      logger,
    });
    const joined = logger.lines.join("\n");
    for (const forbidden of ["s3cret-bypass-value", "sk-token", RUN_ID, SHA, DEPLOYMENT_ID]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  it("reads `process.env` by default, so a route needs to pass nothing", () => {
    withProcessEnv(DEPLOYMENT_ENV, () => {
      expect(verificationRunMarkersFor({ headers: ticketHeaders() })).toEqual(EXPECTED_MARKERS);
    });
  });
});

/* ------------------------------------------------------------------ *
 * Propagation
 * ------------------------------------------------------------------ */

describe("the store propagates the way delivery actually happens", () => {
  it("survives awaits and reaches a callback bound the way `after()` binds one", async () => {
    let seenDeep: VerificationRunMarkers | null = null;
    const deferred = await runWithVerificationRun(EXPECTED_MARKERS, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentVerificationRun()).toEqual(EXPECTED_MARKERS);
      // `next/server`'s after() wraps the callback with AsyncLocalStorage.bind at
      // registration time and runs it after the response.
      return AsyncLocalStorage.bind(async () => {
        await new Promise((r) => setTimeout(r, 1));
        seenDeep = currentVerificationRun();
      });
    });
    expect(currentVerificationRun()).toBeNull();
    await deferred();
    expect(seenDeep).toEqual(EXPECTED_MARKERS);
  });

  it("keeps concurrent requests separate and never leaks to the caller", async () => {
    const other: VerificationRunMarkers = { ...EXPECTED_MARKERS, runId: "srvrun-ffffffffffffffff" };
    const seen: Array<VerificationRunMarkers | null> = [];

    const observe = (markers: VerificationRunMarkers | null) =>
      runWithVerificationRun(markers, async () => {
        await new Promise((r) => setTimeout(r, 1));
        seen.push(currentVerificationRun());
      });

    await Promise.all([observe(EXPECTED_MARKERS), observe(other), observe(null)]);

    expect(seen).toContainEqual(EXPECTED_MARKERS);
    expect(seen).toContainEqual(other);
    // The unmarked concurrent request saw NOTHING. If the store were established
    // with `enterWith`, it would have seen a neighbour's run id.
    expect(seen).toContainEqual(null);
    expect(currentVerificationRun()).toBeNull();
  });

  it("a nested scope never downgrades an outer context to `no markers`", async () => {
    await runWithVerificationRun(EXPECTED_MARKERS, async () => {
      await runWithVerificationRun(null, async () => {
        expect(currentVerificationRun()).toEqual(EXPECTED_MARKERS);
      });
    });
  });
});

/* ------------------------------------------------------------------ *
 * The route wrapper
 * ------------------------------------------------------------------ */

describe("withVerificationRunContext", () => {
  it("is transparent: same arguments, same return value", async () => {
    const handler = vi.fn(async (_req: { headers: Headers }, id: string) => `ok:${id}`);
    const wrapped = withVerificationRunContext(handler);
    const req = { headers: new Headers() };
    await expect(wrapped(req, "abc")).resolves.toBe("ok:abc");
    expect(handler).toHaveBeenCalledWith(req, "abc");
  });

  it("establishes the context for a marked request, and nothing for an unmarked one", async () => {
    await withProcessEnv(DEPLOYMENT_ENV, async () => {
      const seen: Array<VerificationRunMarkers | null> = [];
      const wrapped = withVerificationRunContext(async (_req: { headers: Headers }) => {
        await new Promise((r) => setTimeout(r, 1));
        seen.push(currentVerificationRun());
      });

      await wrapped({ headers: new Headers(ticketHeaders() as Record<string, string>) });
      await wrapped({ headers: new Headers({ "user-agent": "curl" }) });

      expect(seen).toEqual([EXPECTED_MARKERS, null]);
    });
  });

  it("refuses a marked request the deployment does not own, without markers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withProcessEnv(DEPLOYMENT_ENV, async () => {
        let seen: VerificationRunMarkers | null = EXPECTED_MARKERS;
        const wrapped = withVerificationRunContext(async (_req: { headers: Headers }) => {
          seen = currentVerificationRun();
        });
        await wrapped({
          headers: new Headers(
            ticketHeaders({
              [VERIFICATION_HEADERS.deploymentId]: "dpl_someoneElses000",
            }) as Record<string, string>,
          ),
        });
        expect(seen).toBeNull();
      });
      expect(warn.mock.calls.flat().join("\n")).toContain("foreign_deployment");
    } finally {
      warn.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------ *
 * The evidence the firewall emits
 * ------------------------------------------------------------------ */

describe("delivery evidence carries the in-flight run's markers", () => {
  /** Markers resolved from the deployment env alone — the pre-existing behaviour. */
  const ENV_ONLY = { [DELIVERY_MODE_ENV]: DELIVERY_MODE_DISABLED } as const;

  it("prefers the request ticket over the deployment environment, whole", () => {
    runWithVerificationRun(EXPECTED_MARKERS, () => {
      expect(deliveryRunMarkers(DEPLOYMENT_ENV)).toEqual({
        runId: RUN_ID,
        candidateSha: SHA,
        deploymentId: DEPLOYMENT_ID,
      });
      // A stale SR_VERIFY_RUN_ID in the environment can never override the live
      // request, and the three markers always come from the SAME validated ticket.
      expect(
        deliveryRunMarkers({
          ...DEPLOYMENT_ENV,
          SR_VERIFY_RUN_ID: "srvrun-staleaaaaaaaa",
          VERCEL_GIT_COMMIT_SHA: "e".repeat(40),
        }),
      ).toEqual({ runId: RUN_ID, candidateSha: SHA, deploymentId: DEPLOYMENT_ID });
    });
  });

  it("falls back to the environment when there is no request context", () => {
    expect(deliveryRunMarkers(DEPLOYMENT_ENV)).toEqual({
      candidateSha: SHA,
      deploymentId: DEPLOYMENT_ID,
    });
    expect(deliveryRunMarkers({})).toEqual({});
  });

  it("emits a run-scoped delivery_blocked record for every gated transport", () => {
    const logger = capture();
    runWithVerificationRun(EXPECTED_MARKERS, () => {
      for (const channel of DELIVERY_CHANNELS) {
        expect(blockDelivery({ channel, recipientCount: 3, env: DEPLOYMENT_ENV, logger })).toBe(
          true,
        );
      }
    });

    const events = parseDeliveryEvents("runtime.log", logger.lines.join("\n"));
    expect(events).toHaveLength(DELIVERY_CHANNELS.length);
    expect(events.every((e) => e.event === DELIVERY_BLOCKED_EVENT)).toBe(true);
    expect(events.every((e) => e.runId === RUN_ID)).toBe(true);

    const verdict = evaluateDeliveryEvidence({
      events,
      runId: RUN_ID,
      completeLogSources: ["runtime.log"],
    });
    expect(verdict.ok, JSON.stringify(verdict.failures)).toBe(true);
    expect(verdict.attempts).toEqual([]);
    expect(verdict.blocked).toHaveLength(DELIVERY_CHANNELS.length);
  });

  it("emits the record shape the harness parses, and nothing else", () => {
    const record = runWithVerificationRun(EXPECTED_MARKERS, () =>
      buildDeliveryRecord({
        event: DELIVERY_BLOCKED_EVENT,
        channel: "smtp",
        recipientCount: 7,
        reason: "disabled",
        env: DEPLOYMENT_ENV,
      }),
    );
    expect(record).toEqual({
      event: DELIVERY_BLOCKED_EVENT,
      transport: "smtp",
      recipientCount: 7,
      reason: "disabled",
      runId: RUN_ID,
      candidateSha: SHA,
      deploymentId: DEPLOYMENT_ID,
    });
  });

  it("emits NO markers for a refused ticket — and the run's proof then fails", () => {
    const logger = capture();
    const warn = warnings();
    // The gate refuses (foreign deployment), so no context is established at all.
    const markers = verificationRunMarkersFor({
      headers: ticketHeaders({ [VERIFICATION_HEADERS.deploymentId]: "dpl_someoneElses000" }),
      env: DEPLOYMENT_ENV,
      logger: warn,
    });
    runWithVerificationRun(markers, () => {
      blockDelivery({ channel: "smtp", recipientCount: 1, env: ENV_ONLY, logger });
    });

    const parsed = JSON.parse(logger.lines[0]) as Record<string, unknown>;
    expect(parsed.event).toBe(DELIVERY_BLOCKED_EVENT);
    expect("runId" in parsed).toBe(false);
    expect("candidateSha" in parsed).toBe(false);
    expect("deploymentId" in parsed).toBe(false);

    const verdict = evaluateDeliveryEvidence({
      events: parseDeliveryEvents("runtime.log", logger.lines.join("\n")),
      runId: RUN_ID,
      completeLogSources: ["runtime.log"],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.code)).toContain("no_run_scoped_delivery_blocked");
  });

  it("an UNMARKED request emits byte-for-byte the record it emits with no context", () => {
    const marked = capture();
    const bare = capture();
    runWithVerificationRun(
      verificationRunMarkersFor({ headers: { "user-agent": "curl" }, env: DEPLOYMENT_ENV }),
      () => blockDelivery({ channel: "resend", recipientCount: 2, env: ENV_ONLY, logger: marked }),
    );
    blockDelivery({ channel: "resend", recipientCount: 2, env: ENV_ONLY, logger: bare });
    expect(marked.lines).toEqual(bare.lines);
  });

  it("still BLOCKS and still records with no request context at all", () => {
    // The `after()` callback that outlived its scope, the reminder cron, a script.
    expect(currentVerificationRun()).toBeNull();
    const logger = capture();
    for (const channel of DELIVERY_CHANNELS) {
      expect(blockDelivery({ channel, recipientCount: 5, env: ENV_ONLY, logger })).toBe(true);
    }
    expect(logger.lines).toHaveLength(DELIVERY_CHANNELS.length);
    const events = logger.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.every((e) => e.event === DELIVERY_BLOCKED_EVENT)).toBe(true);
    expect(events.every((e) => !("runId" in e))).toBe(true);
  });

  it("emits a delivery_attempt on the ALLOWED path, and never when blocked", () => {
    const allowed = capture();
    const blocked = capture();
    runWithVerificationRun(EXPECTED_MARKERS, () => {
      // Mode absent: this is production's path. The attempt is recorded, run-scoped.
      recordDeliveryAttempt({ channel: "smtp", recipientCount: 1, env: {}, logger: allowed });
      recordDeliveryAttempt({
        channel: "smtp",
        recipientCount: 1,
        env: DEPLOYMENT_ENV,
        logger: blocked,
      });
      blockDelivery({ channel: "smtp", recipientCount: 1, env: DEPLOYMENT_ENV, logger: blocked });
    });

    const attempt = JSON.parse(allowed.lines[0]) as Record<string, unknown>;
    expect(attempt.event).toBe(DELIVERY_ATTEMPT_EVENT);
    expect(attempt.runId).toBe(RUN_ID);
    // A blocked run's logs contain zero attempts, even with a context established.
    expect(blocked.lines.join("\n")).not.toContain(DELIVERY_ATTEMPT_EVENT);
    expect(blocked.lines).toHaveLength(1);
  });

  it("never emits an address, a token, a secret or the raw mode value", () => {
    const logger = capture();
    runWithVerificationRun(EXPECTED_MARKERS, () => {
      blockDelivery({
        channel: "fcm",
        recipientCount: 3,
        env: {
          ...DEPLOYMENT_ENV,
          [DELIVERY_MODE_ENV]: "PLEASE-DELIVER-ANYWAY",
          EMAIL_ALLOWLIST: "frank@oasis.mx",
          SMTP_PASS: "s3cret",
          RESEND_API_KEY: "re_live_key",
          FIREBASE_SERVICE_ACCOUNT: '{"private_key":"-----BEGIN"}',
          SANITY_WRITE_TOKEN: "sk-token",
        },
        logger,
      });
    });
    const serialized = logger.lines.join("\n");
    for (const forbidden of [
      "@",
      "s3cret",
      "re_live_key",
      "BEGIN",
      "sk-token",
      "PLEASE-DELIVER-ANYWAY",
      ATTEMPT_ID,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // The non-secret run provenance IS the point, so it must be there.
    expect(serialized).toContain(RUN_ID);
  });
});

/* ------------------------------------------------------------------ *
 * Coverage: every delivery-capable route establishes the boundary
 * ------------------------------------------------------------------ */
//
// The context can only be established by WRAPPING a continuation, so it has to be
// applied per route handler. That is exactly the kind of rule a new route forgets,
// and forgetting it is silent: the run still passes 58 scenarios and only the
// zero-delivery proof quietly loses its markers. So the rule is enforced statically
// over the git-tracked route modules rather than trusted.
//
// A missed route is not a SAFETY hole — the block still happens and is still
// recorded — but it is an EVIDENCE hole, and this proof exists precisely because
// unproven absence is not proof.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Importing any of these puts an outbound transport within reach of the handler. */
const DELIVERY_CAPABLE_IMPORTS = [
  "serviceMutationSideEffects",
  "utils/push",
  "utils/email",
  "assignmentEmail",
  "proposalNotify",
];

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function gitTrackedRoutes(): string[] {
  return execFileSync("git", ["ls-files", "app/api"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith("/route.ts"));
}

describe("every delivery-capable route establishes the run context", () => {
  const routes = gitTrackedRoutes().map((file) => ({
    file,
    source: readFileSync(resolve(REPO_ROOT, file), "utf8"),
  }));

  it("finds the route inventory (a zero-file scan would pass vacuously)", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it("wraps every request-taking handler of every delivery-capable route", () => {
    const unwrapped: string[] = [];

    for (const { file, source } of routes) {
      if (!DELIVERY_CAPABLE_IMPORTS.some((m) => source.includes(m))) continue;

      for (const method of HTTP_METHODS) {
        const wrapped = new RegExp(
          `export\\s+const\\s+${method}\\s*=\\s*withVerificationRunContext\\(`,
        ).test(source);
        // A handler declared with an EMPTY parameter list has no request to read
        // and therefore nothing to establish — `export async function GET() {`.
        const requestless = new RegExp(
          `export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(\\s*\\)`,
        ).test(source);
        const declared = new RegExp(
          `export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(|export\\s+const\\s+${method}\\s*=`,
        ).test(source);

        if (declared && !wrapped && !requestless) unwrapped.push(`${file} [${method}]`);
      }
    }

    expect(
      unwrapped,
      `these handlers can reach an outbound transport but do not establish the ` +
        `verification run context, so their delivery evidence would carry no run id:\n  ` +
        unwrapped.join("\n  "),
    ).toEqual([]);
  });

  it("covers the three triggers the zero-delivery scenario invokes", () => {
    for (const file of [
      "app/api/admin/roles/publish/route.ts",
      "app/api/admin/proposals/[id]/route.ts",
      "app/api/cron/service-reminders/route.ts",
    ]) {
      const entry = routes.find((r) => r.file === file);
      expect(entry, `${file} is not git-tracked`).toBeDefined();
      expect(entry?.source).toContain("withVerificationRunContext(");
    }
  });
});
