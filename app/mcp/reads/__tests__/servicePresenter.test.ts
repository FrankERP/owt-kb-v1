// The `get_service` / `list_services` presenter (P1 step 4): selector
// resolution, seats, setlist, readiness and the I7 observations, over snapshots
// loaded from the fixture store through the real snapshot loader.
//
// The presenter is pure over a snapshot; the clients are mocked only so the
// snapshot (and the two content lookups) can be loaded exactly as the tools load
// them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ operational: vi.fn(), raw: vi.fn() }));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.raw(...a) },
}));

import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { PUBLISH_SKIP_COPY } from "@/app/components/admin/serviceCardModel";
import { assembleService } from "@/app/utils/publishReadyBundle";
import { publishRefusalFor } from "../publishRefusal";
import { loadMemberNames, loadServiceSnapshot, type ServiceSnapshot, type SnapshotRow } from "../serviceSnapshot";
import {
  catalogueUnreadable,
  observeServiceSetlist,
  parseServiceSelector,
  presentService,
  presentServiceList,
  resolveService,
  serviceContentIds,
  serviceKindOf,
  type GetServicePayload,
  type ServiceSelector,
} from "../servicePresenter";
import { loadSongTitles } from "../songTitles";
import { buildParticipantRoles, participantMemberIds, presentParticipation } from "../participationPresenter";
import { resolveProposalServiceId } from "../proposalPresenter";
import { FROZEN_EVENING, KIDS_ONLY_MEMBER_ID, readToolStore, scopedResponder, type ScopedResponderOptions } from "./readToolFixtures";
import { READINESS_DOMAINS, SERVICE_FIXTURE_ROLE_IDS, serviceFixtureStore, type ServiceFixtureStore } from "./serviceFixtures";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.operational.mockReset();
  h.raw.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.useRealTimers();
});

async function snapshotOf(store: ServiceFixtureStore, options: ScopedResponderOptions = {}): Promise<ServiceSnapshot> {
  const responder = scopedResponder(store, options);
  h.operational.mockImplementation(responder.operational);
  h.raw.mockImplementation(responder.raw);
  return loadServiceSnapshot();
}

function roleOf(snapshot: ServiceSnapshot, id: string): SnapshotRow {
  const row = snapshot.roles.find((r) => r._id === id);
  if (!row) throw new Error(`fixture: no canonical role ${id}`);
  return row;
}

/** What `get_service` does after resolving: both content lookups, then the presenter. */
async function present(snapshot: ServiceSnapshot, id: string): Promise<GetServicePayload> {
  const role = roleOf(snapshot, id);
  const ids = serviceContentIds(snapshot, role);
  const [members, songs] = await Promise.all([
    loadMemberNames(ids.memberIds, snapshot.membersById),
    loadSongTitles(ids.songIds),
  ]);
  return presentService(snapshot, role, { members, songs });
}

function selector(input: Record<string, unknown>): ServiceSelector {
  const parsed = parseServiceSelector(input);
  if (!parsed.ok) throw new Error(`fixture: selector refused: ${parsed.message}`);
  return parsed.selector;
}

function freezeEvening() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FROZEN_EVENING));
}

const CANONICAL_IDS = () => readToolStore().roles.map((r) => r._id as string);

// ── Kinds without role-type literals in the module ──────────────────────────

describe("serviceKindOf", () => {
  it("maps each role type to its service kind, and nothing else", () => {
    expect(serviceKindOf("sunday_role")).toBe("sunday");
    expect(serviceKindOf("saturday_role")).toBe("saturday");
    expect(serviceKindOf("special_role")).toBe("special");
    expect(serviceKindOf("featuredSongs")).toBeNull();
    expect(serviceKindOf(undefined)).toBeNull();
  });
});

// ── Selector parsing (exactly one selector, I13) ────────────────────────────

