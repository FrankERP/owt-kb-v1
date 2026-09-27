// `edit_setlist` (P3 step 11): registration, schema, twin-run parity with the
// admin setlist editor's PUT, refusal replay (the inherited rows AND the mirror
// rows of § «Admin surface gates», E1–E7, E-key), the fresh observation (D8)
// and the report (notifications, the repeat hint, the rows as written).
//
// The twin harness (`../../writes/__tests__/twinRun.ts`) runs the real admin
// route handler — with the body the editor would send for the same intent —
// and this tool's own result function over ONE fixture definition, each on its
// own fresh store, answered by the real canonical query builders. One table
// answers every reader: the tool's pre-reads (the role, the writer's own
// target loader, the song titles, the members), the writer's own reads, the
// setlist push's three inline audience queries, and the report's reads (the
// read-back and the editor's recent-setlist history). Parity is asserted on
// writes, notifications and revalidation, never on reads.
//
// ZERO DOMAIN CALLS is asserted by counting `saveSetlist` calls (a partial mock
// that calls through): read labels cannot tell the tool's pre-read of a special
// from the writer's own, because both issue `canonicalRoleByIdQuery`.
//
// Dates are 2029, used by no other test file. A weekend role's `week` is a
// label: nothing on either side checks the weekday.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const t = await vi.hoisted(async () => {
  const { createTwinHarness } = await import("../../writes/__tests__/twinRun");
  return createTwinHarness();
});
const domain = vi.hoisted(() => ({ calls: 0 }));

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
// Counts domain calls; the route and the tool both reach `saveSetlist` through it.
vi.mock("@/app/utils/setlistSaveCommit", async (orig) => {
  const actual = await orig<typeof import("@/app/utils/setlistSaveCommit")>();
  return {
    ...actual,
    saveSetlist: (raw: unknown) => {
      domain.calls += 1;
      return actual.saveSetlist(raw);
    },
  };
});

import { PUT as setlistPUT } from "@/app/api/admin/setlists/route";
import { WORSHIP_AUDIENCE_GROQ_FILTER } from "@/app/ministries";
import { assignedMemberRefsQuery } from "@/app/utils/notifyTargets";
import { buildClaimedLock, roleTargetLockId } from "@/app/utils/roleTargetLock";
import { ROLE_TYPES, roleTargetKey } from "@/app/utils/serviceReadModel";
import {
  canonicalMembersByIdsQuery,
  canonicalRoleByIdQuery,
  canonicalSetlistsForTargetQuery,
  canonicalWeekendRolesForTargetQuery,
  editorRecentSetlistsQuery,
  rawRoleDraftForBaseQuery,
  rawRoleDraftsForTargetQuery,
  rawSetlistDraftsForWeekQuery,
  roleTargetLocksByIdsQuery,
} from "@/app/utils/serviceReadQueries";
import { SETLIST_READ_ISSUE_COPY } from "@/app/utils/setlistReadContract";
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
import { OUTBOX_SWEEP_NOTE, WHEN_AFTER_RESPONSE } from "../../writes/reports";
import {
  CHANGED_AGAIN_TEXT,
  EDIT_SETLIST_INPUT,
  KEY_MESSAGE,
  NOT_WORSHIP_NIGHT_TEXT,
  READ_BACK_FAILED_TEXT,
  SONG_LOOKUP_FAILED_TEXT,
  editSetlistBody,
  editSetlistResult,
  registerEditSetlist,
  type EditSetlistArgs,
  type RepeatedSong,
} from "../editSetlist";

// ── Projections (mirror the real GROQ projections — ADR-0040) ──────────────

const ROLE_FIELDS = [
  "_id", "_rev", "_type", "published", "week", "date", "service_name", "time", "format",
  "creationReceiptId", "creationFingerprint", "Lead", "BGVs", "Chorus", "instruments", "foh_team",
] as const;
const LOCK_FIELDS = ["_id", "_rev", "_type", "targetKey", "state", "roleId", "roleType", "date", "claimNonce", "generation"] as const;
const MEMBER_FIELDS = ["_id", "_rev", "member_name", "alias", "unavailableDates", "unavailabilityNotes"] as const;

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** `SONGS_FRAGMENT`: `songs[]{ _key, play_key, medley_tag, song{ _type, _ref }, leads[]{ _key, _type, _ref } }`. */
function projectSongs(value: unknown): unknown {
  if (!Array.isArray(value)) return null;
  return value.map((raw) => {
    const item = asObj(raw);
    const song = item.song;
    return {
      _key: item._key ?? null,
      play_key: item.play_key ?? null,
      medley_tag: item.medley_tag ?? null,
      song: song && typeof song === "object" ? { _type: asObj(song)._type ?? null, _ref: asObj(song)._ref ?? null } : null,
      leads: Array.isArray(item.leads)
        ? item.leads.map((l) => ({ _key: asObj(l)._key ?? null, _type: asObj(l)._type ?? null, _ref: asObj(l)._ref ?? null }))
        : null,
    };
  });
}

const roleRow = (doc: TwinDoc) => ({ ...project(doc, ROLE_FIELDS), songs: projectSongs(doc.songs) });
const setlistRow = (doc: TwinDoc) => ({ ...project(doc, ["_id", "_rev", "_type", "week"]), songs: projectSongs(doc.songs) });
const lockRow = (doc: TwinDoc) => project(doc, LOCK_FIELDS);

/** `EDITOR_SETLIST_SONGS_PROJECTION`, with `song->` dereferenced against the store's posts. */
function editorSongs(store: TwinStore, value: unknown): unknown {
  if (!Array.isArray(value)) return null;
  const posts = new Map(canonicalDocs(store, ["post"]).map((d) => [d._id, d]));
  return value.map((raw) => {
    const item = asObj(raw);
    const ref = asObj(item.song)._ref;
    const post = typeof ref === "string" ? posts.get(ref) : undefined;
    return {
      _key: item._key ?? null,
      play_key: item.play_key ?? null,
      medley_tag: item.medley_tag ?? null,
      leadIds: Array.isArray(item.leads) ? item.leads.map((l) => asObj(l)._ref ?? null) : null,
      songRef: ref ?? null,
      song: post ? { _id: post._id, title: post.title ?? null, author: post.author ?? null, key: null, slug: null } : null,
    };
  });
}

const WORSHIP_AUDIENCE_QUERY = `*[_type == "teamMembers" && ${WORSHIP_AUDIENCE_GROQ_FILTER}]{ _id, "setlist": notifPrefs.setlist }`;
const ASSIGNED_ROLE_FILTER =
  `_type in ["sunday_role","saturday_role","special_role"] && (week == $week || date == $week) && published != false`;
const ASSIGNED_PREFS_QUERY = `*[_type == "teamMembers" && _id in $assigned]{ _id, "setlist": notifPrefs.setlist }`;

function inWorship(doc: TwinDoc): boolean {
  const ministries = doc.ministries;
  return !Array.isArray(ministries) || ministries.length === 0 || ministries.includes("worship");
}

function seatRefs(doc: TwinDoc): string[] {
  const out: string[] = [];
  for (const path of ["Lead", "BGVs", "Chorus"]) for (const item of (doc[path] as Obj[] | undefined) ?? []) out.push(String(item._ref));
  for (const path of ["instruments", "foh_team"]) {
    for (const item of (doc[path] as Obj[] | undefined) ?? []) out.push(String(asObj(item.person)._ref));
  }
  return out;
}

type Rows = TwinQuery["rows"];

const ROWS: Record<string, Rows> = {
  "role by id": (store, p) => canonicalDocs(store, strings(p.roleTypes)).filter((d) => d._id === p.id).map(roleRow),
  "role draft by base id": (store, p) =>
    draftDocs(store, strings(p.roleTypes)).filter((d) => d._id === p.draftId).map((d) => ({ _id: d._id })),
  "setlist target": (store, p) =>
    canonicalDocs(store, [String(p.setlistType)]).filter((d) => d.week === p.week).map(setlistRow),
  "setlist drafts for week": (store, p) =>
    draftDocs(store, [String(p.setlistType)]).filter((d) => d.week === p.week).map((d) => ({ _id: d._id })),
  "weekend roles at a target": (store, p) =>
    canonicalDocs(store, [String(p.roleType)]).filter((d) => d.week === p.week).map(roleRow),
  "weekend role drafts at a target": (store, p) =>
    draftDocs(store, [String(p.roleType)]).filter((d) => d.week === p.week).map((d) => ({ _id: d._id, _type: d._type })),
  "locks by id": (store, p) =>
    canonicalDocs(store, ["roleTargetLock"]).filter((d) => strings(p.ids).includes(d._id)).map(lockRow),
  "song titles": (store, p) =>
    canonicalDocs(store, ["post"]).filter((d) => strings(p.ids).includes(d._id)).map((d) => project(d, ["_id", "title", "author"])),
  "members by id": (store, p) =>
    canonicalDocs(store, ["teamMembers"]).filter((d) => strings(p.ids).includes(d._id)).map((d) => project(d, MEMBER_FIELDS)),
  "worship audience": (store) =>
    canonicalDocs(store, ["teamMembers"])
      .filter(inWorship)
      .map((d) => ({ _id: d._id, setlist: asObj(d.notifPrefs).setlist ?? null })),
  "assigned that week": (store, p) => [
    ...new Set(
      canonicalDocs(store, [...ROLE_TYPES])
        .filter((d) => (d.week === p.week || d.date === p.week) && d.published !== false)
        .flatMap(seatRefs),
    ),
  ],
  "assigned prefs": (store, p) =>
    canonicalDocs(store, ["teamMembers"])
      .filter((d) => strings(p.assigned).includes(d._id))
      .map((d) => ({ _id: d._id, setlist: asObj(d.notifPrefs).setlist ?? null })),
  "recent setlists": (store, p) => {
    const cutoff = String(p.cutoff);
    const weekly = (type: string) =>
      canonicalDocs(store, [type])
        .filter((d) => String(d.week) >= cutoff)
        .map((d) => ({ week: d.week, hasSongs: "songs" in d, songs: editorSongs(store, d.songs) }));
    return {
      sunday: weekly("featuredSongs"),
      saturday: weekly("saturdarSongs"),
      special: canonicalDocs(store, ["special_role"])
        .filter((d) => String(d.date) >= cutoff && Array.isArray(d.songs))
        .map((d) => ({ week: d.date, hasSongs: true, songs: editorSongs(store, d.songs) })),
    };
  },
};

