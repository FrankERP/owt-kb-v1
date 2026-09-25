// Test-only fixture matrix for the MCP service snapshot (P1 step 2) — NOT a
// test file (no `.test.` in the name, so vitest's `include` never picks it up).
//
// One store of rows, shaped exactly as the canonical builders in
// `serviceReadQueries.ts` project them (GROQ projects an absent field as `null`,
// so the rows carry `null`, not a missing key), plus a responder that answers
// `operationalClient.fetch` / `rawIntegrityClient.fetch` from that store, keyed
// by the builders' OWN query text. Nothing here hand-copies GROQ: the table is
// built by calling the builders, so a builder edit moves the fixture with it.
//
// Step 2 runs `loadServiceReadinessSources()` and `loadServiceSnapshot()` over
// it (parity). Step 3 reuses the same store to run the real publish-ready route
// against the same services — the field names of `ServiceFixtureStore` match
// the `Store` in `app/api/__tests__/publishReadyRoutes.test.ts` on purpose, and
// `fixtureFetchTable` answers every query that route's loader issues.
//
// `SERVICE_FIXTURE_CASES` says which services are expected to be ready to
// publish; `serviceSnapshotParity.test.ts` asserts that claim against the real
// readiness chain, so the note cannot go stale silently.

import {
  allRoleTargetLocksQuery,
  canonicalMembersByIdsQuery,
  canonicalProposalsQuery,
  canonicalRolesQuery,
  canonicalSetlistsQuery,
  rawProposalDraftsQuery,
  rawRoleDraftsQuery,
  rawSetlistDraftsQuery,
  type BoundQuery,
} from "@/app/utils/serviceReadQueries";

type Row = Record<string, unknown>;

/** Same field names as `publishReadyRoutes.test.ts`'s `Store`. */
export interface ServiceFixtureStore {
  roles: Row[];
  locks: Row[];
  members: Row[];
  setlists: Row[];
  proposals: Row[];
  rawRoleDrafts: Row[];
  rawSetlistDrafts: Row[];
  rawProposalDrafts: Row[];
}

// ── Row builders (projection-shaped) ────────────────────────────────────────

const reference = (key: string, id: string) => ({ _key: key, _type: "reference", _ref: id });

function songRow(key: string, songId: string, playKey: string | null, leads: Row[] | null = null): Row {
  return {
    _key: key,
    play_key: playKey,
    medley_tag: null,
    song: { _type: "reference", _ref: songId },
    leads,
  };
}

/** Every `ROLE_PROJECTION` key, `null` unless given — what GROQ returns for an absent field. */
function role(over: Row): Row {
  return {
    _id: null,
    _rev: null,
    _type: null,
    published: null,
    week: null,
    date: null,
    service_name: null,
    time: null,
    format: null,
    creationReceiptId: null,
    creationFingerprint: null,
    Lead: [],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    songs: null,
    ...over,
  };
}

function setlist(id: string, type: string, week: string, songs: Row[] | null): Row {
  return { _id: id, _rev: `${id}-rev`, _type: type, week, songs };
}

function lock(roleType: string, date: string, roleId: string | null, over: Row = {}): Row {
  return {
    _id: `roleTarget.${roleType}.${date}`,
    _rev: `lock-${roleType}-${date}-rev`,
    _type: "roleTargetLock",
    targetKey: `${roleType}:${date}`,
    state: roleId ? "claimed" : "vacant",
    roleId,
    roleType,
    date,
    claimNonce: `nonce-${date}`,
    generation: 1,
    ...over,
  };
}

function member(id: string, name: string, over: Row = {}): Row {
  return {
    _id: id,
    _rev: `${id}-rev`,
    member_name: name,
    alias: null,
    unavailableDates: null,
    unavailabilityNotes: null,
    ...over,
  };
}

function proposal(over: Row): Row {
  return {
    _id: null,
    _rev: null,
    _createdAt: "2026-09-20T15:00:00Z",
    service_type: null,
    service_ref: null,
    service_date: null,
    status: null,
    songs: null,
    contributors: null,
    lead: null,
    lead_notes: null,
    team_notes: null,
    admin_notes: null,
    messages: null,
    approval_receipt: null,
    last_transition: null,
    ...over,
  };
}

function message(key: string, author: string | null, authorRole: string, kind: string, body: string, at: string): Row {
  return { _key: key, _type: "proposal_message", author, author_role: authorRole, kind, body, at };
}

// ── The matrix ──────────────────────────────────────────────────────────────

