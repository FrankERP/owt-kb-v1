// Service Readiness A3 §3 — the outbound-delivery firewall, proven at the
// TRANSPORT boundary with the real provider SDKs spied.
//
// The plan's contract-test requirement is exact:
//
//   "Contract tests invoke every trigger with provider SDKs spied and require
//    zero SMTP `sendMail`, Resend `emails.send`, Firebase
//    initialization/`sendEachForMulticast`, and pruning calls."
//
// So this file does NOT mock `email.ts`, `push.ts` or `firebaseAdmin.ts`. It mocks
// `nodemailer`, `resend`, `firebase-admin/app` and `firebase-admin/messaging` — the
// providers themselves — and runs the real app modules on top of them. That is the
// only arrangement in which "no provider client is ever constructed" is a claim
// about the app rather than about the test's own stubs.
//
// The environment is deliberately the WORST case: every transport credential is
// present, `EMAIL_ALLOWLIST="*"` (the whole team), a member has an email address
// and a live device token, and FCM reports one token dead so the prune path is
// reached. Only `SERVICE_READINESS_DELIVERY_MODE` differs between the two halves
// of this file.
//
// The second half is the PRODUCTION-COMPATIBILITY proof: with the mode absent, the
// exact same triggers, over the exact same fixtures, must reach the providers with
// the same recipients and the same payloads as before the firewall existed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/* ── Provider SDK spies (NOT the app's wrappers) ─────────────────────────────
 *
 * Declared through `vi.hoisted` because the app modules under test are imported
 * STATICALLY below: the `vi.mock` factories run during that import, which happens
 * before ordinary `const` initializers in this file would have run.
 */

const spies = vi.hoisted(() => {
  const resendSend = vi.fn();
  const sendMail = vi.fn();
  const sendEachForMulticast = vi.fn();
  return {
    resendSend,
    ResendCtor: vi.fn(function (this: { emails: { send: typeof resendSend } }) {
      this.emails = { send: resendSend };
    }),
    sendMail,
    createTransport: vi.fn((..._a: unknown[]) => ({ sendMail })),
    initializeApp: vi.fn((..._a: unknown[]) => ({ name: "[DEFAULT]" })),
    getApps: vi.fn((): unknown[] => []),
    cert: vi.fn((svc: unknown) => svc),
    sendEachForMulticast,
    sdkGetMessaging: vi.fn((..._a: unknown[]) => ({ sendEachForMulticast })),
    serverFetch: vi.fn(),
    patchCommit: vi.fn(),
    patchUnset: vi.fn((..._a: unknown[]) => ({ commit: vi.fn() })),
    writePatch: vi.fn((..._a: unknown[]) => ({ unset: vi.fn() })),
    opFetch: vi.fn(),
    rawFetch: vi.fn(),
    afterCallbacks: [] as (() => unknown)[],
  };
});

const {
  resendSend,
  ResendCtor,
  sendMail,
  createTransport,
  initializeApp,
  getApps,
  cert,
  sendEachForMulticast,
  sdkGetMessaging,
  serverFetch,
  patchCommit,
  patchUnset,
  writePatch,
  opFetch,
  rawFetch,
  afterCallbacks,
} = spies;

vi.mock("resend", () => ({ Resend: spies.ResendCtor }));
vi.mock("nodemailer", () => ({ default: { createTransport: spies.createTransport } }));
vi.mock("firebase-admin/app", () => ({
  initializeApp: spies.initializeApp,
  getApps: spies.getApps,
  cert: spies.cert,
}));
vi.mock("firebase-admin/messaging", () => ({ getMessaging: spies.sdkGetMessaging }));

/* ── Sanity clients ──────────────────────────────────────────────────────── */

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...a: unknown[]) => spies.serverFetch(...a) },
  writeClient: { patch: (...a: unknown[]) => spies.writePatch(...a) },
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => spies.opFetch(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => spies.rawFetch(...a) },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void spies.afterCallbacks.push(fn) };
});

/* ── Real app modules under test ─────────────────────────────────────────── */

