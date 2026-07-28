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
      return [{ _id: "sa-1", email: "boss@oasis.mx", alias: "Jefa" }];
    }
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.CRON_SECRET = SECRET;
  sweepOutboxMock.mockResolvedValue({ claimed: 0, emailed: 0, consumed: 0, deferred: 0, unserved: 0 });
  sendEmailMock.mockResolvedValue({ ok: true });
  sendPushMock.mockResolvedValue({ sent: 0 });
  operationalFetch.mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.NOTIFY_STALE_ALERT_HOURS;
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

  it("declares a maxDuration that can host a whole fan-out", async () => {
    const mod = await import("@/app/api/cron/flush-notifications/route");
    expect(mod.maxDuration).toBe(60);
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