export interface ServiceFixtureCase {
  roleId: string;
  /** What this service exercises. */
  covers: string;
  /** `assembleService(...).readiness.isReadyToPublish` for this service. */
  readyToPublish: boolean;
}

export const SERVICE_FIXTURE_CASES: readonly ServiceFixtureCase[] = [
  {
    roleId: "role-sun-1004",
    covers: "published Sunday with a clean weekend setlist, lock, all five seat paths",
    readyToPublish: false, // operationally ready, but already published
  },
  {
    roleId: "role-sat-1003",
    covers: "draft Saturday (`published: false`), clean setlist, approved proposal",
    readyToPublish: true,
  },
  {
    roleId: "role-sun-1011",
    covers: "legacy role with no `published` field, no setlist, pending proposal, availability conflict",
    readyToPublish: false,
  },
  {
    roleId: "role-sp-1017-a",
    covers: "draft special with `songs: []` (an empty embedded setlist)",
    readyToPublish: false,
  },
  {
    roleId: "role-sp-1017-b",
    covers: "draft special with no `songs` (projected as null: no setlist target)",
    readyToPublish: false,
  },
  {
    roleId: "role-sp-1024-wn",
    covers: "draft worship-night special whose songs name leaders (`leads`)",
    readyToPublish: true,
  },
  {
    roleId: "role-sun-1018",
    covers: "draft Sunday whose setlist has a raw `drafts.*` overlay",
    readyToPublish: false,
  },
  {
    roleId: "role-sun-1025",
    covers: "draft Sunday with two setlist documents for its week, a dangling seat and a raw proposal draft",
    readyToPublish: false,
  },
  {
    roleId: "role-sat-1010",
    covers: "draft Saturday with no weekend lock (missing_lock), otherwise clean",
    readyToPublish: false,
  },
  {
    roleId: "role-sun-1108-invalid",
    covers: "structurally invalid Sunday (a null seat) with a raw role draft overlay",
    readyToPublish: false,
  },
  {
    roleId: "role-sun-1115-live",
    covers: "published (live) Sunday that lost its setlist: a readiness gap on a published service",
    readyToPublish: false,
  },
  {
    roleId: "role-sun-1122-a",
    covers: "draft Sunday sharing its week with a second canonical role (duplicate target), owns the lock: a hard blocker with a usable observation",
    readyToPublish: false,
  },
  {
    roleId: "role-sun-1122-b",
    covers: "the second canonical Sunday on the same week, not the lock owner: a hard blocker with a usable observation",
    readyToPublish: false,
  },
];

/** Every canonical role id in the matrix. */
export const SERVICE_FIXTURE_ROLE_IDS: readonly string[] = SERVICE_FIXTURE_CASES.map((c) => c.roleId);

/** Ids `assembleService` must also agree on: a draft-only role and an id that names nothing. */
export const SERVICE_FIXTURE_EXTRA_IDS: readonly string[] = ["drafts.role-sp-draftonly", "role-missing"];

/** A member referenced only by proposals (lead / contributor / message author), never seated. */
export const UNSEATED_MEMBER_ID = "mem-pablo";

