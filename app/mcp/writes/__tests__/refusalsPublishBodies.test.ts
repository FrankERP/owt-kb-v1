// `refusalFor` over the publish writer's REAL refusal bodies (P3 step 7, F10).
//
// `publishReady` — the domain body of `POST /api/admin/roles/publish-ready`,
// which `publish_service` will call — runs over P1's service fixture matrix
// (`app/mcp/reads/__tests__/serviceFixtures.ts`, read-only here: every case
// that needs a different state edits its OWN fresh copy of the store, never the
// shared definition, ruling P3-R2). Each body it returns is fed to `refusalFor`,
// so the copy is tested against what the writer actually says rather than a
// hand-written imitation:
//
//   not_ready / already_published / hard / unusable  → per-service reasons
//   a retry of a publish that landed                  → already_published + stale
//   already_published beside a REAL workflow blocker  → informational, no override note (P3-R20)
//   a commit race                                     → details.guard
//   the assertion stage                               → assertionIssues
//   a missing service                                 → 404 not_found
//
// The mocks are `publishRefusalParity.test.ts`'s: the strict fixture responder
// answers every read, the transaction is recorded, `after()` is captured and
// never run.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  operational: vi.fn(),
  raw: vi.fn(),
  commitError: null as unknown,
  commits: 0,
  afterCallbacks: [] as (() => unknown)[],
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.raw(...a) },
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: () => makeTransaction() },
}));