const BOUND: Record<string, { client: TwinQuery["client"]; bound: TwinQuery["bound"]; fixedParams?: boolean }> = {
  // `loadCanonicalRole` — the tool's step 1, the special loader, the bootstrap read-back.
  "role by id": { client: "operational", bound: canonicalRoleByIdQuery("x") },
  "role draft by base id": { client: "raw", bound: rawRoleDraftForBaseQuery("x") },
  // `loadWeekendSetlistTarget` — the tool's step 3, the writer's own read, the read-back.
  "setlist target": { client: "operational", bound: canonicalSetlistsForTargetQuery("x", "2029-01-01") },
  "setlist drafts for week": { client: "raw", bound: rawSetlistDraftsForWeekQuery("x", "2029-01-01") },
  // `loadWeekendCoordination` — the writer's only.
  "weekend roles at a target": { client: "operational", bound: canonicalWeekendRolesForTargetQuery("x", "2029-01-01") },
  "weekend role drafts at a target": { client: "raw", bound: rawRoleDraftsForTargetQuery("x", "2029-01-01") },
  "locks by id": { client: "operational", bound: roleTargetLocksByIdsQuery([]) },
  // The tool's E1/E4 read and the report's names; `loadCanonicalMemberIds` (E7).
  "song titles": { client: "operational", bound: songTitlesQuery([]) },
  "members by id": { client: "operational", bound: canonicalMembersByIdsQuery([]) },
  // `notifySetlistSaved`'s three inline queries.
  "worship audience": { client: "operational", bound: { query: WORSHIP_AUDIENCE_QUERY, params: {} }, fixedParams: true },
  "assigned that week": { client: "operational", bound: { query: assignedMemberRefsQuery(ASSIGNED_ROLE_FILTER), params: {} } },
  "assigned prefs": { client: "operational", bound: { query: ASSIGNED_PREFS_QUERY, params: {} } },
  // The repeat hint.
  "recent setlists": { client: "operational", bound: editorRecentSetlistsQuery("2029-01-01") },
};

/** The query table, with any entry's rows replaced. */
function queries(overrides: Partial<Record<keyof typeof ROWS, Rows>> = {}): TwinQuery[] {
  return Object.entries(BOUND).map(([label, { client, bound, fixedParams }]) => ({
    label,
    client,
    bound,
    ...(fixedParams ? { fixedParams } : {}),
    rows: overrides[label] ?? ROWS[label],
  }));
}

/** True once the business transaction committed (a written doc carries a `twin-rev-*`). */
function committed(store: TwinStore): boolean {
  return [...store.docs.values()].some(
    (d) => String(d._rev).startsWith("twin-rev-") && d._type !== "notificationOutbox" && d._type !== "roleTargetLock",
  );
}

/** `label`'s rows, edited by `edit` once the business write has committed — a change landed after the save. */
function afterCommit(label: keyof typeof ROWS, edit: (rows: Obj[]) => void): TwinQuery[] {
  return queries({
    [label]: (store: TwinStore, p: Obj) => {
      const rows = ROWS[label](store, p) as Obj[];
      if (committed(store)) edit(rows);
      return rows;
    },
  });
}

/** Mutates the store at the `nth` read of `label` in each run (once per run). */
function raceAtRead(label: keyof typeof ROWS, nth: number, mutate: (store: TwinStore) => void): TwinQuery[] {
  const seen = new WeakMap<TwinStore, number>();
  return queries({
    [label]: (store: TwinStore, p: Obj) => {
      const n = (seen.get(store) ?? 0) + 1;
      seen.set(store, n);
      if (n === nth) mutate(store);
      return ROWS[label](store, p);
    },
  });
}

// ── Fixture ─────────────────────────────────────────────────────────────────

const ref = (key: string, id: string) => ({ _key: key, _type: "reference", _ref: id });

function song(key: string | null, songId: string, extra: Obj = {}): Obj {
  return { ...(key === null ? {} : { _key: key }), _type: "setlist_song", song: { _type: "reference", _ref: songId }, ...extra };
}

function leadsOf(key: string, ...ids: string[]) {
  return ids.map((id, i) => ref(`${key}-l${i + 1}`, id));
}

function role(over: TwinDoc): TwinDoc {
  return { Lead: [], BGVs: [], Chorus: [], instruments: [], foh_team: [], ...over };
}
function sunday(id: string, week: string, published: boolean, rest: Obj = {}): TwinDoc {
  return role({ _id: id, _rev: `${id}-rev`, _type: "sunday_role", week, published, ...rest });
}
function saturday(id: string, week: string, published: boolean, rest: Obj = {}): TwinDoc {
  return role({ _id: id, _rev: `${id}-rev`, _type: "saturday_role", week, published, ...rest });
}
function special(id: string, date: string, name: string, published: boolean, rest: Obj = {}): TwinDoc {
  return role({ _id: id, _rev: `${id}-rev`, _type: "special_role", date, service_name: name, published, ...rest });
}
function setlistDoc(type: string, week: string, songs: Obj[], id = `${type}.${week}`, rev = `${id}-rev`): TwinDoc {
  return { _id: id, _rev: rev, _type: type, week, songs };
}
function lockFor(r: TwinDoc): TwinDoc {
  const targetKey = roleTargetKey(r) as string;
  const lock = buildClaimedLock({ targetKey, roleId: String(r._id), claimNonce: "n1", now: "2029-01-01T00:00:00.000Z" });
  if (!lock) throw new Error("fixture: no lock for " + r._id);
  return { ...lock, _rev: `${lock._id}-rev` };
}
function lockIdOf(r: TwinDoc): string {
  return roleTargetLockId(roleTargetKey(r)) as string;
}
function member(id: string, name: string, rest: Obj = {}): TwinDoc {
  return { _id: id, _rev: `${id}-rev`, _type: "teamMembers", member_name: name, alias: null, unavailableDates: null, unavailabilityNotes: null, ...rest };
}
function post(id: string, title: string): TwinDoc {
  return { _id: id, _rev: `${id}-rev`, _type: "post", title, author: null };
}

const MEMBERS: TwinDoc[] = [
  member("mem-ana", "Ana"),
  member("mem-beto", "Beto", { notifPrefs: { setlist: "assigned" } }),
  member("mem-caro", "Caro", { notifPrefs: { setlist: "off" } }),
  member("mem-dani", "Dani"),
  member("mem-eli", "Eli"),
  member("mem-fer", "Fer"),
  // Kids only: outside the setlist push's worship audience.
  member("mem-kid", "Kiko", { ministries: ["kids"] }),
];

const POSTS: TwinDoc[] = [
  post("song-1", "Cuán grande es Él"),
  post("song-2", "Aquí estoy"),
  post("song-3", "Santo"),
  post("song-4", "Digno"),
  post("song-5", "Way Maker"),
  post("song-6", "Oceans"),
  post("song-7", "Rey de reyes"),
  post("song-8", "Te alabaré"),
];
const NOT_A_SONG: TwinDoc = { _id: "tag-adoracion", _rev: "tag-rev", _type: "tag", name: "Adoración" };

// The published Sunday: a medley (s1+s2) and a single.
const SUN = sunday("role-sun", "2029-10-07", true, { Lead: [ref("l1", "mem-ana")], BGVs: [ref("b1", "mem-beto")] });
const SUN_SETLIST = setlistDoc("featuredSongs", "2029-10-07", [
  song("s1", "song-1", { play_key: "G", medley_tag: "mx" }),
  song("s2", "song-2", { play_key: "D", medley_tag: "mx" }),
  song("s3", "song-3", { play_key: "E" }),
]);
// A published Sunday with no setlist yet: a deterministic create.
const SUN_NONE = sunday("role-sun-none", "2029-10-14", true, { Lead: [ref("l2", "mem-dani")] });
// A draft Sunday with a setlist.
const SUN_DRAFT = sunday("role-sun-draft", "2029-10-21", false, { Lead: [ref("l3", "mem-eli")] });
const SUN_DRAFT_SETLIST = setlistDoc("featuredSongs", "2029-10-21", [song("d1", "song-5", { play_key: "C" })]);
// A Saturday with no setlist: the Saturday type is the stored typo.
const SAT_NONE = saturday("role-sat", "2029-10-06", true, { Lead: [ref("l4", "mem-fer")] });
// A special with songs, and one without the field.
const SP = special("role-sp", "2029-10-10", "Retiro", true, {
  Lead: [ref("l5", "mem-caro")],
  songs: [song("p1", "song-4", { play_key: "A" })],
});
const SP_NONE = special("role-sp-none", "2029-10-11", "Vigilia", true, { Lead: [ref("l6", "mem-dani")] });
// A worship night: every song names its leaders from Lead.
const WN = special("role-wn", "2029-10-12", "Noche de alabanza", true, {
  format: "worship_night",
  time: "19:00",
  Lead: [ref("l7", "mem-ana"), ref("l8", "mem-eli")],
  songs: [
    song("w1", "song-1", { play_key: "G", leads: leadsOf("w1", "mem-ana") }),
    song("w2", "song-2", { play_key: "D" }),
  ],
});

// Mirror and inherited rows: songs 7 and 8 only, so the repeat hint of the
// services above stays deterministic.
const DANGLE = sunday("role-sun-dangle", "2029-10-28", true, { Lead: [ref("l9", "mem-ana")] });
const DANGLE_SETLIST = setlistDoc("featuredSongs", "2029-10-28", [song("x1", "song-7"), song("x2", "song-deleted")]);
const DUPKEY = sunday("role-sun-dupkey", "2029-11-04", true, { Lead: [ref("l10", "mem-ana")] });
const DUPKEY_SETLIST = setlistDoc("featuredSongs", "2029-11-04", [song("k1", "song-7"), song("k1", "song-8")]);
const NOKEY = sunday("role-sun-nokey", "2029-11-11", true, { Lead: [ref("l11", "mem-ana")] });
const NOKEY_SETLIST = setlistDoc("featuredSongs", "2029-11-11", [song(null, "song-7")]);
const NONSONG = sunday("role-sun-nonsong", "2029-11-18", true, { Lead: [ref("l12", "mem-ana")] });
const NONSONG_SETLIST = setlistDoc("featuredSongs", "2029-11-18", [song("n1", "song-7"), song("n2", "tag-adoracion")]);
// A worship night whose song names a leader with no member document (still a raw Lead ref).
const WN_GONE = special("role-wn-gone", "2029-11-02", "Noche II", true, {
  format: "worship_night",
  Lead: [ref("l13", "mem-gone"), ref("l14", "mem-ana")],
  songs: [song("g1", "song-8", { play_key: "B", leads: leadsOf("g1", "mem-gone") })],
});
const LONGKEY = sunday("role-sun-longkey", "2029-09-02", true, { Lead: [ref("l15", "mem-ana")] });
const LONGKEY_SETLIST = setlistDoc("featuredSongs", "2029-09-02", [song("q1", "song-7", { play_key: "x".repeat(25) })]);
const LEGACY = sunday("role-sun-legacy", "2029-09-09", true, { Lead: [ref("l16", "mem-ana")] }); // no lock
const ROLEDRAFT = sunday("role-sun-roledraft", "2029-09-16", true, { Lead: [ref("l17", "mem-ana")] });
const ROLEDRAFT_OVERLAY: TwinDoc = sunday("drafts.role-sun-roledraft", "2029-09-16", true);
const SLDRAFT = sunday("role-sun-sldraft", "2029-09-23", true, { Lead: [ref("l18", "mem-ana")] });
const SLDRAFT_SETLIST = setlistDoc("featuredSongs", "2029-09-23", [song("sd1", "song-7")]);
const SLDRAFT_OVERLAY = setlistDoc("featuredSongs", "2029-09-23", [song("sd1", "song-8")], "drafts.featuredSongs.2029-09-23");
const MALFORMED = sunday("role-sun-malformed", "2029-09-30", true, { Lead: [ref("l19", "mem-ana")] });
const MALFORMED_SETLIST = setlistDoc("featuredSongs", "2029-09-30", [song("m1", "song-7")], "featuredSongs.2029-09-30", "");
const AMBIG = sunday("role-sun-ambig", "2029-11-25", true, { Lead: [ref("l20", "mem-ana")] });
const AMBIG_A = setlistDoc("featuredSongs", "2029-11-25", [song("a1", "song-7")]);
const AMBIG_B = setlistDoc("featuredSongs", "2029-11-25", [song("a2", "song-8")], "legacy-setlist-1125");
const LONGTAG = sunday("role-sun-longtag", "2029-12-02", true, { Lead: [ref("l21", "mem-ana")] });
const TAG_65 = "t".repeat(65);
const LONGTAG_SETLIST = setlistDoc("featuredSongs", "2029-12-02", [
  song("lt1", "song-7", { medley_tag: TAG_65 }),
  song("lt2", "song-8", { medley_tag: TAG_65 }),
]);

