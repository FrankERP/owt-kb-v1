// The twin-run harness proving itself (P3 step 7), before steps 8–11 rely on it.
//
// The admin unpublish route and a stand-in "tool" — `runWriteTool` calling the
// same `unpublishRoles` through `callDomain`, which is exactly what step 8's
// tool will do — run over one fixture definition, each on its own fresh store.
// No tool is registered; the stand-in exists only here.
//
// A second group drives the real side-effect helpers directly, to prove what
// unpublish cannot: `after()` callbacks run, pushes and outbox upserts are
// recorded, the layer-2 sweep is counted, and `nextKey` restarts per run.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const t = await vi.hoisted(async () => {
  const { createTwinHarness } = await import("./twinRun");
  return createTwinHarness();
});

vi.mock("@/app/utils/authGuards", () => t.mocks.authGuards());
vi.mock("@/sanity/lib/operationalClient", () => t.mocks.operationalClient());
vi.mock("@/sanity/lib/serverClient", () => t.mocks.serverClient());
vi.mock("@/app/utils/push", () => t.mocks.push());
vi.mock("@/app/utils/assignmentEmail", async (orig) => t.mocks.assignmentEmail(await orig()));
vi.mock("@/app/utils/outboxSweep", async (orig) => t.mocks.outboxSweep(await orig()));
vi.mock("@/app/utils/revalidate", () => t.mocks.revalidate());
vi.mock("next/cache", () => t.mocks.nextCache());
vi.mock("next/server", async (orig) => t.mocks.nextServer(await orig()));
vi.mock("@/app/utils/roleWriteOps", async (orig) => t.mocks.roleWriteOps(await orig()));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { POST as unpublishPOST } from "@/app/api/admin/roles/unpublish/route";
import { unpublishRoles } from "@/app/utils/roleUnpublishCommit";
import { nextKey } from "@/app/utils/roleWriteOps";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serverClient } from "@/sanity/lib/serverClient";
import { notifyRoleAssignments, queueRoleNotices } from "@/app/utils/serviceMutationSideEffects";
import { normalizeStoredSeats } from "@/app/utils/roleWriteRequest";
import { ROLE_TYPES, roleTargetKey } from "@/app/utils/serviceReadModel";
import { buildClaimedLock } from "@/app/utils/roleTargetLock";
import {
  canonicalRoleByIdQuery,
  canonicalSpecialRolesForDateQuery,
  canonicalWeekendRolesForTargetQuery,
  rawRoleDraftForBaseQuery,
  rawRoleDraftsForTargetQuery,
  rawSpecialRoleDraftsForDateQuery,
  roleTargetLocksByIdsQuery,
} from "@/app/utils/serviceReadQueries";
import { runWriteTool, WRITE_UNKNOWN_OUTCOME_MESSAGE } from "../runWriteTool";
import { refusalFor } from "../refusals";
import {
  canonicalDocs,
  draftDocs,
  parityView,
  project,
  type TwinDoc,
  type TwinQuery,
  type TwinStore,
} from "./twinRun";

// ── The fixture: one definition, a fresh store per run ──────────────────────

const ROLE_FIELDS = [
  "_id", "_rev", "_type", "published", "week", "date", "service_name", "time", "format",
  "creationReceiptId", "creationFingerprint", "Lead", "BGVs", "Chorus", "instruments", "foh_team", "songs",
] as const;
const LOCK_FIELDS = ["_id", "_rev", "_type", "targetKey", "state", "roleId", "roleType", "date", "claimNonce", "generation"] as const;

const ref = (key: string, id: string) => ({ _key: key, _type: "reference", _ref: id });

function sunday(id: string, week: string, published: boolean): TwinDoc {
  return {
    _id: id,
    _rev: `${id}-rev`,
    _type: "sunday_role",
    week,
    published,
    Lead: [ref("l1", "mem-ana")],
    BGVs: [ref("b1", "mem-luis")],
    Chorus: [],
    instruments: [],
    foh_team: [],
  };
}

