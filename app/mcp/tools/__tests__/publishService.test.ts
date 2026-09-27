// `publish_service` (P3 step 9): registration, schema, the no-override pin,
// twin-run parity with the admin route (a ready special AND a ready weekend
// service), refusal replay, and the I4 agreement test — what `get_service`
// reports as blocking a publish equals what `publish_service` refuses on,
// across P1's whole fixture matrix.
//
// The twin harness (`../writes/__tests__/twinRun.ts`) runs the real admin route
// handler and this tool's own result function over ONE fixture definition, each
// on its own fresh store, answered by the real canonical query builders.
// `publish_service` makes no admission READ of its own beyond the two shape
// predicates it re-checks itself — it RELOADS the five A1 read domains inside
// `publishReady`, exactly as `loadServiceReadinessSources()` does — so the query
// table below is that reload's own eight reads, and nothing else: unlike
// `unpublish_service`, there is no per-role lookup query, because the writer
// recomputes the whole catalogue once regardless of batch size.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";

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

import { POST as publishReadyPOST } from "@/app/api/admin/roles/publish-ready/route";
import { buildClaimedLock } from "@/app/utils/roleTargetLock";
import { ROLE_TYPES, SETLIST_TYPES, roleTargetKey } from "@/app/utils/serviceReadModel";
import {
  allRoleTargetLocksQuery,
  canonicalMembersByIdsQuery,
  canonicalProposalsQuery,
  canonicalRolesQuery,
  canonicalSetlistsForWeeksQuery,
  canonicalSetlistsQuery,
  rawProposalDraftsQuery,
  rawRoleDraftsQuery,
  rawSetlistDraftsQuery,
} from "@/app/utils/serviceReadQueries";
import {
  canonicalDocs,
  draftDocs,
  parityView,
  project,
  type TwinDoc,
  type TwinQuery,
  type TwinStore,
} from "../../writes/__tests__/twinRun";
import { NOTHING_WRITTEN, PUBLISH_OVERRIDE_NOTE, STALE_COPY } from "../../writes/refusals";
import { WRITE_UNKNOWN_OUTCOME_MESSAGE } from "../../writes/runWriteTool";
import { assembleService } from "@/app/utils/publishReadyBundle";
import { loadServiceSnapshot } from "../../reads/serviceSnapshot";
import { publishRefusalFor, type PublishRefusal } from "../../reads/publishRefusal";
import { SERVICE_FIXTURE_CASES, SERVICE_FIXTURE_ROLE_IDS } from "../../reads/__tests__/serviceFixtures";
import { readToolStore } from "../../reads/__tests__/readToolFixtures";
import {
  PUBLISH_SERVICE_INPUT,
  publishServiceBody,
  publishServiceResult,
  registerPublishService,
} from "../publishService";

// ── Field projections (mirrors the real GROQ projections — ADR-0040) ────────

const ROLE_FIELDS = [
  "_id", "_rev", "_type", "published", "week", "date", "service_name", "time", "format",
  "creationReceiptId", "creationFingerprint", "Lead", "BGVs", "Chorus", "instruments", "foh_team", "songs",
] as const;
const LOCK_FIELDS = ["_id", "_rev", "_type", "targetKey", "state", "roleId", "roleType", "date", "claimNonce", "generation"] as const;
const SETLIST_FIELDS = ["_id", "_rev", "_type", "week", "songs"] as const;
const PROPOSAL_FIELDS = [
  "_id", "_rev", "_createdAt", "service_type", "service_ref", "service_date", "status", "songs",
  "contributors", "lead", "lead_notes", "team_notes", "admin_notes", "messages", "approval_receipt", "last_transition",
] as const;
const MEMBER_FIELDS = ["_id", "_rev", "member_name", "alias", "unavailableDates", "unavailabilityNotes"] as const;