/** A fresh, independently mutable copy of the matrix. */
export function serviceFixtureStore(): ServiceFixtureStore {
  const ana = "mem-ana";
  const luis = "mem-luis";
  const sofia = "mem-sofia";

  return {
    roles: [
      role({
        _id: "role-sun-1004",
        _rev: "role-sun-1004-rev",
        _type: "sunday_role",
        week: "2026-10-04",
        published: true,
        Lead: [reference("l1", ana)],
        BGVs: [reference("b1", sofia)],
        Chorus: [reference("c1", luis)],
        instruments: [
          { _key: "i1", _type: "instrument_slot", instrument: "Bajo", person: { _type: "reference", _ref: luis } },
        ],
        foh_team: [{ _key: "f1", _type: "foh_slot", role: "Sonido", person: { _type: "reference", _ref: sofia } }],
      }),
      role({
        _id: "role-sat-1003",
        _rev: "role-sat-1003-rev",
        _type: "saturday_role",
        week: "2026-10-03",
        published: false,
        Lead: [reference("l1", ana)],
        Chorus: [reference("c1", luis)],
      }),
      // Legacy: the stored document predates `published`, so the projection says null.
      role({
        _id: "role-sun-1011",
        _rev: "role-sun-1011-rev",
        _type: "sunday_role",
        week: "2026-10-11",
        Lead: [reference("l1", luis)],
      }),
      role({
        _id: "role-sp-1017-a",
        _rev: "role-sp-1017-a-rev",
        _type: "special_role",
        date: "2026-10-17",
        service_name: "Campamento · Mañana",
        time: "09:00",
        published: false,
        Lead: [reference("l1", ana)],
        songs: [],
      }),
      role({
        _id: "role-sp-1017-b",
        _rev: "role-sp-1017-b-rev",
        _type: "special_role",
        date: "2026-10-17",
        service_name: "Campamento · Noche",
        time: "19:00",
        published: false,
        Lead: [reference("l1", sofia)],
        songs: null,
      }),
      role({
        _id: "role-sp-1024-wn",
        _rev: "role-sp-1024-wn-rev",
        _type: "special_role",
        date: "2026-10-24",
        service_name: "Noche de alabanza",
        format: "worship_night",
        published: false,
        Lead: [reference("l1", ana), reference("l2", luis)],
        songs: [
          songRow("r1", "song-1", "D", [reference("ld1", ana)]),
          songRow("r2", "song-2", "G", [reference("ld1", ana), reference("ld2", luis)]),
        ],
      }),
      role({
        _id: "role-sun-1018",
        _rev: "role-sun-1018-rev",
        _type: "sunday_role",
        week: "2026-10-18",
        published: false,
        Lead: [reference("l1", sofia)],
      }),
      role({
        _id: "role-sun-1025",
        _rev: "role-sun-1025-rev",
        _type: "sunday_role",
        week: "2026-10-25",
        published: false,
        Lead: [reference("l1", ana)],
        BGVs: [reference("b1", "mem-ghost")],
      }),
      role({
        _id: "role-sat-1010",
        _rev: "role-sat-1010-rev",
        _type: "saturday_role",
        week: "2026-10-10",
        published: false,
        Lead: [reference("l1", ana)],
      }),
      role({
        _id: "role-sun-1108-invalid",
        _rev: "role-sun-1108-invalid-rev",
        _type: "sunday_role",
        week: "2026-11-08",
        published: false,
        Lead: [reference("l1", ana)],
        Chorus: null,
      }),
      // Live, locked, clean — but no setlist document for its week.
      role({
        _id: "role-sun-1115-live",
        _rev: "role-sun-1115-live-rev",
        _type: "sunday_role",
        week: "2026-11-15",
        published: true,
        Lead: [reference("l1", sofia)],
      }),
      // Two canonical Sundays on one week (a duplicate target) and ONE claimed
      // lock, owned by the first. The target is a hard blocker, yet each role's
      // observation stays usable — the only case in the matrix where
      // `hard_integrity_blocker` comes without `unusable_observation`.
      ...["role-sun-1122-a", "role-sun-1122-b"].map((id) =>
        role({
          _id: id,
          _rev: `${id}-rev`,
          _type: "sunday_role",
          week: "2026-11-22",
          published: false,
          Lead: [reference("l1", ana)],
          BGVs: [reference("b1", sofia)],
          Chorus: [reference("c1", luis)],
          instruments: [
            { _key: "i1", _type: "instrument_slot", instrument: "Bajo", person: { _type: "reference", _ref: luis } },
          ],
          foh_team: [{ _key: "f1", _type: "foh_slot", role: "Sonido", person: { _type: "reference", _ref: sofia } }],
        }),
      ),
    ],
    locks: [
      lock("sunday_role", "2026-10-04", "role-sun-1004"),
      lock("saturday_role", "2026-10-03", "role-sat-1003"),
      lock("sunday_role", "2026-10-11", "role-sun-1011"),
      lock("sunday_role", "2026-10-18", "role-sun-1018"),
      lock("sunday_role", "2026-10-25", "role-sun-1025"),
      // role-sat-1010 has NO lock (missing_lock). This one is claimed by a role
      // that no longer exists (orphan_lock) and sits at a target nobody owns.
      lock("sunday_role", "2026-11-01", "role-deleted"),
      lock("sunday_role", "2026-11-15", "role-sun-1115-live"),
      lock("sunday_role", "2026-11-22", "role-sun-1122-a"),
    ],
    members: [
      member(ana, "Ana", { unavailableDates: [] }),
      member(luis, "Luis", {
        alias: "Lucho",
        unavailableDates: ["2026-10-11"],
        unavailabilityNotes: [{ date: "2026-10-11", note: "Viaje" }],
      }),
      member(sofia, "Sofía"),
      member(UNSEATED_MEMBER_ID, "Pablo"),
      // "mem-ghost" is referenced by role-sun-1025 and deliberately absent: dangling.
    ],
    setlists: [
      setlist("set-sun-1004", "featuredSongs", "2026-10-04", [
        songRow("r1", "song-1", "G"),
        songRow("r2", "song-2", "A"),
      ]),
      setlist("set-sat-1003", "saturdarSongs", "2026-10-03", [songRow("r1", "song-3", "E")]),
      setlist("set-sun-1018", "featuredSongs", "2026-10-18", [songRow("r1", "song-1", "G")]),
      setlist("set-sun-1025-a", "featuredSongs", "2026-10-25", [songRow("r1", "song-1", "G")]),
      setlist("set-sun-1025-b", "featuredSongs", "2026-10-25", [songRow("r1", "song-2", "C")]),
      setlist("set-sat-1010", "saturdarSongs", "2026-10-10", [songRow("r1", "song-3", "E")]),
    ],
    proposals: [
      proposal({
        _id: "prop-sat-1003",
        _rev: "prop-sat-1003-rev",
        service_type: "saturday",
        service_ref: "role-sat-1003",
        service_date: "2026-10-03",
        status: "approved",
        songs: [songRow("r1", "song-3", "E")],
        contributors: [{ _key: "p1", person: UNSEATED_MEMBER_ID }],
        lead: ana,
        messages: [message("m1", UNSEATED_MEMBER_ID, "lead", "lead_note", "Propuesta lista", "2026-09-21T18:00:00Z")],
      }),
      proposal({
        _id: "prop-sun-1011",
        _rev: "prop-sun-1011-rev",
        service_type: "sunday",
        service_ref: "role-sun-1011",
        service_date: "2026-10-11",
        status: "pending",
        songs: [songRow("r1", "song-2", null)],
        contributors: [{ _key: "p1", person: UNSEATED_MEMBER_ID }],
        lead: luis,
        lead_notes: "Nota congelada (archivo)",
        messages: [
          message("m1", luis, "lead", "lead_note", "¿Bajamos el tono?", "2026-09-22T17:00:00Z"),
          message("m2", null, "admin", "admin_change_request", "Sí, a F", "2026-09-22T19:30:00Z"),
        ],
      }),
      // Points at a role that does not exist: an invalid proposal record.
      proposal({
        _id: "prop-orphan",
        _rev: "prop-orphan-rev",
        service_type: "special",
        service_ref: "role-missing",
        service_date: "2026-10-31",
        status: "pending",
        songs: [],
        lead: ana,
      }),
    ],
    rawRoleDrafts: [
      // Overlay on an invalid canonical role, and one draft with no canonical base.
      role({
        _id: "drafts.role-sun-1108-invalid",
        _rev: "drafts.role-sun-1108-invalid-rev",
        _type: "sunday_role",
        week: "2026-11-08",
        published: false,
        Lead: [reference("l1", ana)],
      }),
      role({
        _id: "drafts.role-sp-draftonly",
        _rev: "drafts.role-sp-draftonly-rev",
        _type: "special_role",
        date: "2026-10-31",
        service_name: "Solo borrador",
        published: false,
      }),
    ],
    rawSetlistDrafts: [setlist("drafts.set-sun-1018", "featuredSongs", "2026-10-18", [songRow("r1", "song-2", "A")])],
    rawProposalDrafts: [
      proposal({
        _id: "drafts.prop-sun-1025",
        _rev: "drafts.prop-sun-1025-rev",
        service_type: "sunday",
        service_ref: "role-sun-1025",
        service_date: "2026-10-25",
        status: "draft",
        lead: ana,
      }),
    ],
  };
}