describe("parseServiceSelector", () => {
  it("accepts each form", () => {
    expect(parseServiceSelector({})).toEqual({ ok: true, selector: { by: "next" } });
    expect(parseServiceSelector({ serviceId: "role-sun-1004" })).toEqual({
      ok: true,
      selector: { by: "id", serviceId: "role-sun-1004" },
    });
    expect(parseServiceSelector({ date: "2026-10-04", kind: "sunday" })).toEqual({
      ok: true,
      selector: { by: "date", date: "2026-10-04", kind: "sunday", name: null },
    });
    expect(parseServiceSelector({ date: "2026-10-17", kind: "special", name: "Vigilia" })).toEqual({
      ok: true,
      selector: { by: "date", date: "2026-10-17", kind: "special", name: "Vigilia" },
    });
    expect(parseServiceSelector({ date: "2026-10-17" })).toEqual({
      ok: true,
      selector: { by: "date", date: "2026-10-17", kind: null, name: null },
    });
  });

  it("refuses a drafts.* id in Spanish, and never as «ya está publicado»", () => {
    const parsed = parseServiceSelector({ serviceId: "drafts.role-sp-draftonly" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toMatch(/borrador/i);
    expect(parsed.message).not.toMatch(/publicado/i);
  });

  it.each([
    [{ serviceId: "" }],
    [{ serviceId: "role sun" }],
    [{ serviceId: "role-sun-1004", date: "2026-10-04" }],
    [{ serviceId: "role-sun-1004", kind: "sunday" }],
    [{ kind: "sunday" }],
    [{ name: "Vigilia" }],
    [{ date: "2026-10-04", kind: "sunday", name: "Vigilia" }],
    [{ date: "2026-10-17", name: "Vigilia" }],
    [{ date: "2026-02-30" }],
  ])("refuses %j with a Spanish message", (input) => {
    const parsed = parseServiceSelector(input as Record<string, unknown>);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message.length).toBeGreaterThan(10);
  });
});

// ── Resolution (A15: an ambiguous selector is refused with its candidates) ──

describe("resolveService", () => {
  it("resolves an id, and refuses an id that names no canonical role", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const found = resolveService(snapshot, selector({ serviceId: "role-sun-1004" }), "2026-09-24");
    expect(found.ok && found.role._id).toBe("role-sun-1004");

    const missing = resolveService(snapshot, selector({ serviceId: "role-missing" }), "2026-09-24");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toMatch(/no existe/i);
  });

  it("refuses a canonical id of another document type — only a role is a service (I13)", async () => {
    const snapshot = await snapshotOf(readToolStore());
    for (const id of ["set-sun-1004", "mem-ana", "prop-sat-1003", "roleTarget.sunday_role.2026-10-04"]) {
      expect(parseServiceSelector({ serviceId: id }).ok, id).toBe(true);
      const r = resolveService(snapshot, selector({ serviceId: id }), "2026-09-24");
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.message, id).toMatch(/no existe/i);
    }
  });

  it("resolves a Sunday by its date", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const r = resolveService(snapshot, selector({ date: "2026-10-04", kind: "sunday" }), "2026-09-24");
    expect(r.ok && r.role._id).toBe("role-sun-1004");
  });

  it("resolves a Saturday by the SATURDAY's own date — its stored week — never the Sunday week key", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const r = resolveService(snapshot, selector({ date: "2026-10-03", kind: "saturday" }), "2026-09-24");
    expect(r.ok && r.role._id).toBe("role-sat-1003");
    const payload = await present(snapshot, "role-sat-1003");
    expect(payload.date).toBe("2026-10-03");
    // …and its setlist is the `saturdarSongs` stored on that same week.
    expect(payload.observations.setlist).toEqual({
      state: "single",
      id: "set-sat-1003",
      rev: "set-sat-1003-rev",
      rowKeys: ["r1"],
    });

    // The following Sunday's date names the Sunday, not the Saturday.
    const onSunday = resolveService(snapshot, selector({ date: "2026-10-04", kind: "saturday" }), "2026-09-24");
    expect(onSunday.ok).toBe(false);
    if (!onSunday.ok) expect(onSunday.candidates.map((c) => c.serviceId)).toEqual(["role-sun-1004"]);
  });

  it("refuses a camp day's special without a name, listing both sets with their times", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const r = resolveService(snapshot, selector({ date: "2026-10-17", kind: "special" }), "2026-09-24");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.candidates).toEqual([
      { serviceId: "role-sp-1017-a", kind: "special", date: "2026-10-17", name: "Campamento · Mañana", time: "09:00" },
      { serviceId: "role-sp-1017-b", kind: "special", date: "2026-10-17", name: "Campamento · Noche", time: "19:00" },
    ]);
  });

  it("matches a special's name by normalizeServiceName — whitespace folds, case does not", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const exact = resolveService(snapshot, selector({ date: "2026-10-17", kind: "special", name: "Campamento · Noche" }), "2026-09-24");
    expect(exact.ok && exact.role._id).toBe("role-sp-1017-b");
    const spaced = resolveService(
      snapshot,
      selector({ date: "2026-10-17", kind: "special", name: "  Campamento   ·  Noche " }),
      "2026-09-24",
    );
    expect(spaced.ok && spaced.role._id).toBe("role-sp-1017-b");
    const lower = resolveService(snapshot, selector({ date: "2026-10-17", kind: "special", name: "campamento · noche" }), "2026-09-24");
    expect(lower.ok).toBe(false);
    if (!lower.ok) expect(lower.candidates).toHaveLength(2);
  });

  it("resolves { date } alone only when exactly one service is on it", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const one = resolveService(snapshot, selector({ date: "2026-10-04" }), "2026-09-24");
    expect(one.ok && one.role._id).toBe("role-sun-1004");
    const two = resolveService(snapshot, selector({ date: "2026-10-17" }), "2026-09-24");
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.candidates.map((c) => c.serviceId)).toEqual(["role-sp-1017-a", "role-sp-1017-b"]);
    const none = resolveService(snapshot, selector({ date: "2026-10-05" }), "2026-09-24");
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.candidates).toEqual([]);
  });

  it("refuses a duplicated weekend target and lists both roles", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const r = resolveService(snapshot, selector({ date: "2026-11-22", kind: "sunday" }), "2026-09-24");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.candidates.map((c) => c.serviceId)).toEqual(["role-sun-1122-a", "role-sun-1122-b"]);
  });

  it("{} at 23:30 in Mexico City (already tomorrow in UTC) is today's first service, drafts included, with its same-day sibling", async () => {
    freezeEvening();
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(serviceTodayIso()).toBe("2026-09-30");
    const snapshot = await snapshotOf(readToolStore());
    const r = resolveService(snapshot, selector({}), serviceTodayIso());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // role-sun-0927 is earlier but past; role-sp-0930-a is a draft and still wins.
    expect(r.role._id).toBe("role-sp-0930-a");
    expect(r.role.published).toBe(false);
    expect(r.sameDayOthers).toEqual([
      { serviceId: "role-sp-0930-b", kind: "special", date: "2026-09-30", name: "Vigilia", time: "21:00" },
    ]);
  });

  it("{} refuses when the day's first place is a tie between specials with no time (A15)", async () => {
    const store = readToolStore();
    for (const row of store.roles) if (String(row._id).startsWith("role-sp-0930")) row.time = null;
    const snapshot = await snapshotOf(store);
    const r = resolveService(snapshot, selector({}), "2026-09-30");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/hora/i);
    expect(r.candidates).toEqual([
      { serviceId: "role-sp-0930-a", kind: "special", date: "2026-09-30", name: "Oración", time: null },
      { serviceId: "role-sp-0930-b", kind: "special", date: "2026-09-30", name: "Vigilia", time: null },
    ]);
  });

  it("{} refuses two duplicate weekend roles tied for first place", async () => {
    const snapshot = await snapshotOf(readToolStore());
    // After 2026-11-15, the earliest upcoming day is 2026-11-22: two canonical Sundays, both untimed.
    const r = resolveService(snapshot, selector({}), "2026-11-16");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/hora/i);
    expect(r.candidates.map((c) => c.serviceId)).toEqual(["role-sun-1122-a", "role-sun-1122-b"]);
  });

  it("{} refuses a Sunday tied with an untimed special on the same day", async () => {
    const store = readToolStore();
    store.roles.push({
      ...store.roles.find((r) => r._id === "role-sp-0930-b")!,
      _id: "role-sp-1004-untimed",
      _rev: "role-sp-1004-untimed-rev",
      date: "2026-10-04",
      service_name: "Santa Cena",
      time: null,
    });
    const snapshot = await snapshotOf(store);
    const r = resolveService(snapshot, selector({}), "2026-10-04");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.candidates).toEqual([
        { serviceId: "role-sp-1004-untimed", kind: "special", date: "2026-10-04", name: "Santa Cena", time: null },
        { serviceId: "role-sun-1004", kind: "sunday", date: "2026-10-04", name: null, time: null },
      ]);
    }
  });

  it("{} refuses two specials at the same HH:mm", async () => {
    const store = readToolStore();
    store.roles.find((r) => r._id === "role-sp-0930-b")!.time = "07:00";
    const snapshot = await snapshotOf(store);
    const r = resolveService(snapshot, selector({}), "2026-09-30");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.candidates.map((c) => [c.serviceId, c.time])).toEqual([
      ["role-sp-0930-a", "07:00"],
      ["role-sp-0930-b", "07:00"],
    ]);
  });

  it("{} still picks when only the LATER same-day specials tie", async () => {
    const store = readToolStore();
    store.roles.find((r) => r._id === "role-sp-0930-b")!.time = null;
    store.roles.push({ ...store.roles.find((r) => r._id === "role-sp-0930-b")!, _id: "role-sp-0930-c", _rev: "c-rev", service_name: "Cena" });
    const snapshot = await snapshotOf(store);
    const r = resolveService(snapshot, selector({}), "2026-09-30");
    expect(r.ok && r.role._id).toBe("role-sp-0930-a");
    if (r.ok) expect(r.sameDayOthers!.map((c) => c.serviceId)).toEqual(["role-sp-0930-b", "role-sp-0930-c"]);
  });

  it("{} with a single service on the earliest date reports no same-day siblings", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const r = resolveService(snapshot, selector({}), "2026-10-01");
    expect(r.ok && r.role._id).toBe("role-sat-1003");
    if (r.ok) expect(r.sameDayOthers).toBeNull();
  });

  it("{} refuses when nothing is scheduled from today on", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const r = resolveService(snapshot, selector({}), "2027-01-01");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no hay/i);
  });
});

