// `unpublish_service` (P3 step 8): registration, schema, twin-run parity with
// the admin route, and refusal replay — every domain refusal code the writer
// can produce, relayed through `refusalFor` exactly as the route's own JSON
// would read.
//
// The twin harness (`../writes/__tests__/twinRun.ts`) runs the real admin
// route handler and this tool's own result function over ONE fixture
// definition, each on its own fresh store, answered by the real canonical
// query builders. `unpublish_service` makes no admission read of its own — its
// whole pre-domain step is the strict schema — so the query table is exactly
// `unpublishRoles`'s own reads.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const t = await vi.hoisted(async () => {
  const { createTwinHarness } = await import("../../writes/__tests__/twinRun");
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

import { POST as unpublishPOST } from "@/app/api/admin/roles/unpublish/route";
import { buildClaimedLock, roleTargetLockId } from "@/app/utils/roleTargetLock";
import { ROLE_TYPES, roleTargetKey } from "@/app/utils/serviceReadModel";
import {
  canonicalRoleByIdQuery,
  canonicalSpecialRolesForDateQuery,
  canonicalWeekendRolesForTargetQuery,
  rawRoleDraftForBaseQuery,
  rawRoleDraftsForTargetQuery,
  rawSpecialRoleDraftsForDateQuery,
  roleTargetLocksByIdsQuery,
} from "@/app/utils/serviceReadQueries";
import {
  canonicalDocs,
  draftDocs,
  parityView,
  project,
  TWIN_FROZEN_INSTANT,
  type TwinDoc,
  type TwinQuery,
  type TwinStore,
} from "../../writes/__tests__/twinRun";
import {
  BOOTSTRAP_COMPLETED_RELOAD_MESSAGE,
  NOTHING_WRITTEN,
  STALE_COPY,
} from "../../writes/refusals";
import { WRITE_UNKNOWN_OUTCOME_MESSAGE } from "../../writes/runWriteTool";
import {
  UNPUBLISH_SERVICE_INPUT,
  registerUnpublishService,
  unpublishServiceResult,
} from "../unpublishService";

// ── The fixture: one definition, a fresh store per run ──────────────────────

const ROLE_FIELDS = [
  "_id", "_rev", "_type", "published", "week", "date", "service_name", "time", "format",
  "creationReceiptId", "creationFingerprint", "Lead", "BGVs", "Chorus", "instruments", "foh_team", "songs",
] as const;
const LOCK_FIELDS = ["_id", "_rev", "_type", "targetKey", "state", "roleId", "roleType", "date", "claimNonce", "generation"] as const;

function sunday(id: string, week: string, published: boolean): TwinDoc {
  return {
    _id: id,
    _rev: `${id}-rev`,
    _type: "sunday_role",
    week,
    published,
    Lead: [],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
  };
}

function lockFor(role: TwinDoc, ownerId: string = String(role._id)): TwinDoc {
  const targetKey = roleTargetKey(role) as string;
  const lock = buildClaimedLock({ targetKey, roleId: ownerId, claimNonce: "n1", now: "2026-09-01T00:00:00.000Z" });
  if (!lock) throw new Error("fixture: no lock for " + role._id);
  return { ...lock, _rev: `${lock._id}-rev` };
}

/** A raw `drafts.*` overlay of `baseId`, occupying no target on its own. */
function draftOverlay(baseId: string): TwinDoc {
  return { _id: `drafts.${baseId}`, _rev: `drafts.${baseId}-rev`, _type: "sunday_role", week: "2099-01-01", published: false };
}

const LIVE = sunday("role-sun-1004", "2026-10-04", true);
const DRAFT = sunday("role-sun-1011", "2026-10-11", false);
const DUP_A = sunday("role-sun-2101-a", "2026-11-01", true);
const DUP_B = sunday("role-sun-2101-b", "2026-11-01", true);
const DRAFT_OVERLAY_TARGET = sunday("role-sun-2108", "2026-11-08", true);
const WRONG_OWNER_TARGET = sunday("role-sun-2115", "2026-11-15", true);
const NO_LOCK_TARGET = sunday("role-sun-2206", "2026-12-06", true);