const roleRow = (doc: TwinDoc) => project(doc, ROLE_FIELDS);
const lockRow = (doc: TwinDoc) => project(doc, LOCK_FIELDS);
const setlistRow = (doc: TwinDoc) => project(doc, SETLIST_FIELDS);
const proposalRow = (doc: TwinDoc) => project(doc, PROPOSAL_FIELDS);
const memberRow = (doc: TwinDoc) => project(doc, MEMBER_FIELDS);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * The eight reads `loadServiceReadinessSources()` issues (`publishReadyBundle.ts`)
 * and `loadServiceSnapshot()` mirrors byte-for-byte (ADR-0040, D1) — the SAME
 * table answers both the writer's reload and the read tool's own snapshot, which
 * is exactly the wiring the I4 test below proves. There is no per-role query:
 * the reload is one fixed set of reads regardless of how many roles are named.
 */
const PUBLISH_QUERIES: TwinQuery[] = [
  {
    label: "canonical roles",
    client: "operational",
    bound: canonicalRolesQuery(),
    rows: (store) => canonicalDocs(store, ROLE_TYPES).map(roleRow),
  },
  {
    label: "raw role drafts",
    client: "raw",
    bound: rawRoleDraftsQuery(),
    rows: (store) => draftDocs(store, ROLE_TYPES).map(roleRow),
  },
  {
    label: "role target locks",
    client: "operational",
    bound: allRoleTargetLocksQuery(),
    rows: (store) => canonicalDocs(store, ["roleTargetLock"]).map(lockRow),
  },
  {
    label: "canonical setlists",
    client: "operational",
    bound: canonicalSetlistsQuery(),
    rows: (store) => canonicalDocs(store, SETLIST_TYPES).map(setlistRow),
  },
  {
    label: "raw setlist drafts",
    client: "raw",
    bound: rawSetlistDraftsQuery(),
    rows: (store) => draftDocs(store, SETLIST_TYPES).map(setlistRow),
  },
  {
    label: "canonical proposals",
    client: "operational",
    bound: canonicalProposalsQuery(),
    rows: (store) => canonicalDocs(store, ["setlistProposal"]).map(proposalRow),
  },
  {
    label: "raw proposal drafts",
    client: "raw",
    bound: rawProposalDraftsQuery(),
    rows: (store) => draftDocs(store, ["setlistProposal"]).map(proposalRow),
  },
  {
    label: "members by id",
    client: "operational",
    bound: canonicalMembersByIdsQuery([]),
    rows: (store, p) =>
      canonicalDocs(store, ["teamMembers"]).filter((d) => strings(p.ids).includes(d._id)).map(memberRow),
  },
  // Not one of the eight reload reads: `queuePublishedSetlistNotices`'s
  // deferred `after()` block issues this ONE extra read, for weekend roles
  // only, to decide whether «Setlist listo» is actually due (a special's songs
  // are its own role row, so no read is needed there).
  {
    label: "canonical setlists for weeks (post-commit hasSongs check)",
    client: "operational",
    bound: canonicalSetlistsForWeeksQuery([]),
    rows: (store, p) =>
      canonicalDocs(store, SETLIST_TYPES).filter((d) => strings(p.weeks).includes(d.week as string)).map(setlistRow),
  },
];

// ── The local fixture: one small, self-contained store ─────────────────────
//
// Deliberately NOT `serviceFixtures.ts`/`readToolFixtures.ts` for the happy-path
// and refusal-replay cases below — those stay P1's own (ruling P3-R2). The I4
// agreement test, further down, is the one place this file reads P1's matrix.

const ref = (key: string, id: string) => ({ _key: key, _type: "reference", _ref: id });
const songRow = (key: string, songId: string, playKey: string | null) => ({
  _key: key,
  play_key: playKey,
  medley_tag: null,
  song: { _type: "reference", _ref: songId },
  leads: null,
});

/**
 * A role fixture with every seat path defaulted to `[]` (never the `project()`
 * default of `null`, which the readiness summary reads as a STRUCTURALLY
 * INVALID record — the same rule `serviceFixtures.ts`'s own `role()` builder
 * exists for).
 */
function role(over: TwinDoc): TwinDoc {
  return { Lead: [], BGVs: [], Chorus: [], instruments: [], foh_team: [], ...over };
}

