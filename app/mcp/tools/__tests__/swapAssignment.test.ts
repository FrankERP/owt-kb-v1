// `swap_assignment` (P3 step 10): registration, schema, twin-run parity with the
// admin swap route, refusal replay (inherited AND mirror rows of § «Admin surface
// gates», S1–S4), and the report: what moved, the notifications, the orphaned
// worship-night leaders, the newly placed unavailable members and `freshRevs`.
//
// The twin harness (`../../writes/__tests__/twinRun.ts`) runs the real admin
// route handler and this tool's own result function over ONE fixture
// definition, each on its own fresh store, answered by the real canonical query
// builders. The tool reads more than the route: P1's catalogue snapshot and the
// two occupancy reads (its admission), then the read-back, the member lookup and
// the song titles (its report). One table answers every reader; parity is
// asserted on writes, notifications and revalidation, never on reads.
//
// A MIRROR row is refused by the tool BEFORE the domain: zero domain reads (no
// `role by id`, no `locks by id`) and zero transactions. Each mirror test also
// runs the route ALONE on the same fixture and records what it does — most of
// them commit, which is exactly the gap the mirror closes, so a later route fix
// shows up here as a changed assertion rather than silently.
//
// Dates are 2028, used by no other test file. A weekend role's `week` is a label
// here: nothing on either side checks the weekday.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

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

import { POST as swapPOST } from "@/app/api/admin/roles/swap/route";
import { buildClaimedLock, roleTargetLockId } from "@/app/utils/roleTargetLock";
import { ROLE_TYPES, SETLIST_TYPES, roleTargetKey } from "@/app/utils/serviceReadModel";
import { SEAT_PATHS, type SeatPath } from "@/app/utils/roleWriteRequest";
import {
  allRoleTargetLocksQuery,
  canonicalMembersByIdsQuery,
  canonicalProposalsQuery,
  canonicalRoleByIdQuery,
  canonicalRolesByIdsQuery,
  canonicalRolesQuery,
  canonicalSetlistsQuery,
  canonicalSpecialRolesForDateQuery,
  canonicalWeekendRolesForTargetQuery,
  rawProposalDraftsQuery,
  rawRoleDraftForBaseQuery,
  rawRoleDraftsForTargetQuery,
  rawRoleDraftsQuery,
  rawSetlistDraftsQuery,
  rawSpecialRoleDraftsForDateQuery,
  roleTargetLocksByIdsQuery,
} from "@/app/utils/serviceReadQueries";
import { songTitlesQuery } from "../../reads/songTitles";
import {
  canonicalDocs,
  draftDocs,
  parityView,
  project,
  TWIN_FROZEN_INSTANT,
  type TwinDoc,
  type TwinQuery,
  type TwinRun,
  type TwinRunOptions,
  type TwinStore,
} from "../../writes/__tests__/twinRun";
import { BOOTSTRAP_COMPLETED_RELOAD_MESSAGE, NOTHING_WRITTEN, STALE_COPY } from "../../writes/refusals";
import { WRITE_PRE_FAILURE_MESSAGE, WRITE_UNKNOWN_OUTCOME_MESSAGE } from "../../writes/runWriteTool";
import { OUTBOX_SWEEP_NOTE } from "../../writes/reports";
import { SWAP_SOURCES_UNREADY_TEXT } from "../../writes/swapAdmission";
import {
  READ_BACK_FAILED_TEXT,
  SECTION_PATH_MESSAGE,
  SONG_LEADS_ORPHANED_NOTE,
  SWAP_ASSIGNMENT_INPUT,
  TEAM_PATH_MESSAGE,
  registerSwapAssignment,
  swapAssignmentBody,
  swapAssignmentResult,
  type FreshRev,
  type OrphanedSongLeads,
  type SwapAssignmentArgs,
  type SwapServiceReport,
  type UnavailablePlacement,
} from "../swapAssignment";

// ── Projections (mirror the real GROQ projections — ADR-0040) ──────────────

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
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

type Rows = TwinQuery["rows"];

const ROWS: Record<string, Rows> = {
  "canonical roles": (store) => canonicalDocs(store, ROLE_TYPES).map(roleRow),
  "raw role drafts": (store) => draftDocs(store, ROLE_TYPES).map(roleRow),
  "role target locks": (store) => canonicalDocs(store, ["roleTargetLock"]).map(lockRow),
  "canonical setlists": (store) => canonicalDocs(store, SETLIST_TYPES).map((d) => project(d, SETLIST_FIELDS)),
  "raw setlist drafts": (store) => draftDocs(store, SETLIST_TYPES).map((d) => project(d, SETLIST_FIELDS)),
  "canonical proposals": (store) => canonicalDocs(store, ["setlistProposal"]).map((d) => project(d, PROPOSAL_FIELDS)),
  "raw proposal drafts": (store) => draftDocs(store, ["setlistProposal"]).map((d) => project(d, PROPOSAL_FIELDS)),
  "members by id": (store, p) =>
    canonicalDocs(store, ["teamMembers"]).filter((d) => strings(p.ids).includes(d._id)).map((d) => project(d, MEMBER_FIELDS)),
  "weekend roles at a target": (store, p) =>
    canonicalDocs(store, [String(p.roleType)]).filter((d) => d.week === p.week).map(roleRow),
  "weekend role drafts at a target": (store, p) =>
    draftDocs(store, [String(p.roleType)]).filter((d) => d.week === p.week).map((d) => ({ _id: d._id, _type: d._type })),
  "specials on a date": (store, p) => canonicalDocs(store, ["special_role"]).filter((d) => d.date === p.date).map(roleRow),
  "special drafts on a date": (store, p) =>
    draftDocs(store, ["special_role"])
      .filter((d) => d.date === p.date)
      .map((d) => ({ _id: d._id, _type: d._type, service_name: d.service_name ?? null })),
  "role by id": (store, p) => canonicalDocs(store, strings(p.roleTypes)).filter((d) => d._id === p.id).map(roleRow),
  "role draft by base id": (store, p) =>
    draftDocs(store, strings(p.roleTypes)).filter((d) => d._id === p.draftId).map((d) => ({ _id: d._id })),
  "locks by id": (store, p) =>
    canonicalDocs(store, ["roleTargetLock"]).filter((d) => strings(p.ids).includes(d._id)).map(lockRow),
  "roles by ids (read-back)": (store, p) =>
    canonicalDocs(store, strings(p.roleTypes)).filter((d) => strings(p.ids).includes(d._id)).map(roleRow),
  "song titles": (store, p) =>
    canonicalDocs(store, ["post"]).filter((d) => strings(p.ids).includes(d._id)).map((d) => project(d, ["_id", "title", "author"])),
};

const BOUND: Record<string, { client: TwinQuery["client"]; bound: TwinQuery["bound"] }> = {
  // P1's catalogue snapshot (the admission's first read), mirrored from the
  // readiness loader's eight reads.
  "canonical roles": { client: "operational", bound: canonicalRolesQuery() },
  "raw role drafts": { client: "raw", bound: rawRoleDraftsQuery() },
  "role target locks": { client: "operational", bound: allRoleTargetLocksQuery() },
  "canonical setlists": { client: "operational", bound: canonicalSetlistsQuery() },
  "raw setlist drafts": { client: "raw", bound: rawSetlistDraftsQuery() },
  "canonical proposals": { client: "operational", bound: canonicalProposalsQuery() },
  "raw proposal drafts": { client: "raw", bound: rawProposalDraftsQuery() },
  // One entry serves the snapshot, the domain's dangling check and the report's lookup.
  "members by id": { client: "operational", bound: canonicalMembersByIdsQuery([]) },
  // `loadTargetOccupancy` (the admission's second read).
  "weekend roles at a target": { client: "operational", bound: canonicalWeekendRolesForTargetQuery("x", "2028-01-01") },
  "weekend role drafts at a target": { client: "raw", bound: rawRoleDraftsForTargetQuery("x", "2028-01-01") },
  "specials on a date": { client: "operational", bound: canonicalSpecialRolesForDateQuery("2028-01-01") },
  "special drafts on a date": { client: "raw", bound: rawSpecialRoleDraftsForDateQuery("2028-01-01") },
  // `swapRoles`' own reads (`loadRoleForWrite`, `resolveOwnedCoordination`, the bootstrap read-back).
  "role by id": { client: "operational", bound: canonicalRoleByIdQuery("x") },
  "role draft by base id": { client: "raw", bound: rawRoleDraftForBaseQuery("x") },
  "locks by id": { client: "operational", bound: roleTargetLocksByIdsQuery([]) },
  // The report's reads.
  "roles by ids (read-back)": { client: "operational", bound: canonicalRolesByIdsQuery([]) },
  "song titles": { client: "operational", bound: songTitlesQuery([]) },
};