/** An empty catalogue: no roles means no member references and no members round trip. */
export function emptyFixtureStore(): ServiceFixtureStore {
  return {
    roles: [],
    locks: [],
    members: [],
    setlists: [],
    proposals: [],
    rawRoleDrafts: [],
    rawSetlistDrafts: [],
    rawProposalDrafts: [],
  };
}

// ── The fetch table, keyed by the builders' own query text ──────────────────

/** The eight reads `loadServiceReadinessSources` issues, one per domain. */
export type ReadinessDomain =
  | "roles"
  | "roleDrafts"
  | "locks"
  | "setlists"
  | "setlistDrafts"
  | "proposals"
  | "proposalDrafts"
  | "members";

export const READINESS_DOMAINS: readonly ReadinessDomain[] = [
  "roles",
  "roleDrafts",
  "locks",
  "setlists",
  "setlistDrafts",
  "proposals",
  "proposalDrafts",
  "members",
];

export type FixtureClient = "operational" | "raw";

export interface FixtureTableEntry {
  domain: ReadinessDomain;
  /** The ONE client this query may run on; the other answers with a rejection. */
  client: FixtureClient;
  /** The builder's own params, or null where they vary by call (the member ids). */
  params: Record<string, unknown> | null;
  rows: (params: Record<string, unknown>) => Row[];
}

