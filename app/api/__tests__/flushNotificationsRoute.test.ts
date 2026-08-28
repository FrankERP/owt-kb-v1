// Spec §3 — the three flush triggers and the liveness alarm.
//
// Layer 1 (`/api/cron/flush-notifications`, driven by GitHub Actions every five
// minutes) and layer 3 (the existing daily Vercel cron) are asserted here; layer
// 2 — the opportunistic sweep inside a committed write — lives with the writers
// and is asserted in `app/utils/__tests__/serviceMutationSideEffects.test.ts`.
//
// The sweep itself is one function with three thin callers, so nothing here
// re-tests the pipeline: these tests only ask "is it authorized, is it called,
// and does the alarm see the whole outbox and reach a person?".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// `outboxSweep`/`outboxLiveness`/`operationalClient` are `import "server-only"`
// guarded; neutralize the marker so they load under vitest's node environment.
vi.mock("server-only", () => ({}));

const sweepOutboxMock = vi.fn();
const sendEmailMock = vi.fn();
const sendPushMock = vi.fn();
const operationalFetch = vi.fn();

vi.mock("@/app/utils/outboxSweep", () => ({
  sweepOutbox: (...a: unknown[]) => sweepOutboxMock(...a),
  EMAIL_LIMIT: 40,
  SEND_BUDGET_MS: 40_000,
}));
vi.mock("@/app/utils/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmailMock(...a),
  SEND_CONCURRENCY: 8, SEND_TIMEOUT_MS: 20_000,
}));
vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn() },
}));
// `assignmentEmail` (the allowlist helpers the alarm reuses) imports the write
// client, which asserts Sanity env at module load. Nothing here writes.
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: vi.fn(), patch: vi.fn() },
}));

const SECRET = "cron-secret-for-tests";