/** The query table, with any entry's rows replaced. */
function queries(overrides: Partial<Record<keyof typeof ROWS, Rows>> = {}): TwinQuery[] {
  return Object.entries(BOUND).map(([label, { client, bound }]) => ({
    label,
    client,
    bound,
    rows: overrides[label] ?? ROWS[label],
  }));
}

/**
 * Lands `mutate` on the store at the domain's FIRST read of each run (`role by
 * id` — the snapshot never issues it): a state change between the tool's
 * admission read and the domain's own, the only way the race-only rows are
 * reachable. Applies once per run, to the route's run as well.
 */
function raceAtDomainRead(mutate: (store: TwinStore) => void): TwinQuery[] {
  const done = new WeakSet<TwinStore>();
  return queries({
    "role by id": (store, p) => {
      if (!done.has(store)) {
        done.add(store);
        mutate(store);
      }
      return ROWS["role by id"](store, p);
    },
  });
}

/** The read-back as the store holds it, then edited by `edit` — a change landed after the swap. */
function readBackEdited(edit: (rows: Record<string, unknown>[]) => void): TwinQuery[] {
  return queries({
    "roles by ids (read-back)": (store, p) => {
      const rows = ROWS["roles by ids (read-back)"](store, p) as Record<string, unknown>[];
      edit(rows);
      return rows;
    },
  });
}

/** True once the business transaction committed (every touched doc then carries a `twin-rev-*`). */
function committed(store: TwinStore): boolean {
  return [...store.docs.values()].some((d) => String(d._rev).startsWith("twin-rev-") && ROLE_TYPES.includes(d._type as never));
}

// ── Fixture ─────────────────────────────────────────────────────────────────

const ref = (key: string, id: string) => ({ _key: key, _type: "reference", _ref: id });
const inst = (key: string, instrument: string, id: string) => ({
  _key: key,
  _type: "instrument_slot",
  instrument,
  person: { _type: "reference", _ref: id },
});
const fohSlot = (key: string, role: string, id: string) => ({
  _key: key,
  _type: "foh_slot",
  role,
  person: { _type: "reference", _ref: id },
});

function role(over: TwinDoc): TwinDoc {
  return { Lead: [], BGVs: [], Chorus: [], instruments: [], foh_team: [], ...over };
}

function sunday(id: string, week: string, published: boolean, seats: Partial<TwinDoc> = {}): TwinDoc {
  return role({ _id: id, _rev: `${id}-rev`, _type: "sunday_role", week, published, ...seats });
}

function saturday(id: string, week: string, published: boolean, seats: Partial<TwinDoc> = {}): TwinDoc {
  return role({ _id: id, _rev: `${id}-rev`, _type: "saturday_role", week, published, ...seats });
}

function special(id: string, date: string, name: string, published: boolean, rest: Partial<TwinDoc> = {}): TwinDoc {
  return role({ _id: id, _rev: `${id}-rev`, _type: "special_role", date, service_name: name, published, ...rest });
}

function lockFor(r: TwinDoc, ownerId: string = String(r._id)): TwinDoc {
  const targetKey = roleTargetKey(r) as string;
  const lock = buildClaimedLock({ targetKey, roleId: ownerId, claimNonce: "n1", now: "2028-01-01T00:00:00.000Z" });
  if (!lock) throw new Error("fixture: no lock for " + r._id);
  return { ...lock, _rev: `${lock._id}-rev` };
}

function lockIdOf(r: TwinDoc): string {
  return roleTargetLockId(roleTargetKey(r)) as string;
}

function member(
  id: string,
  name: string,
  unavailableDates: string[] | null = null,
  unavailabilityNotes: { date: string; note: string }[] | null = null,
): TwinDoc {
  return { _id: id, _rev: `${id}-rev`, _type: "teamMembers", member_name: name, alias: null, unavailableDates, unavailabilityNotes };
}

const MEMBERS: TwinDoc[] = [
  member("mem-ana", "Ana", ["2028-10-06", "2028-10-09"]),
  member("mem-beto", "Beto"),
  member("mem-caro", "Caro"),
  member("mem-dani", "Dani"),
  member("mem-eli", "Eli"),
  // Fer leads SUN_B and cannot serve on SUN_A's day: a Lead swap places him there.
  member("mem-fer", "Fer", ["2028-10-01"], [{ date: "2028-10-01", note: "Viaje" }]),
  member("mem-gabo", "Gabo"),
  member("mem-hugo", "Hugo"),
  member("mem-ivan", "Iván"),
  member("mem-juan", "Juan"),
  member("mem-kike", "Kike"),
  member("mem-lalo", "Lalo"),
];

// The published pair every section and team twin swaps: same month, every
// section populated, different cardinalities, SUN_B with an empty FOH.
const SUN_A = sunday("role-sun-a", "2028-10-01", true, {
  Lead: [ref("la1", "mem-ana")],
  BGVs: [ref("ba1", "mem-beto")],
  Chorus: [ref("ca1", "mem-caro")],
  instruments: [inst("ia1", "Bajo", "mem-dani")],
  foh_team: [fohSlot("fa1", "Sonido", "mem-eli")],
});
const SUN_B = sunday("role-sun-b", "2028-10-08", true, {
  Lead: [ref("lb1", "mem-fer")],
  BGVs: [ref("bb1", "mem-gabo"), ref("bb2", "mem-hugo")],
  Chorus: [ref("cb1", "mem-ivan")],
  instruments: [inst("ib1", "Teclado", "mem-juan")],
  foh_team: [],
});

// A draft pair: a Sunday and a special (no weekend lock), the special timed and with a song.
const DRAFT_SUN = sunday("role-sun-draft", "2028-10-15", false, {
  Lead: [ref("ld1", "mem-kike")],
  BGVs: [ref("bd1", "mem-beto")],
});
const DRAFT_SP = special("role-sp-draft", "2028-10-20", "Ensayo abierto", false, {
  time: "18:00",
  Lead: [ref("ls1", "mem-lalo")],
  Chorus: [ref("cs1", "mem-caro")],
  songs: [{ _key: "s1", play_key: "G", medley_tag: null, song: { _type: "reference", _ref: "song-2" }, leads: null }],
});

// Topology.
const SAT = saturday("role-sat", "2028-10-07", true, { Lead: [ref("lsat", "mem-gabo")] });
const SAT_HIDDEN = saturday("role-sat-hidden", "2028-10-14", true, {
  Lead: [ref("lsh", "mem-hugo")],
  Chorus: [ref("csh", "mem-ivan")],
});

