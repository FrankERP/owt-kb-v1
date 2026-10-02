// `publishReady`'s OUTCOME contract — what the admin route and the MCP
// `publish_service` tool both receive from the one publish writer.
//
// The writer's BEHAVIOUR (every refusal, every guard op, every notice) is
// pinned end to end through the admin route by `publishReadyRoutes.test.ts`,
// and its per-service verdict against the MCP read by
// `publishRefusalParity.test.ts`; both stayed unchanged when the body moved
// here. What they cannot see is the part only a caller of the module gets:
// `effects` — the observations the post-commit helpers were built from and
// the descriptors those helpers returned. The tool builds its report from
// exactly these, so they are pinned here.
//
// The reads run for real over P1's shared service fixtures (read only — this
// file adds nothing to them, ruling P3-R2), so `assembleService`, the verdict
// and the guard bundle are the real ones. The two post-commit helpers are
// wrapped in pass-through spies, so their real descriptors come back and the
// arguments they were handed can be inspected.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  operational: vi.fn(),
  raw: vi.fn(),
  transactions: [] as { committed: boolean }[],
  afterCallbacks: [] as (() => unknown)[],
  notifyRolePublished: vi.fn(),
  queuePublishedSetlistNotices: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.raw(...a) },
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: {
    transaction: () => {
      const record = { committed: false };
      h.transactions.push(record);
      const tx = {
        patch(_id: string, build: (p: unknown) => unknown) {
          const p = {
            ifRevisionId: () => p,
            set: () => p,
            unset: () => p,
          };
          build(p);
          return tx;
        },
        async commit() {
          record.committed = true;
          return { transactionId: "t1" };
        },
      };
      return tx;
    },
  },
}));

vi.mock("@/app/utils/revalidate", () => ({ revalidateServiceViews: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidatePath(...a) }));
vi.mock("@/app/utils/push", () => ({ sendPush: vi.fn() }));
vi.mock("@/app/utils/assignmentEmail", () => ({
  sendAssignmentEmails: vi.fn(),
  sendAssignmentEmailsBatch: vi.fn(),
  assigneesOf: () => [],
}));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void h.afterCallbacks.push(fn) };
});

// Pass-through spies: the REAL helpers run (and return their real descriptors),
// and the calls are recorded.
vi.mock("@/app/utils/serviceMutationSideEffects", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/app/utils/serviceMutationSideEffects")>();
  h.notifyRolePublished.mockImplementation(mod.notifyRolePublished);
  h.queuePublishedSetlistNotices.mockImplementation(mod.queuePublishedSetlistNotices);
  return {
    ...mod,
    notifyRolePublished: (...a: Parameters<typeof mod.notifyRolePublished>) => h.notifyRolePublished(...a),
    queuePublishedSetlistNotices: (...a: Parameters<typeof mod.queuePublishedSetlistNotices>) =>
      h.queuePublishedSetlistNotices(...a),
  };
});

import { publishReady } from "@/app/utils/publishReadyCommit";
import type { PublishedSetlistSubject } from "@/app/utils/serviceMutationSideEffects";
import {
  createFixtureResponder,
  serviceFixtureStore,
  type ReadinessDomain,
} from "@/app/mcp/reads/__tests__/serviceFixtures";

/** Noon in Mexico City on 2026-09-24: every fixture service is in the future. */
const FROZEN_INSTANT = "2026-09-24T18:00:00.000Z";

const SPECIAL = "role-sp-1024-wn"; // a ready worship-night special WITH songs
const SATURDAY = "role-sat-1003"; // a ready Saturday

let errorSpy: ReturnType<typeof vi.spyOn>;

function wire(fail: readonly ReadinessDomain[] = []) {
  const responder = createFixtureResponder(serviceFixtureStore(), { fail });
  h.operational.mockImplementation(responder.operational);
  h.raw.mockImplementation(responder.raw);
}

function rev(id: string): string {
  return `${id}-rev`;
}

beforeEach(() => {
  h.operational.mockReset();
  h.raw.mockReset();
  h.notifyRolePublished.mockClear();
  h.queuePublishedSetlistNotices.mockClear();
  h.revalidatePath.mockReset();
  h.transactions.length = 0;
  h.afterCallbacks.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FROZEN_INSTANT));
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errorSpy.mockRestore();
});