import { DELIVERY_MODE_DISABLED, DELIVERY_MODE_ENV } from "@/app/utils/deliveryFirewall";
import { SEND_CONCURRENCY, SEND_TIMEOUT_MS, sendEmail } from "@/app/utils/email";
import { getMessaging } from "@/app/utils/firebaseAdmin";
import { sendPush } from "@/app/utils/push";
import { sendAssignmentEmails, sendAssignmentEmailsBatch } from "@/app/utils/assignmentEmail";
import { notifyProposalSubmitted } from "@/app/utils/proposalNotify";
import {
  notifyProposalPending,
  notifyProposalReview,
  notifyRoleAssignments,
  notifyRolePublished,
  notifySetlistSaved,
} from "@/app/utils/serviceMutationSideEffects";
import { GET as remindersGET } from "@/app/api/cron/service-reminders/route";
import { GET as flushGET } from "@/app/api/cron/flush-notifications/route";
import {
  evaluateDeliveryEvidence,
  parseDeliveryEvents,
} from "@/e2e/service-readiness/lib/deliveryEvidence";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const RUN_ID = "srvrun-0123456789abcdef";
const SERVICE = { type: "sunday_role" as const, date: "2026-08-02" };
const BODY = { leads: ["m1"], bgvs: [], chorus: [], instruments: [], foh: [] };

/** One member: mailable AND pushable, so nothing is skipped for lack of a target. */
const MEMBER_EMAIL_ROW = {
  _id: "m1",
  member_name: "Ana",
  alias: "Ana",
  email: "ana@oasis.mx",
};
const MEMBER_PUSH_ROW = {
  _id: "m1",
  deviceTokens: [{ token: "live-token" }, { token: "dead-token" }],
  notifPrefs: {},
};

/** `validateRole` needs all five seat arrays present. Two Leads → a real co-lead. */
function validRole() {
  return {
    _id: "r1",
    _rev: "rev1",
    _type: "sunday_role",
    week: SERVICE.date,
    Lead: [
      { _key: "l0", _type: "reference", _ref: "lead1" },
      { _key: "l1", _type: "reference", _ref: "lead2" },
    ],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
  };
}

const PROVIDER_ENV: Record<string, string> = {
  // Both email backends fully configured — SMTP wins, Resend is the fallback.
  EMAIL_FROM: "Oasis <contacto@oasis.mx>",
  SMTP_HOST: "mail.oasis.mx",
  SMTP_USER: "contacto@oasis.mx",
  SMTP_PASS: "s3cret",
  RESEND_API_KEY: "re_live_key",
  // The whole team is deliverable — the real production default.
  EMAIL_ALLOWLIST: "*",
  FIREBASE_SERVICE_ACCOUNT: '{"project_id":"p","client_email":"x@y.z","private_key":"k"}',
  CRON_SECRET: "cron-secret",
  SANITY_WRITE_TOKEN: "sk-token",
};

const TOUCHED_ENV = [
  ...Object.keys(PROVIDER_ENV),
  DELIVERY_MODE_ENV,
  "SR_VERIFY_RUN_ID",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_GIT_COMMIT_SHA",
  "EMAIL_REDIRECT_TO",
];

const savedEnv: Record<string, string | undefined> = {};

/** Every provider entry point the firewall must keep unreached. */
function providerCalls() {
  return {
    createTransport: createTransport.mock.calls.length,
    sendMail: sendMail.mock.calls.length,
    ResendCtor: ResendCtor.mock.calls.length,
    resendSend: resendSend.mock.calls.length,
    initializeApp: initializeApp.mock.calls.length,
    sendEachForMulticast: sendEachForMulticast.mock.calls.length,
    prunePatch: writePatch.mock.calls.length,
    pruneCommit: patchCommit.mock.calls.length,
  };
}

const NO_PROVIDER_CALLS = {
  createTransport: 0,
  sendMail: 0,
  ResendCtor: 0,
  resendSend: 0,
  initializeApp: 0,
  sendEachForMulticast: 0,
  prunePatch: 0,
  pruneCommit: 0,
};

/** Captured `console.log` output — the run's evidence stream. */
let logLines: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

async function drainAfter(): Promise<void> {
  // `after` callbacks may enqueue nothing further, but drain until empty anyway.
  for (let guard = 0; guard < 10 && afterCallbacks.length; guard++) {
    const batch = afterCallbacks.splice(0);
    for (const cb of batch) await cb();
  }
}

/**
 * Invoke EVERY delivery trigger in the inventory: direct transports, the role
 * create/publish fan-out, the setlist save, both proposal paths and the reminder
 * cron. Each one is primed so that, absent the firewall, it WOULD deliver.
 */