// Mirror rows.
const SUN_NOV = sunday("role-sun-nov", "2028-11-05", true, { Lead: [ref("ln1", "mem-juan")] });
const DUP_A = sunday("role-sun-dup-a", "2028-10-22", true, { Lead: [ref("lda", "mem-dani")] });
const DUP_B = sunday("role-sun-dup-b", "2028-10-22", true, { Lead: [ref("ldb", "mem-eli")] });
// A Studio draft of the role's OWN id: readiness files it as the target's
// `draft_conflict` (stage 1), which the route refuses too (`loadRoleForWrite`).
const OVERLAID = sunday("role-sun-overlaid", "2028-10-12", true, { Lead: [ref("lov", "mem-juan")] });
const OVERLAY_DRAFT: TwinDoc = sunday("drafts.role-sun-overlaid", "2028-10-12", true);
const GHOSTED = sunday("role-sun-ghosted", "2028-10-29", true, { Lead: [ref("lg1", "mem-hugo")] });
const GHOST_DRAFT: TwinDoc = sunday("drafts.role-ghost", "2028-10-29", true);
const SP_X = special("role-sp-x", "2028-10-28", "Retiro de jóvenes", true, { Lead: [ref("lx1", "mem-kike")] });
const SP_X2 = special("role-sp-x2", "2028-10-28", "  Retiro   de jóvenes ", true, { Lead: [ref("lx2", "mem-lalo")] });
const SP_VIGILIA = special("role-sp-vigilia", "2028-10-27", "Vigilia", true, { Lead: [ref("lv1", "mem-kike")] });
const VIGILIA_COPY: TwinDoc = special("drafts.role-sp-vigilia-copy", "2028-10-27", "Vigilia", false);
const DANGLING = sunday("role-sun-dangling", "2028-10-02", true, {
  Lead: [ref("ldg", "mem-lalo")],
  BGVs: [ref("bdg", "mem-ghost")],
});
const BLANK_SP = special("role-sp-blank", "2028-10-03", "   ", true, { Lead: [ref("lbl", "mem-ana")] });
const NO_LOCK = sunday("role-sun-nolock", "2028-10-04", true, { Lead: [ref("lnl", "mem-caro")] });
const WRONG_LOCK = sunday("role-sun-wronglock", "2028-10-05", true, { Lead: [ref("lwl", "mem-dani")] });

// Reports.
const WN_A = special("role-wn-a", "2028-10-10", "Noche de alabanza", true, {
  format: "worship_night",
  Lead: [ref("lwa", "mem-kike")],
  songs: [
    {
      _key: "w1",
      play_key: "A",
      medley_tag: null,
      song: { _type: "reference", _ref: "song-1" },
      leads: [{ _key: "wl1", _type: "reference", _ref: "mem-kike" }],
    },
    { _key: "w2", play_key: "D", medley_tag: null, song: { _type: "reference", _ref: "song-2" }, leads: null },
  ],
});
const WN_B = special("role-wn-b", "2028-10-11", "Noche de alabanza II", true, {
  format: "worship_night",
  Lead: [ref("lwb", "mem-lalo")],
});
const SAME_A = sunday("role-sun-same-a", "2028-10-06", true, { Lead: [ref("lsa", "mem-ana")] });
const SAME_B = sunday("role-sun-same-b", "2028-10-09", true, { Lead: [ref("lsb", "mem-ana")] });

const POSTS: TwinDoc[] = [
  { _id: "song-1", _rev: "song-1-rev", _type: "post", title: "Cuán grande es Él", author: null },
  { _id: "song-2", _rev: "song-2-rev", _type: "post", title: "Aquí estoy", author: null },
];

function fixture(): TwinDoc[] {
  return [
    ...MEMBERS,
    ...POSTS,
    SUN_A, lockFor(SUN_A),
    SUN_B, lockFor(SUN_B),
    DRAFT_SUN, lockFor(DRAFT_SUN),
    DRAFT_SP,
    SAT, lockFor(SAT),
    SAT_HIDDEN, lockFor(SAT_HIDDEN),
    SUN_NOV, lockFor(SUN_NOV),
    DUP_A, DUP_B, lockFor(DUP_A),
    OVERLAID, lockFor(OVERLAID), OVERLAY_DRAFT,
    GHOSTED, lockFor(GHOSTED), GHOST_DRAFT,
    SP_X, SP_X2,
    SP_VIGILIA, VIGILIA_COPY,
    DANGLING, lockFor(DANGLING),
    BLANK_SP,
    NO_LOCK, // deliberately no lock: a legacy weekend role (S2g)
    WRONG_LOCK, lockFor(WRONG_LOCK, "role-sun-b"), // claimed by a role that owns another target
    WN_A, WN_B,
    SAME_A, lockFor(SAME_A),
    SAME_B, lockFor(SAME_B),
  ];
}

const OPTIONS: TwinRunOptions = { fixture, queries: queries() };

// ── Helpers ─────────────────────────────────────────────────────────────────

function sel(r: TwinDoc, rev: string = String(r._rev)) {
  return { serviceId: String(r._id), rev };
}

function section(path: SeatPath, a: TwinDoc, b: TwinDoc, revs: [string?, string?] = []): SwapAssignmentArgs {
  return { kind: "section", path, services: [sel(a, revs[0]), sel(b, revs[1])] };
}

function team(a: TwinDoc, b: TwinDoc, revs: [string?, string?] = []): SwapAssignmentArgs {
  return { kind: "team", services: [sel(a, revs[0]), sel(b, revs[1])] };
}

const call = (args: SwapAssignmentArgs) => () => swapAssignmentResult(args);

function twinOf(args: SwapAssignmentArgs, options: TwinRunOptions = OPTIONS) {
  return t.twin(options, { handler: swapPOST, body: swapAssignmentBody(args) }, call(args));
}

function textOf(result: CallToolResult): string {
  return (result.content as { text: string }[])[0].text;
}

function sc<T = Record<string, unknown>>(result: CallToolResult): T {
  return result.structuredContent as T;
}

function doc(store: TwinStore, id: string): TwinDoc {
  const d = store.docs.get(id);
  if (!d) throw new Error(`no ${id}`);
  return d;
}

/** The reads only the domain makes: none may appear when the tool refuses at admission. */
function domainReads(run: TwinRun<unknown>): string[] {
  return run.reads.filter((r) => r.label === "role by id" || r.label === "locks by id").map((r) => r.label);
}

function expectMirrorRefusal(run: TwinRun<CallToolResult>) {
  expect(run.refusedReads).toEqual([]);
  expect(run.response.isError).toBe(true);
  expect(domainReads(run)).toEqual([]);
  expect(run.transactions).toEqual([]);
  expect(run.outboxUpserts).toEqual([]);
  expect(run.pushes).toEqual([]);
  expect(run.revalidations).toEqual([]);
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

describe("registerSwapAssignment", () => {
  it("registers swap_assignment with the write-tool annotations (I14) and the strict schema", () => {
    const registered: { name: string; config: Record<string, unknown> }[] = [];
    registerSwapAssignment({
      registerTool: (name: string, config: Record<string, unknown>) => registered.push({ name, config }),
    } as never);
    expect(registered).toHaveLength(1);
    const [{ name, config }] = registered;
    expect(name).toBe("swap_assignment");
    expect(config.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(config.inputSchema).toBe(SWAP_ASSIGNMENT_INPUT);
    expect((config.title as string).length).toBeGreaterThan(0);
    expect((config.description as string).length).toBeGreaterThan(0);
  });

  it("publishes ONE object with top-level additionalProperties:false and no seat shape (P3-R1)", () => {
    const schema = z.toJSONSchema(SWAP_ASSIGNMENT_INPUT) as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema).not.toHaveProperty("anyOf");
    expect(schema).not.toHaveProperty("oneOf");
    const props = schema.properties as Record<string, { enum?: string[] }>;
    expect(Object.keys(props).sort()).toEqual(["kind", "path", "services"]);
    expect(props.kind.enum).toEqual(["section", "team"]);
    expect(props.path.enum).toEqual([...SEAT_PATHS]);
  });
});

describe("SWAP_ASSIGNMENT_INPUT", () => {
  const services = [sel(SUN_A), sel(SUN_B)];

  it("accepts a section with its path and a team without one", () => {
    for (const path of SEAT_PATHS) {
      expect(SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "section", path, services }).success).toBe(true);
    }
    expect(SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "team", services }).success).toBe(true);
  });

  it('refuses kind: "seat" in every spelling — with source/target or with services (decision 6)', () => {
    expect(
      SWAP_ASSIGNMENT_INPUT.safeParse({
        kind: "seat",
        source: { roleId: "role-sun-a", rev: "r", path: "Lead", itemKey: "la1" },
        target: { roleId: "role-sun-b", rev: "r", path: "Lead", itemKey: "lb1" },
      }).success,
    ).toBe(false);
    expect(SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "seat", path: "Lead", services }).success).toBe(false);
  });

  it("refuses source/target beside a valid section, an extra top-level field, and an extra field on a service", () => {
    expect(
      SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "section", path: "Lead", services, source: {}, target: {} }).success,
    ).toBe(false);
    expect(SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "team", services, roles: [] }).success).toBe(false);
    expect(
      SWAP_ASSIGNMENT_INPUT.safeParse({
        kind: "team",
        services: [{ ...sel(SUN_A), itemKey: "la1" }, sel(SUN_B)],
      }).success,
    ).toBe(false);
  });

  it("refuses a section without path and a team with one, in Spanish", () => {
    const noPath = SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "section", services });
    expect(noPath.success).toBe(false);
    if (!noPath.success) expect(noPath.error.issues.map((i) => i.message)).toContain(SECTION_PATH_MESSAGE);
    const teamPath = SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "team", path: "Lead", services });
    expect(teamPath.success).toBe(false);
    if (!teamPath.success) expect(teamPath.error.issues.map((i) => i.message)).toContain(TEAM_PATH_MESSAGE);
  });

  it("refuses anything but exactly two services, an unknown path, a drafts.* id and a whitespace rev", () => {
    expect(SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "team", services: [sel(SUN_A)] }).success).toBe(false);
    expect(SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "team", services: [...services, sel(SAT)] }).success).toBe(false);
    expect(SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "section", path: "Voces", services }).success).toBe(false);
    expect(
      SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "team", services: [{ serviceId: "drafts.role-sun-a", rev: "r" }, sel(SUN_B)] })
        .success,
    ).toBe(false);
    expect(
      SWAP_ASSIGNMENT_INPUT.safeParse({ kind: "team", services: [{ serviceId: "role-sun-a", rev: "a b" }, sel(SUN_B)] })
        .success,
    ).toBe(false);
  });
});