function fixture(): TwinDoc[] {
  return [
    LIVE,
    lockFor(LIVE),
    DRAFT,
    lockFor(DRAFT),
    DUP_A,
    DUP_B,
    DRAFT_OVERLAY_TARGET,
    lockFor(DRAFT_OVERLAY_TARGET),
    draftOverlay("role-sun-2108"),
    WRONG_OWNER_TARGET,
    lockFor(WRONG_OWNER_TARGET, "role-someone-elses"),
    NO_LOCK_TARGET,
    // NO_LOCK_TARGET deliberately has no roleTargetLock document: its target
    // is bootstrap-eligible.
  ];
}

const roleRow = (doc: TwinDoc) => project(doc, ROLE_FIELDS);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Every read `unpublishRoles` makes, keyed by the builders' own query text. */
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

function roleIn(store: TwinStore, id: string): TwinDoc {
  const doc = store.docs.get(id);
  if (!doc) throw new Error(`no ${id}`);
  return doc;
}

function call(serviceId: string, rev: string) {
  return () => unpublishServiceResult({ serviceId, rev });
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Registration and schema ──────────────────────────────────────────────────

describe("registerUnpublishService", () => {
  it("registers unpublish_service with the write-tool annotations and a strict schema", () => {
    const registered: { name: string; config: Record<string, unknown> }[] = [];
    const server = {
      registerTool: (name: string, config: Record<string, unknown>) => {
        registered.push({ name, config });
      },
    };
    registerUnpublishService(server as never);
    expect(registered).toHaveLength(1);
    const [{ name, config }] = registered;
    expect(name).toBe("unpublish_service");
    expect(config.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(config.inputSchema).toBe(UNPUBLISH_SERVICE_INPUT);
    expect(typeof config.title).toBe("string");
    expect(typeof config.description).toBe("string");
    expect((config.description as string).length).toBeGreaterThan(0);
  });
});

describe("UNPUBLISH_SERVICE_INPUT", () => {
  it("accepts exactly { serviceId, rev }", () => {
    expect(UNPUBLISH_SERVICE_INPUT.safeParse({ serviceId: "role-sun-1004", rev: "role-sun-1004-rev" }).success).toBe(
      true,
    );
  });

  it("rejects an unknown field", () => {
    expect(
      UNPUBLISH_SERVICE_INPUT.safeParse({ serviceId: "role-sun-1004", rev: "role-sun-1004-rev", mode: "recover" })
        .success,
    ).toBe(false);
    expect(
      UNPUBLISH_SERVICE_INPUT.safeParse({
        serviceId: "role-sun-1004",
        rev: "role-sun-1004-rev",
        acknowledgedBlockers: [],
      }).success,
    ).toBe(false);
  });

  it("rejects a missing rev, a missing serviceId, and either as an empty string", () => {
    expect(UNPUBLISH_SERVICE_INPUT.safeParse({ serviceId: "role-sun-1004" }).success).toBe(false);
    expect(UNPUBLISH_SERVICE_INPUT.safeParse({ rev: "role-sun-1004-rev" }).success).toBe(false);
    expect(UNPUBLISH_SERVICE_INPUT.safeParse({ serviceId: "", rev: "role-sun-1004-rev" }).success).toBe(false);
    expect(UNPUBLISH_SERVICE_INPUT.safeParse({ serviceId: "role-sun-1004", rev: "" }).success).toBe(false);
  });
});

// ── Twin runs: route and tool over one fixture ──────────────────────────────

describe("twin: the admin unpublish route and unpublish_service", () => {
  it("published -> draft: identical transaction, revalidation and response shape", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-1004", rev: "role-sun-1004-rev" }] } },
      call("role-sun-1004", "role-sun-1004-rev"),
    );
    expect(route.refusedReads).toEqual([]);
    expect(tool.refusedReads).toEqual([]);

    expect(route.response).toEqual({
      status: 200,
      body: { ok: true, unpublished: 1, services: [{ id: "role-sun-1004" }] },
    });
    expect(tool.response.isError).toBeUndefined();
    expect(tool.response.structuredContent).toEqual({
      ok: true,
      serviceId: "role-sun-1004",
      changed: true,
      published: "draft",
      notifications: [],
    });
    expect(tool.response.content).toEqual([
      { type: "text", text: "Servicio oculto. Nadie recibe aviso; /schedule y /me se actualizan." },
    ]);

    expect(parityView(tool)).toEqual(parityView(route));
    expect(route.transactions).toHaveLength(1);
    expect(roleIn(tool.store, "role-sun-1004").published).toBe(false);
    expect(route.pushes).toEqual([]);
    expect(route.outboxUpserts).toEqual([]);
  });

  it("the already-draft no-op: neither run writes, and the tool's text is NOT success wording", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-1011", rev: "role-sun-1011-rev" }] } },
      call("role-sun-1011", "role-sun-1011-rev"),
    );
    expect(route.response).toMatchObject({ status: 200, body: { unpublished: 0 } });
    expect(tool.response.structuredContent).toEqual({
      ok: true,
      serviceId: "role-sun-1011",
      changed: false,
      published: "draft",
      notifications: [],
    });
    expect(tool.response.content).toEqual([
      { type: "text", text: "Ya estaba oculto: el servicio ya era un borrador. No se cambió nada." },
    ]);
    // U1: no refresh is mentioned, and the changed:true sentence's wording never appears.
    expect((tool.response.content[0] as { text: string }).text).not.toContain("Servicio oculto");
    expect((tool.response.content[0] as { text: string }).text).not.toMatch(/schedule|\/me/);
    expect(parityView(tool)).toEqual(parityView(route));
    expect(route.transactions).toEqual([]);
    expect(route.revalidations).toEqual([]);
  });
});