async function invokeEveryTrigger(): Promise<void> {
  // 1. the raw email transport (SMTP branch, then the Resend branch)
  await sendEmail({ to: "ana@oasis.mx", subject: "s", html: "<p>h</p>" });
  delete process.env.SMTP_HOST;
  await sendEmail({ to: "ana@oasis.mx", subject: "s", html: "<p>h</p>" });
  process.env.SMTP_HOST = PROVIDER_ENV.SMTP_HOST;

  // 2. Firebase initialization through the app's own accessor
  try {
    getMessaging();
  } catch {
    // A blocked initialization throws DeliveryBlockedError by design; the caller
    // (`sendPush`) already swallows it. Asserted separately below.
  }

  // 3. FCM send + dead-token pruning
  serverFetch.mockResolvedValue([MEMBER_PUSH_ROW]);
  sendEachForMulticast.mockResolvedValue({
    responses: [
      { success: true },
      { success: false, error: { code: "messaging/registration-token-not-registered" } },
    ],
  });
  await sendPush(["m1"], "assignments", { title: "t", body: "b", path: "/me" });
  await sendPush(["m1"], "reminders", { title: "t", body: "b", path: "/me" });
  await sendPush(["m1"], "setlist", { title: "t", body: "b", path: "/" });
  await sendPush(["m1"], "proposals", { title: "t", body: "b", path: "/admin" });

  // 4. assignment emails, single and batched (role create/edit and publish)
  serverFetch.mockResolvedValue([MEMBER_EMAIL_ROW]);
  await sendAssignmentEmails(["m1"], { ...SERVICE, body: BODY });
  await sendAssignmentEmailsBatch([
    { ...SERVICE, body: BODY },
    { type: "saturday_role", date: "2026-08-01", body: BODY },
  ]);

  // 5. the A2 centralized post-commit fan-out
  notifyRoleAssignments([
    { recipients: ["m1"], ...SERVICE, body: BODY, kind: "created" },
  ]);
  await drainAfter();
  notifyRolePublished([{ recipients: ["m1"], ...SERVICE, body: BODY }]);
  await drainAfter();

  // 6. manual setlist save
  opFetch.mockReset();
  opFetch
    .mockResolvedValueOnce([{ _id: "m1", setlist: "all" }])
    .mockResolvedValueOnce(["m1"]);
  serverFetch.mockResolvedValue([MEMBER_PUSH_ROW]);
  await notifySetlistSaved(SERVICE.date);
  await drainAfter();

  // 7. proposal submitted (push to admins + co-leads, email to admins)
  opFetch.mockReset();
  rawFetch.mockReset();
  rawFetch.mockResolvedValue([]);
  opFetch
    .mockResolvedValueOnce([validRole()])
    .mockResolvedValueOnce({ admins: ["a1"], lead: { member_name: "Frank" }, proposal: null })
    .mockResolvedValueOnce([{ _id: "a1", email: "admin@oasis.mx", emailPref: null }]);
  await notifyProposalSubmitted({
    leadId: "lead1",
    roleId: "r1",
    proposalId: "p1",
    serviceType: "sunday",
    serviceDate: SERVICE.date,
  });

  opFetch.mockReset();
  rawFetch.mockResolvedValue([]);
  opFetch
    .mockResolvedValueOnce([validRole()])
    .mockResolvedValueOnce({ admins: ["a1"], lead: { member_name: "Frank" }, proposal: null })
    .mockResolvedValueOnce([{ _id: "a1", email: "admin@oasis.mx", emailPref: null }]);
  await notifyProposalPending({
    leadId: "lead1",
    roleId: "r1",
    proposalId: "p1",
    serviceType: "sunday",
    serviceDate: SERVICE.date,
  });

  // 8. proposal review outcome push
  serverFetch.mockResolvedValue([MEMBER_PUSH_ROW]);
  await notifyProposalReview(
    { lead: "m1", contributors: [{ person: { _ref: "m1" } }] },
    { title: "Propuesta aprobada", body: "Listo." },
  );
  await drainAfter();

  // 9. the reminder cron
  opFetch.mockReset();
  opFetch.mockResolvedValue(["m1"]);
  const req = {
    headers: { get: (n: string) => (n === "authorization" ? "Bearer cron-secret" : null) },
    nextUrl: { searchParams: { get: () => null } },
  };
  await remindersGET(req as unknown as Parameters<typeof remindersGET>[0]);

  await drainAfter();
}