function lockFor(role: TwinDoc, ownerId: string = String(role._id)): TwinDoc {
  const targetKey = roleTargetKey(role) as string;
  const lock = buildClaimedLock({ targetKey, roleId: ownerId, claimNonce: "n1", now: "2027-01-01T00:00:00.000Z" });
  if (!lock) throw new Error("fixture: no lock for " + role._id);
  return { ...lock, _rev: `${lock._id}-rev` };
}

const MEM_A = "mem-a";

const READY_SPECIAL: TwinDoc = role({
  _id: "role-sp-ready",
  _rev: "role-sp-ready-rev",
  _type: "special_role",
  date: "2027-03-07",
  service_name: "Listo",
  published: false,
  Lead: [ref("l1", MEM_A)],
  songs: [songRow("r1", "song-x", "G")],
});

const READY_SUNDAY: TwinDoc = role({
  _id: "role-sun-ready",
  _rev: "role-sun-ready-rev",
  _type: "sunday_role",
  week: "2027-03-14",
  published: false,
  Lead: [ref("l1", MEM_A)],
});
const READY_SUNDAY_SETLIST: TwinDoc = {
  _id: "set-sun-ready",
  _rev: "set-sun-ready-rev",
  _type: "featuredSongs",
  week: "2027-03-14",
  songs: [songRow("r1", "song-y", "A")],
};

const LIVE_CLEAN: TwinDoc = role({
  _id: "role-sun-live",
  _rev: "role-sun-live-rev",
  _type: "sunday_role",
  week: "2027-03-21",
  published: true,
  Lead: [ref("l1", MEM_A)],
});
const LIVE_CLEAN_SETLIST: TwinDoc = {
  _id: "set-sun-live",
  _rev: "set-sun-live-rev",
  _type: "featuredSongs",
  week: "2027-03-21",
  songs: [songRow("r1", "song-z", "C")],
};

// A hard integrity blocker (dangling assignment) which also makes the
// observation itself unusable — both `hard_integrity_blocker` and
// `unusable_observation` fire together here, exactly as the P1 matrix's own
// duplicate-target pair combines `hard_integrity_blocker` with `not_ready`.
const DANGLING: TwinDoc = role({
  _id: "role-sun-dangling",
  _rev: "role-sun-dangling-rev",
  _type: "sunday_role",
  week: "2027-03-28",
  published: false,
  Lead: [ref("l1", MEM_A)],
  BGVs: [ref("b1", "mem-ghost")],
});
const DANGLING_SETLIST: TwinDoc = {
  _id: "set-sun-dangling",
  _rev: "set-sun-dangling-rev",
  _type: "featuredSongs",
  week: "2027-03-28",
  songs: [songRow("r1", "song-w", "D")],
};

// An empty team, otherwise clean: `not_ready` (workflow: team_empty) ALONE, no
// hard blocker — the top-level code is `stale_revision` (F10), and the text
// must read as the blocker, never as "re-read and retry".
const EMPTY_TEAM: TwinDoc = role({
  _id: "role-sp-emptyteam",
  _rev: "role-sp-emptyteam-rev",
  _type: "special_role",
  date: "2027-04-04",
  service_name: "Sin equipo",
  published: false,
  Lead: [],
  songs: [songRow("r1", "song-v", "E")],
});

const MEMBER_A: TwinDoc = {
  _id: MEM_A,
  _rev: `${MEM_A}-rev`,
  _type: "teamMembers",
  member_name: "Ana",
  alias: null,
  unavailableDates: null,
  unavailabilityNotes: null,
};

function fixture(): TwinDoc[] {
  return [
    READY_SPECIAL,
    READY_SUNDAY,
    lockFor(READY_SUNDAY),
    READY_SUNDAY_SETLIST,
    LIVE_CLEAN,
    lockFor(LIVE_CLEAN),
    LIVE_CLEAN_SETLIST,
    DANGLING,
    lockFor(DANGLING),
    DANGLING_SETLIST,
    EMPTY_TEAM,
    MEMBER_A,
  ];
}

const OPTIONS = { fixture, queries: PUBLISH_QUERIES };