describe("swapAssignmentBody — the one domain body", () => {
  it("is the route's own section shape, and a team body carries no path", () => {
    expect(swapAssignmentBody(section("BGVs", SUN_A, SUN_B))).toEqual({
      kind: "section",
      path: "BGVs",
      roles: [
        { id: "role-sun-a", rev: "role-sun-a-rev" },
        { id: "role-sun-b", rev: "role-sun-b-rev" },
      ],
    });
    const teamBody = swapAssignmentBody(team(SUN_A, SUN_B));
    expect(teamBody).toEqual({
      kind: "team",
      roles: [
        { id: "role-sun-a", rev: "role-sun-a-rev" },
        { id: "role-sun-b", rev: "role-sun-b-rev" },
      ],
    });
    expect(teamBody).not.toHaveProperty("path");
  });
});

describe("swap_assignment — a malformed direct call is refused before any read", () => {
  it.each([
    ["a section without path", { kind: "section", services: [sel(SUN_A), sel(SUN_B)] }, "path_required", SECTION_PATH_MESSAGE],
    ["a team with a path", { kind: "team", path: "Lead", services: [sel(SUN_A), sel(SUN_B)] }, "path_not_allowed", TEAM_PATH_MESSAGE],
    [
      "a seat kind",
      { kind: "seat", services: [sel(SUN_A), sel(SUN_B)] },
      "invalid_kind",
      'kind debe ser "section" (una sección completa) o "team" (el equipo completo).',
    ],
    [
      "one service",
      { kind: "team", services: [sel(SUN_A)] },
      "invalid_services",
      "services debe tener exactamente dos servicios, cada uno con { serviceId, rev }.",
    ],
    [
      "a drafts.* id",
      { kind: "team", services: [{ serviceId: "drafts.role-sun-a", rev: "r" }, sel(SUN_B)] },
      "invalid_service_id",
      "serviceId no es un id de servicio válido; usa el que devuelve get_service.",
    ],
    [
      "a whitespace rev",
      { kind: "team", services: [{ serviceId: "role-sun-a", rev: "a b" }, sel(SUN_B)] },
      "invalid_revision",
      "rev no es una revisión válida; usa la que devuelve get_service.",
    ],
  ])("%s: invalid_request, zero reads, zero transactions", async (_name, args, detail, message) => {
    const run = await t.runTool(OPTIONS, call(args as SwapAssignmentArgs));
    expect(sc(run.response)).toEqual({ refused: true, code: "invalid_request", detail });
    expect(textOf(run.response)).toBe(`${message} ${NOTHING_WRITTEN}`);
    expect(run.reads).toEqual([]);
    expect(run.transactions).toEqual([]);
  });
});

// ── Twin runs: route and tool over one fixture ──────────────────────────────

function expectCommittedParity(route: TwinRun<{ status: number; body: unknown }>, tool: TwinRun<CallToolResult>) {
  expect(route.refusedReads).toEqual([]);
  expect(tool.refusedReads).toEqual([]);
  expect(route.afterErrors).toBe(0);
  expect(tool.afterErrors).toBe(0);
  expect(route.response.status).toBe(200);
  expect(tool.response.isError).toBeUndefined();
  expect(parityView(tool)).toEqual(parityView(route));
  expect(route.transactions).toHaveLength(1);
  expect(route.revalidations).toEqual(["revalidateServiceViews()", "revalidatePath(/me)"]);
}