describe("publishReady — a committed publish", () => {
  it("returns the route's JSON as body, plus the observations and the two helpers' own descriptors", async () => {
    wire();
    const outcome = await publishReady({
      mode: "ready",
      roles: [
        { id: SPECIAL, rev: rev(SPECIAL) },
        { id: SATURDAY, rev: rev(SATURDAY) },
      ],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({
      ok: true,
      mode: "ready",
      published: 2,
      services: [{ id: SPECIAL }, { id: SATURDAY }],
    });
    expect(h.transactions).toEqual([{ committed: true }]);

    const { effects } = outcome;
    expect(effects.recovered).toBe(false);
    // Request order, and exactly the values the helpers were built from.
    expect(effects.observations.map((o) => o.roleId)).toEqual([SPECIAL, SATURDAY]);
    expect(effects.observations.map((o) => o.roleRev)).toEqual([rev(SPECIAL), rev(SATURDAY)]);
    const subjects = h.queuePublishedSetlistNotices.mock.calls[0][0] as PublishedSetlistSubject[];
    expect(effects.observations.map((o) => o.role)).toEqual(subjects.map((s) => s.role));

    // The descriptors are the helpers' own return values, captured at their call sites.
    expect(h.notifyRolePublished).toHaveBeenCalledTimes(1);
    expect(h.queuePublishedSetlistNotices).toHaveBeenCalledTimes(1);
    expect(effects.push).toBe(h.notifyRolePublished.mock.results[0].value);
    expect(effects.notice).toBe(h.queuePublishedSetlistNotices.mock.results[0].value);
    expect(effects.push?.pushes.map((p) => p.date)).toEqual(["2026-10-24", "2026-10-03"]);
    expect(effects.push?.emailBatch.map((e) => e.date)).toEqual(["2026-10-24", "2026-10-03"]);
    // The special's own name rides to the publish email; the Saturday carries none.
    expect(effects.push?.emailBatch[0].serviceName).toBe("Noche de alabanza");
    expect(effects.push?.emailBatch[1]).not.toHaveProperty("serviceName");
    expect(effects.notice).toEqual({
      kind: "publishedSetlist",
      subjects: subjects.map((s) => ({ roleId: s.roleId, knownRecipients: s.knownRecipients })),
    });
    expect(effects.notice?.subjects.map((s) => s.roleId)).toEqual([SPECIAL, SATURDAY]);
  });

  it("hands out COPIES of the observations: editing one cannot change what the deferred «Setlist listo» block reads", async () => {
    wire();
    const outcome = await publishReady({ mode: "ready", roles: [{ id: SPECIAL, rev: rev(SPECIAL) }] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const subject = (h.queuePublishedSetlistNotices.mock.calls[0][0] as PublishedSetlistSubject[])[0];
    const role = subject.role as { songs: unknown[] };
    expect(role.songs).toHaveLength(2);

    // A report that empties the special's songs, or rewrites its fields, must not
    // reach the object the deferred block reads `songs` from.
    const reported = outcome.effects.observations[0];
    (reported.role as { songs: unknown[] }).songs.length = 0;
    reported.role._id = "edited-by-a-report";
    reported.members.length = 0;
    expect(role.songs).toHaveLength(2);
    expect(subject.role).toMatchObject({ _id: SPECIAL });
    expect(reported.role).not.toBe(subject.role);
  });
});

describe("publishReady — recovery and refusals", () => {
  it("answers a recovered 200 with an explicit EMPTY effects value, and writes and notifies nothing", async () => {
    wire();
    const outcome = await publishReady({
      mode: "recover",
      published: true,
      roles: [{ id: "role-sun-1004" }], // already published in the fixture
    });
    expect(outcome).toEqual({
      ok: true,
      status: 200,
      body: {
        ok: true,
        mode: "recover",
        outcome: "recovered",
        services: [{ id: "role-sun-1004", publishState: "published", rawDrafts: [] }],
      },
      effects: { recovered: true, observations: [], push: null, notice: null },
    });
    expect(h.transactions).toEqual([]);
    expect(h.notifyRolePublished).not.toHaveBeenCalled();
    expect(h.queuePublishedSetlistNotices).not.toHaveBeenCalled();
  });

  it("answers an unknown recovery as a 503 refusal with NO effects", async () => {
    wire(["roles"]);
    const outcome = await publishReady({ mode: "recover", published: true, roles: [{ id: SPECIAL }] });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(503);
    expect(outcome).not.toHaveProperty("effects");
    expect(outcome.body).toMatchObject({ error: "unknown_outcome", outcome: "unknown" });
    expect(h.transactions).toEqual([]);
  });

  it("refuses a not-ready service with the route's 409 body, no effects and no write", async () => {
    wire();
    const outcome = await publishReady({
      mode: "ready",
      roles: [{ id: "role-sun-1011", rev: rev("role-sun-1011") }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(409);
    expect(outcome).not.toHaveProperty("effects");
    expect(outcome.body).toMatchObject({
      error: "stale_revision",
      details: { mode: "ready", services: [{ id: "role-sun-1011" }] },
    });
    // Already published (grandfathered — no `published` field) plus unmet
    // workflow blockers, never a revision reason: the rev sent above is the
    // fixture's own.
    const body = outcome.body as { details: { services: { reasons: string[] }[] } };
    expect(body.details.services[0]!.reasons).toEqual(["already_published", "not_ready"]);
    expect(h.transactions).toEqual([]);
    expect(h.notifyRolePublished).not.toHaveBeenCalled();
    expect(h.queuePublishedSetlistNotices).not.toHaveBeenCalled();
  });

  it("refuses an unparseable body with 400 before any read", async () => {
    const outcome = await publishReady({ mode: "publish" });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(400);
    expect(outcome).not.toHaveProperty("effects");
    expect(h.operational).not.toHaveBeenCalled();
    expect(h.raw).not.toHaveBeenCalled();
  });
});