function fixture(): TwinDoc[] {
  return [
    ...MEMBERS,
    ...POSTS,
    NOT_A_SONG,
    SUN, lockFor(SUN), SUN_SETLIST,
    SUN_NONE, lockFor(SUN_NONE),
    SUN_DRAFT, lockFor(SUN_DRAFT), SUN_DRAFT_SETLIST,
    SAT_NONE, lockFor(SAT_NONE),
    SP, SP_NONE, WN,
    DANGLE, lockFor(DANGLE), DANGLE_SETLIST,
    DUPKEY, lockFor(DUPKEY), DUPKEY_SETLIST,
    NOKEY, lockFor(NOKEY), NOKEY_SETLIST,
    NONSONG, lockFor(NONSONG), NONSONG_SETLIST,
    WN_GONE,
    LONGKEY, lockFor(LONGKEY), LONGKEY_SETLIST,
    LEGACY,
    ROLEDRAFT, lockFor(ROLEDRAFT), ROLEDRAFT_OVERLAY,
    SLDRAFT, lockFor(SLDRAFT), SLDRAFT_SETLIST, SLDRAFT_OVERLAY,
    MALFORMED, lockFor(MALFORMED), MALFORMED_SETLIST,
    AMBIG, lockFor(AMBIG), AMBIG_A, AMBIG_B,
    LONGTAG, lockFor(LONGTAG), LONGTAG_SETLIST,
  ];
}

const OPTIONS: TwinRunOptions = { fixture, queries: queries() };

// ── Helpers ─────────────────────────────────────────────────────────────────

type Observed = EditSetlistArgs["observed"];
type Row = EditSetlistArgs["rows"][number];

const NONE: Observed = { state: "none" };

/** P1's `single` observation of a setlist document (a special's is its role). */
function single(doc: TwinDoc, over: Partial<{ id: string; rev: string; rowKeys: (string | null)[] }> = {}): Observed {
  const songs = (doc.songs as Obj[] | undefined) ?? [];
  return {
    state: "single",
    id: String(doc._id),
    rev: String(doc._rev),
    rowKeys: songs.map((s) => (typeof s._key === "string" ? s._key : null)),
    ...over,
  };
}

function edit(r: TwinDoc, observed: Observed, rows: Row[], roleRev: string = String(r._rev)): EditSetlistArgs {
  return { serviceId: String(r._id), roleRev, observed, rows };
}

const kindOf = (r: TwinDoc) =>
  r._type === "sunday_role" ? "sunday" : r._type === "saturday_role" ? "saturday" : "special";

interface EditorSong {
  songId: string;
  play_key: string;
  medley_tag?: string;
  leadIds?: string[];
}

/** What `/admin`'s setlist editor sends (`SetlistEditor.tsx` `save()`): `roleId` only for a special. */
function editorBody(r: TwinDoc, observed: Observed, songs: EditorSong[]) {
  const isSpecial = r._type === "special_role";
  const target = observed.state === "single" ? { state: "single", id: observed.id, rev: observed.rev } : { state: "none" };
  return {
    week: isSpecial ? r.date : r.week,
    type: kindOf(r),
    ...(isSpecial ? { roleId: r._id } : {}),
    observed: target,
    songs,
  };
}

const call = (args: EditSetlistArgs) => () => editSetlistResult(args);

function twinOf(args: EditSetlistArgs, route: unknown, options: TwinRunOptions = OPTIONS) {
  return t.twin(options, { handler: setlistPUT, body: route }, call(args));
}

async function toolRun(args: EditSetlistArgs, options: TwinRunOptions = OPTIONS) {
  domain.calls = 0;
  const run = await t.runTool(options, call(args));
  return { run, domainCalls: domain.calls };
}

function textOf(result: CallToolResult): string {
  return (result.content as { text: string }[])[0].text;
}

function sc<T = Obj>(result: CallToolResult): T {
  return result.structuredContent as T;
}

function doc(store: TwinStore, id: string): TwinDoc {
  const d = store.docs.get(id);
  if (!d) throw new Error(`no ${id}`);
  return d;
}

function expectCommittedParity(route: TwinRun<{ status: number; body: unknown }>, tool: TwinRun<CallToolResult>) {
  expect(route.refusedReads).toEqual([]);
  expect(tool.refusedReads).toEqual([]);
  expect(route.afterErrors).toBe(0);
  expect(tool.afterErrors).toBe(0);
  expect(route.response.status).toBe(200);
  expect(tool.response.isError).toBeUndefined();
  expect(parityView(tool)).toEqual(parityView(route));
  expect(route.transactions).toHaveLength(1);
  expect(route.revalidations).toEqual(["revalidateServiceViews()"]);
}