// ── The residual fixture (P3-R2): its OWN store, never P1's ────────────────
//
// A service that PASSES readiness (so `get_service` reports `passesNow: true`)
// but whose one assigned member is stored with an empty `_rev` — a shape
// `publishVerdict` never inspects (member revisions are a WRITE-side concern,
// asserted only when `buildPublishAssertion` plans the guard bundle,
// `publishReadyTransaction.ts`'s `revisioned()`). The read and the write
// therefore disagree by construction (ADR-0040's amendment; step 5).
const RESIDUAL_ROLE: TwinDoc = role({
  _id: "role-sp-residual",
  _rev: "role-sp-residual-rev",
  _type: "special_role",
  date: "2027-05-02",
  service_name: "Residual #97",
  published: false,
  Lead: [ref("l1", "mem-emptyrev")],
  songs: [songRow("r1", "song-residual", "G")],
});
const RESIDUAL_MEMBER: TwinDoc = {
  _id: "mem-emptyrev",
  _rev: "",
  _type: "teamMembers",
  member_name: "Sin revisión",
  alias: null,
  unavailableDates: null,
  unavailabilityNotes: null,
};
const RESIDUAL_OPTIONS = { fixture: () => [RESIDUAL_ROLE, RESIDUAL_MEMBER], queries: PUBLISH_QUERIES };

function roleIn(store: TwinStore, id: string): TwinDoc {
  const doc = store.docs.get(id);
  if (!doc) throw new Error(`no ${id}`);
  return doc;
}

function call(serviceId: string, rev: string) {
  return () => publishServiceResult({ serviceId, rev });
}

async function readSideAnswer(options: typeof OPTIONS, id: string): Promise<PublishRefusal> {
  const run = await t.run(options, async () => {
    const snapshot = await loadServiceSnapshot();
    return publishRefusalFor(assembleService(snapshot.readiness, id));
  });
  expect(run.refusedReads).toEqual([]);
  return run.response;
}