vi.mock("@/app/utils/revalidate", () => ({ revalidateServiceViews: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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

import { publishReady } from "@/app/utils/publishReadyCommit";
import type { DomainRefusal } from "../refusals";
import { NOTHING_WRITTEN, PUBLISH_OVERRIDE_NOTE, STALE_COPY, refusalFor } from "../refusals";
import { PUBLISH_SKIP_COPY } from "@/app/components/admin/serviceCardModel";
import {
  createFixtureResponder,
  serviceFixtureStore,
  type ServiceFixtureStore,
} from "@/app/mcp/reads/__tests__/serviceFixtures";

function makeTransaction() {
  const tx = {
    patch(_id: string, fn: (p: unknown) => unknown) {
      const p = {
        ifRevisionId: () => p,
        set: () => p,
        unset: () => p,
      };
      fn(p);
      return tx;
    },
    create: () => tx,
    createIfNotExists: () => tx,
    delete: () => tx,
    async commit() {
      if (h.commitError) throw h.commitError;
      h.commits += 1;
      return { transactionId: "t1" };
    },
  };
  return tx;
}

/** Noon in Mexico City on 2026-09-24: every fixture service is in the future. */
const FROZEN_INSTANT = "2026-09-24T18:00:00.000Z";

let refusedReads: string[];

/** Wire both clients to a fresh strict responder over `store`, recording every read it refused. */
function wire(store: ServiceFixtureStore) {
  refusedReads = [];
  const responder = createFixtureResponder(store);
  const strict =
    (serve: typeof responder.operational) =>
    async (query: string, params?: Record<string, unknown>) => {
      try {
        return await serve(query, params);
      } catch (err) {
        refusedReads.push(err instanceof Error ? err.message.slice(0, 80) : "non-error rejection");
        throw err;
      }
    };
  h.operational.mockImplementation(strict(responder.operational));
  h.raw.mockImplementation(strict(responder.raw));
}

function revOf(store: ServiceFixtureStore, id: string): string {
  const rev = store.roles.find((r) => r._id === id)?._rev;
  return typeof rev === "string" ? rev : "rev-of-a-missing-role";
}

/** One ready-mode publish of one service over `store` (a fresh matrix unless given). */
async function publishOne(id: string, store = serviceFixtureStore(), rev = revOf(store, id)): Promise<DomainRefusal> {
  wire(store);
  const outcome = await publishReady({ mode: "ready", roles: [{ id, rev }] });
  expect(refusedReads, "a refused fixture read would make the body agree for the wrong reason").toEqual([]);
  if (outcome.ok) throw new Error(`${id} published; the test needs a refusal`);
  return outcome;
}

function textOf(outcome: DomainRefusal): string {
  const result = refusalFor(outcome);
  expect(result.isError).toBe(true);
  return (result.content as { text: string }[])[0].text;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FROZEN_INSTANT));
  h.commitError = null;
  h.commits = 0;
  h.afterCallbacks.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("refusalFor over publishReady's real refusal bodies", () => {
  it("control: the ready Saturday publishes (so the refusals below are the writer's, not the harness's)", async () => {
    const store = serviceFixtureStore();
    wire(store);
    const outcome = await publishReady({ mode: "ready", roles: [{ id: "role-sat-1003", rev: revOf(store, "role-sat-1003") }] });
    expect(outcome.ok).toBe(true);
    expect(h.commits).toBe(1);
    expect(refusedReads).toEqual([]);
  });

  it("not_ready arrives as top-level stale_revision and reads as its workflow blockers", async () => {
    const outcome = await publishOne("role-sp-1017-a");
    expect(outcome.status).toBe(409);
    expect((outcome.body as { error: string }).error).toBe("stale_revision");
    const result = refusalFor(outcome);
    const services = (result.structuredContent as { services: { reasons: string[]; workflowBlockers: string[] }[] })
      .services;
    expect(services).toHaveLength(1);
    expect(services[0].reasons).toEqual(["not_ready"]);
    expect(services[0].workflowBlockers.length).toBeGreaterThan(0);

    const text = textOf(outcome);
    expect(text.startsWith("No se puede publicar todavía: ")).toBe(true);
    for (const blocker of services[0].workflowBlockers) {
      expect(text).toContain(PUBLISH_SKIP_COPY[blocker as keyof typeof PUBLISH_SKIP_COPY]);
    }
    expect(text).toContain(PUBLISH_OVERRIDE_NOTE);
    expect(text).not.toContain("vuelve a leer");
    expect(text.endsWith(NOTHING_WRITTEN)).toBe(true);
    expect(h.commits).toBe(0);
  });

  it("already_published reads as «ya está publicado»", async () => {
    const outcome = await publishOne("role-sun-1004");
    expect((outcome.body as { error: string }).error).toBe("stale_revision");
    const text = textOf(outcome);
    expect(text.startsWith("Ya está publicado.")).toBe(true);
    expect(text).not.toContain("vuelve a leer");
    expect(text).not.toContain(PUBLISH_OVERRIDE_NOTE);
  });

  it("a published service that ALSO has workflow blockers: informational only, never PUBLISH_OVERRIDE_NOTE", async () => {
    // role-sun-1115-live is live, locked and clean, but has no setlist document
    // for its week — a real `not_ready` blocker beside a real `already_published`.
    const outcome = await publishOne("role-sun-1115-live");
    const reasons = (refusalFor(outcome).structuredContent as { services: { reasons: string[] }[] }).services[0]
      .reasons;
    expect(reasons).toEqual(["already_published", "not_ready"]);
    const text = textOf(outcome);
    expect(text.startsWith("Ya está publicado.")).toBe(true);
    // Never the "cannot publish yet" lead-in, and never the override note —
    // there is nothing to override on a service that already published.
    expect(text).not.toContain("No se puede publicar todavía");
    expect(text).not.toContain(PUBLISH_OVERRIDE_NOTE);
    expect(text).not.toContain("vuelve a leer");
    expect(text).toContain(PUBLISH_SKIP_COPY.incomplete_setlist);
  });

  it("a hard integrity blocker reads as the integrity blockers, top-level integrity_conflict", async () => {
    const outcome = await publishOne("role-sun-1018");
    expect((outcome.body as { error: string }).error).toBe("integrity_conflict");
    const text = textOf(outcome);
    expect(text).toContain("No se puede publicar por un problema de integridad: ");
    expect(text).toContain(PUBLISH_SKIP_COPY.setlist_draft_conflict);
    expect(text).not.toContain("vuelve a leer");
  });

  it("an unusable observation reads as the route-only copy", async () => {
    const outcome = await publishOne("role-sun-1108-invalid");
    const reasons = (refusalFor(outcome).structuredContent as { services: { reasons: string[] }[] }).services[0]
      .reasons;
    expect(reasons).toContain("unusable_observation");
    expect(textOf(outcome)).toContain("No se pudo leer el servicio con seguridad para publicarlo.");
  });

  it("a retry of a publish that landed: already_published + stale_revision, leading with «ya está publicado»", async () => {
    const store = serviceFixtureStore();
    const consumedRev = revOf(store, "role-sat-1003");
    // What the first call left behind: the role is published and its rev moved.
    const role = store.roles.find((r) => r._id === "role-sat-1003") as Record<string, unknown>;
    role.published = true;
    role._rev = "role-sat-1003-rev-after-publish";

    const outcome = await publishOne("role-sat-1003", store, consumedRev);
    const reasons = (refusalFor(outcome).structuredContent as { services: { reasons: string[] }[] }).services[0]
      .reasons;
    expect(reasons).toEqual(["already_published", "stale_revision"]);
    expect(textOf(outcome)).toBe(`Ya está publicado. Además, el servicio cambió desde que lo leíste. ${NOTHING_WRITTEN}`);
  });

  it("a stale revision alone is the re-read instruction", async () => {
    const outcome = await publishOne("role-sat-1003", serviceFixtureStore(), "someone-elses-rev");
    const reasons = (refusalFor(outcome).structuredContent as { services: { reasons: string[] }[] }).services[0]
      .reasons;
    expect(reasons).toEqual(["stale_revision"]);
    expect(textOf(outcome)).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
  });

  it("a commit race carries details.guard and is the re-read instruction", async () => {
    h.commitError = Object.assign(new Error("Sanity 409 with internal detail"), {
      statusCode: 409,
      details: { type: "mutationError", items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }] },
    });
    const outcome = await publishOne("role-sat-1003");
    expect((outcome.body as { details: { guard: string } }).details.guard).toBe("publish_ready_assertions");
    const result = refusalFor(outcome);
    expect(result.structuredContent).toEqual({ refused: true, code: "stale_revision", detail: "publish_ready_assertions" });
    expect(textOf(outcome)).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
    expect(JSON.stringify(result)).not.toContain("internal detail");
  });

  it("the assertion stage (a member with no revision) is the integrity copy, never a retry", async () => {
    const store = serviceFixtureStore();
    const ana = store.members.find((m) => m._id === "mem-ana") as Record<string, unknown>;
    ana._rev = "";
    const outcome = await publishOne("role-sat-1003", store);
    expect((outcome.body as { error: string }).error).toBe("integrity_conflict");
    expect(Object.keys((outcome.body as { details: Record<string, unknown> }).details)).toEqual(["assertionIssues"]);
    const result = refusalFor(outcome);
    expect(result.structuredContent).toEqual({ refused: true, code: "integrity_conflict", detail: "assertionIssues" });
    const text = textOf(outcome);
    expect(text).toContain("no pasan una verificación de integridad");
    expect(text).not.toContain("vuelve a leer");
    expect(h.commits).toBe(0);
  });

  it("a missing service is a 404 not_found", async () => {
    const outcome = await publishOne("role-missing");
    expect(outcome.status).toBe(404);
    const result = refusalFor(outcome);
    expect(result.structuredContent).toEqual({ refused: true, code: "not_found" });
    expect(textOf(outcome)).toBe(`El servicio no existe; vuelve a buscarlo con list_services. ${NOTHING_WRITTEN}`);
  });
});