// ── The catalogue gate ──────────────────────────────────────────────────────

describe("catalogueUnreadable", () => {
  it("is true exactly when the roles read failed", async () => {
    expect(catalogueUnreadable(await snapshotOf(readToolStore(), { fail: ["roles"] }))).toBe(true);
    expect(catalogueUnreadable(await snapshotOf(readToolStore(), { fail: ["proposals"] }))).toBe(false);
    expect(catalogueUnreadable(await snapshotOf(readToolStore()))).toBe(false);
  });
});

// ── The setlist observation (I7), pinned per case ───────────────────────────

describe("observeServiceSetlist", () => {
  it.each([
    ["role-sun-1004", { state: "single", id: "set-sun-1004", rev: "set-sun-1004-rev", rowKeys: ["r1", "r2"] }],
    ["role-sat-1003", { state: "single", id: "set-sat-1003", rev: "set-sat-1003-rev", rowKeys: ["r1"] }],
    ["role-sun-1011", { state: "none" }],
    ["role-sun-1025", { state: "ambiguous", ids: ["set-sun-1025-a", "set-sun-1025-b"] }],
    ["role-sun-1018", { state: "draft_overlay", draftIds: ["drafts.set-sun-1018"] }],
    ["role-sun-1129", { state: "draft_overlay", draftIds: ["drafts.featuredSongs.2026-11-29"] }],
    ["role-sat-1128", { state: "draft_overlay", draftIds: ["drafts.saturdarSongs.2026-11-28"] }],
    ["role-sp-1024-wn", { state: "single", id: "role-sp-1024-wn", rev: "role-sp-1024-wn-rev", rowKeys: ["r1", "r2"] }],
    ["role-sp-1017-a", { state: "single", id: "role-sp-1017-a", rev: "role-sp-1017-a-rev", rowKeys: [] }],
    ["role-sp-1017-b", { state: "none" }],
    ["role-sp-1107", { state: "draft_overlay", draftIds: ["drafts.role-sp-1107"] }],
    ["role-sp-1114-invalid", { state: "invalid" }],
  ])("%s → %j", async (id, expected) => {
    const snapshot = await snapshotOf(readToolStore());
    expect(observeServiceSetlist(snapshot, roleOf(snapshot, id)).observation).toEqual(expected);
  });

  it("sees the legacy-id overlay by _type + week, where readiness (by base id) sees a clean single", async () => {
    const snapshot = await snapshotOf(readToolStore());
    expect(assembleService(snapshot.readiness, "role-sun-1129")!.observation!.setlist).toEqual({
      state: "single",
      id: "legacy-set-1129",
      rev: "legacy-set-1129-rev",
    });
    expect(observeServiceSetlist(snapshot, roleOf(snapshot, "role-sun-1129")).observation).toEqual({
      state: "draft_overlay",
      draftIds: ["drafts.featuredSongs.2026-11-29"],
    });
  });

  it("carries every raw setlist draft's type and week in the snapshot, beside the unchanged id list", async () => {
    const snapshot = await snapshotOf(serviceFixtureStore());
    expect(snapshot.setlistDraftIds).toEqual(["drafts.set-sun-1018"]);
    expect(snapshot.setlistDrafts).toEqual([{ id: "drafts.set-sun-1018", type: "featuredSongs", week: "2026-10-18" }]);
  });

  it("is unknown, never none, when the weekend setlist reads failed", async () => {
    for (const domain of ["setlists", "setlistDrafts"] as const) {
      const snapshot = await snapshotOf(readToolStore(), { fail: [domain] });
      expect(observeServiceSetlist(snapshot, roleOf(snapshot, "role-sun-1011")).observation).toEqual({ state: "unknown" });
      expect(observeServiceSetlist(snapshot, roleOf(snapshot, "role-sun-1004")).observation).toEqual({ state: "unknown" });
      // A special's setlist is its own role row; the weekend setlist reads do not touch it.
      expect(observeServiceSetlist(snapshot, roleOf(snapshot, "role-sp-1017-b")).observation).toEqual({ state: "none" });
    }
  });

  it("is unknown for a special when the role-draft inventory failed", async () => {
    const snapshot = await snapshotOf(readToolStore(), { fail: ["roleDrafts"] });
    expect(observeServiceSetlist(snapshot, roleOf(snapshot, "role-sp-1017-b")).observation).toEqual({ state: "unknown" });
    expect(observeServiceSetlist(snapshot, roleOf(snapshot, "role-sp-1107")).observation).toEqual({ state: "unknown" });
  });
});