function lockFor(role: TwinDoc): TwinDoc {
  const targetKey = roleTargetKey(role) as string;
  const lock = buildClaimedLock({ targetKey, roleId: role._id, claimNonce: "n1", now: "2026-09-01T00:00:00.000Z" });
  if (!lock) throw new Error("fixture: no lock for " + role._id);
  return { ...lock, _rev: `${lock._id}-rev` };
}

function fixture(): TwinDoc[] {
  const live = sunday("role-sun-1004", "2026-10-04", true);
  const draft = sunday("role-sun-1011", "2026-10-11", false);
  return [
    live,
    lockFor(live),
    draft,
    lockFor(draft),
    { _id: "mem-ana", _rev: "mem-ana-rev", _type: "teamMembers", member_name: "Ana" },
    { _id: "mem-luis", _rev: "mem-luis-rev", _type: "teamMembers", member_name: "Luis" },
  ];
}

const roleRow = (doc: TwinDoc) => project(doc, ROLE_FIELDS);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Every read the unpublish writer makes, keyed by the builders' own text. */
const UNPUBLISH_QUERIES: TwinQuery[] = [
  {
    label: "role by id",
    client: "operational",
    bound: canonicalRoleByIdQuery("x"),
    rows: (store, p) =>
      canonicalDocs(store, strings(p.roleTypes)).filter((d) => d._id === p.id).map(roleRow),
  },
  {
    label: "role draft by base id",
    client: "raw",
    bound: rawRoleDraftForBaseQuery("x"),
    rows: (store, p) =>
      draftDocs(store, strings(p.roleTypes)).filter((d) => d._id === p.draftId).map((d) => ({ _id: d._id })),
  },
  {
    label: "weekend roles at a target",
    client: "operational",
    bound: canonicalWeekendRolesForTargetQuery("x", "2026-01-01"),
    rows: (store, p) =>
      canonicalDocs(store, [String(p.roleType)]).filter((d) => d.week === p.week).map(roleRow),
  },
  {
    label: "weekend role drafts at a target",
    client: "raw",
    bound: rawRoleDraftsForTargetQuery("x", "2026-01-01"),
    rows: (store, p) =>
      draftDocs(store, [String(p.roleType)]).filter((d) => d.week === p.week).map((d) => ({ _id: d._id, _type: d._type })),
  },
  {
    label: "specials on a date",
    client: "operational",
    bound: canonicalSpecialRolesForDateQuery("2026-01-01"),
    rows: (store, p) => canonicalDocs(store, ["special_role"]).filter((d) => d.date === p.date).map(roleRow),
  },
  {
    label: "special drafts on a date",
    client: "raw",
    bound: rawSpecialRoleDraftsForDateQuery("2026-01-01"),
    rows: (store, p) =>
      draftDocs(store, ["special_role"])
        .filter((d) => d.date === p.date)
        .map((d) => ({ _id: d._id, _type: d._type, service_name: d.service_name ?? null })),
  },
  {
    label: "locks by id",
    client: "operational",
    bound: roleTargetLocksByIdsQuery([]),
    rows: (store, p) =>
      canonicalDocs(store, ["roleTargetLock"]).filter((d) => strings(p.ids).includes(d._id)).map((d) => project(d, LOCK_FIELDS)),
  },
];

const OPTIONS = { fixture, queries: UNPUBLISH_QUERIES };

/** The stand-in tool: exactly the call shape step 8's `unpublish_service` makes. */
function probeTool(id: string, rev: string): () => Promise<CallToolResult> {
  return () =>
    runWriteTool("unpublish_probe", async ({ callDomain }) => {
      const outcome = await callDomain(() => unpublishRoles({ roles: [{ id, rev }] }));
      if (!outcome.ok) return refusalFor(outcome);
      return {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { ok: true, changed: outcome.effects.toPatch.length > 0 },
      };
    });
}