describe("twin: the admin swap route and swap_assignment — published", () => {
  it.each(SEAT_PATHS)(
    "section %s: identical transaction (both role patches + both lock heartbeats), pushes, outbox and revalidation",
    async (path) => {
      const args = section(path, SUN_A, SUN_B);
      const { route, tool } = await twinOf(args);
      expectCommittedParity(route, tool);
      expect(route.response.body).toEqual({ ok: true, kind: "section", roleIds: ["role-sun-a", "role-sun-b"] });

      const ops = route.transactions[0];
      expect(ops).toEqual([
        { kind: "patch", id: "role-sun-a", ifRevisionId: "role-sun-a-rev", set: { [path]: SUN_B[path] }, setIfMissing: {}, unset: [] },
        { kind: "patch", id: "role-sun-b", ifRevisionId: "role-sun-b-rev", set: { [path]: SUN_A[path] }, setIfMissing: {}, unset: [] },
        {
          kind: "patch",
          id: lockIdOf(SUN_A),
          ifRevisionId: `${lockIdOf(SUN_A)}-rev`,
          set: { updatedAt: TWIN_FROZEN_INSTANT },
          setIfMissing: {},
          unset: [],
        },
        {
          kind: "patch",
          id: lockIdOf(SUN_B),
          ifRevisionId: `${lockIdOf(SUN_B)}-rev`,
          set: { updatedAt: TWIN_FROZEN_INSTANT },
          setIfMissing: {},
          unset: [],
        },
      ]);
      // `_key`s travel with their items: each side now holds the other's stored array.
      expect(doc(tool.store, "role-sun-a")[path]).toEqual(SUN_B[path]);
      expect(doc(tool.store, "role-sun-b")[path]).toEqual(SUN_A[path]);
      // Published roles: the outbox gets the union of before and after assignees.
      expect(route.outboxUpserts.length).toBeGreaterThan(0);

      const report = sc<{ ok: true; kind: string; path: string; services: SwapServiceReport[]; freshRevs: FreshRev[] }>(
        tool.response,
      );
      expect(report.ok).toBe(true);
      expect(report.kind).toBe("section");
      expect(report.path).toBe(path);
      expect(report.services.map((s) => Object.keys(s.moved))).toEqual([[path], [path]]);
      expect(report.freshRevs).toEqual([
        { serviceId: "role-sun-a", rev: "twin-rev-1" },
        { serviceId: "role-sun-b", rev: "twin-rev-1" },
      ]);
    },
  );

  it("section BGVs names who moved, from the pre-commit seat states, and the queued notifications", async () => {
    const { route, tool } = await twinOf(section("BGVs", SUN_A, SUN_B));
    expectCommittedParity(route, tool);
    const report = sc<{ services: SwapServiceReport[]; notifications: { channel: string; audience: { name: string }[] }[] }>(
      tool.response,
    );
    expect(report.services).toEqual([
      {
        serviceId: "role-sun-a",
        date: "2028-10-01",
        published: "published",
        moved: { BGVs: { before: ["Beto"], after: ["Gabo", "Hugo"] } },
      },
      {
        serviceId: "role-sun-b",
        date: "2028-10-08",
        published: "published",
        moved: { BGVs: { before: ["Gabo", "Hugo"], after: ["Beto"] } },
      },
    ]);
    // The pushes the route sent are the ones the report names: added members per destination.
    expect(route.pushes.map((p) => p.memberIds)).toEqual([["mem-gabo", "mem-hugo"], ["mem-beto"]]);
    const pushes = report.notifications.filter((n) => n.channel === "push");
    expect(pushes.map((n) => n.audience.map((a) => a.name))).toEqual([["Gabo", "Hugo"], ["Beto"]]);
    const outbox = report.notifications.filter((n) => n.channel === "outbox_email");
    expect(outbox.map((n) => n.audience.map((a) => a.name))).toEqual([
      ["Ana", "Beto", "Caro", "Dani", "Eli", "Gabo", "Hugo"],
      ["Fer", "Gabo", "Hugo", "Iván", "Juan", "Beto"],
    ]);
    const text = textOf(tool.response);
    expect(text).toContain(
      "Intercambio hecho: la sección BGVs entre el domingo 2028-10-01 y el domingo 2028-10-08. /, /schedule, /me y las páginas de canciones se actualizan.",
    );
    expect(text).toContain("El domingo 2028-10-01, BGVs: antes Beto; ahora Gabo, Hugo.");
    expect(text).toContain("El domingo 2028-10-08, BGVs: antes Gabo, Hugo; ahora Beto.");
    expect(text).toContain(OUTBOX_SWEEP_NOTE);
    expect(text).not.toMatch(/enviad|entregad/);
  });

  it("section instruments and FOH name each slot with its label", async () => {
    const instruments = await twinOf(section("instruments", SUN_A, SUN_B));
    expectCommittedParity(instruments.route, instruments.tool);
    expect(sc<{ services: SwapServiceReport[] }>(instruments.tool.response).services[0].moved).toEqual({
      instruments: { before: ["Bajo: Dani"], after: ["Teclado: Juan"] },
    });
    const foh = await twinOf(section("foh_team", SUN_A, SUN_B));
    expectCommittedParity(foh.route, foh.tool);
    expect(sc<{ services: SwapServiceReport[] }>(foh.tool.response).services.map((s) => s.moved)).toEqual([
      { foh_team: { before: ["Sonido: Eli"], after: [] } },
      { foh_team: { before: [], after: ["Sonido: Eli"] } },
    ]);
    expect(textOf(foh.tool.response)).toContain("El domingo 2028-10-01, FOH: antes Sonido: Eli; ahora nadie.");
  });

  it("team: exactly the five seat fields change hands, in one transaction with both locks", async () => {
    const args = team(SUN_A, SUN_B);
    const { route, tool } = await twinOf(args);
    expectCommittedParity(route, tool);
    expect(route.response.body).toEqual({ ok: true, kind: "team", roleIds: ["role-sun-a", "role-sun-b"] });
    const [patchA, patchB, lockA, lockB] = route.transactions[0] as { id: string; set: Record<string, unknown> }[];
    expect(Object.keys(patchA.set).sort()).toEqual([...SEAT_PATHS].sort());
    expect(Object.keys(patchB.set).sort()).toEqual([...SEAT_PATHS].sort());
    expect(lockA.id).toBe(lockIdOf(SUN_A));
    expect(lockB.id).toBe(lockIdOf(SUN_B));
    for (const path of SEAT_PATHS) {
      expect(doc(tool.store, "role-sun-a")[path]).toEqual(SUN_B[path]);
      expect(doc(tool.store, "role-sun-b")[path]).toEqual(SUN_A[path]);
    }
    // Identity, date, publication and songs untouched.
    expect(doc(tool.store, "role-sun-a").week).toBe("2028-10-01");
    expect(doc(tool.store, "role-sun-a").published).toBe(true);

    const report = sc<{ kind: string; path?: string; services: SwapServiceReport[]; freshRevs: FreshRev[] }>(tool.response);
    expect(report.kind).toBe("team");
    expect(report).not.toHaveProperty("path");
    // SUN_B had no FOH and SUN_A had one: FOH appears for both, every populated section too.
    expect(Object.keys(report.services[0].moved)).toEqual([...SEAT_PATHS]);
    expect(report.freshRevs.every((f) => "rev" in f)).toBe(true);
    expect(textOf(tool.response)).toContain("Intercambio hecho: el equipo completo entre");
  });
});

describe("twin: the admin swap route and swap_assignment — drafts stay silent", () => {
  it("a section swap between a draft Sunday and a draft special: same write, no push, no outbox", async () => {
    const { route, tool } = await twinOf(section("Lead", DRAFT_SUN, DRAFT_SP));
    expectCommittedParity(route, tool);
    // A special takes no weekend lock: two role patches and ONE heartbeat.
    expect(route.transactions[0].map((op) => (op.kind === "patch" ? op.id : op.kind))).toEqual([
      "role-sun-draft",
      "role-sp-draft",
      lockIdOf(DRAFT_SUN),
    ]);
    expect(route.pushes).toEqual([]);
    expect(route.outboxUpserts).toEqual([]);
    expect(route.sweeps).toBe(0);
    const report = sc<{ services: SwapServiceReport[]; notifications: { channel: string; status: string; note?: string }[] }>(
      tool.response,
    );
    expect(report.services.map((s) => s.published)).toEqual(["draft", "draft"]);
    expect(report.services[1]).toMatchObject({ serviceId: "role-sp-draft", name: "Ensayo abierto", date: "2028-10-20" });
    expect(report.notifications.filter((n) => n.channel === "outbox_email").map((n) => [n.status, n.note])).toEqual([
      ["no encolada", "No se encoló: el servicio es un borrador."],
      ["no encolada", "No se encoló: el servicio es un borrador."],
    ]);
    expect(textOf(tool.response)).not.toContain(OUTBOX_SWEEP_NOTE);
  });

  it("a team swap between the two drafts: same write, nobody notified", async () => {
    const { route, tool } = await twinOf(team(DRAFT_SUN, DRAFT_SP));
    expectCommittedParity(route, tool);
    expect(route.pushes).toEqual([]);
    expect(route.outboxUpserts).toEqual([]);
    expect(doc(tool.store, "role-sp-draft").Lead).toEqual(DRAFT_SUN.Lead);
    expect(doc(tool.store, "role-sp-draft").songs).toEqual(DRAFT_SP.songs);
  });
});

// ── Refusal replay: inherited rows (the route's own code) ───────────────────