// ── get_service's payload ───────────────────────────────────────────────────

describe("presentService — identity and publication (I3)", () => {
  it("reports a special's name, time and format, and no such keys on a weekend service", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const special = await present(snapshot, "role-sp-1017-a");
    expect(special).toMatchObject({
      serviceId: "role-sp-1017-a",
      kind: "special",
      date: "2026-10-17",
      name: "Campamento · Mañana",
      time: "09:00",
      format: null,
    });
    expect((await present(snapshot, "role-sp-1024-wn")).format).toBe("worship_night");
    const sunday = await present(snapshot, "role-sun-1004");
    expect(sunday).toMatchObject({ serviceId: "role-sun-1004", kind: "sunday", date: "2026-10-04" });
    for (const key of ["name", "time", "format"]) expect(key in sunday, key).toBe(false);
  });

  it("normalises publication: legacy (no field) is published, false is a draft, true is published", async () => {
    const snapshot = await snapshotOf(readToolStore());
    expect(await present(snapshot, "role-sun-1011")).toMatchObject({ published: "published", publishedRaw: null });
    expect(await present(snapshot, "role-sat-1003")).toMatchObject({ published: "draft", publishedRaw: false });
    expect(await present(snapshot, "role-sun-1004")).toMatchObject({ published: "published", publishedRaw: true });
  });
});