beforeEach(() => {
  for (const key of TOUCHED_ENV) savedEnv[key] = process.env[key];
  for (const [key, value] of Object.entries(PROVIDER_ENV)) process.env[key] = value;
  delete process.env[DELIVERY_MODE_ENV];
  delete process.env.EMAIL_REDIRECT_TO;

  for (const spy of [
    resendSend,
    ResendCtor,
    sendMail,
    createTransport,
    initializeApp,
    cert,
    sendEachForMulticast,
    sdkGetMessaging,
    serverFetch,
    writePatch,
    patchUnset,
    patchCommit,
    opFetch,
    rawFetch,
  ]) {
    spy.mockClear();
  }
  createTransport.mockReturnValue({ sendMail });
  writePatch.mockReturnValue({ unset: patchUnset });
  patchUnset.mockReturnValue({ commit: patchCommit });
  sdkGetMessaging.mockReturnValue({ sendEachForMulticast });
  getApps.mockReturnValue([]);
  sendMail.mockResolvedValue({ messageId: "1" });
  resendSend.mockResolvedValue({ data: { id: "1" }, error: null });
  patchCommit.mockResolvedValue({});
  afterCallbacks.length = 0;

  logLines = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  vi.restoreAllMocks();
  for (const key of TOUCHED_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key] as string;
  }
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * SERVICE_READINESS_DELIVERY_MODE=disabled — nothing reaches a provider
 * ══════════════════════════════════════════════════════════════════════════ */

describe("delivery mode `disabled` refuses at the transport boundary", () => {
  beforeEach(() => {
    process.env[DELIVERY_MODE_ENV] = DELIVERY_MODE_DISABLED;
    process.env.SR_VERIFY_RUN_ID = RUN_ID;
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_verify_1";
    process.env.VERCEL_GIT_COMMIT_SHA = "cafebabe";
  });

  it("invokes EVERY trigger and makes zero provider calls", async () => {
    await invokeEveryTrigger();
    expect(providerCalls()).toEqual(NO_PROVIDER_CALLS);
  });

  it("never constructs a provider client — not even before failing", async () => {
    await invokeEveryTrigger();
    // The transport CONSTRUCTORS, separately from the send methods: the plan's
    // requirement is that no client is ever constructed, not merely unused.
    expect(createTransport).not.toHaveBeenCalled();
    expect(ResendCtor).not.toHaveBeenCalled();
    expect(initializeApp).not.toHaveBeenCalled();
    expect(cert).not.toHaveBeenCalled();
  });

  it("never prunes a device token", async () => {
    await invokeEveryTrigger();
    expect(writePatch).not.toHaveBeenCalled();
    expect(patchUnset).not.toHaveBeenCalled();
    expect(patchCommit).not.toHaveBeenCalled();
  });

  it("emits run-scoped delivery_blocked evidence and zero delivery_attempt", async () => {
    await invokeEveryTrigger();
    const events = parseDeliveryEvents("runtime.log", logLines.join("\n"));
    const verdict = evaluateDeliveryEvidence({
      events,
      runId: RUN_ID,
      completeLogSources: ["runtime.log"],
    });
    expect(verdict.attempts).toEqual([]);
    expect(verdict.blocked.length).toBeGreaterThan(0);
    expect(verdict.ok).toBe(true);
  });

  it("blocks each reachable channel at least once", async () => {
    await invokeEveryTrigger();
    const events = parseDeliveryEvents("runtime.log", logLines.join("\n"));
    const transports = new Set(events.map((e) => e.transport));
    expect(transports).toContain("smtp");
    expect(transports).toContain("resend");
    expect(transports).toContain("fcm");
    // `prune` is deliberately NOT expected here: with the firewall closed, the
    // `fcm` gate returns before any FCM response exists, so nothing can reach the
    // prune. Its own gate is defense-in-depth for a future caller — proven
    // reachable in "the prune gate holds on its own axis" below.
    expect(transports).not.toContain("prune");
  });

  it("emits no email address, device token or secret in the evidence", async () => {
    await invokeEveryTrigger();
    const text = logLines.join("\n");
    for (const forbidden of [
      "ana@oasis.mx",
      "admin@oasis.mx",
      "contacto@oasis.mx",
      "live-token",
      "dead-token",
      "s3cret",
      "re_live_key",
      "private_key",
      "sk-token",
      "cron-secret",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("keeps every trigger non-throwing — a block is never a caller error", async () => {
    await expect(invokeEveryTrigger()).resolves.toBeUndefined();
  });

  it("still answers the reminder cron 200 with a zero-send result", async () => {
    opFetch.mockResolvedValue(["m1"]);
    const req = {
      headers: { get: (n: string) => (n === "authorization" ? "Bearer cron-secret" : null) },
      nextUrl: { searchParams: { get: () => null } },
    };
    const res = await remindersGET(req as unknown as Parameters<typeof remindersGET>[0]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 0, pruned: 0 });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("still answers the sweep route 200 without claiming or sending anything", async () => {
    // Spec §10: the firewall transport tests extend to the sweep route. The
    // sweep refuses BEFORE the outbox is even read, so a verification run that
    // hits layer 1 leaves the outbox untouched and mails nobody.
    const req = {
      headers: { get: (n: string) => (n === "authorization" ? "Bearer cron-secret" : null) },
      nextUrl: { searchParams: { get: () => null } },
    };
    const res = await flushGET(req as unknown as Parameters<typeof flushGET>[0]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: 0, emailed: 0, consumed: 0 });
    // The outbox was never even READ — the gate is stage 1, ahead of selection.
    expect(opFetch).not.toHaveBeenCalled();
    expect(logLines.join("\n")).toContain("notify_sweep_blocked");
    expect(createTransport).not.toHaveBeenCalled();
    expect(ResendCtor).not.toHaveBeenCalled();
  });

  it("reports ok:false from sendEmail without touching a backend", async () => {
    const r = await sendEmail({ to: "ana@oasis.mx", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
    expect(ResendCtor).not.toHaveBeenCalled();
  });

  it("refuses Firebase initialization even when called directly", () => {
    expect(() => getMessaging()).toThrow(/delivery is disabled/i);
    expect(initializeApp).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * The prune gate, independently
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the prune gate holds on its own axis", () => {
  it("refuses the dead-token write BEFORE it reaches Sanity", async () => {
    // Enter with the mode absent so the `fcm` gate passes, then close the firewall
    // while FCM is in flight. That stands in for a future caller that reaches the
    // prune without having passed the `fcm` gate: the prune must still refuse, and
    // it must refuse before any patch is constructed.
    delete process.env[DELIVERY_MODE_ENV];
    process.env.SR_VERIFY_RUN_ID = RUN_ID;
    serverFetch.mockResolvedValue([MEMBER_PUSH_ROW]);
    sendEachForMulticast.mockImplementation(async () => {
      process.env[DELIVERY_MODE_ENV] = DELIVERY_MODE_DISABLED;
      return {
        responses: [
          { success: true },
          { success: false, error: { code: "messaging/registration-token-not-registered" } },
        ],
      };
    });

    const r = await sendPush(["m1"], "assignments", { title: "t", body: "b", path: "/me" });
    expect(r).toEqual({ sent: 1, pruned: 0 });
    expect(writePatch).not.toHaveBeenCalled();
    expect(patchCommit).not.toHaveBeenCalled();

    const events = parseDeliveryEvents("runtime.log", logLines.join("\n"));
    expect(
      events.some(
        (e) => e.event === "delivery_blocked" && e.transport === "prune" && e.runId === RUN_ID,
      ),
    ).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * An UNRECOGNIZED mode blocks too — fail closed
 * ══════════════════════════════════════════════════════════════════════════ */

describe("an unrecognized delivery mode blocks", () => {
  for (const value of ["Disabled", "disable", "off", "false", "enabled"]) {
    it(`blocks on ${JSON.stringify(value)}`, async () => {
      process.env[DELIVERY_MODE_ENV] = value;
      await invokeEveryTrigger();
      expect(providerCalls()).toEqual(NO_PROVIDER_CALLS);
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * PRODUCTION COMPATIBILITY — an absent mode delivers exactly as today
 * ══════════════════════════════════════════════════════════════════════════ */

describe("an absent delivery mode delivers unchanged", () => {
  it("sends through SMTP with the same transport options and the same message", async () => {
    // `email.ts` pools ONE transport per host:port:secure:user key across the
    // module's lifetime, so this assertion uses a host no other test uses. That
    // guarantees a cache miss and makes the assertion order-independent.
    process.env.SMTP_HOST = "smtp-options-probe.oasis.mx";
    const r = await sendEmail({ to: "ana@oasis.mx", subject: "Asunto", html: "<p>h</p>" });
    expect(r).toEqual({ ok: true });
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp-options-probe.oasis.mx",
      port: 465,
      secure: true,
      auth: { user: "contacto@oasis.mx", pass: "s3cret" },
      pool: true,
      // Was 1. The probe showed the cost is per-MESSAGE, not per-connection, so
      // serializing over one connection was the throughput ceiling itself.
      maxConnections: SEND_CONCURRENCY,
      maxMessages: 100,
      // The client-side brake, pinned with the rest of the options. Without it
      // the pool bursts all eight connections and authenticates them at once,
      // which is what a provider rate-limits on — and Gmail rate-limits per
      // ACCOUNT, so the penalty lands on every send from this sender.
      rateDelta: 1_000,
      rateLimit: SEND_CONCURRENCY,
      // The timeout set is part of the pinned options, not incidental: every one
      // of nodemailer's defaults outlives the hosting function's maxDuration, so
      // dropping them would restore the hang that stalled the outbox for a day on
      // 2026-08-06. See SEND_TIMEOUT_MS in `email.ts`.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: SEND_TIMEOUT_MS,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "Oasis <contacto@oasis.mx>",
      to: "ana@oasis.mx",
      subject: "Asunto",
      html: "<p>h</p>",
    });
    expect(ResendCtor).not.toHaveBeenCalled();
  });

  it("falls back to Resend with the same payload when SMTP_HOST is absent", async () => {
    delete process.env.SMTP_HOST;
    const r = await sendEmail({ to: "ana@oasis.mx", subject: "Asunto", html: "<p>h</p>" });
    expect(r).toEqual({ ok: true });
    expect(ResendCtor).toHaveBeenCalledWith("re_live_key");
    expect(resendSend).toHaveBeenCalledWith({
      from: "Oasis <contacto@oasis.mx>",
      to: "ana@oasis.mx",
      subject: "Asunto",
      html: "<p>h</p>",
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("still no-ops when EMAIL_FROM is absent (unchanged inert behavior)", async () => {
    delete process.env.EMAIL_FROM;
    const r = await sendEmail({ to: "ana@oasis.mx", subject: "s", html: "<p>h</p>" });
    expect(r).toEqual({ ok: false, error: "email disabled" });
    expect(createTransport).not.toHaveBeenCalled();
    expect(ResendCtor).not.toHaveBeenCalled();
  });

  it("initializes Firebase and sends to exactly the opted-in tokens", async () => {
    serverFetch.mockResolvedValue([MEMBER_PUSH_ROW]);
    sendEachForMulticast.mockResolvedValue({
      responses: [{ success: true }, { success: true }],
    });
    const r = await sendPush(["m1"], "assignments", { title: "t", body: "b", path: "/me" });
    expect(r).toEqual({ sent: 2, pruned: 0 });
    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(sendEachForMulticast).toHaveBeenCalledWith({
      tokens: ["live-token", "dead-token"],
      notification: { title: "t", body: "b" },
      data: { path: "/me" },
    });
  });

  it("still prunes a token FCM reports dead, with the same unset path", async () => {
    serverFetch.mockResolvedValue([MEMBER_PUSH_ROW]);
    sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true },
        { success: false, error: { code: "messaging/registration-token-not-registered" } },
      ],
    });
    const r = await sendPush(["m1"], "assignments", { title: "t", body: "b", path: "/me" });
    expect(r).toEqual({ sent: 1, pruned: 1 });
    expect(writePatch).toHaveBeenCalledWith("m1");
    expect(patchUnset).toHaveBeenCalledWith(['deviceTokens[token == "dead-token"]']);
    expect(patchCommit).toHaveBeenCalledTimes(1);
  });

  it("emails exactly the allowlisted, opted-in assignees of a role", async () => {
    serverFetch.mockResolvedValue([MEMBER_EMAIL_ROW]);
    await sendAssignmentEmails(["m1"], { ...SERVICE, body: BODY });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(message.to).toBe("ana@oasis.mx");
    expect(message.subject).toContain("Domingo");
    expect(message.html).toContain("Ana");
  });

  it("honors EMAIL_REDIRECT_TO exactly as before", async () => {
    process.env.EMAIL_REDIRECT_TO = "frank@oasis.mx";
    serverFetch.mockResolvedValue([MEMBER_EMAIL_ROW]);
    await sendAssignmentEmails(["m1"], { ...SERVICE, body: BODY });
    const message = sendMail.mock.calls[0][0] as { to: string; subject: string };
    expect(message.to).toBe("frank@oasis.mx");
    expect(message.subject).toContain("[→ ana@oasis.mx]");
  });

  it("still respects an explicitly non-matching EMAIL_ALLOWLIST", async () => {
    process.env.EMAIL_ALLOWLIST = "nobody@invalid.test";
    serverFetch.mockResolvedValue([MEMBER_EMAIL_ROW]);
    await sendAssignmentEmails(["m1"], { ...SERVICE, body: BODY });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("still respects a per-member email opt-out", async () => {
    // The GROQ projection now returns `notifPrefs` (not a flattened
    // `emailPref` alias) — see assignmentEmail.ts Task 7 restyle.
    serverFetch.mockResolvedValue([{ ...MEMBER_EMAIL_ROW, notifPrefs: { email: false } }]);
    await sendAssignmentEmails(["m1"], { ...SERVICE, body: BODY });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends one batched email covering both services", async () => {
    serverFetch.mockResolvedValue([MEMBER_EMAIL_ROW]);
    await sendAssignmentEmailsBatch([
      { ...SERVICE, body: BODY },
      { type: "saturday_role", date: "2026-08-01", body: BODY },
    ]);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0] as { subject: string };
    expect(message.subject).toContain("2 servicios");
  });

  it("runs the whole A2 fan-out and reaches both transports", async () => {
    serverFetch.mockResolvedValue([MEMBER_PUSH_ROW]);
    sendEachForMulticast.mockResolvedValue({ responses: [{ success: true }, { success: true }] });
    notifyRoleAssignments([{ recipients: ["m1"], ...SERVICE, body: BODY, kind: "created" }]);
    await drainAfter();
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    // `notifyRoleAssignments` is push-ONLY since the outbox absorbed its
    // immediate assignment email (spec §7). It reaches no mail transport at all
    // now — previously it did re-read the member rows and found none mailable.
    expect(sendMail).toHaveBeenCalledTimes(0);

    serverFetch.mockResolvedValue([MEMBER_EMAIL_ROW]);
    notifyRolePublished([{ recipients: ["m1"], ...SERVICE, body: BODY }]);
    await drainAfter();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("emits a delivery_attempt on the allowed path, per transport", async () => {
    serverFetch.mockResolvedValue([MEMBER_PUSH_ROW]);
    sendEachForMulticast.mockResolvedValue({ responses: [{ success: true }, { success: true }] });
    await sendPush(["m1"], "assignments", { title: "t", body: "b", path: "/me" });
    await sendEmail({ to: "ana@oasis.mx", subject: "s", html: "<p>h</p>" });

    const events = parseDeliveryEvents("runtime.log", logLines.join("\n"));
    const attempts = events.filter((e) => e.event === "delivery_attempt");
    expect(attempts.map((a) => a.transport)).toEqual(["fcm", "smtp"]);
    expect(events.some((e) => e.event === "delivery_blocked")).toBe(false);
  });

  it("emits no address or token on the allowed path either", async () => {
    serverFetch.mockResolvedValue([MEMBER_EMAIL_ROW]);
    await sendAssignmentEmails(["m1"], { ...SERVICE, body: BODY });
    const text = logLines.join("\n");
    expect(text).not.toContain("ana@oasis.mx");
    expect(text).not.toContain("s3cret");
  });

  it("delivers the reminder cron push unchanged", async () => {
    opFetch.mockResolvedValue(["m1"]);
    serverFetch.mockResolvedValue([MEMBER_PUSH_ROW]);
    sendEachForMulticast.mockResolvedValue({ responses: [{ success: true }, { success: true }] });
    const req = {
      headers: { get: (n: string) => (n === "authorization" ? "Bearer cron-secret" : null) },
      nextUrl: { searchParams: { get: () => null } },
    };
    const res = await remindersGET(req as unknown as Parameters<typeof remindersGET>[0]);
    expect(await res.json()).toMatchObject({ day: expect.any(String), sent: 2, pruned: 0 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * The explicit `normal` mode is equivalent to absent
 * ══════════════════════════════════════════════════════════════════════════ */

describe("an explicit `normal` delivery mode delivers", () => {
  it("sends through SMTP just like an absent mode", async () => {
    process.env[DELIVERY_MODE_ENV] = "normal";
    const r = await sendEmail({ to: "ana@oasis.mx", subject: "s", html: "<p>h</p>" });
    expect(r).toEqual({ ok: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