describe("swap_assignment — refusal replay, inherited rows", () => {
  async function expectInherited(
    args: SwapAssignmentArgs,
    code: string,
    options: TwinRunOptions = OPTIONS,
  ): Promise<{ route: TwinRun<{ status: number; body: unknown }>; tool: TwinRun<CallToolResult> }> {
    const { route, tool } = await twinOf(args, options);
    expect(route.refusedReads).toEqual([]);
    expect(tool.refusedReads).toEqual([]);
    expect(route.response.body).toMatchObject({ error: code });
    expect(tool.response.isError).toBe(true);
    expect(sc(tool.response)).toMatchObject({ refused: true, code });
    expect(parityView(tool)).toEqual(parityView(route));
    return { route, tool };
  }

  it("incompatible_team_topology: a Sunday and a Saturday", async () => {
    const { tool, route } = await expectInherited(team(SUN_A, SAT), "invalid_request");
    expect(route.response.status).toBe(400);
    expect(sc(tool.response)).toEqual({ refused: true, code: "invalid_request", issues: ["incompatible_team_topology"] });
    expect(textOf(tool.response)).toBe(
      `La solicitud no es válida. No se puede intercambiar el equipo completo entre un sábado y un servicio que no es sábado. ${NOTHING_WRITTEN}`,
    );
    expect(tool.transactions).toEqual([]);
  });

  it("incompatible_section_topology: Chorus with a Saturday", async () => {
    const { tool } = await expectInherited(section("Chorus", SUN_A, SAT), "invalid_request");
    expect(sc(tool.response)).toEqual({ refused: true, code: "invalid_request", issues: ["incompatible_section_topology"] });
    expect(textOf(tool.response)).toContain("El Coro no se puede intercambiar con un sábado");
    expect(tool.transactions).toEqual([]);
  });

  it("hidden_saturday_chorus: a Saturday with stored Chorus", async () => {
    const { tool } = await expectInherited(section("BGVs", SAT_HIDDEN, SAT), "integrity_conflict");
    expect(sc(tool.response)).toEqual({ refused: true, code: "integrity_conflict", detail: "hidden_saturday_chorus" });
    expect(textOf(tool.response)).toContain("Un sábado con Coro guardado no se puede intercambiar");
    expect(tool.transactions).toEqual([]);
  });

  it("identical_selection: the same service twice", async () => {
    const { tool } = await expectInherited(section("Lead", SUN_A, SUN_A), "invalid_request");
    expect(sc(tool.response)).toEqual({ refused: true, code: "invalid_request", issues: ["identical_selection"] });
    expect(textOf(tool.response)).toBe(`La solicitud no es válida. Los dos servicios son el mismo. ${NOTHING_WRITTEN}`);
    expect(tool.transactions).toEqual([]);
  });

  it("not_found: met at admission, with the route's code and wording, zero domain reads", async () => {
    const args: SwapAssignmentArgs = { kind: "section", path: "Lead", services: [{ serviceId: "role-nope", rev: "r" }, sel(SUN_B)] };
    const { route, tool } = await twinOf(args);
    expect(route.response).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(sc(tool.response)).toEqual({ refused: true, code: "not_found", serviceId: "role-nope" });
    expect(textOf(tool.response)).toBe(`El servicio no existe; vuelve a buscarlo con list_services. ${NOTHING_WRITTEN}`);
    expectMirrorRefusal(tool);
    expect(route.transactions).toEqual([]);
  });

  it.each([
    ["the first", section("Lead", SUN_A, SUN_B, ["stale-a", undefined])],
    ["the second", section("Lead", SUN_A, SUN_B, [undefined, "stale-b"])],
  ])("stale_revision on %s service: zero transactions", async (_which, args) => {
    const { tool } = await expectInherited(args, "stale_revision");
    expect(textOf(tool.response)).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
    expect(tool.transactions).toEqual([]);
  });

  it("a commit conflict (a concurrent edit lands before the commit): stale_revision, nothing written", async () => {
    const race = (store: TwinStore) => {
      doc(store, "role-sun-a")._rev = "someone-else";
    };
    const { tool } = await expectInherited(section("Lead", SUN_A, SUN_B), "stale_revision", { ...OPTIONS, race });
    expect(textOf(tool.response)).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
    expect(tool.transactions).toEqual([]);
    expect(tool.revalidations).toEqual([]);
    expect(doc(tool.store, "role-sun-a").Lead).toEqual(SUN_A.Lead);
  });

  it("race: a moved person stops existing between admission and the domain read — danglingRefs", async () => {
    const queries = raceAtDomainRead((store) => store.docs.delete("mem-fer"));
    const { tool } = await expectInherited(section("Lead", SUN_A, SUN_B), "integrity_conflict", { ...OPTIONS, queries });
    expect(textOf(tool.response)).toContain("Una de las personas que se moverían ya no existe como miembro.");
    expect(textOf(tool.response)).toMatch(/No se escribió nada\.$/);
    expect(tool.transactions).toEqual([]);
  });

  it("race: the weekend lock turns wrong-owner between admission and the domain read", async () => {
    const queries = raceAtDomainRead((store) => {
      doc(store, lockIdOf(SUN_A)).roleId = "role-sun-b";
    });
    const { tool } = await expectInherited(section("Lead", SUN_A, SUN_B), "integrity_conflict", { ...OPTIONS, queries });
    expect(sc(tool.response)).toEqual({ refused: true, code: "integrity_conflict", detail: "lock_wrong_owner" });
    expect(textOf(tool.response)).toContain("pertenece a otro servicio");
    expect(tool.transactions).toEqual([]);
  });

  it("race: the weekend lock disappears between admission and the domain read — bootstrap_completed_reload", async () => {
    const queries = raceAtDomainRead((store) => store.docs.delete(lockIdOf(SUN_A)));
    const { route, tool } = await twinOf(section("Lead", SUN_A, SUN_B), { ...OPTIONS, queries });
    expect(route.response).toMatchObject({ status: 409, body: { error: "bootstrap_completed_reload" } });
    expect(sc(tool.response)).toEqual({ refused: true, code: "bootstrap_completed_reload" });
    expect(textOf(tool.response)).toBe(BOOTSTRAP_COMPLETED_RELOAD_MESSAGE);
    // The maintenance write committed (its claimNonce is random: structure only),
    // the swap did not.
    for (const run of [route, tool]) {
      expect(run.transactions).toHaveLength(1);
      const ops = run.transactions[0];
      expect(ops.map((op) => op.kind).sort()).toEqual(["create", "patch"]);
      const patch = ops.find((op) => op.kind === "patch");
      expect(patch).toMatchObject({ id: "role-sun-a", ifRevisionId: "role-sun-a-rev", set: { week: "2028-10-01" } });
      const create = ops.find((op) => op.kind === "create");
      expect(create && "doc" in create ? create.doc : {}).toMatchObject({
        _id: lockIdOf(SUN_A),
        state: "claimed",
        roleId: "role-sun-a",
      });
      expect(doc(run.store, "role-sun-a").Lead).toEqual(SUN_A.Lead);
      expect(run.pushes).toEqual([]);
      expect(run.outboxUpserts).toEqual([]);
    }
  });

  it("a retry with the revs the first call consumed is stale_revision, never a second swap", async () => {
    const first = await t.runTool(OPTIONS, call(section("Lead", SUN_A, SUN_B)));
    expect(first.response.isError).toBeUndefined();
    const retry = await t.runTool(
      { ...OPTIONS, fixture: () => [...first.store.docs.values()] as TwinDoc[] },
      call(section("Lead", SUN_A, SUN_B)),
    );
    expect(sc(retry.response)).toMatchObject({ refused: true, code: "stale_revision" });
    expect(retry.transactions).toEqual([]);
  });

  it("a commit that fails for another reason is the unknown outcome, never «No se escribió nada.»", async () => {
    const run = await t.runTool(
      { ...OPTIONS, failFirstCommit: Object.assign(new Error("socket hang up token=abc"), { statusCode: 502 }) },
      call(section("Lead", SUN_A, SUN_B)),
    );
    expect(run.response.content).toEqual([{ type: "text", text: WRITE_UNKNOWN_OUTCOME_MESSAGE }]);
    expect(run.transactions).toEqual([]);
    expect(JSON.stringify(run.response)).not.toContain("token=abc");
  });

  it("a throw in an admission read is the pre-phase text: nothing written, the domain never called", async () => {
    const queries_ = queries({
      "weekend roles at a target": () => {
        throw new Error("read failed token=abc");
      },
    });
    const run = await t.runTool({ ...OPTIONS, queries: queries_ }, call(section("Lead", SUN_A, SUN_B)));
    expect(run.response.content).toEqual([{ type: "text", text: WRITE_PRE_FAILURE_MESSAGE }]);
    expect(domainReads(run)).toEqual([]);
    expect(run.transactions).toEqual([]);
    expect(JSON.stringify(run.response)).not.toContain("token=abc");
  });
});

// ── Refusal replay: mirror rows (admission; the route alone for the record) ─