/** A minimal `NextRequest` — the two cron routes read headers and search params. */
function req(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** Route the daily cron's two reads by the query they issue. */
function serveReminderFetches(stale: { count: number; oldest: string | null }) {
  operationalFetch.mockImplementation(async (query: string) => {
    if (query.includes("notificationOutbox")) return stale;
    if (query.includes("super-admin")) {
      return [{ _id: "sa-1", email: "boss@oasis.mx" }];
    }
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.CRON_SECRET = SECRET;
  sweepOutboxMock.mockResolvedValue({ claimed: 0, emailed: 0, consumed: 0, deferred: 0, unserved: 0, repended: 0, lost: 0, failed: 0, skipped: 0 });
  sendEmailMock.mockResolvedValue({ ok: true });
  sendPushMock.mockResolvedValue({ sent: 0 });
  operationalFetch.mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.NOTIFY_STALE_ALERT_HOURS;
  delete process.env.EMAIL_ALLOWLIST;
  vi.restoreAllMocks();
});

async function flushRoute() {
  return (await import("@/app/api/cron/flush-notifications/route")).GET;
}

async function remindersRoute() {
  return (await import("@/app/api/cron/service-reminders/route")).GET;
}

describe("layer 1 — /api/cron/flush-notifications", () => {
  it("rejects a request without the cron secret", async () => {
    const GET = await flushRoute();
    expect((await GET(req({}))).status).toBe(401);
    expect(sweepOutboxMock).not.toHaveBeenCalled();
  });

  it("rejects a request carrying the wrong secret", async () => {
    const GET = await flushRoute();
    expect((await GET(req({ authorization: "Bearer nope" }))).status).toBe(401);
    expect(sweepOutboxMock).not.toHaveBeenCalled();
  });

  it("refuses when no secret is configured, rather than authorizing everyone", async () => {
    delete process.env.CRON_SECRET;
    const GET = await flushRoute();
    expect((await GET(req({}))).status).toBe(401);
    expect(sweepOutboxMock).not.toHaveBeenCalled();
  });

  it("runs the sweep with the secret", async () => {
    const GET = await flushRoute();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    expect(sweepOutboxMock).toHaveBeenCalled();
  });

  it("sweeps at the FULL budget — the derating belongs to layer 2 alone", async () => {
    const GET = await flushRoute();
    await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(sweepOutboxMock).toHaveBeenCalledWith();
  });

  it("drains multiple rounds when a sweep re-pends work", async () => {
    sweepOutboxMock
      .mockResolvedValueOnce({ claimed: 1, emailed: 2, consumed: 0, deferred: 0, unserved: 8, repended: 1, lost: 0, failed: 0, skipped: 0 })
      .mockResolvedValueOnce({ claimed: 1, emailed: 2, consumed: 0, deferred: 0, unserved: 6, repended: 1, lost: 0, failed: 0, skipped: 0 })
      .mockResolvedValueOnce({ claimed: 1, emailed: 2, consumed: 0, deferred: 0, unserved: 4, repended: 1, lost: 0, failed: 0, skipped: 0 })
      .mockResolvedValueOnce({ claimed: 1, emailed: 2, consumed: 0, deferred: 0, unserved: 2, repended: 1, lost: 0, failed: 0, skipped: 0 })
      .mockResolvedValueOnce({ claimed: 1, emailed: 2, consumed: 1, deferred: 0, unserved: 0, repended: 0, lost: 0, failed: 0, skipped: 0 });

    const GET = await flushRoute();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    const body = await res.json();

    expect(sweepOutboxMock).toHaveBeenCalledTimes(5);
    expect(body).toMatchObject({ rounds: 5, emailed: 10, repended: 0, lost: 0, failed: 0, skipped: 0 });
  });

  it("stops draining after loss", async () => {
    sweepOutboxMock
      .mockResolvedValueOnce({ claimed: 1, emailed: 2, consumed: 0, deferred: 0, unserved: 8, repended: 1, lost: 0, failed: 0, skipped: 0 })
      .mockResolvedValueOnce({ claimed: 1, emailed: 0, consumed: 1, deferred: 0, unserved: 8, repended: 0, lost: 8, failed: 0, skipped: 0 });

    const GET = await flushRoute();
    const body = await GET(req({ authorization: `Bearer ${SECRET}` })).then((r) => r.json());

    expect(sweepOutboxMock).toHaveBeenCalledTimes(2);
    expect(body.lost).toBe(8);
    expect(body.repended).toBe(0);
  });

  it("stops draining when the wall-clock budget runs out", async () => {
    let tick = 0;
    const started = 1_000_000;
    sweepOutboxMock.mockImplementation(async () => {
      tick++;
      return { claimed: 1, emailed: 2, consumed: 0, deferred: 0, unserved: 8, repended: 1, lost: 0, failed: 0, skipped: 0 };
    });

    const mod = await import("@/app/api/cron/flush-notifications/route");
    const report = await mod.drainOutbox({
      sweep: sweepOutboxMock,
      now: () => started + tick * 25_000,
    });

    expect(sweepOutboxMock.mock.calls.length).toBeGreaterThan(1);
    expect(sweepOutboxMock.mock.calls.length).toBeLessThan(5);
    expect(report.repended).toBe(1);
    expect(report.emailed).toBe(2 * sweepOutboxMock.mock.calls.length);
  });

  it("declares a maxDuration that can host a whole fan-out", async () => {
    const mod = await import("@/app/api/cron/flush-notifications/route");
    expect(mod.maxDuration).toBe(60);
  });

  it("lets a throwing sweep fail the request — the red run IS layer 1's signal", async () => {
    // Deliberately the OPPOSITE of layer 3's handling. Here the caller is
    // `curl --fail` in GitHub Actions, so a 500 becomes a red run somebody sees;
    // swallowing it would make a broken sweep indistinguishable from a healthy one.
    sweepOutboxMock.mockRejectedValue(new Error("outbox unreadable"));
    const GET = await flushRoute();
    await expect(GET(req({ authorization: `Bearer ${SECRET}` }))).rejects.toThrow("outbox unreadable");
  });
});

describe("layer 3 — the daily cron also sweeps", () => {
  it("runs the same sweep", async () => {
    serveReminderFetches({ count: 0, oldest: null });
    const GET = await remindersRoute();
    await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(sweepOutboxMock).toHaveBeenCalled();
  });

  it("still refuses an unauthorized request", async () => {
    const GET = await remindersRoute();
    const res = await GET(req({}));
    expect(res.status).toBe(403);
    expect(sweepOutboxMock).not.toHaveBeenCalled();
  });

  it("refuses when no secret is configured, rather than authorizing everyone", async () => {
    // This route is now reachable without a session (the middleware matcher
    // excludes /api/cron/*), so its own guard is the ONLY guard. Fail closed.
    delete process.env.CRON_SECRET;
    const GET = await remindersRoute();
    expect((await GET(req({}))).status).toBe(403);
    expect((await GET(req({ authorization: "Bearer undefined" }))).status).toBe(403);
    expect(sweepOutboxMock).not.toHaveBeenCalled();
  });
});

describe("the liveness alarm", () => {
  /** The query the alarm issued against the outbox. */
  function staleQuery(): string {
    const call = operationalFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("notificationOutbox"),
    );
    return String(call?.[0] ?? "");
  }

  it("reports the oldest entry in EITHER status", async () => {
    // A notice stuck mid-fan-out sits in `sending`; reporting only `pending`
    // would blind the alarm to exactly the failure that spams the team.
    serveReminderFetches({ count: 1, oldest: hoursAgo(1) });
    const GET = await remindersRoute();
    await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(staleQuery()).toContain('status in ["pending","sending"]');
  });

  it("emails super-admins when the outbox is stale", async () => {
    // console.error has no consumer: no log drain, no alerting on Hobby.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    serveReminderFetches({ count: 4, oldest: hoursAgo(9) });
    const GET = await remindersRoute();
    await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(sendEmailMock).toHaveBeenCalled();
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ to: "boss@oasis.mx" });
    expect(error).toHaveBeenCalled();
    const logged = error.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).toContain("notify_outbox_stale");
  });

  it("stays silent while the oldest entry is inside the window", async () => {
    serveReminderFetches({ count: 2, oldest: hoursAgo(1) });
    const GET = await remindersRoute();
    await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("stays silent on an empty outbox", async () => {
    serveReminderFetches({ count: 0, oldest: null });
    const GET = await remindersRoute();
    await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("honours NOTIFY_STALE_ALERT_HOURS", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NOTIFY_STALE_ALERT_HOURS = "2";
    serveReminderFetches({ count: 1, oldest: hoursAgo(3) });
    const GET = await remindersRoute();
    await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(sendEmailMock).toHaveBeenCalled();
  });

  it("measures the age as an INSTANT, not a calendar day", async () => {
    // 30 minutes before local midnight is a different calendar day from "now"
    // and must still read as 0.5 h old, well inside the window.
    vi.spyOn(console, "error").mockImplementation(() => {});
    serveReminderFetches({ count: 1, oldest: hoursAgo(0.5) });
    const GET = await remindersRoute();
    await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("MEASURES BEFORE THE SWEEP — a backlog this run drains still fires", async () => {
    // The regression this alarm is for: layer 1 is dead, notices queued all day,
    // every one past its 1 h ceiling — and then THIS request's own sweep sends
    // and DELETES them. A sweep-then-measure order reads an empty outbox, reports
    // idle, and leaves 24-hour-late mail permanently silent.
    //
    // So the sweep here really consumes the fixture the liveness query reads,
    // rather than being the inert no-op every other test uses. Under the wrong
    // order this expectation fails.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const outbox: { count: number; oldest: string | null } = { count: 7, oldest: hoursAgo(11) };
    operationalFetch.mockImplementation(async (query: string) => {
      if (query.includes("notificationOutbox")) return { ...outbox };
      if (query.includes("super-admin")) return [{ _id: "sa-1", email: "boss@oasis.mx" }];
      return [];
    });
    sweepOutboxMock.mockImplementation(async () => {
      outbox.count = 0;
      outbox.oldest = null;
      return { claimed: 7, emailed: 7, consumed: 7, deferred: 0, unserved: 0, repended: 0, lost: 0, failed: 0, skipped: 0 };
    });

    const GET = await remindersRoute();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));

    expect(sweepOutboxMock).toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalled();
    expect(error.mock.calls.map((c) => String(c[0])).join(" ")).toContain("notify_outbox_stale");
    expect((await res.json()).liveness).toMatchObject({ count: 7, alerted: true });
  });

  it("still runs when the sweep throws — the alarm is not suppressed by it", async () => {
    // Parts of the sweep run outside its internal try (the due-notices fetch,
    // `resolveRecipients`), so a GROQ or transport failure there propagates. An
    // unwrapped call would 500 the route on exactly the run where the pipeline is
    // broken in the way the alarm exists to report.
    vi.spyOn(console, "error").mockImplementation(() => {});
    serveReminderFetches({ count: 3, oldest: hoursAgo(9) });
    sweepOutboxMock.mockRejectedValue(new Error("groq down"));

    const GET = await remindersRoute();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalled();
  });

  it("does not claim it alerted when a narrowed allowlist excludes every super-admin", async () => {
    // A narrowed EMAIL_ALLOWLIST is a supported configuration. The email IS the
    // mitigation here — no log drain, no alerting — so reaching nobody while
    // reporting `alerted: true` is the worst outcome available.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.EMAIL_ALLOWLIST = "solo-frank@oasis.mx";
    serveReminderFetches({ count: 4, oldest: hoursAgo(9) });

    const GET = await remindersRoute();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));

    expect(sendEmailMock).not.toHaveBeenCalled();
    const logged = error.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).toContain("notify_outbox_stale_unreachable");
    expect(logged).toContain("not_allowlisted");
    expect((await res.json()).liveness).toMatchObject({ alerted: false });
  });

  it("does not claim it alerted when the super-admin has no email address", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    operationalFetch.mockImplementation(async (query: string) => {
      if (query.includes("notificationOutbox")) return { count: 2, oldest: hoursAgo(9) };
      if (query.includes("super-admin")) return [{ _id: "sa-1" }];
      return [];
    });

    const GET = await remindersRoute();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(error.mock.calls.map((c) => String(c[0])).join(" ")).toContain("no_email_address");
    expect((await res.json()).liveness).toMatchObject({ alerted: false });
  });

  it("does not claim it alerted when every send fails", async () => {
    // The one super-admin provisioned by scripts/create-service-account.mjs
    // carries an undeliverable address, so this is the live shape of the problem.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sendEmailMock.mockResolvedValue({ ok: false, error: "no mailbox" });
    serveReminderFetches({ count: 4, oldest: hoursAgo(9) });

    const GET = await remindersRoute();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));

    expect(sendEmailMock).toHaveBeenCalled();
    const logged = error.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).toContain("notify_outbox_stale_email_failed");
    expect(logged).toContain("all_sends_failed");
    expect((await res.json()).liveness).toMatchObject({ alerted: false });
  });

  it("reports alerted when the mail actually lands", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    serveReminderFetches({ count: 4, oldest: hoursAgo(9) });
    const GET = await remindersRoute();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect((await res.json()).liveness).toMatchObject({ alerted: true });
  });

  it("never fails the cron when the alarm itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    operationalFetch.mockImplementation(async (query: string) => {
      if (query.includes("notificationOutbox")) throw new Error("outbox unreadable");
      return [];
    });
    const GET = await remindersRoute();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
  });
});