/** The refusal reason codes this tool's own result names, in the writer's own vocabulary. */
function toolRefusalCodes(result: CallToolResult): string[] {
  const sc = result.structuredContent as
    | { refused?: boolean; code?: string; services?: { reasons: string[] }[] }
    | undefined;
  if (!sc?.refused) return [];
  if (Array.isArray(sc.services) && sc.services.length === 1) return sc.services[0].reasons;
  return sc.code ? [sc.code] : [];
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

describe("registerPublishService", () => {
  it("registers publish_service with the write-tool annotations and a strict schema", () => {
    const registered: { name: string; config: Record<string, unknown> }[] = [];
    const server = {
      registerTool: (name: string, config: Record<string, unknown>) => {
        registered.push({ name, config });
      },
    };
    registerPublishService(server as never);
    expect(registered).toHaveLength(1);
    const [{ name, config }] = registered;
    expect(name).toBe("publish_service");
    expect(config.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(config.inputSchema).toBe(PUBLISH_SERVICE_INPUT);
    expect(typeof config.title).toBe("string");
    expect(typeof config.description).toBe("string");
    expect((config.description as string).length).toBeGreaterThan(0);
  });
});

describe("PUBLISH_SERVICE_INPUT", () => {
  it("accepts exactly { serviceId, rev }", () => {
    expect(PUBLISH_SERVICE_INPUT.safeParse({ serviceId: "role-sun-1004", rev: "role-sun-1004-rev" }).success).toBe(
      true,
    );
  });

  it("rejects mode, acknowledgedBlockers and roles — no override is expressible", () => {
    const base = { serviceId: "role-sun-1004", rev: "role-sun-1004-rev" };
    expect(PUBLISH_SERVICE_INPUT.safeParse({ ...base, mode: "override" }).success).toBe(false);
    expect(PUBLISH_SERVICE_INPUT.safeParse({ ...base, mode: "ready" }).success).toBe(false);
    expect(PUBLISH_SERVICE_INPUT.safeParse({ ...base, acknowledgedBlockers: [] }).success).toBe(false);
    expect(PUBLISH_SERVICE_INPUT.safeParse({ ...base, roles: [base] }).success).toBe(false);
  });

  it("rejects a missing rev, a missing serviceId, and either as an empty string", () => {
    expect(PUBLISH_SERVICE_INPUT.safeParse({ serviceId: "role-sun-1004" }).success).toBe(false);
    expect(PUBLISH_SERVICE_INPUT.safeParse({ rev: "role-sun-1004-rev" }).success).toBe(false);
    expect(PUBLISH_SERVICE_INPUT.safeParse({ serviceId: "", rev: "role-sun-1004-rev" }).success).toBe(false);
    expect(PUBLISH_SERVICE_INPUT.safeParse({ serviceId: "role-sun-1004", rev: "" }).success).toBe(false);
  });

  it("rejects a serviceId that is a drafts.* overlay id, with the get_service-pointing message", () => {
    const result = PUBLISH_SERVICE_INPUT.safeParse({ serviceId: "drafts.role-sun-1004", rev: "role-sun-1004-rev" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "serviceId no es un id de servicio válido; usa el que devuelve get_service.",
      );
    }
  });

  it("rejects a rev containing whitespace, with the get_service-pointing message", () => {
    const result = PUBLISH_SERVICE_INPUT.safeParse({ serviceId: "role-sun-1004", rev: "a b" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("rev no es una revisión válida; usa la que devuelve get_service.");
    }
  });
});

describe("publishServiceBody — the no-override pin (I4 / roadmap 'expose no override')", () => {
  it("is exactly { mode: 'ready', roles: [{ id, rev }] } — never override, never recover, never acknowledgedBlockers", () => {
    const body = publishServiceBody({ serviceId: "role-sun-1004", rev: "role-sun-1004-rev" });
    expect(body).toEqual({ mode: "ready", roles: [{ id: "role-sun-1004", rev: "role-sun-1004-rev" }] });
    expect(JSON.stringify(body)).not.toContain("override");
    expect(JSON.stringify(body)).not.toContain("acknowledgedBlockers");
    expect(JSON.stringify(body)).not.toContain("recover");
  });
});

// ── Admission replay: malformed input never reaches the domain ─────────────

describe("publish_service — malformed input is refused before the domain call", () => {
  it("a drafts.* serviceId: zero domain calls, zero transactions", async () => {
    const run = await t.runTool(OPTIONS, call("drafts.role-sun-1004", "role-sun-1004-rev"));
    expect(run.response.structuredContent).toEqual({
      refused: true,
      code: "invalid_request",
      detail: "invalid_service_id",
    });
    expect(run.transactions).toEqual([]);
    expect(run.reads).toEqual([]);
  });

  it("a rev with whitespace: zero domain calls, zero transactions", async () => {
    const run = await t.runTool(OPTIONS, call("role-sun-1004", "role sun 1004 rev"));
    expect(run.response.structuredContent).toEqual({
      refused: true,
      code: "invalid_request",
      detail: "invalid_revision",
    });
    expect(run.transactions).toEqual([]);
    expect(run.reads).toEqual([]);
  });
});

// ── Twin runs: route and tool over one fixture ──────────────────────────────

describe("twin: the admin publish-ready route and publish_service", () => {
  it("a ready special: identical transaction, pushes, email batch, outbox upsert and revalidation", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: publishReadyPOST, body: { mode: "ready", roles: [{ id: "role-sp-ready", rev: "role-sp-ready-rev" }] } },
      call("role-sp-ready", "role-sp-ready-rev"),
    );
    expect(route.refusedReads).toEqual([]);
    expect(tool.refusedReads).toEqual([]);

    expect(route.response).toEqual({
      status: 200,
      body: { ok: true, mode: "ready", published: 1, services: [{ id: "role-sp-ready" }] },
    });
    expect(tool.response.isError).toBeUndefined();
    const sc = tool.response.structuredContent as { ok: true; serviceId: string; published: string; notifications: unknown[] };
    expect(sc.ok).toBe(true);
    expect(sc.serviceId).toBe("role-sp-ready");
    expect(sc.published).toBe("published");
    expect(sc.notifications).toHaveLength(3); // push + email + «Setlist listo»

    expect(parityView(tool)).toEqual(parityView(route));
    expect(route.transactions).toHaveLength(1);
    expect(route.outboxUpserts).toHaveLength(1);
    expect(route.sweeps).toBe(1);
    expect(route.revalidations).toEqual(["revalidatePath(/)", "revalidatePath(/schedule)", "revalidatePath(/me)"]);
    expect(roleIn(tool.store, "role-sp-ready").published).toBe(true);
  });

  it("a ready weekend service: identical transaction, pushes, email batch, outbox upsert and revalidation", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: publishReadyPOST, body: { mode: "ready", roles: [{ id: "role-sun-ready", rev: "role-sun-ready-rev" }] } },
      call("role-sun-ready", "role-sun-ready-rev"),
    );
    expect(route.refusedReads).toEqual([]);
    expect(tool.refusedReads).toEqual([]);

    expect(route.response).toMatchObject({ status: 200, body: { ok: true, published: 1 } });
    expect(tool.response.isError).toBeUndefined();
    const sc = tool.response.structuredContent as { ok: true; notifications: unknown[] };
    expect(sc.notifications).toHaveLength(3);

    expect(parityView(tool)).toEqual(parityView(route));
    expect(route.transactions).toHaveLength(1);
    expect(route.outboxUpserts).toHaveLength(1);
    expect(route.revalidations).toEqual(["revalidatePath(/)", "revalidatePath(/schedule)", "revalidatePath(/me)"]);
    expect(roleIn(tool.store, "role-sun-ready").published).toBe(true);
  });
});