describe("presentService — seats", () => {
  it("names all five seat groups with their item keys and labels", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const { seats } = await present(snapshot, "role-sun-1004");
    expect(seats).toEqual({
      Lead: [{ itemKey: "l1", memberId: "mem-ana", name: "Ana", alias: null }],
      BGVs: [{ itemKey: "b1", memberId: "mem-sofia", name: "Sofía", alias: null }],
      Chorus: [{ itemKey: "c1", memberId: "mem-luis", name: "Luis", alias: "Lucho" }],
      instruments: [{ itemKey: "i1", memberId: "mem-luis", name: "Luis", alias: "Lucho", instrument: "Bajo" }],
      foh_team: [{ itemKey: "f1", memberId: "mem-sofia", name: "Sofía", alias: null, role: "Sonido" }],
    });
  });

  it("reports a dangling seat reference as missing, never drops it", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const { seats } = await present(snapshot, "role-sun-1025");
    expect(seats.BGVs).toEqual([{ itemKey: "b1", memberId: "mem-ghost", name: null, alias: null, missing: true }]);
  });

  it("shows a seated kids-only member (the I5 seat exception)", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const { seats } = await present(snapshot, "role-sp-0930-a");
    expect(seats.BGVs).toEqual([{ itemKey: "b1", memberId: KIDS_ONLY_MEMBER_ID, name: "Kiki", alias: null }]);
  });

  it("presents an invalid role: a non-list seat group is null, and the record is still observed", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const payload = await present(snapshot, "role-sun-1108-invalid");
    expect(payload.seats.Chorus).toBeNull();
    expect(payload.seats.Lead).toEqual([{ itemKey: "l1", memberId: "mem-ana", name: "Ana", alias: null }]);
    expect(payload.readiness.blockers.hard.map((b) => b.code)).toContain("invalid_record");
    expect(payload.observations).toMatchObject({
      roleId: "role-sun-1108-invalid",
      roleRev: "role-sun-1108-invalid-rev",
      seatItemKeys: { Lead: ["l1"], BGVs: [], Chorus: null, instruments: [], foh_team: [] },
    });
  });

  it("says a name is UNREADABLE, not missing, when the member reads failed", async () => {
    const snapshot = await snapshotOf(readToolStore(), { fail: ["members"] });
    const payload = await present(snapshot, "role-sun-1004");
    expect(payload.failedSources).toContain("members");
    expect(payload.seats.Lead).toEqual([{ itemKey: "l1", memberId: "mem-ana", name: null, alias: null, unresolved: true }]);
    expect(payload.notes!.join(" ")).toMatch(/miembros/i);
  });
});

describe("presentService — setlist", () => {
  it("lists rows with song id, title and author, key and medley tag, and the runs buildRuns computes", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const { setlist } = await present(snapshot, "role-sun-1004");
    expect(setlist).toEqual({
      rows: [
        { rowKey: "r1", song: { id: "song-1", title: "Grande es tu fidelidad", author: "Thomas Chisholm" }, key: "G", medleyTag: null },
        { rowKey: "r2", song: { id: "song-2", title: "Cuán grande es Él", author: "Carl Boberg" }, key: "A", medleyTag: null },
      ],
      runs: [
        { kind: "single", rowKeys: ["r1"], positions: [1] },
        { kind: "single", rowKeys: ["r2"], positions: [2] },
      ],
    });
  });

  it("groups a medley into one run", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const { setlist } = await present(snapshot, "role-sun-1129");
    expect(setlist!.runs).toEqual([
      { kind: "medley", rowKeys: ["r1", "r2"], positions: [1, 2] },
      { kind: "single", rowKeys: ["r3"], positions: [3] },
    ]);
    expect(setlist!.rows.map((r) => r.medleyTag)).toEqual(["m1", "m1", null]);
  });

  it("names a worship night's per-song leaders; a service that is not one carries no leads", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const wn = await present(snapshot, "role-sp-1024-wn");
    expect(wn.setlist!.rows.map((r) => r.leads)).toEqual([
      [{ memberId: "mem-ana", name: "Ana", alias: null }],
      [
        { memberId: "mem-ana", name: "Ana", alias: null },
        { memberId: "mem-luis", name: "Luis", alias: "Lucho" },
      ],
    ]);
    const sunday = await present(snapshot, "role-sun-1004");
    for (const row of sunday.setlist!.rows) expect("leads" in row).toBe(false);
  });

  it("reports a worship-night leader that names no member as missing (P1-R2), never drops it", async () => {
    const store = readToolStore();
    const wnRole = store.roles.find((r) => r._id === "role-sp-1024-wn")!;
    (wnRole.songs as { leads: unknown[] }[])[0]!.leads.push({ _key: "ld9", _type: "reference", _ref: "mem-gone" });
    const snapshot = await snapshotOf(store);
    const wn = await present(snapshot, "role-sp-1024-wn");
    expect(wn.setlist!.rows[0]!.leads).toEqual([
      { memberId: "mem-ana", name: "Ana", alias: null },
      { memberId: "mem-gone", name: null, alias: null, missing: true },
    ]);
  });

  it("reports a worship-night leader entry with NO reference as missing, like a ref-less seat — never dropped", async () => {
    const store = readToolStore();
    const wnRole = store.roles.find((r) => r._id === "role-sp-1024-wn")!;
    (wnRole.songs as { leads: unknown[] }[])[1]!.leads.splice(1, 0, { _key: "ld8", _type: "reference", _ref: null });
    const snapshot = await snapshotOf(store);
    const wn = await present(snapshot, "role-sp-1024-wn");
    expect(wn.setlist!.rows[1]!.leads).toEqual([
      { memberId: "mem-ana", name: "Ana", alias: null },
      { memberId: null, name: null, alias: null, missing: true },
      { memberId: "mem-luis", name: "Luis", alias: "Lucho" },
    ]);
  });

  it("keeps the service when the song titles cannot be read: titles null, with a note", async () => {
    const snapshot = await snapshotOf(readToolStore(), { failPosts: true });
    const payload = await present(snapshot, "role-sun-1004");
    expect(payload.setlist!.rows[0]!.song).toEqual({ id: "song-1", title: null, author: null });
    expect(payload.notes!.join(" ")).toMatch(/canciones/i);
    expect(payload.observations.setlist).toMatchObject({ state: "single", rowKeys: ["r1", "r2"] });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sk-fixture-secret");
  });

  it("marks a song reference that resolves to no post", async () => {
    const snapshot = await snapshotOf(readToolStore(), { posts: [] });
    const payload = await present(snapshot, "role-sun-1004");
    expect(payload.setlist!.rows[0]!.song).toEqual({ id: "song-1", title: null, author: null, missing: true });
    expect(payload.notes).toBeUndefined();
  });

  it("shows no rows for an ambiguous setlist, and none for a failed read", async () => {
    const snapshot = await snapshotOf(readToolStore());
    expect((await present(snapshot, "role-sun-1025")).setlist).toBeNull();
    const failed = await snapshotOf(readToolStore(), { fail: ["setlists"] });
    const payload = await present(failed, "role-sun-1004");
    expect(payload.setlist).toBeNull();
    expect(payload.observations.setlist).toEqual({ state: "unknown" });
    expect(payload.failedSources).toEqual(["setlistTargets"]);
  });
});