describe("aggregateFlushReports", () => {
  const round = (over: Record<string, number> = {}) => ({
    claimed: 0, emailed: 0, consumed: 0, deferred: 0,
    unserved: 0, repended: 0, lost: 0, failed: 0, skipped: 0,
    ...over,
  });

  it("SUMS the loss counters across rounds instead of taking the last", async () => {
    // The property the code comment defends and nothing tested: a wave throttled
    // in round 1 and a clean round 2 must not net out to zero. Taking `failed`
    // from the last round — the way `deferred` and `repended` are taken — would
    // report 0 here, the flush workflow would stay green, and eight destroyed
    // notifications would leave no trace anywhere.
    const { aggregateFlushReports } = await import("@/app/api/cron/flush-notifications/route");
    const out = aggregateFlushReports([
      round({ emailed: 2, failed: 3, skipped: 1, lost: 1, unserved: 4 }),
      round({ emailed: 5, failed: 0, skipped: 2, lost: 0, unserved: 0, deferred: 7, repended: 9 }),
    ]);
    expect(out.failed).toBe(3);
    expect(out.skipped).toBe(3);
    // The existing split, asserted alongside so a future edit cannot quietly move
    // a counter from one side to the other.
    expect(out.emailed).toBe(7);
    expect(out.lost).toBe(1);
    expect(out.unserved).toBe(4);
    expect(out.deferred).toBe(7);
    expect(out.repended).toBe(9);
    expect(out.rounds).toBe(2);
  });

  it("initialises the new counters on an empty drain", async () => {
    // `undefined` here would serialise as `"failed":null`, which the workflow's
    // numeric `sed` gate does not match — a silent fail-open on the one signal
    // this delivery added.
    const { aggregateFlushReports } = await import("@/app/api/cron/flush-notifications/route");
    const out = aggregateFlushReports([]);
    expect(out.failed).toBe(0);
    expect(out.skipped).toBe(0);
    expect(JSON.stringify(out)).toContain('"failed":0');
    expect(JSON.stringify(out)).toContain('"skipped":0');
  });

  it("never emits null for a counter, whatever the rounds carry", async () => {
    // A reducer-internal typo, which is what this row actually covers — the
    // helper below always supplies both fields, so it cannot reproduce a CALLER
    // passing the old shape. That regression (every mock returning the old
    // report, making `failed += r.failed` NaN and the route answer
    // `"failed":null`) is caught by the eleven updated fixtures plus the exact
    // `failed: 0` assertion on the drain body, where `null !== 0` fails.
    const { aggregateFlushReports } = await import("@/app/api/cron/flush-notifications/route");
    const out = aggregateFlushReports([round({ emailed: 1 })]);
    for (const [k, v] of Object.entries(out)) {
      expect(Number.isFinite(v), `${k} is ${v}`).toBe(true);
    }
  });
});