// ── Refusal replay ───────────────────────────────────────────────────────────

describe("publish_service — refusal replay", () => {
  it("not_found: a serviceId that resolves to nothing, zero transactions", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: publishReadyPOST, body: { mode: "ready", roles: [{ id: "role-nope-0000", rev: "whatever" }] } },
      call("role-nope-0000", "whatever"),
    );
    expect(route.response).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(tool.response.structuredContent).toEqual({ refused: true, code: "not_found" });
    expect((tool.response.content as { text: string }[])[0].text).toBe(
      `El servicio no existe; vuelve a buscarlo con list_services. ${NOTHING_WRITTEN}`,
    );
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("hard_integrity_blocker + unusable_observation: a dangling assignment, with the override note, zero transactions", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: publishReadyPOST, body: { mode: "ready", roles: [{ id: "role-sun-dangling", rev: "role-sun-dangling-rev" }] } },
      call("role-sun-dangling", "role-sun-dangling-rev"),
    );
    expect(route.response).toMatchObject({ status: 409 });
    const sc = tool.response.structuredContent as { refused: true; code: string; services: { reasons: string[] }[] };
    expect(sc.services).toHaveLength(1);
    expect(sc.services[0].reasons).toContain("hard_integrity_blocker");
    expect(sc.services[0].reasons).toContain("unusable_observation");
    const text = (tool.response.content as { text: string }[])[0].text;
    expect(text).toContain(PUBLISH_OVERRIDE_NOTE);
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("already_published (alone): a live, otherwise-clean service, zero transactions", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: publishReadyPOST, body: { mode: "ready", roles: [{ id: "role-sun-live", rev: "role-sun-live-rev" }] } },
      call("role-sun-live", "role-sun-live-rev"),
    );
    expect(route.response).toMatchObject({ status: 409 });
    const sc = tool.response.structuredContent as { refused: true; services: { reasons: string[] }[] };
    expect(sc.services).toEqual([
      { id: "role-sun-live", reasons: ["already_published"], hardBlockers: [], workflowBlockers: [] },
    ]);
    const text = (tool.response.content as { text: string }[])[0].text;
    expect(text).toMatch(/^Ya está publicado\./);
    expect(text).not.toContain(PUBLISH_OVERRIDE_NOTE);
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("stale_revision (alone): the observed rev no longer matches an otherwise-ready service, zero transactions", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: publishReadyPOST, body: { mode: "ready", roles: [{ id: "role-sp-ready", rev: "someone-elses-rev" }] } },
      call("role-sp-ready", "someone-elses-rev"),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "stale_revision" } });
    const sc = tool.response.structuredContent as { refused: true; services: { reasons: string[] }[] };
    expect(sc.services).toEqual([
      { id: "role-sp-ready", reasons: ["stale_revision"], hardBlockers: [], workflowBlockers: [] },
    ]);
    const text = (tool.response.content as { text: string }[])[0].text;
    expect(text).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("not_ready (alone): an empty team, top-level stale_revision, copy is the blocker — never 're-read and retry'", async () => {
    const { route, tool } = await t.twin(
      OPTIONS,
      { handler: publishReadyPOST, body: { mode: "ready", roles: [{ id: "role-sp-emptyteam", rev: "role-sp-emptyteam-rev" }] } },
      call("role-sp-emptyteam", "role-sp-emptyteam-rev"),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "stale_revision" } });
    const sc = tool.response.structuredContent as { refused: true; code: string; services: { reasons: string[] }[] };
    expect(sc.code).toBe("stale_revision");
    expect(sc.services).toEqual([
      { id: "role-sp-emptyteam", reasons: ["not_ready"], hardBlockers: [], workflowBlockers: ["team_empty"] },
    ]);
    const text = (tool.response.content as { text: string }[])[0].text;
    expect(text).not.toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
    expect(text).not.toMatch(/vuelve a leer/);
    expect(text).toContain(PUBLISH_OVERRIDE_NOTE);
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
  });

  it("a commit conflict (details.guard): a concurrent edit lands between the reload and the commit", async () => {
    const race = (store: TwinStore) => {
      roleIn(store, "role-sun-ready")._rev = "moved-by-someone-else";
    };
    const { route, tool } = await t.twin(
      { ...OPTIONS, race },
      { handler: publishReadyPOST, body: { mode: "ready", roles: [{ id: "role-sun-ready", rev: "role-sun-ready-rev" }] } },
      call("role-sun-ready", "role-sun-ready-rev"),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "stale_revision" } });
    expect(tool.response.structuredContent).toEqual({
      refused: true,
      code: "stale_revision",
      detail: "publish_ready_assertions",
    });
    const text = (tool.response.content as { text: string }[])[0].text;
    expect(text).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
    expect(route.transactions).toEqual([]);
    expect(tool.transactions).toEqual([]);
    expect(route.revalidations).toEqual([]);
  });

  it("a retry with the rev the first call already consumed: already_published + stale_revision, top-level stale_revision, leads with «ya está publicado»", async () => {
    const first = await t.runTool(OPTIONS, call("role-sp-ready", "role-sp-ready-rev"));
    expect(first.response.isError).toBeUndefined();

    const retry = await t.runTool(
      { ...OPTIONS, fixture: () => [...first.store.docs.values()] as TwinDoc[] },
      call("role-sp-ready", "role-sp-ready-rev"),
    );
    const sc = retry.response.structuredContent as { refused: true; code: string; services: { reasons: string[] }[] };
    expect(sc.code).toBe("stale_revision");
    expect(sc.services).toEqual([
      { id: "role-sp-ready", reasons: ["already_published", "stale_revision"], hardBlockers: [], workflowBlockers: [] },
    ]);
    const text = (retry.response.content as { text: string }[])[0].text;
    expect(text).toMatch(/^Ya está publicado\./);
    expect(retry.transactions).toEqual([]);
  });

  it("a commit that fails for another reason is the unknown outcome, never «No se escribió nada.»", async () => {
    const run = await t.runTool(
      { ...OPTIONS, failFirstCommit: Object.assign(new Error("socket hang up token=abc"), { statusCode: 502 }) },
      call("role-sp-ready", "role-sp-ready-rev"),
    );
    expect(run.response.content).toEqual([{ type: "text", text: WRITE_UNKNOWN_OUTCOME_MESSAGE }]);
    expect(run.response.structuredContent).toBeUndefined();
    expect(run.transactions).toEqual([]);
    expect(JSON.stringify(run.response)).not.toContain("token=abc");
  });
});