describe("swap_assignment — refusal replay, mirror rows (§ «Admin surface gates»)", () => {
  async function mirror(args: SwapAssignmentArgs, toolOptions: TwinRunOptions = OPTIONS) {
    const tool = await t.runTool(toolOptions, call(args));
    expectMirrorRefusal(tool);
    const route = await t.runRoute(OPTIONS, swapPOST, swapAssignmentBody(args));
    expect(route.refusedReads).toEqual([]);
    return { tool, route };
  }

  function expectRouteCommits(route: TwinRun<{ status: number; body: unknown }>) {
    expect(route.response.status).toBe(200);
    expect(route.transactions).toHaveLength(1);
  }

  it("S1: two services in different months — the route alone commits", async () => {
    const { tool, route } = await mirror(section("Lead", SUN_A, SUN_NOV));
    expect(sc(tool.response)).toEqual({ refused: true, code: "invalid_request", detail: "cross_month" });
    expect(textOf(tool.response)).toBe(
      `Los dos servicios están en meses distintos (2028-10 y 2028-11); el planner de /admin → Servicios solo intercambia servicios del mismo mes. ${NOTHING_WRITTEN}`,
    );
    expectRouteCommits(route);
  });

  it("S2a: a weekend target with two canonical roles — the route alone commits", async () => {
    const { tool, route } = await mirror(section("Lead", DUP_A, SUN_B));
    expect(sc(tool.response)).toEqual({
      refused: true,
      code: "ambiguous_target",
      detail: "duplicate_weekend_target",
      serviceId: "role-sun-dup-a",
    });
    expect(textOf(tool.response)).toContain("El domingo 2028-10-22: hay más de un servicio guardado en ese mismo fin de semana");
    expect(textOf(tool.response)).not.toContain("role-sun-dup-a");
    expectRouteCommits(route);
  });

  it("S2b: two specials sharing a date and a normalized name — the route alone commits", async () => {
    const { tool, route } = await mirror(section("Lead", SP_X, SUN_B));
    expect(sc(tool.response)).toEqual({
      refused: true,
      code: "ambiguous_target",
      detail: "duplicate_special_identity",
      serviceId: "role-sp-x",
    });
    expect(textOf(tool.response)).toContain(
      "El especial «Retiro de jóvenes» del 2028-10-28: hay otro servicio especial ese mismo día con el mismo nombre",
    );
    expectRouteCommits(route);
  });

  it("S2c: a raw draft of the role's OWN id (readiness draft_conflict) — the route alone refuses too", async () => {
    const { tool, route } = await mirror(section("Lead", OVERLAID, SUN_B));
    expect(sc(tool.response)).toEqual({
      refused: true,
      code: "integrity_conflict",
      detail: "raw_draft",
      serviceId: "role-sun-overlaid",
    });
    expect(textOf(tool.response)).toBe(
      `El domingo 2028-10-12: hay un borrador de Studio sobre ese servicio, y /admin → Servicios no lo deja intercambiar; descártalo o publícalo en Studio y vuelve a leer. ${NOTHING_WRITTEN}`,
    );
    expect(route.response).toMatchObject({
      status: 409,
      body: { error: "integrity_conflict", details: { rawDrafts: ["drafts.role-sun-overlaid"] } },
    });
    expect(route.transactions).toEqual([]);
  });

  it("S2c: a raw draft of ANOTHER id at a weekend target — the route alone commits", async () => {
    const { tool, route } = await mirror(section("Lead", GHOSTED, SUN_B));
    expect(sc(tool.response)).toEqual({
      refused: true,
      code: "integrity_conflict",
      detail: "raw_draft",
      serviceId: "role-sun-ghosted",
    });
    expect(textOf(tool.response)).toContain("borrador de Studio");
    expectRouteCommits(route);
  });

  it("S2c: a special's same-name draft of another id — the route alone commits", async () => {
    const { tool, route } = await mirror(section("Lead", SP_VIGILIA, SUN_B));
    expect(sc(tool.response)).toEqual({
      refused: true,
      code: "integrity_conflict",
      detail: "raw_draft",
      serviceId: "role-sp-vigilia",
    });
    expectRouteCommits(route);
  });

  it("S2d: a dangling assignment in a section that is NOT moved — the route alone commits", async () => {
    const { tool, route } = await mirror(section("Lead", DANGLING, SUN_B));
    expect(sc(tool.response)).toEqual({
      refused: true,
      code: "integrity_conflict",
      detail: "dangling_assignment",
      serviceId: "role-sun-dangling",
    });
    expect(textOf(tool.response)).toContain("ya no existe como miembro");
    expectRouteCommits(route);
  });

  it("S2f: a special with a blank name — the route alone commits", async () => {
    const { tool, route } = await mirror(section("Lead", BLANK_SP, SUN_B));
    expect(sc(tool.response)).toEqual({
      refused: true,
      code: "integrity_conflict",
      detail: "invalid_special_name",
      serviceId: "role-sp-blank",
    });
    expect(textOf(tool.response)).toContain("El especial sin nombre del 2028-10-03: el servicio especial no tiene nombre");
    expectRouteCommits(route);
  });

  it("S2g: a legacy weekend role with no lock — the tool writes NOTHING, the route alone commits the bootstrap", async () => {
    const { tool, route } = await mirror(section("Lead", NO_LOCK, SUN_B));
    expect(sc(tool.response)).toEqual({
      refused: true,
      code: "integrity_conflict",
      detail: "lock:missing_lock",
      serviceId: "role-sun-nolock",
    });
    expect(textOf(tool.response)).toBe(
      `El domingo 2028-10-04 es un servicio antiguo sin su dato de coordinación; guárdalo una vez desde el planner de /admin y vuelve a leer. ${NOTHING_WRITTEN}`,
    );
    expect(tool.store.docs.has(lockIdOf(NO_LOCK))).toBe(false);
    // The route alone: a maintenance commit, then `bootstrap_completed_reload`.
    expect(route.response).toMatchObject({ status: 409, body: { error: "bootstrap_completed_reload" } });
    expect(route.transactions).toHaveLength(1);
    expect(route.store.docs.has(lockIdOf(NO_LOCK))).toBe(true);
  });

  it("S2g (invalid_lock): a wrong-owner lock — the route alone refuses too", async () => {
    const { tool, route } = await mirror(section("Lead", WRONG_LOCK, SUN_B));
    expect(sc(tool.response)).toEqual({
      refused: true,
      code: "integrity_conflict",
      detail: "lock:wrong_owner",
      serviceId: "role-sun-wronglock",
    });
    expect(textOf(tool.response)).toContain("su dato de coordinación del fin de semana pertenece a otro servicio");
    expect(route.response).toMatchObject({ status: 409, body: { error: "integrity_conflict", details: { detail: "lock_wrong_owner" } } });
    expect(route.transactions).toEqual([]);
  });

  it("S4: the members source is not ready — «no se pudo comprobar»; the route alone (whose reads work) commits", async () => {
    const unready = queries({
      "members by id": () => {
        throw new Error("members read failed");
      },
    });
    const { tool, route } = await mirror(section("Lead", SUN_A, SUN_B), { ...OPTIONS, queries: unready });
    expect(sc(tool.response)).toEqual({ refused: true, code: "integrity_conflict", detail: "sources:members" });
    expect(textOf(tool.response)).toBe(`${SWAP_SOURCES_UNREADY_TEXT} ${NOTHING_WRITTEN}`);
    expectRouteCommits(route);
  });
});

// ── Reports ──────────────────────────────────────────────────────────────────