export function fixtureFetchTable(store: ServiceFixtureStore): Map<string, FixtureTableEntry> {
  const entries: [BoundQuery, Omit<FixtureTableEntry, "params">, boolean][] = [
    [canonicalRolesQuery(), { domain: "roles", client: "operational", rows: () => store.roles }, true],
    [rawRoleDraftsQuery(), { domain: "roleDrafts", client: "raw", rows: () => store.rawRoleDrafts }, true],
    [allRoleTargetLocksQuery(), { domain: "locks", client: "operational", rows: () => store.locks }, true],
    [canonicalSetlistsQuery(), { domain: "setlists", client: "operational", rows: () => store.setlists }, true],
    [rawSetlistDraftsQuery(), { domain: "setlistDrafts", client: "raw", rows: () => store.rawSetlistDrafts }, true],
    [canonicalProposalsQuery(), { domain: "proposals", client: "operational", rows: () => store.proposals }, true],
    [
      rawProposalDraftsQuery(),
      { domain: "proposalDrafts", client: "raw", rows: () => store.rawProposalDrafts },
      true,
    ],
    [
      canonicalMembersByIdsQuery([]),
      {
        domain: "members",
        client: "operational",
        rows: (params) => {
          const ids = Array.isArray(params.ids) ? params.ids : [];
          return store.members.filter((m) => ids.includes(m._id));
        },
      },
      false,
    ],
  ];
  const table = new Map<string, FixtureTableEntry>();
  for (const [bound, entry, fixedParams] of entries) {
    table.set(bound.query, { ...entry, params: fixedParams ? bound.params : null });
  }
  return table;
}

export interface FixtureCall {
  client: FixtureClient;
  domain: ReadinessDomain;
  params: Record<string, unknown>;
}

export interface FixtureResponderOptions {
  /** Domains whose read rejects, as a Sanity outage would. */
  fail?: readonly ReadinessDomain[];
  /**
   * Suffix every returned `_rev` with the domain's call count (`#1`, `#2`, …),
   * as if a writer committed between two reads. A loader that reads one domain
   * twice then holds two revisions of the same document.
   */
  revisionDrift?: boolean;
}

/** The text a failed fixture read throws — it must never reach a log line. */
export const FIXTURE_FAILURE_SECRET = "token=sk-fixture-secret dataset=production";

export interface FixtureResponder {
  operational: (query: string, params?: Record<string, unknown>) => Promise<Row[]>;
  raw: (query: string, params?: Record<string, unknown>) => Promise<Row[]>;
  /** Every read served, in arrival order. */
  calls: FixtureCall[];
}

/**
 * Answers both clients from one table. A query the table does not know, a query
 * on the wrong client, or a fixed-param query with different params rejects —
 * the loader under test then reports that domain as failed, so a drift from the
 * builders shows up as a parity failure instead of passing quietly.
 */
export function createFixtureResponder(
  store: ServiceFixtureStore,
  options: FixtureResponderOptions = {},
): FixtureResponder {
  const table = fixtureFetchTable(store);
  const fail = new Set(options.fail ?? []);
  const counts = new Map<ReadinessDomain, number>();
  const calls: FixtureCall[] = [];

  const serve = (client: FixtureClient) => async (query: string, params: Record<string, unknown> = {}) => {
    const entry = table.get(query);
    if (!entry) throw new Error(`fixture: unknown query on ${client}: ${query.slice(0, 60)}`);
    if (entry.client !== client) throw new Error(`fixture: ${entry.domain} read on the ${client} client`);
    if (entry.params && JSON.stringify(entry.params) !== JSON.stringify(params)) {
      throw new Error(`fixture: ${entry.domain} read with unexpected params`);
    }
    calls.push({ client, domain: entry.domain, params });
    const n = (counts.get(entry.domain) ?? 0) + 1;
    counts.set(entry.domain, n);
    if (fail.has(entry.domain)) throw new Error(`fixture: ${entry.domain} failed ${FIXTURE_FAILURE_SECRET}`);
    const rows = structuredClone(entry.rows(params));
    if (options.revisionDrift) {
      for (const row of rows) {
        if (typeof row._rev === "string") row._rev = `${row._rev}#${n}`;
      }
    }
    return rows;
  };

  return { operational: serve("operational"), raw: serve("raw"), calls };
}