// ── The assertion-stage residual (P3-R2, ADR-0040's amendment) ─────────────

describe("publish_service — the assertion-stage residual", () => {
  it("an assigned member stored with an empty _rev: get_service says passesNow: true, the tool refuses integrity_conflict with zero transactions", async () => {
    const mcp = await readSideAnswer(RESIDUAL_OPTIONS, "role-sp-residual");
    expect(mcp.ready).toBe(true);
    expect(mcp.refusals).toEqual([]);

    const tool = await t.runTool(RESIDUAL_OPTIONS, call("role-sp-residual", "role-sp-residual-rev"));
    expect(tool.response.structuredContent).toEqual({
      refused: true,
      code: "integrity_conflict",
      detail: "assertionIssues",
    });
    expect(tool.transactions).toEqual([]);
  });
});

// ── The I4 agreement test ────────────────────────────────────────────────────
//
// `get_service`'s `publishCheck.refusals` (`publishRefusalFor`, over
// `loadServiceSnapshot()`) equals `publish_service`'s own refusal codes, over
// EVERY id in P1's fixture matrix — `serviceFixtures.ts` plus the read-tool
// store in `readToolFixtures.ts` (`readToolStore()`, a superset, includes
// `role-sun-1129`, the #97 case) — plus an id that names no service. Both calls
// read the SAME store and use `rev = roleRev` from that same fixture, through
// the SAME eight-query table `PUBLISH_QUERIES` answers for both loaders (D1).
//
// This matrix holds NO assertion-stage-only failure: the one case where the
// read and the write disagree is the dedicated residual fixture above, kept
// out of this store on purpose (P3-R2).