function roleIn(store: TwinStore, id: string): TwinDoc {
  const doc = store.docs.get(id);
  if (!doc) throw new Error(`no ${id}`);
  return doc;
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Twin runs: route and tool over one fixture ──────────────────────────────

describe("twin: the admin unpublish route and a runWriteTool call of the same domain", () => {
  it("land the same transaction and the same revalidation, each on its own fresh store", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-1004", rev: "role-sun-1004-rev" }] } },
      probeTool("role-sun-1004", "role-sun-1004-rev"),
    );
    expect(route.refusedReads).toEqual([]);
    expect(tool.refusedReads).toEqual([]);

    expect(route.response).toEqual({
      status: 200,
      body: { ok: true, unpublished: 1, services: [{ id: "role-sun-1004" }] },
    });
    expect(tool.response.isError).toBeUndefined();
    expect(tool.response.structuredContent).toEqual({ ok: true, changed: true });

    expect(parityView(tool)).toEqual(parityView(route));
    // Not vacuous: the one transaction is the published:false patch plus the lock heartbeat.
    expect(route.transactions).toHaveLength(1);
    expect(route.transactions[0]).toEqual([
      expect.objectContaining({ kind: "patch", id: "role-sun-1004", ifRevisionId: "role-sun-1004-rev", set: { published: false } }),
      expect.objectContaining({
        kind: "patch",
        id: "roleTarget.sunday_role.2026-10-04",
        ifRevisionId: "roleTarget.sunday_role.2026-10-04-rev",
        set: { updatedAt: "2026-09-24T18:00:00.000Z" },
      }),
    ]);
    expect(route.revalidations).toEqual(["revalidatePath(/)", "revalidatePath(/schedule)", "revalidatePath(/me)"]);
    expect(route.pushes).toEqual([]);
    expect(route.outboxUpserts).toEqual([]);

    // Each run committed to ITS store: the second run was not refused stale by the first.
    expect(roleIn(route.store, "role-sun-1004").published).toBe(false);
    expect(roleIn(tool.store, "role-sun-1004").published).toBe(false);
    expect(roleIn(tool.store, "role-sun-1004")._rev).toBe("twin-rev-1");
  });

  it("the already-draft no-op: neither run writes or revalidates", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-1011", rev: "role-sun-1011-rev" }] } },
      probeTool("role-sun-1011", "role-sun-1011-rev"),
    );
    expect(route.response).toMatchObject({ status: 200, body: { unpublished: 0 } });
    expect(tool.response.structuredContent).toEqual({ ok: true, changed: false });
    expect(parityView(tool)).toEqual(parityView(route));
    expect(route.transactions).toEqual([]);
    expect(route.revalidations).toEqual([]);
  });

  it("a stale rev: both refuse with the route's code, zero commits", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-1004", rev: "someone-elses-rev" }] } },
      probeTool("role-sun-1004", "someone-elses-rev"),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "stale_revision" } });
    expect(tool.response.structuredContent).toEqual({ refused: true, code: "stale_revision" });
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("a race (a write landing before the commit) is refused stale by the store, in both runs", async () => {
    const race = (store: TwinStore) => {
      roleIn(store, "role-sun-1004")._rev = "moved-by-someone-else";
    };
    const { route, tool } = await t.twin(
      { ...OPTIONS, race },
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-1004", rev: "role-sun-1004-rev" }] } },
      probeTool("role-sun-1004", "role-sun-1004-rev"),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "stale_revision" } });
    expect(tool.response.structuredContent).toEqual({ refused: true, code: "stale_revision" });
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
    expect(route.revalidations).toEqual([]);
  });

  it("a commit that fails for another reason is the tool's unknown outcome, never «No se escribió nada.»", async () => {
    const run = await t.runTool(
      { ...OPTIONS, failFirstCommit: Object.assign(new Error("socket hang up token=abc"), { statusCode: 502 }) },
      probeTool("role-sun-1004", "role-sun-1004-rev"),
    );
    expect(run.response.content).toEqual([{ type: "text", text: WRITE_UNKNOWN_OUTCOME_MESSAGE }]);
    expect(run.transactions).toEqual([]);
    expect(JSON.stringify(run.response)).not.toContain("token=abc");
  });

  it("control: parityView tells a write from a no-op", async () => {
    const wrote = await t.runTool(OPTIONS, probeTool("role-sun-1004", "role-sun-1004-rev"));
    const noop = await t.runTool(OPTIONS, probeTool("role-sun-1011", "role-sun-1011-rev"));
    expect(parityView(wrote)).not.toEqual(parityView(noop));
  });
});