// ── Refusal replay ───────────────────────────────────────────────────────────

describe("unpublish_service — refusal replay", () => {
  it("not_found: a serviceId that resolves to nothing, zero transactions", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-nope-0000", rev: "whatever" }] } },
      call("role-nope-0000", "whatever"),
    );
    expect(route.response).toMatchObject({ status: 404 });
    expect(tool.response.structuredContent).toEqual({ refused: true, code: "not_found" });
    expect((tool.response.content as { text: string }[])[0].text).toBe(
      `El servicio no existe; vuelve a buscarlo con list_services. ${NOTHING_WRITTEN}`,
    );
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("stale_revision: the observed rev no longer matches, zero transactions", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-1004", rev: "someone-elses-rev" }] } },
      call("role-sun-1004", "someone-elses-rev"),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "stale_revision" } });
    expect(tool.response.structuredContent).toEqual({ refused: true, code: "stale_revision" });
    expect((tool.response.content as { text: string }[])[0].text).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("ambiguous_target: a duplicate canonical role at the same weekend target, zero transactions", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-2101-a", rev: "role-sun-2101-a-rev" }] } },
      call("role-sun-2101-a", "role-sun-2101-a-rev"),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "ambiguous_target" } });
    expect(tool.response.structuredContent).toEqual({ refused: true, code: "ambiguous_target" });
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("integrity_conflict — a raw draft overlay of the role's own id, zero transactions", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-2108", rev: "role-sun-2108-rev" }] } },
      call("role-sun-2108", "role-sun-2108-rev"),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "integrity_conflict" } });
    expect(tool.response.structuredContent).toEqual({ refused: true, code: "integrity_conflict" });
    expect((tool.response.content as { text: string }[])[0].text).toContain("borrador de Studio");
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("integrity_conflict — the weekend token is owned by another role, zero transactions", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-2115", rev: "role-sun-2115-rev" }] } },
      call("role-sun-2115", "role-sun-2115-rev"),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "integrity_conflict" } });
    expect(tool.response.structuredContent).toEqual({
      refused: true,
      code: "integrity_conflict",
      detail: "lock_wrong_owner",
    });
    expect((tool.response.content as { text: string }[])[0].text).toContain("pertenece a otro servicio");
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("a retry with the rev the first call already consumed is stale_revision, not the no-op", async () => {
    const first = await t.runTool(OPTIONS, call("role-sun-1004", "role-sun-1004-rev"));
    expect(first.response.structuredContent).toEqual({
      ok: true,
      serviceId: "role-sun-1004",
      changed: true,
      published: "draft",
      notifications: [],
    });

    const retry = await t.runTool(
      { ...OPTIONS, fixture: () => [...first.store.docs.values()] as TwinDoc[] },
      call("role-sun-1004", "role-sun-1004-rev"),
    );
    expect(retry.response.structuredContent).toEqual({ refused: true, code: "stale_revision" });
    expect((retry.response.content as { text: string }[])[0].text).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
    expect(retry.transactions).toEqual([]);
  });

  it("bootstrap_completed_reload: a legacy weekend target with no lock document commits the bootstrap, not the unpublish", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: unpublishPOST, body: { roles: [{ id: "role-sun-2206", rev: "role-sun-2206-rev" }] } },
      call("role-sun-2206", "role-sun-2206-rev"),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "bootstrap_completed_reload" } });
    expect(tool.response.structuredContent).toEqual({ refused: true, code: "bootstrap_completed_reload" });
    expect((tool.response.content as { text: string }[])[0].text).toBe(BOOTSTRAP_COMPLETED_RELOAD_MESSAGE);

    // The maintenance write committed (`randomUUID`'s claimNonce is not
    // deterministic, so compare everything else and check the nonce shape).
    for (const run of [route, tool]) {
      expect(run.transactions).toHaveLength(1);
      const ops = run.transactions[0];
      expect(ops).toHaveLength(2);
      const patch = ops.find((op) => op.kind === "patch");
      expect(patch).toMatchObject({ kind: "patch", id: "role-sun-2206", ifRevisionId: "role-sun-2206-rev" });
      // The date field is heartbeated to its own unchanged value — never `published`.
      expect(patch && "set" in patch ? patch.set : {}).not.toHaveProperty("published");
      const create = ops.find((op) => op.kind === "create");
      expect(create).toBeDefined();
      const lockDoc = create && "doc" in create ? (create.doc as Record<string, unknown>) : {};
      expect(lockDoc).toMatchObject({
        _type: "roleTargetLock",
        _id: roleTargetLockId(roleTargetKey(NO_LOCK_TARGET) as string),
        state: "claimed",
        roleId: "role-sun-2206",
        generation: 0,
        createdAt: TWIN_FROZEN_INSTANT,
        updatedAt: TWIN_FROZEN_INSTANT,
      });
      expect(typeof lockDoc.claimNonce).toBe("string");
      expect((lockDoc.claimNonce as string).length).toBeGreaterThan(0);
      // No published:false patch anywhere — the business write never ran.
      expect(roleIn(run.store, "role-sun-2206").published).toBe(true);
    }
  });

  it("a commit that fails for another reason is the unknown outcome, never «No se escribió nada.»", async () => {
    const run = await t.runTool(
      { ...OPTIONS, failFirstCommit: Object.assign(new Error("socket hang up token=abc"), { statusCode: 502 }) },
      call("role-sun-1004", "role-sun-1004-rev"),
    );
    expect(run.response.content).toEqual([{ type: "text", text: WRITE_UNKNOWN_OUTCOME_MESSAGE }]);
    expect(run.response.structuredContent).toBeUndefined();
    expect(run.transactions).toEqual([]);
    expect(JSON.stringify(run.response)).not.toContain("token=abc");
  });

  it("`unexpected_type` is unreachable through the real loader: a foreign _type at the target id resolves as not_found, not as integrity_conflict", async () => {
    // The query that resolves `serviceId` already filters `_type in $roleTypes`
    // (ROLE_TYPES === the writer's own PUBLISHABLE_TYPES), so a document of any
    // other type never reaches the writer's own `unexpected_type` guard — it
    // reads as though the id does not exist. The copy for `unexpected_type` is
    // still covered directly in `refusals.test.ts`.
    const foreignType: TwinDoc = { _id: "role-sun-1004", _rev: "role-sun-1004-rev", _type: "teamMembers" };
    const run = await t.runTool(
      { fixture: () => [foreignType], queries: UNPUBLISH_QUERIES },
      call("role-sun-1004", "role-sun-1004-rev"),
    );
    expect(run.response.structuredContent).toEqual({ refused: true, code: "not_found" });
    expect(ROLE_TYPES as readonly string[]).not.toContain("teamMembers");
    expect(run.transactions).toEqual([]);
  });
});