type Row = Record<string, unknown> & { _id: unknown; _rev?: unknown };

function withType(rows: readonly Row[], type: string): TwinDoc[] {
  return rows.map((r) => ({ ...r, _type: type })) as TwinDoc[];
}

const READ_TOOL_STORE = readToolStore();
const MATRIX_FIXTURE_DOCS: TwinDoc[] = [
  ...(READ_TOOL_STORE.roles as unknown as TwinDoc[]),
  ...(READ_TOOL_STORE.locks as unknown as TwinDoc[]),
  ...withType(READ_TOOL_STORE.members as Row[], "teamMembers"),
  ...(READ_TOOL_STORE.setlists as unknown as TwinDoc[]),
  ...withType(READ_TOOL_STORE.proposals as Row[], "setlistProposal"),
  ...(READ_TOOL_STORE.rawRoleDrafts as unknown as TwinDoc[]),
  ...(READ_TOOL_STORE.rawSetlistDrafts as unknown as TwinDoc[]),
  ...withType(READ_TOOL_STORE.rawProposalDrafts as Row[], "setlistProposal"),
];
const MATRIX_OPTIONS = { fixture: () => MATRIX_FIXTURE_DOCS, queries: PUBLISH_QUERIES };

const MATRIX_IDS: readonly string[] = READ_TOOL_STORE.roles.map((r) => String(r._id));

function roleRevIn(id: string): string {
  const rev = READ_TOOL_STORE.roles.find((r) => r._id === id)?._rev;
  return typeof rev === "string" ? rev : "rev-of-a-missing-role";
}

describe("the I4 agreement test: publish_service refuses exactly what get_service reports as blocking", () => {
  it("covers every id in P1's fixture matrix (serviceFixtures.ts's own case list)", () => {
    expect(SERVICE_FIXTURE_ROLE_IDS.length).toBe(SERVICE_FIXTURE_CASES.length);
    expect(MATRIX_IDS).toEqual(expect.arrayContaining([...SERVICE_FIXTURE_ROLE_IDS]));
    expect(MATRIX_IDS).toContain("role-sun-1129"); // the #97 case
  });

  it.each([...MATRIX_IDS, "role-missing"].map((id) => [id]))("%s", async (id) => {
    const rev = roleRevIn(id);

    const mcp = await readSideAnswer(MATRIX_OPTIONS, id);
    const tool = await t.runTool(MATRIX_OPTIONS, call(id, rev));
    expect(tool.refusedReads).toEqual([]);

    expect(toolRefusalCodes(tool.response)).toEqual(mcp.refusals);
    expect(!tool.response.isError).toBe(mcp.ready);
    if (mcp.ready) {
      expect(tool.transactions).toHaveLength(1);
    } else {
      expect(tool.transactions).toEqual([]);
    }
  });
});