describe("presentService — a draft overlay readiness cannot see", () => {
  const NOTE = /borrador sin publicar de este setlist en Studio.*La verificación de publicación no lo detecta.*se negará a guardar/;

  it("names the legacy-id week's draft in the observation AND in a Spanish note, without touching readiness", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const payload = await present(snapshot, "role-sun-1129");
    expect(payload.observations.setlist).toEqual({ state: "draft_overlay", draftIds: ["drafts.featuredSongs.2026-11-29"] });
    expect(payload.notes).toHaveLength(1);
    expect(payload.notes![0]).toMatch(NOTE);
    expect(payload.notes![0]).toContain("«drafts.featuredSongs.2026-11-29»");
    // No synthetic blocker: readiness is still the publish route's verdict (I4).
    const d2 = publishRefusalFor(assembleService(snapshot.readiness, "role-sun-1129"));
    expect(payload.readiness.blockers.hard.map((b) => b.code)).toEqual(d2.blockers!.hard);
    expect(payload.readiness.blockers.hard.map((b) => b.code)).not.toContain("setlist_draft_conflict");
    // A draft-only week with no canonical setlist is the same blind spot.
    expect((await present(snapshot, "role-sat-1128")).notes![0]).toContain("«drafts.saturdarSongs.2026-11-28»");
  });

  it("adds no note when readiness already names the draft", async () => {
    const snapshot = await snapshotOf(readToolStore());
    for (const [id, draftId] of [
      ["role-sun-1018", "drafts.set-sun-1018"],
      ["role-sp-1107", "drafts.role-sp-1107"],
    ] as const) {
      const payload = await present(snapshot, id);
      expect(payload.observations.setlist, id).toEqual({ state: "draft_overlay", draftIds: [draftId] });
      expect(payload.readiness.integrityIssues.flatMap((i) => i.ids), id).toContain(draftId);
      expect(payload.notes, id).toBeUndefined();
    }
  });
});

describe("presentService — readiness (I4) from the same snapshot", () => {
  it("reports D2's blockers with the admin's Spanish copy, the primary action and the notes, for every service", async () => {
    const snapshot = await snapshotOf(readToolStore());
    for (const id of CANONICAL_IDS()) {
      const assembled = assembleService(snapshot.readiness, id)!;
      const d2 = publishRefusalFor(assembled);
      const { readiness } = await present(snapshot, id);
      expect(readiness.blockers, id).toEqual({
        hard: d2.blockers!.hard.map((code) => ({ code, copy: PUBLISH_SKIP_COPY[code] })),
        workflow: d2.blockers!.workflow.map((code) => ({ code, copy: PUBLISH_SKIP_COPY[code] })),
      });
      expect(readiness.primaryAction, id).toEqual({
        kind: assembled.readiness.primaryAction.kind,
        label: assembled.readiness.primaryAction.label,
      });
      expect(readiness.conflicts, id).toEqual(assembled.readiness.conflicts);
      expect(readiness.integrityIssues, id).toEqual(assembled.readiness.integrityIssues);
      expect(readiness.publishCheck.refusals, id).toEqual(d2.refusals);
      expect(readiness.publishCheck.passesNow, id).toBe(d2.ready);
    }
  });

  it("reports the availability conflict the admin shows", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const { readiness } = await present(snapshot, "role-sun-1011");
    expect(readiness.conflicts).toEqual([{ memberId: "mem-luis", memberName: "Lucho", note: "Viaje" }]);
    expect(readiness.blockers.workflow.map((b) => b.code)).toContain("availability_conflict");
  });

  it("presents «already published» as a state, not a problem, and puts the workflow blockers beside not_ready", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const ready = (await present(snapshot, "role-sat-1003")).readiness.publishCheck;
    expect(ready).toEqual({ passesNow: true, refusals: [], alreadyPublished: false, problems: [] });

    const live = (await present(snapshot, "role-sun-1004")).readiness.publishCheck;
    expect(live).toEqual({ passesNow: false, refusals: ["already_published"], alreadyPublished: true, problems: [] });

    const liveGap = (await present(snapshot, "role-sun-1115-live")).readiness.publishCheck;
    expect(liveGap.alreadyPublished).toBe(true);
    expect(liveGap.problems).toEqual([
      { code: "not_ready", copy: PUBLISH_SKIP_COPY.not_ready, blockers: [PUBLISH_SKIP_COPY.incomplete_setlist] },
    ]);

    const hard = (await present(snapshot, "role-sun-1018")).readiness.publishCheck;
    expect(hard.problems[0]).toMatchObject({
      code: "hard_integrity_blocker",
      blockers: [PUBLISH_SKIP_COPY.setlist_draft_conflict],
    });
  });
});