describe("swap_assignment — the report", () => {
  it("a worship-night Lead swap names the orphaned song leaders (reported, never refused)", async () => {
    const { route, tool } = await twinOf(section("Lead", WN_A, WN_B));
    expectCommittedParity(route, tool);
    const report = sc<{ songLeadsOrphaned: OrphanedSongLeads[] }>(tool.response);
    expect(report.songLeadsOrphaned).toEqual([
      {
        serviceId: "role-wn-a",
        position: 1,
        songId: "song-1",
        songTitle: "Cuán grande es Él",
        leaders: [{ memberId: "mem-kike", name: "Kike" }],
      },
    ]);
    expect(textOf(tool.response)).toContain(
      `El especial «Noche de alabanza» del 2028-10-10: «Cuán grande es Él» todavía nombra como líder a Kike, que ya no está en Lead; ${SONG_LEADS_ORPHANED_NOTE}.`,
    );
    // The songs themselves were not touched.
    expect(doc(tool.store, "role-wn-a").songs).toEqual(WN_A.songs);
  });

  it("a non-Lead swap on a worship night orphans nobody", async () => {
    const { tool } = await twinOf(section("BGVs", WN_A, WN_B));
    expect(sc<{ songLeadsOrphaned: OrphanedSongLeads[] }>(tool.response).songLeadsOrphaned).toEqual([]);
    expect(tool.reads.some((r) => r.label === "song titles")).toBe(false);
  });

  it("a cross-date swap names a member now placed on a day they marked unavailable", async () => {
    const { tool } = await twinOf(section("Lead", SUN_A, SUN_B));
    const report = sc<{ unavailablePlaced: UnavailablePlacement[] }>(tool.response);
    expect(report.unavailablePlaced).toEqual([
      { serviceId: "role-sun-a", date: "2028-10-01", memberId: "mem-fer", name: "Fer", note: "Viaje" },
    ]);
    expect(textOf(tool.response)).toContain(
      "Atención: Fer quedó en el domingo 2028-10-01, pero marcó ese día como no disponible («Viaje»).",
    );
  });

  it("a same-member no-op names nobody, even though that member is unavailable on both days", async () => {
    const { route, tool } = await twinOf(section("Lead", SAME_A, SAME_B));
    expectCommittedParity(route, tool);
    const report = sc<{ unavailablePlaced: UnavailablePlacement[] }>(tool.response);
    expect(report.unavailablePlaced).toEqual([]);
    expect(textOf(tool.response)).not.toContain("Atención:");
    // Nobody was added, so nobody is pushed; the outbox still hears from Ana.
    expect(route.pushes).toEqual([]);
  });

  describe("freshRevs (D8)", () => {
    it("is returned when the read-back is exactly the written state", async () => {
      const run = await t.runTool(OPTIONS, call(team(DRAFT_SUN, DRAFT_SP)));
      expect(sc<{ freshRevs: FreshRev[] }>(run.response).freshRevs).toEqual([
        { serviceId: "role-sun-draft", rev: "twin-rev-1" },
        { serviceId: "role-sp-draft", rev: "twin-rev-1" },
      ]);
      expect(textOf(run.response)).toContain("Las revisiones nuevas de los dos servicios van en freshRevs");
    });

    it("is withheld when the read-back differs only by one item's _key", async () => {
      const queries_ = readBackEdited((rows) => {
        const row = rows.find((r) => r._id === "role-sun-a") as Record<string, unknown>;
        const lead = row.Lead as Record<string, unknown>[];
        row.Lead = [{ ...lead[0], _key: "rekeyed" }];
      });
      const run = await t.runTool({ ...OPTIONS, queries: queries_ }, call(section("Lead", SUN_A, SUN_B)));
      expect(run.response.isError).toBeUndefined();
      const fresh = sc<{ freshRevs: FreshRev[] }>(run.response).freshRevs;
      expect(fresh[0]).toEqual({
        serviceId: "role-sun-a",
        changedAgainAfterSave: true,
        current: {
          date: "2028-10-01",
          published: "published",
          seats: {
            Lead: ["Fer"],
            BGVs: ["Beto"],
            Chorus: ["Caro"],
            instruments: ["Bajo: Dani"],
            foh_team: ["Sonido: Eli"],
          },
        },
      });
      expect(fresh[0]).not.toHaveProperty("rev");
      expect(fresh[1]).toEqual({ serviceId: "role-sun-b", rev: "twin-rev-1" });
      expect(textOf(run.response)).toContain(
        "El domingo 2028-10-01 cambió otra vez después del intercambio; vuelve a leer con get_service antes de otra escritura.",
      );
    });

    it("is withheld when the read-back differs only in a field the swap did not write: a special's time", async () => {
      const queries_ = readBackEdited((rows) => {
        (rows.find((r) => r._id === "role-sp-draft") as Record<string, unknown>).time = "19:30";
      });
      const run = await t.runTool({ ...OPTIONS, queries: queries_ }, call(section("Lead", DRAFT_SUN, DRAFT_SP)));
      const fresh = sc<{ freshRevs: FreshRev[] }>(run.response).freshRevs;
      expect(fresh[0]).toEqual({ serviceId: "role-sun-draft", rev: "twin-rev-1" });
      expect(fresh[1]).toMatchObject({ serviceId: "role-sp-draft", changedAgainAfterSave: true });
      expect(fresh[1]).not.toHaveProperty("rev");
    });

    it("is withheld when the read-back differs only in one song's play_key", async () => {
      const queries_ = readBackEdited((rows) => {
        const row = rows.find((r) => r._id === "role-sp-draft") as Record<string, unknown>;
        const songs = row.songs as Record<string, unknown>[];
        row.songs = [{ ...songs[0], play_key: "A" }];
      });
      const run = await t.runTool({ ...OPTIONS, queries: queries_ }, call(section("Lead", DRAFT_SUN, DRAFT_SP)));
      const fresh = sc<{ freshRevs: FreshRev[] }>(run.response).freshRevs;
      expect(fresh[1]).toMatchObject({ serviceId: "role-sp-draft", changedAgainAfterSave: true });
      expect(fresh[1]).not.toHaveProperty("rev");
    });

    it("is withheld when the service is gone from the read-back", async () => {
      const queries_ = readBackEdited((rows) => {
        rows.splice(rows.findIndex((r) => r._id === "role-sun-b"), 1);
      });
      const run = await t.runTool({ ...OPTIONS, queries: queries_ }, call(section("Lead", SUN_A, SUN_B)));
      const fresh = sc<{ freshRevs: FreshRev[] }>(run.response).freshRevs;
      expect(fresh[1]).toEqual({ serviceId: "role-sun-b", changedAgainAfterSave: true, current: null });
    });

    it("a failed read-back degrades only freshRevs: the committed swap stays ok", async () => {
      const queries_ = queries({
        "roles by ids (read-back)": () => {
          throw new Error("read-back failed");
        },
      });
      const run = await t.runTool({ ...OPTIONS, queries: queries_ }, call(section("Lead", SUN_A, SUN_B)));
      expect(run.response.isError).toBeUndefined();
      expect(sc<{ ok: boolean; freshRevs: FreshRev[] | null }>(run.response)).toMatchObject({ ok: true, freshRevs: null });
      expect(textOf(run.response)).toContain(READ_BACK_FAILED_TEXT);
      expect(run.transactions).toHaveLength(1);
    });
  });

  it("a failed member lookup after the commit degrades names and availability, never the write", async () => {
    const queries_ = queries({
      "members by id": (store, p) => {
        if (committed(store)) throw new Error("members read failed");
        return ROWS["members by id"](store, p);
      },
    });
    const run = await t.runTool({ ...OPTIONS, queries: queries_ }, call(section("Lead", SUN_A, SUN_B)));
    expect(run.response.isError).toBeUndefined();
    const report = sc<{ services: SwapServiceReport[]; unavailablePlaced: UnavailablePlacement[] | null }>(run.response);
    expect(report.unavailablePlaced).toBeNull();
    expect(report.services[0].moved.Lead).toEqual({
      before: ["mem-ana (nombre no resuelto)"],
      after: ["mem-fer (nombre no resuelto)"],
    });
    expect(textOf(run.response)).toContain("No se pudo comprobar la disponibilidad de las personas que entraron");
    expect(run.transactions).toHaveLength(1);
  });

  it("a failed song-title read leaves the orphaned song named by its position", async () => {
    const queries_ = queries({
      "song titles": () => {
        throw new Error("titles read failed");
      },
    });
    const run = await t.runTool({ ...OPTIONS, queries: queries_ }, call(section("Lead", WN_A, WN_B)));
    expect(run.response.isError).toBeUndefined();
    const report = sc<{ songLeadsOrphaned: OrphanedSongLeads[] }>(run.response);
    expect(report.songLeadsOrphaned[0]).toMatchObject({ songId: "song-1", songTitle: null });
    expect(textOf(run.response)).toContain("la canción 1 todavía nombra como líder a Kike");
  });
});