beforeEach(() => {
  domain.calls = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Registration and schema ─────────────────────────────────────────────────

describe("registerEditSetlist", () => {
  it("registers edit_setlist with the write-tool annotations (I14) and the strict schema", () => {
    const registered: { name: string; config: Obj }[] = [];
    registerEditSetlist({ registerTool: (name: string, config: Obj) => registered.push({ name, config }) } as never);
    expect(registered).toHaveLength(1);
    const [{ name, config }] = registered;
    expect(name).toBe("edit_setlist");
    expect(config.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(config.inputSchema).toBe(EDIT_SETLIST_INPUT);
    expect((config.title as string).length).toBeGreaterThan(0);
    expect((config.description as string).length).toBeGreaterThan(0);
  });

  it("publishes ONE object with top-level additionalProperties:false (I13)", () => {
    const schema = z.toJSONSchema(EDIT_SETLIST_INPUT) as Obj;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema).not.toHaveProperty("anyOf");
    expect(schema).not.toHaveProperty("oneOf");
    expect(Object.keys(schema.properties as Obj).sort()).toEqual(["observed", "roleRev", "rows", "serviceId"]);
    expect(schema.required).toEqual(["serviceId", "roleRev", "observed", "rows"]);
  });
});

describe("EDIT_SETLIST_INPUT", () => {
  const base = edit(SUN, single(SUN_SETLIST), [{ rowKey: "s1" }]);

  it("refuses a key of 25 characters and accepts one of 24", () => {
    expect(EDIT_SETLIST_INPUT.safeParse({ ...base, rows: [{ rowKey: "s1", key: "x".repeat(24) }] }).success).toBe(true);
    const refused = EDIT_SETLIST_INPUT.safeParse({ ...base, rows: [{ rowKey: "s1", key: "x".repeat(25) }] });
    expect(refused.success).toBe(false);
    expect(EDIT_SETLIST_INPUT.safeParse({ ...base, rows: [{ songId: "song-5", key: "x".repeat(25) }] }).success).toBe(false);
  });

  it("accepts 24 × U+0958 (24 raw characters; 48 after NFC — the translation refuses it)", () => {
    expect(EDIT_SETLIST_INPUT.safeParse({ ...base, rows: [{ songId: "song-5", key: "क़".repeat(24) }] }).success).toBe(true);
  });

  it("refuses a missing roleRev", () => {
    const { roleRev: _omit, ...rest } = base;
    void _omit;
    expect(EDIT_SETLIST_INPUT.safeParse(rest).success).toBe(false);
  });

  it("accepts every observation get_service can return, verbatim", () => {
    for (const observed of [
      { state: "none" },
      { state: "single", id: "featuredSongs.2029-10-07", rev: "r", rowKeys: ["a", null] },
      { state: "ambiguous", ids: ["a", "b"] },
      { state: "draft_overlay", draftIds: ["drafts.a"] },
      { state: "invalid" },
      { state: "unknown" },
    ]) {
      expect(EDIT_SETLIST_INPUT.safeParse({ ...base, observed, rows: [] }).success).toBe(true);
    }
  });

  it("refuses an extra field, a row that names both a rowKey and a songId, a null key on a new row, and a single without rowKeys", () => {
    expect(EDIT_SETLIST_INPUT.safeParse({ ...base, type: "sunday" }).success).toBe(false);
    expect(EDIT_SETLIST_INPUT.safeParse({ ...base, rows: [{ rowKey: "s1", songId: "song-5" }] }).success).toBe(false);
    expect(EDIT_SETLIST_INPUT.safeParse({ ...base, rows: [{ songId: "song-5", key: null }] }).success).toBe(false);
    expect(
      EDIT_SETLIST_INPUT.safeParse({ ...base, observed: { state: "single", id: "featuredSongs.2029-10-07", rev: "r" } }).success,
    ).toBe(false);
    expect(EDIT_SETLIST_INPUT.safeParse({ ...base, observed: { state: "none", id: "x" } }).success).toBe(false);
  });

  it("refuses three leaders, one leader twice, and a blank medleyTag", () => {
    expect(EDIT_SETLIST_INPUT.safeParse({ ...base, rows: [{ rowKey: "s1", leads: ["a", "b", "c"] }] }).success).toBe(false);
    expect(EDIT_SETLIST_INPUT.safeParse({ ...base, rows: [{ rowKey: "s1", leads: ["a", "a"] }] }).success).toBe(false);
    expect(EDIT_SETLIST_INPUT.safeParse({ ...base, rows: [{ rowKey: "s1", medleyTag: "  " }] }).success).toBe(false);
  });
});

describe("edit_setlist — a malformed direct call is refused in Spanish before any read", () => {
  it("a key of 25 characters on a kept row: the schema's own message", async () => {
    const { run, domainCalls } = await toolRun(edit(SUN, single(SUN_SETLIST), [{ rowKey: "s1", key: "x".repeat(25) }]));
    expect(sc(run.response)).toEqual({ refused: true, code: "invalid_request", detail: "invalid_input" });
    expect(textOf(run.response)).toBe(`${KEY_MESSAGE} ${NOTHING_WRITTEN}`);
    expect(run.reads).toEqual([]);
    expect(domainCalls).toBe(0);
  });

  it("a missing roleRev and a row with both identities", async () => {
    const noRev = await toolRun({ ...edit(SUN, NONE, []), roleRev: undefined } as unknown as EditSetlistArgs);
    expect(sc(noRev.run.response)).toMatchObject({ refused: true, code: "invalid_request", detail: "invalid_input" });
    expect(textOf(noRev.run.response)).toMatch(/No se escribió nada\.$/);
    const both = await toolRun(edit(SUN, NONE, [{ rowKey: "s1", songId: "song-5" } as unknown as Row]));
    expect(textOf(both.run.response)).toBe(
      `La fila 1 de rows no tiene un formato válido: una fila guardada es { rowKey, key?, medleyTag?, leads? } y una nueva es { songId, key?, medleyTag?, leads? }. ${NOTHING_WRITTEN}`,
    );
    expect(both.run.reads).toEqual([]);
  });
});

// ── Twin runs: route and tool over one fixture ──────────────────────────────

describe("twin: the admin setlist PUT and edit_setlist", () => {
  it("weekend none: the deterministic create, with the lock heartbeat, push, outbox and revalidation", async () => {
    const args = edit(SUN_NONE, NONE, [{ songId: "song-5", key: "C" }, { songId: "song-6" }]);
    const route = editorBody(SUN_NONE, NONE, [
      { songId: "song-5", play_key: "C" },
      { songId: "song-6", play_key: "" },
    ]);
    const { route: r, tool } = await twinOf(args, route);
    expectCommittedParity(r, tool);
    expect(r.response.body).toEqual({ ok: true, setlistId: "featuredSongs.2029-10-14", created: true });
    expect(r.transactions[0]).toEqual([
      {
        kind: "create",
        doc: {
          _id: "featuredSongs.2029-10-14",
          _type: "featuredSongs",
          week: "2029-10-14",
          songs: [
            { _type: "setlist_song", _key: "key-1", play_key: "C", song: { _type: "reference", _ref: "song-5" } },
            { _type: "setlist_song", _key: "key-2", song: { _type: "reference", _ref: "song-6" } },
          ],
        },
      },
      {
        kind: "patch",
        id: lockIdOf(SUN_NONE),
        ifRevisionId: `${lockIdOf(SUN_NONE)}-rev`,
        set: { updatedAt: TWIN_FROZEN_INSTANT },
        setIfMissing: {},
        unset: [],
      },
    ]);
    expect(r.pushes).toHaveLength(1);
    const report = sc<Obj>(tool.response);
    expect(report).toMatchObject({ ok: true, serviceId: "role-sun-none", kind: "sunday", date: "2029-10-14", created: true });
    expect(report.observations).toEqual({
      roleRev: "role-sun-none-rev",
      setlist: { state: "single", id: "featuredSongs.2029-10-14", rev: "twin-rev-1", rowKeys: ["key-1", "key-2"] },
    });
    expect(textOf(tool.response)).toContain(
      "Setlist creado para el domingo 2029-10-14: 2 canciones. /, /schedule y las páginas de canciones se actualizan.",
    );
  });

  it("Saturday none: creates the stored-typo type (saturdarSongs), never «corrected»", async () => {
    const args = edit(SAT_NONE, NONE, [{ songId: "song-6", key: "A" }]);
    const { route, tool } = await twinOf(args, editorBody(SAT_NONE, NONE, [{ songId: "song-6", play_key: "A" }]));
    expectCommittedParity(route, tool);
    expect(route.transactions[0][0]).toMatchObject({ kind: "create", doc: { _id: "saturdarSongs.2029-10-06", _type: "saturdarSongs" } });
  });

  it("weekend single: a key-only edit patches the setlist under its rev, carries every attribute, and heartbeats the lock", async () => {
    const observed = single(SUN_SETLIST);
    const args = edit(SUN, observed, [{ rowKey: "s1" }, { rowKey: "s2" }, { rowKey: "s3", key: "F" }]);
    const route = editorBody(SUN, observed, [
      { songId: "song-1", play_key: "G", medley_tag: "mx" },
      { songId: "song-2", play_key: "D", medley_tag: "mx" },
      { songId: "song-3", play_key: "F" },
    ]);
    const { route: r, tool } = await twinOf(args, route);
    expectCommittedParity(r, tool);
    const [patch, heartbeat] = r.transactions[0];
    expect(patch).toMatchObject({ kind: "patch", id: "featuredSongs.2029-10-07", ifRevisionId: "featuredSongs.2029-10-07-rev" });
    expect(heartbeat).toMatchObject({ kind: "patch", id: lockIdOf(SUN) });
    // The medley tag is carried byte-identical: no re-derivation on a key-only edit.
    expect((doc(tool.store, "featuredSongs.2029-10-07").songs as Obj[]).map((s) => s.medley_tag ?? null)).toEqual(["mx", "mx", null]);
  });

  it("weekend single: a removal re-derives the medley exactly as the editor's remove() does", async () => {
    const observed = single(SUN_SETLIST);
    const args = edit(SUN, observed, [{ rowKey: "s1" }, { rowKey: "s3" }]);
    // The editor's `normalizeMedleyTags` leaves s1 alone — untagged.
    const route = editorBody(SUN, observed, [
      { songId: "song-1", play_key: "G" },
      { songId: "song-3", play_key: "E" },
    ]);
    const { route: r, tool } = await twinOf(args, route);
    expectCommittedParity(r, tool);
    expect(doc(tool.store, "featuredSongs.2029-10-07").songs).toEqual([
      { _type: "setlist_song", _key: "key-1", play_key: "G", song: { _type: "reference", _ref: "song-1" } },
      { _type: "setlist_song", _key: "key-2", play_key: "E", song: { _type: "reference", _ref: "song-3" } },
    ]);
  });

  it("weekend single: an explicit link joins a new tail row to a stored single, with a fresh tag", async () => {
    const observed = single(SUN_SETLIST);
    const args = edit(SUN, observed, [
      { rowKey: "s1" },
      { rowKey: "s2" },
      { rowKey: "s3", medleyTag: "nuevo" },
      { songId: "song-6", key: "E", medleyTag: "nuevo" },
    ]);
    const route = editorBody(SUN, observed, [
      { songId: "song-1", play_key: "G", medley_tag: "medley-1" },
      { songId: "song-2", play_key: "D", medley_tag: "medley-1" },
      { songId: "song-3", play_key: "E", medley_tag: "medley-2" },
      { songId: "song-6", play_key: "E", medley_tag: "medley-2" },
    ]);
    const { route: r, tool } = await twinOf(args, route);
    expectCommittedParity(r, tool);
    const view = sc<{ setlist: { runs: { kind: string; positions: number[] }[] } }>(tool.response).setlist;
    expect(view.runs).toEqual([
      { kind: "medley", rowKeys: ["key-1", "key-2"], positions: [1, 2] },
      { kind: "medley", rowKeys: ["key-3", "key-4"], positions: [3, 4] },
    ]);
  });

  it("special single: patches the role's songs under the role _rev, with roleId in the body and no lock", async () => {
    const observed = single(SP);
    const args = edit(SP, observed, [{ rowKey: "p1" }, { songId: "song-6", key: "E" }]);
    const route = editorBody(SP, observed, [
      { songId: "song-4", play_key: "A" },
      { songId: "song-6", play_key: "E" },
    ]);
    const { route: r, tool } = await twinOf(args, route);
    expectCommittedParity(r, tool);
    expect(r.transactions[0]).toHaveLength(1);
    expect(r.transactions[0][0]).toMatchObject({ kind: "patch", id: "role-sp", ifRevisionId: "role-sp-rev" });
    // L1-style: the fresh roleRev is the role's new rev, which is also the setlist's.
    expect(sc<Obj>(tool.response).observations).toEqual({
      roleRev: "twin-rev-1",
      setlist: { state: "single", id: "role-sp", rev: "twin-rev-1", rowKeys: ["key-1", "key-2"] },
    });
  });

  it("special none: the first save writes the songs field under the role _rev", async () => {
    const args = edit(SP_NONE, NONE, [{ songId: "song-6" }]);
    const { route, tool } = await twinOf(args, editorBody(SP_NONE, NONE, [{ songId: "song-6", play_key: "" }]));
    expectCommittedParity(route, tool);
    expect(route.transactions[0]).toEqual([
      {
        kind: "patch",
        id: "role-sp-none",
        ifRevisionId: "role-sp-none-rev",
        set: { songs: [{ _type: "setlist_song", _key: "key-1", song: { _type: "reference", _ref: "song-6" } }] },
        setIfMissing: {},
        unset: [],
      },
    ]);
  });

  it("worship night: every row carries its leaders — carried and replaced — as the editor sends them", async () => {
    const observed = single(WN);
    const args = edit(WN, observed, [{ rowKey: "w1" }, { rowKey: "w2", leads: ["mem-eli", "mem-ana"] }]);
    const route = editorBody(WN, observed, [
      { songId: "song-1", play_key: "G", leadIds: ["mem-ana"] },
      { songId: "song-2", play_key: "D", leadIds: ["mem-eli", "mem-ana"] },
    ]);
    const { route: r, tool } = await twinOf(args, route);
    expectCommittedParity(r, tool);
    const view = sc<{ setlist: { rows: { leads?: { memberId: string; name: string }[] }[] } }>(tool.response).setlist;
    expect(view.rows.map((row) => row.leads?.map((l) => l.name))).toEqual([["Ana"], ["Eli", "Ana"]]);
  });

  it("draft vs published: a draft pushes nothing and queues no outbox notice; the tool says «ninguna (servicio en borrador)»", async () => {
    const observed = single(SUN_DRAFT_SETLIST);
    const args = edit(SUN_DRAFT, observed, [{ rowKey: "d1", key: "D" }]);
    const { route, tool } = await twinOf(args, editorBody(SUN_DRAFT, observed, [{ songId: "song-5", play_key: "D" }]));
    expectCommittedParity(route, tool);
    expect(route.pushes).toEqual([]);
    expect(route.outboxUpserts).toEqual([]);
    expect(route.sweeps).toBe(0);
    expect(sc<Obj>(tool.response)).toMatchObject({
      published: "draft",
      notifications: [],
      notificationNote: "ninguna (servicio en borrador)",
    });
    expect(textOf(tool.response)).toContain("Notificaciones: ninguna (servicio en borrador).");
    expect(textOf(tool.response)).not.toContain(OUTBOX_SWEEP_NOTE);
  });

  it("published: the push audience and the outbox participants are the helpers' own, named, never «enviada»", async () => {
    const observed = single(SUN_SETLIST);
    const args = edit(SUN, observed, [{ rowKey: "s1" }, { rowKey: "s2" }, { rowKey: "s3", key: "F" }]);
    const route = editorBody(SUN, observed, [
      { songId: "song-1", play_key: "G", medley_tag: "mx" },
      { songId: "song-2", play_key: "D", medley_tag: "mx" },
      { songId: "song-3", play_key: "F" },
    ]);
    const { route: r, tool } = await twinOf(args, route);
    // Worship members on `all` (the default), plus Beto (`assigned`, and assigned); never Caro (`off`) or the Kids member.
    expect(r.pushes).toEqual([
      {
        memberIds: ["mem-ana", "mem-beto", "mem-dani", "mem-eli", "mem-fer"],
        category: "setlist",
        payload: { title: "Setlist de la semana", body: "Ya están las canciones de este servicio.", path: "/" },
      },
    ]);
    const report = sc<{ notifications: { channel: string; status: string; when: string; audience: { name: string }[] }[] }>(
      tool.response,
    );
    expect(report.notifications.map((n) => [n.channel, n.status, n.audience.map((a) => a.name)])).toEqual([
      ["push", "encolada", ["Ana", "Beto", "Dani", "Eli", "Fer"]],
      ["outbox_email", "encolada", ["Ana", "Beto"]],
    ]);
    expect(report.notifications[0].when).toBe(WHEN_AFTER_RESPONSE);
    expect(r.outboxUpserts).toHaveLength(1);
    expect(textOf(tool.response)).toContain(OUTBOX_SWEEP_NOTE);
    expect(textOf(tool.response)).not.toMatch(/enviad|entregad/);
  });
});

// ── Refusal replay: P1's non-writable observations and bad row keys ─────────

describe("edit_setlist — refused before any read", () => {
  it.each([
    [
      "draft_overlay",
      { state: "draft_overlay", draftIds: ["drafts.featuredSongs.2029-10-07"] },
      "integrity_conflict",
      "Hay un borrador de Studio sobre este setlist; descártalo o publícalo en Studio y vuelve a leer.",
    ],
    [
      "ambiguous",
      { state: "ambiguous", ids: ["a", "b"] },
      "ambiguous_target",
      "Hay más de un setlist para este servicio; corrígelo en /admin o Studio.",
    ],
    ["invalid", { state: "invalid" }, "integrity_conflict", "El registro del setlist es inválido."],
    ["unknown", { state: "unknown" }, "invalid_request", "La lectura falló; vuelve a leer."],
  ])("observed %s: a Spanish refusal, zero reads, zero transactions", async (state, observed, code, text) => {
    const { run, domainCalls } = await toolRun(edit(SUN, observed as Observed, [{ rowKey: "s1" }]));
    expect(sc(run.response)).toEqual({ refused: true, code, detail: `observed_${state}` });
    expect(textOf(run.response)).toBe(`${text} ${NOTHING_WRITTEN}`);
    expect(run.reads).toEqual([]);
    expect(run.transactions).toEqual([]);
    expect(domainCalls).toBe(0);
  });

  it.each([
    ["a null row key", [null, "s2"]],
    ["a repeated row key", ["s1", "s1"]],
  ])("observed single with %s: the editor's invalid_content copy, zero reads", async (_name, rowKeys) => {
    const { run, domainCalls } = await toolRun(
      edit(SUN, single(SUN_SETLIST, { rowKeys: rowKeys as (string | null)[] }), [{ rowKey: "s2" }]),
    );
    expect(sc(run.response)).toEqual({ refused: true, code: "integrity_conflict", detail: "invalid_content" });
    expect(textOf(run.response)).toBe(`${SETLIST_READ_ISSUE_COPY.invalid_content} ${NOTHING_WRITTEN}`);
    expect(run.reads).toEqual([]);
    expect(run.transactions).toEqual([]);
    expect(domainCalls).toBe(0);
  });

  it("a rowKey listed twice, or one the observation does not have, is refused and never guessed", async () => {
    const twice = await toolRun(edit(SUN, single(SUN_SETLIST), [{ rowKey: "s1" }, { rowKey: "s1" }]));
    expect(sc(twice.run.response)).toEqual({
      refused: true,
      code: "invalid_request",
      detail: "duplicate_row_key",
      position: 2,
      rowKey: "s1",
    });
    expect(twice.run.reads).toEqual([]);
    const unknown = await toolRun(edit(SUN, single(SUN_SETLIST), [{ rowKey: "zz" }]));
    expect(sc(unknown.run.response)).toMatchObject({ detail: "unknown_row_key", rowKey: "zz" });
    expect(textOf(unknown.run.response)).toContain("no está en el setlist que leíste");
    expect(unknown.run.reads).toEqual([]);
    // In `none` there are no stored rows at all.
    const inNone = await toolRun(edit(SUN_NONE, NONE, [{ rowKey: "s1" }]));
    expect(sc(inNone.run.response)).toMatchObject({ detail: "unknown_row_key" });
  });

  it("more than 60 rows: the route's own songs_length refusal, byte for byte, with zero reads", async () => {
    const rows = Array.from({ length: 61 }, (_, i) => ({ songId: `song-x${i}` }));
    const { run, domainCalls } = await toolRun(edit(SUN_NONE, NONE, rows));
    const route = await t.runRoute(
      OPTIONS,
      setlistPUT,
      editorBody(SUN_NONE, NONE, rows.map((r) => ({ songId: r.songId, play_key: "" }))),
    );
    expect(route.response).toMatchObject({ status: 400, body: { error: "invalid_request", details: { issues: ["songs_length"] } } });
    expect(sc(run.response)).toEqual({ refused: true, code: "invalid_request", issues: ["songs_length"] });
    expect(textOf(run.response)).toBe(`La solicitud no es válida. Un setlist admite como máximo 60 canciones. ${NOTHING_WRITTEN}`);
    expect(run.reads).toEqual([]);
    expect(domainCalls).toBe(0);
  });
});

// ── Refusal replay: stale observations ──────────────────────────────────────

describe("edit_setlist — stale observations write nothing", () => {
  async function expectInherited(args: EditSetlistArgs, route: unknown, code: string, options: TwinRunOptions = OPTIONS) {
    const twin = await twinOf(args, route, options);
    expect(twin.route.refusedReads).toEqual([]);
    expect(twin.tool.refusedReads).toEqual([]);
    expect(twin.route.response.body).toMatchObject({ error: code });
    expect(twin.tool.response.isError).toBe(true);
    expect(sc(twin.tool.response)).toMatchObject({ refused: true, code });
    expect(parityView(twin.tool)).toEqual(parityView(twin.route));
    expect(twin.tool.transactions).toEqual([]);
    return twin;
  }

  const rows3: Row[] = [{ rowKey: "s1" }, { rowKey: "s2" }, { rowKey: "s3" }];
  const songs3: EditorSong[] = [
    { songId: "song-1", play_key: "G", medley_tag: "mx" },
    { songId: "song-2", play_key: "D", medley_tag: "mx" },
    { songId: "song-3", play_key: "E" },
  ];

  it("a moved setlist rev: the writer's own revision_mismatch, before any body is built", async () => {
    const observed = single(SUN_SETLIST, { rev: "old-rev" });
    const { tool } = await expectInherited(edit(SUN, observed, rows3), editorBody(SUN, observed, songs3), "stale_revision");
    expect(sc(tool.response)).toEqual({ refused: true, code: "stale_revision", detail: "revision_mismatch" });
    expect(textOf(tool.response)).toBe(`${STALE_COPY} El setlist se guardó otra vez desde que lo leíste. ${NOTHING_WRITTEN}`);
  });

  it("observed none, but the setlist was created meanwhile: concurrent_creation", async () => {
    const { tool } = await expectInherited(
      edit(SUN, NONE, [{ songId: "song-6" }]),
      editorBody(SUN, NONE, [{ songId: "song-6", play_key: "" }]),
      "stale_revision",
    );
    expect(sc(tool.response)).toMatchObject({ detail: "concurrent_creation" });
    expect(textOf(tool.response)).toContain("Alguien creó el setlist mientras tanto.");
  });

  it("an identity mismatch: the observation names another document", async () => {
    const observed = single(SUN_SETLIST, { id: "legacy-setlist-1007" });
    const { tool } = await expectInherited(edit(SUN, observed, rows3), editorBody(SUN, observed, songs3), "stale_revision");
    expect(sc(tool.response)).toMatchObject({ detail: "identity_mismatch" });
  });

  it("a special whose Lead changed (its role _rev moved): the tool's roleRev check; the route's own revision check", async () => {
    const moved = () => fixture().map((d) => (d._id === "role-sp" ? { ...d, _rev: "role-sp-rev2", Lead: [ref("l5", "mem-fer")] } : d));
    const observed = single(SP);
    const { tool } = await expectInherited(
      edit(SP, observed, [{ rowKey: "p1" }]),
      editorBody(SP, observed, [{ songId: "song-4", play_key: "A" }]),
      "stale_revision",
      { ...OPTIONS, fixture: moved },
    );
    expect(sc(tool.response)).toEqual({ refused: true, code: "stale_revision", detail: "role_revision" });
    expect(textOf(tool.response)).toBe(`${STALE_COPY} ${NOTHING_WRITTEN}`);
  });

  it("rowKeys that do not match the stored rows (same id and rev): refused, zero domain calls", async () => {
    const { run, domainCalls } = await toolRun(edit(SUN, single(SUN_SETLIST, { rowKeys: ["s1", "s2"] }), [{ rowKey: "s1" }]));
    expect(sc(run.response)).toEqual({ refused: true, code: "stale_revision", detail: "row_keys_mismatch" });
    expect(textOf(run.response)).toBe(`${STALE_COPY} Las filas del setlist ya no son las que leíste. ${NOTHING_WRITTEN}`);
    expect(run.transactions).toEqual([]);
    expect(domainCalls).toBe(0);
  });

  it("roleRev moved on a special in none state whose team changed: the tool refuses; the route alone commits (the gap it closes)", async () => {
    const moved = () =>
      fixture().map((d) => (d._id === "role-sp-none" ? { ...d, _rev: "role-sp-none-rev2", Lead: [ref("l6", "mem-fer")] } : d));
    const options = { ...OPTIONS, fixture: moved };
    const { run, domainCalls } = await toolRun(edit(SP_NONE, NONE, [{ songId: "song-6" }]), options);
    expect(sc(run.response)).toEqual({ refused: true, code: "stale_revision", detail: "role_revision" });
    expect(run.transactions).toEqual([]);
    expect(domainCalls).toBe(0);
    const route = await t.runRoute(options, setlistPUT, editorBody(SP_NONE, NONE, [{ songId: "song-6", play_key: "" }]));
    expect(route.response.status).toBe(200);
    expect(route.transactions).toHaveLength(1);
  });

  it("roleRev moved on a weekend role whose date moved while both dates read none: nothing is written anywhere", async () => {
    const moved = () =>
      fixture().flatMap((d) => {
        if (d._id === "role-sun-none") return [{ ...d, _rev: "moved-rev", week: "2029-10-15" }];
        if (d._id === lockIdOf(SUN_NONE)) return [lockFor({ ...SUN_NONE, week: "2029-10-15" })];
        return [d];
      });
    const { run, domainCalls } = await toolRun(edit(SUN_NONE, NONE, [{ songId: "song-6" }]), { ...OPTIONS, fixture: moved });
    expect(sc(run.response)).toEqual({ refused: true, code: "stale_revision", detail: "role_revision" });
    expect(domainCalls).toBe(0);
    expect(run.transactions).toEqual([]);
    expect(run.store.docs.has("featuredSongs.2029-10-15")).toBe(false);
    expect(run.store.docs.has("featuredSongs.2029-10-14")).toBe(false);
  });
});

// ── Refusal replay: inherited rows (the route's own code) ───────────────────

describe("edit_setlist — refusal replay, inherited rows", () => {
  async function expectInherited(args: EditSetlistArgs, route: unknown, code: string, options: TwinRunOptions = OPTIONS) {
    const twin = await twinOf(args, route, options);
    expect(twin.route.refusedReads).toEqual([]);
    expect(twin.tool.refusedReads).toEqual([]);
    expect(twin.route.response.body).toMatchObject({ error: code });
    expect(sc(twin.tool.response)).toMatchObject({ refused: true, code });
    expect(parityView(twin.tool)).toEqual(parityView(twin.route));
    return twin;
  }

  it("setlist_draft_conflict (a Studio draft appeared after the read): refused at the writer's own loader", async () => {
    const observed = single(SLDRAFT_SETLIST);
    const { tool } = await expectInherited(
      edit(SLDRAFT, observed, [{ rowKey: "sd1" }]),
      editorBody(SLDRAFT, observed, [{ songId: "song-7", play_key: "" }]),
      "integrity_conflict",
    );
    expect(sc(tool.response)).toEqual({ refused: true, code: "integrity_conflict", detail: "setlist_draft_conflict" });
    expect(textOf(tool.response)).toContain("Hay un borrador de Studio sobre este setlist");
    expect(tool.transactions).toEqual([]);
  });

  it("setlist_malformed: a stored setlist without a rev", async () => {
    const { tool } = await expectInherited(
      edit(MALFORMED, NONE, [{ songId: "song-8" }]),
      editorBody(MALFORMED, NONE, [{ songId: "song-8", play_key: "" }]),
      "integrity_conflict",
    );
    expect(sc(tool.response)).toMatchObject({ detail: "setlist_malformed" });
    expect(tool.transactions).toEqual([]);
  });

  it("ambiguous_target: two setlists for one weekend", async () => {
    const { tool } = await expectInherited(
      edit(AMBIG, NONE, [{ songId: "song-8" }]),
      editorBody(AMBIG, NONE, [{ songId: "song-8", play_key: "" }]),
      "ambiguous_target",
    );
    expect(tool.transactions).toEqual([]);
  });

  it("role_draft_conflict: a Studio draft of the weekend role — met by the writer itself", async () => {
    domain.calls = 0;
    const { tool } = await expectInherited(
      edit(ROLEDRAFT, NONE, [{ songId: "song-8" }]),
      editorBody(ROLEDRAFT, NONE, [{ songId: "song-8", play_key: "" }]),
      "integrity_conflict",
    );
    expect(sc(tool.response)).toMatchObject({ detail: "role_draft_conflict" });
    expect(domain.calls).toBe(2); // the route and the tool both reached the writer
    expect(tool.transactions).toEqual([]);
  });

  it("a special that does not exist: not_found, with the route's wording", async () => {
    const ghost = special("role-sp-nope", "2029-10-10", "Nadie", true);
    const { tool } = await expectInherited(
      edit(ghost, NONE, [{ songId: "song-8" }]),
      editorBody(ghost, NONE, [{ songId: "song-8", play_key: "" }]),
      "not_found",
    );
    expect(textOf(tool.response)).toBe(`El servicio no existe; vuelve a buscarlo con list_services. ${NOTHING_WRITTEN}`);
    expect(sc(tool.response)).toMatchObject({ serviceId: "role-sp-nope" });
  });

  it("a type mismatch is structural: the tool derives the body's type from the role, and sends roleId only for a special", async () => {
    // The route refuses a Sunday id sent as a special (`_type`)…
    const route = await t.runRoute(OPTIONS, setlistPUT, {
      week: "2029-10-07",
      type: "special",
      roleId: "role-sun",
      observed: { state: "none" },
      songs: [],
    });
    expect(route.response).toMatchObject({ status: 400, body: { error: "invalid_request", details: { issues: ["_type"] } } });
    // …which the tool cannot send.
    expect(editSetlistBody({ week: "2029-10-07", kind: "sunday", serviceId: "role-sun", observed: { state: "none" }, songs: [] })).toEqual({
      week: "2029-10-07",
      type: "sunday",
      observed: { state: "none" },
      songs: [],
    });
  });

  it("the week mismatch: a special's date moves between the tool's read and the writer's", async () => {
    // Reads of `role by id` in the tool's run: its step 1, its step-3 loader, then the writer's loader.
    const queries_ = raceAtRead("role by id", 3, (store) => {
      doc(store, "role-sp").date = "2029-10-13";
    });
    domain.calls = 0;
    const { run } = await toolRun(edit(SP, single(SP), [{ rowKey: "p1" }]), { ...OPTIONS, queries: queries_ });
    expect(run.refusedReads).toEqual([]);
    expect(sc(run.response)).toEqual({ refused: true, code: "invalid_request", issues: ["week"] });
    expect(run.transactions).toEqual([]);
    // The route alone, given a body whose week no longer matches the role: the same code and issue.
    const route = await t.runRoute(OPTIONS, setlistPUT, {
      ...editorBody(SP, single(SP), [{ songId: "song-4", play_key: "A" }]),
      week: "2029-10-13",
    });
    expect(route.response).toMatchObject({ status: 400, body: { error: "invalid_request", details: { issues: ["week"] } } });
  });

  it("a leader who is not in Lead (a worship night): the writer refuses, the tool names who and where", async () => {
    const observed = single(WN);
    const { tool } = await expectInherited(
      edit(WN, observed, [{ rowKey: "w1", leads: ["mem-fer"] }, { rowKey: "w2" }]),
      editorBody(WN, observed, [
        { songId: "song-1", play_key: "G", leadIds: ["mem-fer"] },
        { songId: "song-2", play_key: "D", leadIds: [] },
      ]),
      "invalid_request",
    );
    expect(sc(tool.response)).toEqual({ refused: true, code: "invalid_request", issues: ["songs[0].leadIds"] });
    expect(textOf(tool.response)).toBe(
      `Fer ya no está en Lead («Cuán grande es Él», fila w1). Cambia leads en esas filas o vuelve a leer con get_service. ${NOTHING_WRITTEN}`,
    );
    expect(tool.transactions).toEqual([]);
  });

  it("explicit leads on a service that is not a worship night: forwarded, and the whole edit refused (F6)", async () => {
    const observed = single(SUN_SETLIST);
    const { tool } = await expectInherited(
      edit(SUN, observed, [{ rowKey: "s1", leads: ["mem-ana"] }, { rowKey: "s2" }, { rowKey: "s3" }]),
      editorBody(SUN, observed, [
        { songId: "song-1", play_key: "G", medley_tag: "mx", leadIds: ["mem-ana"] },
        { songId: "song-2", play_key: "D", medley_tag: "mx" },
        { songId: "song-3", play_key: "E" },
      ]),
      "invalid_request",
    );
    expect(sc(tool.response)).toEqual({ refused: true, code: "invalid_request", issues: ["songs[0].leadIds"] });
    expect(textOf(tool.response)).toBe(`${NOT_WORSHIP_NIGHT_TEXT} ${NOTHING_WRITTEN}`);
    expect(tool.transactions).toEqual([]);
    // leads: [] on the same service is a no-op, not a refusal.
    const noop = await toolRun(edit(SUN, observed, [{ rowKey: "s1", leads: [] }, { rowKey: "s2" }, { rowKey: "s3" }]));
    expect(noop.run.response.isError).toBeUndefined();
  });

  it("an over-long stored medley_tag carried by a key-only edit: the writer's own refusal", async () => {
    const observed = single(LONGTAG_SETLIST);
    const { tool } = await expectInherited(
      edit(LONGTAG, observed, [{ rowKey: "lt1" }, { rowKey: "lt2", key: "A" }]),
      editorBody(LONGTAG, observed, [
        { songId: "song-7", play_key: "", medley_tag: TAG_65 },
        { songId: "song-8", play_key: "A", medley_tag: TAG_65 },
      ]),
      "invalid_request",
    );
    expect(sc(tool.response)).toEqual({ refused: true, code: "invalid_request", issues: ["songs[0].medley_tag"] });
    expect(textOf(tool.response)).toContain("La etiqueta de medley de la canción 1 no tiene un valor válido.");
    expect(tool.transactions).toEqual([]);
  });

  it("bootstrap_completed_reload: a legacy weekend role with no lock — the maintenance write commits, the setlist does not", async () => {
    const { route, tool } = await twinOf(
      edit(LEGACY, NONE, [{ songId: "song-8" }]),
      editorBody(LEGACY, NONE, [{ songId: "song-8", play_key: "" }]),
    );
    expect(route.response).toMatchObject({ status: 409, body: { error: "bootstrap_completed_reload" } });
    expect(sc(tool.response)).toEqual({ refused: true, code: "bootstrap_completed_reload" });
    expect(textOf(tool.response)).toBe(BOOTSTRAP_COMPLETED_RELOAD_MESSAGE);
    for (const run of [route, tool]) {
      expect(run.transactions).toHaveLength(1);
      expect(run.transactions[0].map((op) => op.kind).sort()).toEqual(["create", "patch"]);
      expect(run.store.docs.has("featuredSongs.2029-09-09")).toBe(false);
      expect(run.pushes).toEqual([]);
    }
  });

  it("a commit conflict (a concurrent save lands before the commit): stale_revision, nothing written", async () => {
    const observed = single(SUN_SETLIST);
    const race = (store: TwinStore) => {
      doc(store, "featuredSongs.2029-10-07")._rev = "someone-else";
    };
    const { tool } = await expectInherited(
      edit(SUN, observed, [{ rowKey: "s1" }, { rowKey: "s2" }, { rowKey: "s3", key: "F" }]),
      editorBody(SUN, observed, [
        { songId: "song-1", play_key: "G", medley_tag: "mx" },
        { songId: "song-2", play_key: "D", medley_tag: "mx" },
        { songId: "song-3", play_key: "F" },
      ]),
      "stale_revision",
      { ...OPTIONS, race },
    );
    expect(sc(tool.response)).toMatchObject({ detail: "revision_moved" });
    expect(textOf(tool.response)).toBe(`${STALE_COPY} Alguien guardó un cambio mientras tanto. ${NOTHING_WRITTEN}`);
    expect(tool.transactions).toEqual([]);
    expect(tool.revalidations).toEqual([]);
  });

  it("a concurrent creation at commit: the deterministic id is the mutex", async () => {
    const race = (store: TwinStore) => {
      store.docs.set("featuredSongs.2029-10-14", setlistDoc("featuredSongs", "2029-10-14", [], "featuredSongs.2029-10-14", "theirs"));
    };
    const { tool } = await expectInherited(
      edit(SUN_NONE, NONE, [{ songId: "song-6" }]),
      editorBody(SUN_NONE, NONE, [{ songId: "song-6", play_key: "" }]),
      "stale_revision",
      { ...OPTIONS, race },
    );
    expect(sc(tool.response)).toMatchObject({ detail: "concurrent_creation" });
  });

  it("a retry with the observation the first call consumed is stale_revision, never a second write", async () => {
    const first = await t.runTool(OPTIONS, call(edit(SP, single(SP), [{ rowKey: "p1", key: "B" }])));
    expect(first.response.isError).toBeUndefined();
    const retry = await t.runTool(
      { ...OPTIONS, fixture: () => [...first.store.docs.values()] as TwinDoc[] },
      call(edit(SP, single(SP), [{ rowKey: "p1", key: "B" }])),
    );
    expect(sc(retry.response)).toMatchObject({ refused: true, code: "stale_revision" });
    expect(retry.transactions).toEqual([]);
  });

  it("a commit that fails for another reason is the unknown outcome, never «No se escribió nada.»", async () => {
    const run = await t.runTool(
      { ...OPTIONS, failFirstCommit: Object.assign(new Error("socket hang up token=abc"), { statusCode: 502 }) },
      call(edit(SP, single(SP), [{ rowKey: "p1", key: "B" }])),
    );
    expect(run.response.content).toEqual([{ type: "text", text: WRITE_UNKNOWN_OUTCOME_MESSAGE }]);
    expect(run.transactions).toEqual([]);
    expect(JSON.stringify(run.response)).not.toContain("token=abc");
  });

  it("a throw in a pre-read is the pre-phase text: nothing written, the writer never called", async () => {
    const queries_ = queries({
      "role by id": () => {
        throw new Error("read failed token=abc");
      },
    });
    const { run, domainCalls } = await toolRun(edit(SP, single(SP), [{ rowKey: "p1" }]), { ...OPTIONS, queries: queries_ });
    expect(run.response.content).toEqual([{ type: "text", text: WRITE_PRE_FAILURE_MESSAGE }]);
    expect(domainCalls).toBe(0);
    expect(run.transactions).toEqual([]);
    expect(JSON.stringify(run.response)).not.toContain("token=abc");
  });
});

// ── Refusal replay: mirror rows (the tool alone; the route alone for the record) ─

describe("edit_setlist — refusal replay, mirror rows (§ «Admin surface gates»)", () => {
  async function mirror(args: EditSetlistArgs, route: unknown, toolOptions: TwinRunOptions = OPTIONS) {
    const { run: tool, domainCalls } = await toolRun(args, toolOptions);
    expect(tool.refusedReads).toEqual([]);
    expect(tool.response.isError).toBe(true);
    expect(domainCalls).toBe(0);
    expect(tool.transactions).toEqual([]);
    expect(tool.outboxUpserts).toEqual([]);
    expect(tool.pushes).toEqual([]);
    expect(tool.revalidations).toEqual([]);
    const routeRun = await t.runRoute(OPTIONS, setlistPUT, route);
    expect(routeRun.refusedReads).toEqual([]);
    return { tool, route: routeRun };
  }

  function expectRouteCommits(route: TwinRun<{ status: number; body: unknown }>) {
    expect(route.response.status).toBe(200);
    expect(route.transactions).toHaveLength(1);
  }

  const invalidContent = `${SETLIST_READ_ISSUE_COPY.invalid_content} ${NOTHING_WRITTEN}`;

  it("E1: a stored row whose song reference dangles — the route alone commits", async () => {
    const observed = single(DANGLE_SETLIST);
    const { tool, route } = await mirror(
      edit(DANGLE, observed, [{ rowKey: "x1" }, { rowKey: "x2" }]),
      editorBody(DANGLE, observed, [
        { songId: "song-7", play_key: "" },
        { songId: "song-deleted", play_key: "" },
      ]),
    );
    expect(sc(tool.response)).toEqual({ refused: true, code: "integrity_conflict", detail: "invalid_content" });
    expect(textOf(tool.response)).toBe(invalidContent);
    expectRouteCommits(route);
  });

  it("E1 runs after the observation checks: a stale observation of an invalid setlist is reported as stale first", async () => {
    const { run, domainCalls } = await toolRun(
      edit(DANGLE, single(DANGLE_SETLIST, { rev: "old-rev" }), [{ rowKey: "x1" }, { rowKey: "x2" }]),
    );
    expect(sc(run.response)).toEqual({ refused: true, code: "stale_revision", detail: "revision_mismatch" });
    expect(domainCalls).toBe(0);
  });

  it("E1: a stored row with a duplicate _key — refused before any read; the route alone commits", async () => {
    const observed = single(DUPKEY_SETLIST);
    expect(observed).toMatchObject({ rowKeys: ["k1", "k1"] });
    const { tool, route } = await mirror(
      edit(DUPKEY, observed, [{ rowKey: "k1" }]),
      editorBody(DUPKEY, observed, [
        { songId: "song-7", play_key: "" },
        { songId: "song-8", play_key: "" },
      ]),
    );
    expect(textOf(tool.response)).toBe(invalidContent);
    expect(tool.reads).toEqual([]);
    expectRouteCommits(route);
  });

  it("E1: a stored row with no _key — refused before any read; the route alone commits", async () => {
    const observed = single(NOKEY_SETLIST);
    expect(observed).toMatchObject({ rowKeys: [null] });
    const { tool, route } = await mirror(
      edit(NOKEY, observed, [{ songId: "song-8" }]),
      editorBody(NOKEY, observed, [
        { songId: "song-7", play_key: "" },
        { songId: "song-8", play_key: "" },
      ]),
    );
    expect(textOf(tool.response)).toBe(invalidContent);
    expect(tool.reads).toEqual([]);
    expectRouteCommits(route);
  });

  it("E1: a stored reference to an existing non-song document (the post-typed resolver) — the route alone commits", async () => {
    const observed = single(NONSONG_SETLIST);
    const { tool, route } = await mirror(
      edit(NONSONG, observed, [{ rowKey: "n1" }, { rowKey: "n2" }]),
      editorBody(NONSONG, observed, [
        { songId: "song-7", play_key: "" },
        { songId: "tag-adoracion", play_key: "" },
      ]),
    );
    expect(sc(tool.response)).toMatchObject({ detail: "invalid_content" });
    expectRouteCommits(route);
  });

  it("a failed song lookup: «No se pudieron comprobar las canciones» — the route alone (which reads no titles) commits", async () => {
    const queries_ = queries({
      "song titles": () => {
        throw new Error("titles read failed");
      },
    });
    const observed = single(SUN_SETLIST);
    const { tool, route } = await mirror(
      edit(SUN, observed, [{ rowKey: "s1" }, { rowKey: "s2" }, { rowKey: "s3", key: "F" }]),
      editorBody(SUN, observed, [
        { songId: "song-1", play_key: "G", medley_tag: "mx" },
        { songId: "song-2", play_key: "D", medley_tag: "mx" },
        { songId: "song-3", play_key: "F" },
      ]),
      { ...OPTIONS, queries: queries_ },
    );
    expect(sc(tool.response)).toEqual({ refused: true, code: "integrity_conflict", detail: "song_lookup_failed" });
    expect(textOf(tool.response)).toBe(`${SONG_LOOKUP_FAILED_TEXT} ${NOTHING_WRITTEN}`);
    expectRouteCommits(route);
  });

  it.each([
    ["a member id", "mem-ana"],
    ["a song that was deleted", "song-deleted"],
  ])("E4: a new songId that is %s — the route alone commits", async (_name, songId) => {
    const observed = single(SUN_SETLIST);
    const { tool, route } = await mirror(
      edit(SUN, observed, [{ rowKey: "s1" }, { rowKey: "s2" }, { rowKey: "s3" }, { songId }]),
      editorBody(SUN, observed, [
        { songId: "song-1", play_key: "G", medley_tag: "mx" },
        { songId: "song-2", play_key: "D", medley_tag: "mx" },
        { songId: "song-3", play_key: "E" },
        { songId, play_key: "" },
      ]),
    );
    expect(sc(tool.response)).toEqual({ refused: true, code: "invalid_request", detail: "unknown_song", position: 4, songId });
    expect(textOf(tool.response)).toBe(
      `«${songId}» no es una canción del catálogo; usa un id que devuelva search_songs. ${NOTHING_WRITTEN}`,
    );
    expectRouteCommits(route);
  });

  it("E7: a carried leader whose member document is gone — the route alone (raw Lead refs) commits", async () => {
    const observed = single(WN_GONE);
    const { tool, route } = await mirror(
      edit(WN_GONE, observed, [{ rowKey: "g1" }]),
      editorBody(WN_GONE, observed, [{ songId: "song-8", play_key: "B", leadIds: ["mem-gone"] }]),
    );
    expect(sc(tool.response)).toEqual({
      refused: true,
      code: "invalid_request",
      detail: "lead_not_member",
      position: 1,
      rowKey: "g1",
      songId: "song-8",
      memberIds: ["mem-gone"],
    });
    expect(textOf(tool.response)).toBe(
      `«Te alabaré» nombra como líder a alguien que ya no existe como miembro; cámbialo con leads en esa fila. ${NOTHING_WRITTEN}`,
    );
    expectRouteCommits(route);
  });

  it("E3: a new row naming a song already in the setlist («Ya está») — the route alone commits the duplicate", async () => {
    const observed = single(SUN_SETLIST);
    const { tool, route } = await mirror(
      edit(SUN, observed, [{ rowKey: "s1" }, { rowKey: "s2" }, { rowKey: "s3" }, { songId: "song-1" }]),
      editorBody(SUN, observed, [
        { songId: "song-1", play_key: "G", medley_tag: "mx" },
        { songId: "song-2", play_key: "D", medley_tag: "mx" },
        { songId: "song-3", play_key: "E" },
        { songId: "song-1", play_key: "" },
      ]),
    );
    expect(sc(tool.response)).toEqual({ refused: true, code: "invalid_request", detail: "duplicate_song", position: 4, songId: "song-1" });
    expect(textOf(tool.response)).toBe(`«Cuán grande es Él» ya está en el setlist. ${NOTHING_WRITTEN}`);
    expectRouteCommits(route);
  });

  it("E-key: a carried play_key of 25 characters — refused unless replaced; the route alone blanks it silently", async () => {
    const observed = single(LONGKEY_SETLIST);
    const { tool, route } = await mirror(
      edit(LONGKEY, observed, [{ rowKey: "q1" }]),
      editorBody(LONGKEY, observed, [{ songId: "song-7", play_key: "x".repeat(25) }]),
    );
    expect(sc(tool.response)).toMatchObject({ detail: "stored_key_too_long", rowKey: "q1" });
    expect(textOf(tool.response)).toContain("La tonalidad guardada de «Rey de reyes» pasa de 24 caracteres");
    expectRouteCommits(route);
    expect((doc(route.store, "featuredSongs.2029-09-02").songs as Obj[])[0]).not.toHaveProperty("play_key");
    // Sending key replaces it.
    const replaced = await toolRun(edit(LONGKEY, observed, [{ rowKey: "q1", key: "C" }]));
    expect(replaced.run.response.isError).toBeUndefined();
  });

  it("E-key: 24 × U+0958 passes the schema and is refused by the writer's own parser, with zero domain calls", async () => {
    const qa = "क़".repeat(24);
    const observed = single(SUN_SETLIST);
    const { tool, route } = await mirror(
      edit(SUN, observed, [{ rowKey: "s1" }, { rowKey: "s2" }, { rowKey: "s3", key: qa }]),
      editorBody(SUN, observed, [
        { songId: "song-1", play_key: "G", medley_tag: "mx" },
        { songId: "song-2", play_key: "D", medley_tag: "mx" },
        { songId: "song-3", play_key: qa },
      ]),
    );
    expect(sc(tool.response)).toMatchObject({ detail: "key_too_long", position: 3 });
    expect(textOf(tool.response)).toBe(`La tonalidad de «Santo» pasa de 24 caracteres. ${NOTHING_WRITTEN}`);
    expectRouteCommits(route);
    expect((doc(route.store, "featuredSongs.2029-10-07").songs as Obj[])[2]).not.toHaveProperty("play_key");
  });

  it("E5: an explicit link between rows that are not adjacent — refused; the route alone stores the stray tags", async () => {
    const observed = single(SUN_SETLIST);
    const { tool, route } = await mirror(
      edit(SUN, observed, [{ rowKey: "s3", medleyTag: "x" }, { rowKey: "s1" }, { rowKey: "s2" }, { songId: "song-6", medleyTag: "x" }]),
      editorBody(SUN, observed, [
        { songId: "song-3", play_key: "E", medley_tag: "x" },
        { songId: "song-1", play_key: "G", medley_tag: "mx" },
        { songId: "song-2", play_key: "D", medley_tag: "mx" },
        { songId: "song-6", play_key: "", medley_tag: "x" },
      ]),
    );
    expect(sc(tool.response)).toMatchObject({ code: "invalid_request", detail: "medley_not_adjacent", position: 1 });
    expect(textOf(tool.response)).toBe(
      `El enlace de medley de «Santo» no se puede aplicar: las canciones enlazadas tienen que quedar juntas. ${NOTHING_WRITTEN}`,
    );
    expectRouteCommits(route);
  });
});

// ── D8: the fresh observation ───────────────────────────────────────────────

describe("edit_setlist — the fresh observation (D8)", () => {
  const observed = single(SUN_SETLIST);
  const keyEdit = edit(SUN, observed, [{ rowKey: "s1" }, { rowKey: "s2" }, { rowKey: "s3", key: "F" }]);

  it("is returned, with the rows, when the read-back is exactly what was written", async () => {
    const { run } = await toolRun(keyEdit);
    const report = sc<Obj>(run.response);
    expect(report.observations).toEqual({
      roleRev: "role-sun-rev",
      setlist: { state: "single", id: "featuredSongs.2029-10-07", rev: "twin-rev-1", rowKeys: ["key-1", "key-2", "key-3"] },
    });
    expect(report).not.toHaveProperty("changedAgainAfterSave");
    expect((report.setlist as { rows: Obj[] }).rows).toEqual([
      { rowKey: "key-1", song: { id: "song-1", title: "Cuán grande es Él", author: null }, key: "G", medleyTag: "mx" },
      { rowKey: "key-2", song: { id: "song-2", title: "Aquí estoy", author: null }, key: "D", medleyTag: "mx" },
      { rowKey: "key-3", song: { id: "song-3", title: "Santo", author: null }, key: "F", medleyTag: null },
    ]);
    expect(textOf(run.response)).toContain("La observación nueva va en observations, para la próxima escritura.");
  });

  it("is withheld when a row differs from what was written only in its play_key", async () => {
    const queries_ = afterCommit("setlist target", (rows) => {
      const songs = rows[0].songs as Obj[];
      songs[2] = { ...songs[2], play_key: "G" };
    });
    const { run } = await toolRun(keyEdit, { ...OPTIONS, queries: queries_ });
    const report = sc<Obj>(run.response);
    expect(report.ok).toBe(true);
    expect(report).not.toHaveProperty("observations");
    expect(report.changedAgainAfterSave).toBe(true);
    expect((report.current as { setlist: { rows: Obj[] } }).setlist.rows[2]).toMatchObject({ key: "G" });
    expect(textOf(run.response)).toContain(CHANGED_AGAIN_TEXT);
  });

  it("is withheld when a row differs only in a leader's _key (a worship night)", async () => {
    const queries_ = afterCommit("role by id", (rows) => {
      for (const row of rows) {
        if (row._id !== "role-wn") continue;
        const songs = row.songs as Obj[];
        const leads = songs[0].leads as Obj[];
        songs[0] = { ...songs[0], leads: [{ ...leads[0], _key: "rekeyed" }] };
      }
    });
    const { run } = await toolRun(edit(WN, single(WN), [{ rowKey: "w1" }, { rowKey: "w2" }]), { ...OPTIONS, queries: queries_ });
    expect(sc<Obj>(run.response)).toMatchObject({ ok: true, changedAgainAfterSave: true });
    expect(sc<Obj>(run.response)).not.toHaveProperty("observations");
  });

  it("is withheld for a special whose seats changed after the save (same document, same rev)", async () => {
    const queries_ = afterCommit("role by id", (rows) => {
      for (const row of rows) if (row._id === "role-sp") row.BGVs = [ref("nb", "mem-fer")];
    });
    const { run } = await toolRun(edit(SP, single(SP), [{ rowKey: "p1", key: "B" }]), { ...OPTIONS, queries: queries_ });
    expect(sc<Obj>(run.response)).toMatchObject({ ok: true, changedAgainAfterSave: true });
    expect(sc<Obj>(run.response)).not.toHaveProperty("observations");
  });

  it("is withheld for a weekend role whose rev moved after the save", async () => {
    const queries_ = afterCommit("role by id", (rows) => {
      for (const row of rows) if (row._id === "role-sun") row._rev = "role-sun-rev2";
    });
    const { run } = await toolRun(keyEdit, { ...OPTIONS, queries: queries_ });
    expect(sc<Obj>(run.response)).toMatchObject({ ok: true, changedAgainAfterSave: true });
  });

  it("is returned with the new roleRev after L1-style special edits, one after another", async () => {
    const first = await t.runTool(OPTIONS, call(edit(SP, single(SP), [{ rowKey: "p1" }, { songId: "song-6" }])));
    const fresh = sc<{ observations: { roleRev: string; setlist: Observed } }>(first.response).observations;
    expect(fresh).toEqual({
      roleRev: "twin-rev-1",
      setlist: { state: "single", id: "role-sp", rev: "twin-rev-1", rowKeys: ["key-1", "key-2"] },
    });
    // The next edit takes the fresh observation as it is.
    const second = await t.runTool(
      { ...OPTIONS, fixture: () => [...first.store.docs.values()] as TwinDoc[] },
      call({ serviceId: "role-sp", roleRev: fresh.roleRev, observed: fresh.setlist, rows: [{ rowKey: "key-2", key: "E" }] }),
    );
    expect(second.response.isError).toBeUndefined();
    expect(second.transactions).toHaveLength(1);
  });

  it("gives observations: null, with the committed ok: true, when the read-back throws", async () => {
    const queries_ = queries({
      "setlist target": (store, p) => {
        if (committed(store)) throw new Error("read-back failed");
        return ROWS["setlist target"](store, p);
      },
    });
    const { run } = await toolRun(keyEdit, { ...OPTIONS, queries: queries_ });
    expect(run.response.isError).toBeUndefined();
    expect(sc<Obj>(run.response)).toMatchObject({ ok: true, observations: null });
    expect(textOf(run.response)).toContain(READ_BACK_FAILED_TEXT);
    expect(run.transactions).toHaveLength(1);
  });
});

// ── The report ──────────────────────────────────────────────────────────────

describe("edit_setlist — the report", () => {
  it("names the songs used by other services in the editor's window (the repeat hint, E-hint)", async () => {
    const { run } = await toolRun(edit(SUN, single(SUN_SETLIST), [{ rowKey: "s1" }, { rowKey: "s2" }, { rowKey: "s3" }]));
    expect(sc<{ repeatedSongs: RepeatedSong[] }>(run.response).repeatedSongs).toEqual([
      { songId: "song-1", title: "Cuán grande es Él", lastUsed: "2029-10-12" },
      { songId: "song-2", title: "Aquí estoy", lastUsed: "2029-10-12" },
    ]);
    expect(textOf(run.response)).toContain(
      "Repetidas en las últimas semanas: «Cuán grande es Él» (2029-10-12), «Aquí estoy» (2029-10-12).",
    );
    const cutoff = run.reads.find((r) => r.label === "recent setlists")?.params.cutoff;
    expect(cutoff).toBe("2026-07-30"); // 8 weeks before the frozen CDMX day, as the editor's GET reads it
  });

  it("a failed hint read omits the hint and never fails the committed edit", async () => {
    const queries_ = queries({
      "recent setlists": () => {
        throw new Error("hint failed");
      },
    });
    const { run } = await toolRun(edit(SUN, single(SUN_SETLIST), [{ rowKey: "s1" }]), { ...OPTIONS, queries: queries_ });
    expect(run.response.isError).toBeUndefined();
    expect(sc<Obj>(run.response)).not.toHaveProperty("repeatedSongs");
    expect(run.transactions).toHaveLength(1);
  });

  it("a failed member read after the commit leaves names unresolved; the edit stays ok", async () => {
    const queries_ = queries({
      "members by id": (store, p) => {
        if (committed(store)) throw new Error("members failed");
        return ROWS["members by id"](store, p);
      },
    });
    const { run } = await toolRun(edit(WN, single(WN), [{ rowKey: "w1" }, { rowKey: "w2" }]), { ...OPTIONS, queries: queries_ });
    expect(run.response.isError).toBeUndefined();
    const rows = sc<{ setlist: { rows: { leads?: Obj[] }[] } }>(run.response).setlist.rows;
    expect(rows[0].leads).toEqual([{ memberId: "mem-ana", name: null, alias: null, unresolved: true }]);
  });
});