describe("presentService — observations (I7) and the snapshot rule", () => {
  it("returns the role id, its _rev, every seat item key and the setlist observation", async () => {
    const snapshot = await snapshotOf(readToolStore());
    expect((await present(snapshot, "role-sun-1004")).observations).toEqual({
      roleId: "role-sun-1004",
      roleRev: "role-sun-1004-rev",
      seatItemKeys: { Lead: ["l1"], BGVs: ["b1"], Chorus: ["c1"], instruments: ["i1"], foh_team: ["f1"] },
      setlist: { state: "single", id: "set-sun-1004", rev: "set-sun-1004-rev", rowKeys: ["r1", "r2"] },
    });
  });

  it("takes every _rev from the snapshot's own rows, the same ones readiness was computed from", async () => {
    // Each read stamps its revisions with a call count; a second read of a domain would show `#2`.
    const snapshot = await snapshotOf(readToolStore(), { revisionDrift: true });
    const payload = await present(snapshot, "role-sun-1004");
    const observation = assembleService(snapshot.readiness, "role-sun-1004")!.observation!;
    expect(payload.observations.roleRev).toBe("role-sun-1004-rev#1");
    expect(payload.observations.roleRev).toBe(observation.roleRev);
    expect(payload.observations.setlist).toMatchObject({ id: "set-sun-1004", rev: "set-sun-1004-rev#1" });
    expect(payload.observations.setlist).toMatchObject({ rev: (observation.setlist as { rev: string }).rev });
  });
});

describe("presentService — serialisation and payload hygiene", () => {
  it("is plain JSON: no Map, no undefined, identical after a round trip", async () => {
    const snapshot = await snapshotOf(readToolStore());
    for (const id of CANONICAL_IDS()) {
      const payload = await present(snapshot, id);
      expect(JSON.parse(JSON.stringify(payload)), id).toStrictEqual(payload);
    }
  });

  it("never carries peaks, lyrics or chord charts", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const text = JSON.stringify(await present(snapshot, "role-sun-1004"));
    expect(text).toContain("Grande es tu fidelidad");
    for (const field of ["peaks", "body", "chords", "rehearsalMixes"]) expect(text).not.toContain(`"${field}"`);
  });
});

// ── list_services' payload ──────────────────────────────────────────────────

describe("presentServiceList", () => {
  it("lists a month's canonical services in /admin's order (date, then time), draft-only records excluded", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const list = presentServiceList(snapshot, "2026-10");
    expect(list.month).toBe("2026-10");
    expect(list.services.map((s) => s.serviceId)).toEqual([
      "role-sat-1003",
      "role-sun-1004",
      "role-sat-1010",
      "role-sun-1011",
      "role-sp-1017-a",
      "role-sp-1017-b",
      "role-sun-1018",
      "role-sp-1024-wn",
      "role-sun-1025",
    ]);
    expect(list.failedSources).toBeUndefined();
    expect(JSON.stringify(list)).not.toContain("draftonly");
  });

  it("gives each entry its id, _rev, date, kind, publication, publish verdict and D2 blockers — special fields only on specials", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const list = presentServiceList(snapshot, "2026-10");
    for (const entry of list.services) {
      const d2 = publishRefusalFor(assembleService(snapshot.readiness, entry.serviceId));
      expect(entry.blockers, entry.serviceId).toEqual({
        hard: d2.blockers!.hard.map((code) => ({ code, copy: PUBLISH_SKIP_COPY[code] })),
        workflow: d2.blockers!.workflow.map((code) => ({ code, copy: PUBLISH_SKIP_COPY[code] })),
      });
      expect(entry.passesNow, entry.serviceId).toBe(d2.ready);
      expect(entry.roleRev).toBe(roleOf(snapshot, entry.serviceId)._rev);
    }
    expect(list.services[0]).toEqual({
      serviceId: "role-sat-1003",
      roleRev: "role-sat-1003-rev",
      date: "2026-10-03",
      kind: "saturday",
      published: "draft",
      publishedRaw: false,
      passesNow: true,
      blockers: { hard: [], workflow: [] },
    });
    expect(list.services.find((s) => s.serviceId === "role-sun-1011")).toMatchObject({
      published: "published",
      publishedRaw: null,
    });
    expect(list.services.find((s) => s.serviceId === "role-sp-1024-wn")).toMatchObject({
      kind: "special",
      name: "Noche de alabanza",
      time: null,
      format: "worship_night",
    });
  });

  it("orders untimed same-day roles deterministically and keeps an invalid canonical role", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const ids = presentServiceList(snapshot, "2026-11").services.map((s) => s.serviceId);
    expect(ids).toEqual([
      "role-sp-1107",
      "role-sun-1108-invalid",
      "role-sp-1114-invalid",
      "role-sun-1115-live",
      "role-sun-1122-a",
      "role-sun-1122-b",
      "role-sat-1128",
      "role-sun-1129",
    ]);
  });

  it("lists September's past and present services", async () => {
    const snapshot = await snapshotOf(readToolStore());
    expect(presentServiceList(snapshot, "2026-09").services.map((s) => s.serviceId)).toEqual([
      "role-sun-0927",
      "role-sp-0930-a",
      "role-sp-0930-b",
    ]);
  });

  it("lists the data with failedSources when a non-role domain failed", async () => {
    const snapshot = await snapshotOf(readToolStore(), { fail: ["proposals"] });
    const list = presentServiceList(snapshot, "2026-10");
    expect(list.failedSources).toEqual(["proposals"]);
    expect(list.services).toHaveLength(9);
    for (const entry of list.services) expect(entry.blockers.hard.map((b) => b.code)).toContain("source_unready");
  });

  it("is plain JSON", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const list = presentServiceList(snapshot, "2026-10");
    expect(JSON.parse(JSON.stringify(list))).toStrictEqual(list);
  });

  it("answers passesNow exactly as get_service's publishCheck.passesNow does, both ways", async () => {
    const snapshot = await snapshotOf(readToolStore());
    const seen = new Set<boolean>();
    for (const month of ["2026-09", "2026-10", "2026-11", "2026-12"]) {
      for (const entry of presentServiceList(snapshot, month).services) {
        const full = await present(snapshot, entry.serviceId);
        expect(entry.passesNow, entry.serviceId).toBe(full.readiness.publishCheck.passesNow);
        seen.add(entry.passesNow);
      }
    }
    expect([...seen].sort()).toEqual([false, true]); // both verdicts occur, so the comparison is not vacuous
  });

  // list_services carries `blockers`, never the refusal codes. That is only
  // honest while the one refusal with no blocker of its own,
  // `unusable_observation`, always comes with a hard blocker.
  it("never refuses unusable_observation without a hard blocker, over the step-2/3 matrix and every failed domain", async () => {
    let unusable = 0;
    for (const fail of [[], ...READINESS_DOMAINS.map((d) => [d])]) {
      const snapshot = await snapshotOf(serviceFixtureStore(), { fail });
      for (const id of SERVICE_FIXTURE_ROLE_IDS) {
        const verdict = publishRefusalFor(assembleService(snapshot.readiness, id));
        if (!verdict.refusals.includes("unusable_observation")) continue;
        unusable++;
        expect(verdict.blockers!.hard.length, `${id} (failed: ${fail.join(",") || "none"})`).toBeGreaterThan(0);
      }
      if (snapshot.readiness.sources.roles !== "ready") continue;
      for (const entry of presentServiceList(snapshot, "2026-10").services.concat(presentServiceList(snapshot, "2026-11").services)) {
        const verdict = publishRefusalFor(assembleService(snapshot.readiness, entry.serviceId));
        if (verdict.refusals.includes("unusable_observation")) expect(entry.blockers.hard.length, entry.serviceId).toBeGreaterThan(0);
      }
    }
    expect(unusable).toBeGreaterThan(0); // the matrix really exercises the refusal
  });
});

