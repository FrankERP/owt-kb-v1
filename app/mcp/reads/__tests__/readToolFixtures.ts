// Test-only fixtures for the P1 step 4 read tools (`get_service`,
// `list_services`) — NOT a test file (no `.test.` in the name).
//
// `readToolStore()` is step 2's matrix (`serviceFixtureStore()`) PLUS the rows
// these tools need and the matrix lacks. The extra rows are layered onto a FRESH
// copy here, never added to `serviceFixtureStore()` itself: step 2's parity test
// pins that matrix exactly (its draft-id lists, its lock issues, its seated
// members), and it must pass untouched.
//
// `scopedResponder()` answers what `createFixtureResponder` deliberately does
// not: the writer's own TARGET-SCOPED reads (`loadWeekendSetlistTarget`,
// `loadSpecialSetlistTarget`) and the MCP's one `post` query. Everything else
// falls through to the strict step-2 responder UNCHANGED, so an unknown query
// or a read on the wrong client is still refused.

import {
  canonicalRoleByIdQuery,
  canonicalSetlistsForTargetQuery,
  rawRoleDraftForBaseQuery,
  rawSetlistDraftsForWeekQuery,
} from "@/app/utils/serviceReadQueries";
import { songTitlesQuery } from "../songTitles";
import {
  createFixtureResponder,
  serviceFixtureStore,
  type FixtureClient,
  type FixtureResponder,
  type FixtureResponderOptions,
  type ServiceFixtureStore,
} from "./serviceFixtures";

type Row = Record<string, unknown>;

/**
 * 23:30 in Mexico City on 2026-09-30 — already 2026-10-01 in UTC. A "today" read
 * in UTC instead of CDMX skips the 2026-09-30 services and picks 2026-10-03.
 */
export const FROZEN_EVENING = "2026-09-30T23:30:00-06:00";

/** A member who serves in kids only — still shown where she is seated (spec I5's seat exception). */
export const KIDS_ONLY_MEMBER_ID = "mem-kiki";

const ref = (key: string, id: string) => ({ _key: key, _type: "reference", _ref: id });

function songRow(key: string, songId: string, playKey: string | null, medleyTag: string | null = null, leads: Row[] | null = null): Row {
  return { _key: key, play_key: playKey, medley_tag: medleyTag, song: { _type: "reference", _ref: songId }, leads };
}

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

function lock(roleType: string, date: string, roleId: string): Row {
  return {
    _id: `roleTarget.${roleType}.${date}`,
    _rev: `lock-${roleType}-${date}-rev`,
    _type: "roleTargetLock",
    targetKey: `${roleType}:${date}`,
    state: "claimed",
    roleId,
    roleType,
    date,
    claimNonce: `nonce-${date}`,
    generation: 1,
  };
}

/**
 * The song documents, as `post` stores them — deliberately carrying the heavy
 * fields (`body`, `chords`, mix `peaks`) that must never reach a payload. The
 * responder returns them raw, so only the tool's own shaping keeps them out.
 */
export const SONG_POSTS: readonly Row[] = [
  {
    _id: "song-1",
    title: "Grande es tu fidelidad",
    author: "Thomas Chisholm",
    body: [{ _type: "block", children: [{ text: "letra" }] }],
    chords: [{ key: "G", content: "[G]Grande" }],
    rehearsalMixes: [{ _key: "mx1", tone: "G", peaks: [0.1, 0.2] }],
  },
  { _id: "song-2", title: "Cuán grande es Él", author: "Carl Boberg" },
  { _id: "song-3", title: "Santo, santo, santo", author: "Reginald Heber" },
];