// ── The machinery the unpublish twin cannot reach ───────────────────────────

describe("the harness's own mechanics", () => {
  it("runs after() callbacks once the action returns, recording pushes, outbox upserts and the sweep", async () => {
    const run = await t.run(OPTIONS, async () => {
      const after = normalizeStoredSeats(sunday("role-sun-1004", "2026-10-04", true));
      notifyRoleAssignments([
        { recipients: ["mem-ana"], type: "sunday_role", date: "2026-10-04", body: {}, kind: "updated" },
      ]);
      queueRoleNotices({
        roleId: "role-sun-1004",
        roleType: "sunday_role",
        serviceDate: "2026-10-04",
        published: true,
        beforeSeats: null,
        afterSeats: after,
      });
      return "done";
    });
    expect(run.response).toBe("done");
    expect(run.afterErrors).toBe(0);
    expect(run.pushes).toEqual([
      {
        memberIds: ["mem-ana"],
        category: "assignments",
        payload: { title: "Servicio actualizado", body: "Te asignaron para el 2026-10-04.", path: "/me" },
      },
    ]);
    expect(run.outboxUpserts.map((u) => [u.doc._type, u.doc.memberId, u.doc.notifyAfter])).toEqual([
      ["notificationOutbox", "mem-ana", expect.any(String)],
      ["notificationOutbox", "mem-luis", expect.any(String)],
    ]);
    expect(run.outboxUpserts[0].patchSet).toMatchObject({ status: "pending", servedRecipients: [] });
    expect(run.outboxUpserts[0].doc.firstQueuedAt).toBe("2026-09-24T18:00:00.000Z");
    expect(run.sweeps).toBe(1);
    expect(run.transactions).toEqual([]);
  });

  it("makes nextKey deterministic, restarting per run", async () => {
    const first = await t.run(OPTIONS, async () => [nextKey(), nextKey()]);
    const second = await t.run(OPTIONS, async () => [nextKey()]);
    expect(first.response).toEqual(["key-1", "key-2"]);
    expect(second.response).toEqual(["key-1"]);
  });

  it("refuses and records a query the table does not know, a wrong client, and any serverClient read", async () => {
    const run = await t.run(OPTIONS, async () => {
      const outcomes = await Promise.allSettled([
        operationalClient.fetch(`*[_type == "anything"]`),
        operationalClient.fetch(rawRoleDraftForBaseQuery("x").query, rawRoleDraftForBaseQuery("x").params),
        serverClient.fetch(`*[_type == "teamMembers"]`),
      ]);
      return outcomes.map((o) => o.status);
    });
    expect(run.response).toEqual(["rejected", "rejected", "rejected"]);
    expect(run.refusedReads).toHaveLength(3);
    expect(run.refusedReads[1]).toContain("role draft by base id read on the operational client");
  });

  it("serves a known read from the store, as a copy the caller cannot use to edit the store", async () => {
    const run = await t.run(OPTIONS, async () => {
      const bound = canonicalRoleByIdQuery("role-sun-1004");
      const rows = (await operationalClient.fetch(bound.query, bound.params)) as Record<string, unknown>[];
      rows[0].published = "edited";
      return rows;
    });
    expect(run.response).toHaveLength(1);
    expect(roleIn(run.store, "role-sun-1004").published).toBe(true);
    expect(run.reads).toEqual([
      { client: "operational", label: "role by id", params: { roleTypes: [...ROLE_TYPES], id: "role-sun-1004" } },
    ]);
  });
});