// ── The one service-row rule (`serviceCandidateOf`), across every tool ──────

describe("a role whose _id is not a canonical document id is no service, in any tool", () => {
  /**
   * `readToolStore()` plus January 2027 — a month nothing else in this suite
   * pins. `role-sun-0103` is a real service; the two roles with whitespace in
   * their `_id` fail `isCanonicalDocumentId`, one of them on the SAME Sunday.
   * Ana is seated on all three, so the counts show which rows were counted.
   */
  function storeWithMalformedIds(): ServiceFixtureStore {
    const store = readToolStore();
    const blank = { published: false, week: null, date: null, service_name: null, time: null, format: null, songs: null };
    const seats = { Lead: [{ _key: "l1", _type: "reference", _ref: "mem-ana" }], BGVs: [], Chorus: [], instruments: [], foh_team: [] };
    store.roles.push(
      { ...blank, ...seats, _id: "role-sun-0103", _rev: "role-sun-0103-rev", _type: "sunday_role", week: "2027-01-03" },
      { ...blank, ...seats, _id: "role sun 0103 malformed", _rev: "m1-rev", _type: "sunday_role", week: "2027-01-03" },
      {
        ...blank,
        ...seats,
        _id: "role sp 0109 malformed",
        _rev: "m2-rev",
        _type: "special_role",
        date: "2027-01-09",
        service_name: "Mal formado",
        time: "19:00",
      },
    );
    return store;
  }

  it("list_services, get_participation's services[] and counts, and list_proposals' links all leave it out", async () => {
    const snapshot = await snapshotOf(storeWithMalformedIds());
    expect(snapshot.roles.filter((r) => String(r._id).includes(" "))).toHaveLength(2); // the rows did load

    expect(presentServiceList(snapshot, "2027-01").services.map((s) => s.serviceId)).toEqual(["role-sun-0103"]);

    const members = await loadMemberNames(
      participantMemberIds(buildParticipantRoles(snapshot, "2027-01")),
      snapshot.membersById,
    );
    const participation = presentParticipation(snapshot, "2027-01", members);
    expect(participation.services.map((s) => s.serviceId)).toEqual(["role-sun-0103"]);
    expect(participation.members).toEqual([expect.objectContaining({ memberId: "mem-ana", sunLead: 1, total: 1 })]);

    const proposal = (over: Record<string, unknown>): SnapshotRow => ({ _id: "prop-x", ...over });
    // A weekend link: the malformed Sunday does not make the real one ambiguous.
    expect(
      resolveProposalServiceId(snapshot, proposal({ service_type: "sunday", service_date: "2027-01-03" })),
    ).toBe("role-sun-0103");
    // A special link: `service_ref` naming the malformed special resolves to nothing.
    expect(
      resolveProposalServiceId(snapshot, proposal({ service_type: "special", service_ref: "role sp 0109 malformed" })),
    ).toBeNull();
  });
});