/**
 * Step 2's matrix plus the rows `get_service` / `list_services` need:
 *
 * - `role-sun-0927`: a PAST Sunday — never the next upcoming service.
 * - `role-sp-0930-a` (07:00) / `role-sp-0930-b` (21:00): two specials on the
 *   frozen "today", 2026-09-30. `-a` seats a kids-only member.
 * - `role-sun-1129`: a Sunday whose canonical setlist has a LEGACY id
 *   (`legacy-set-1129`, not `featuredSongs.2026-11-29`) and a draft-only overlay
 *   `drafts.featuredSongs.2026-11-29` for the same week. The writer finds the
 *   overlay by `_type + week` and refuses; readiness matches drafts by base id
 *   and does not see it. The canonical rows carry a medley.
 * - `role-sat-1128`: a Saturday with no canonical setlist and a draft-only
 *   `drafts.saturdarSongs.2026-11-28`.
 * - `role-sp-1107`: a special with songs and a raw role draft overlay.
 * - `role-sp-1114-invalid`: a special with songs and a null seat (not groupable).
 */
export function readToolStore(): ServiceFixtureStore {
  const store = serviceFixtureStore();
  const ana = "mem-ana";
  const luis = "mem-luis";
  const sofia = "mem-sofia";

  store.roles.push(
    role({
      _id: "role-sun-0927",
      _rev: "role-sun-0927-rev",
      _type: "sunday_role",
      week: "2026-09-27",
      published: true,
      Lead: [ref("l1", ana)],
    }),
    role({
      _id: "role-sp-0930-a",
      _rev: "role-sp-0930-a-rev",
      _type: "special_role",
      date: "2026-09-30",
      service_name: "Oración",
      time: "07:00",
      published: false,
      Lead: [ref("l1", ana)],
      BGVs: [ref("b1", KIDS_ONLY_MEMBER_ID)],
      songs: [songRow("r1", "song-2", "C")],
    }),
    role({
      _id: "role-sp-0930-b",
      _rev: "role-sp-0930-b-rev",
      _type: "special_role",
      date: "2026-09-30",
      service_name: "Vigilia",
      time: "21:00",
      published: false,
      Lead: [ref("l1", sofia)],
    }),
    role({
      _id: "role-sun-1129",
      _rev: "role-sun-1129-rev",
      _type: "sunday_role",
      week: "2026-11-29",
      published: false,
      Lead: [ref("l1", ana)],
    }),
    role({
      _id: "role-sat-1128",
      _rev: "role-sat-1128-rev",
      _type: "saturday_role",
      week: "2026-11-28",
      published: false,
      Lead: [ref("l1", luis)],
    }),
    role({
      _id: "role-sp-1107",
      _rev: "role-sp-1107-rev",
      _type: "special_role",
      date: "2026-11-07",
      service_name: "Bautizos",
      published: false,
      Lead: [ref("l1", sofia)],
      songs: [songRow("r1", "song-1", "G")],
    }),
    role({
      _id: "role-sp-1114-invalid",
      _rev: "role-sp-1114-invalid-rev",
      _type: "special_role",
      date: "2026-11-14",
      service_name: "Roto",
      published: false,
      Lead: [ref("l1", ana)],
      Chorus: null,
      songs: [songRow("r1", "song-3", "E")],
    }),
  );
  store.locks.push(
    lock("sunday_role", "2026-09-27", "role-sun-0927"),
    lock("sunday_role", "2026-11-29", "role-sun-1129"),
    lock("saturday_role", "2026-11-28", "role-sat-1128"),
  );
  store.members.push({
    _id: KIDS_ONLY_MEMBER_ID,
    _rev: `${KIDS_ONLY_MEMBER_ID}-rev`,
    member_name: "Kiki",
    alias: null,
    unavailableDates: null,
    unavailabilityNotes: null,
    // Not projected by CANONICAL_MEMBER_PROJECTION; carried to show nothing reads it.
    ministries: ["kids"],
  });
  store.setlists.push({
    _id: "legacy-set-1129",
    _rev: "legacy-set-1129-rev",
    _type: "featuredSongs",
    week: "2026-11-29",
    songs: [songRow("r1", "song-1", "G", "m1"), songRow("r2", "song-2", "G", "m1"), songRow("r3", "song-3", "A")],
  });
  store.rawSetlistDrafts.push(
    { _id: "drafts.featuredSongs.2026-11-29", _rev: "d1129-rev", _type: "featuredSongs", week: "2026-11-29", songs: [] },
    { _id: "drafts.saturdarSongs.2026-11-28", _rev: "d1128-rev", _type: "saturdarSongs", week: "2026-11-28", songs: [] },
  );
  store.rawRoleDrafts.push(
    role({
      _id: "drafts.role-sp-1107",
      _rev: "drafts.role-sp-1107-rev",
      _type: "special_role",
      date: "2026-11-07",
      service_name: "Bautizos",
      published: false,
    }),
  );
  return store;
}

export interface ScopedResponderOptions extends FixtureResponderOptions {
  /** The `post` rows the title query answers from (default: `SONG_POSTS`). */
  posts?: readonly Row[];
  /** Reject the `post` title query, as a Sanity outage would. */
  failPosts?: boolean;
}

export interface ScopedResponder extends FixtureResponder {
  /** Every read served outside the step-2 table, by name. */
  scopedCalls: string[];
}

interface ScopedEntry {
  name: string;
  client: FixtureClient;
  rows: (params: Record<string, unknown>) => Row[];
}

/**
 * The strict step-2 responder, plus the writer's target-scoped reads and the
 * MCP `post` read, each keyed by its builder's own query text (the text does not
 * depend on the arguments — they are bound as params) and answered by filtering
 * the same store by those params.
 */
export function scopedResponder(store: ServiceFixtureStore, options: ScopedResponderOptions = {}): ScopedResponder {
  const base = createFixtureResponder(store, options);
  const posts = options.posts ?? SONG_POSTS;
  const idsOf = (rows: Row[]) => rows.map((row) => ({ _id: row._id }));

  const scoped = new Map<string, ScopedEntry>([
    [
      canonicalSetlistsForTargetQuery("x", "x").query,
      {
        name: "canonicalSetlistsForTarget",
        client: "operational",
        rows: (p) => store.setlists.filter((s) => s._type === p.setlistType && s.week === p.week),
      },
    ],
    [
      rawSetlistDraftsForWeekQuery("x", "x").query,
      {
        name: "rawSetlistDraftsForWeek",
        client: "raw",
        rows: (p) => idsOf(store.rawSetlistDrafts.filter((s) => s._type === p.setlistType && s.week === p.week)),
      },
    ],
    [
      canonicalRoleByIdQuery("x").query,
      {
        name: "canonicalRoleById",
        client: "operational",
        rows: (p) =>
          store.roles.filter((r) => r._id === p.id && (p.roleTypes as unknown[]).includes(r._type)),
      },
    ],
    [
      rawRoleDraftForBaseQuery("x").query,
      {
        name: "rawRoleDraftForBase",
        client: "raw",
        rows: (p) => idsOf(store.rawRoleDrafts.filter((r) => r._id === p.draftId)),
      },
    ],
    [
      songTitlesQuery(["x"]).query,
      {
        name: "songTitles",
        client: "operational",
        rows: (p) => {
          if (options.failPosts) throw new Error("fixture: posts failed token=sk-fixture-secret");
          const ids = Array.isArray(p.ids) ? p.ids : [];
          return posts.filter((post) => ids.includes(post._id));
        },
      },
    ],
  ]);

  const scopedCalls: string[] = [];
  const serve =
    (client: FixtureClient, fallback: FixtureResponder["operational"]) =>
    async (query: string, params: Record<string, unknown> = {}) => {
      const entry = scoped.get(query);
      if (!entry) return fallback(query, params);
      if (entry.client !== client) throw new Error(`fixture: ${entry.name} read on the ${client} client`);
      scopedCalls.push(entry.name);
      return structuredClone(entry.rows(params));
    };

  return {
    operational: serve("operational", base.operational),
    raw: serve("raw", base.raw),
    calls: base.calls,
    scopedCalls,
  };
}
