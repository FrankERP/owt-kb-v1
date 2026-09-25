// The `list_proposals` presenter (P1 step 7): linking a proposal to its
// service, the live `messages[]` thread vs. the frozen notes (A7), `threadOpen`
// and the D6 month-mode truncation.
//
// The presenter is pure over a snapshot; the clients are mocked only so the
// snapshot (and the two content lookups) can be loaded exactly as the tool
// loads them. Most rows here are ad hoc literals — `presentProposal` and
// `resolveProposalServiceId` take a row directly, so a row does not need to
// live in the shared fixture's `store.proposals` to be tested; only the
// SELECTION functions (`proposalsForService` / `proposalsForMonth`, and the
// payload builders on top of them) need real entries, and the shared matrix
// already has three (`prop-sat-1003`, `prop-sun-1011`, `prop-orphan`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ operational: vi.fn(), raw: vi.fn() }));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.raw(...a) },
}));

import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { UNSEATED_MEMBER_ID } from "./serviceFixtures";
import {
  presentProposal,
  presentProposalsForMonth,
  presentProposalsForService,
  proposalContentIds,
  proposalsForMonth,
  proposalsForService,
  proposalsUnreadable,
  resolveProposalServiceId,
  type ProposalLookups,
} from "../proposalPresenter";
import { loadMemberNames, loadServiceSnapshot, type ServiceSnapshot, type SnapshotRow } from "../serviceSnapshot";
import { loadSongTitles } from "../songTitles";
import { FROZEN_EVENING, readToolStore, scopedResponder, type ScopedResponderOptions } from "./readToolFixtures";

async function snapshotOf(options: ScopedResponderOptions = {}): Promise<ServiceSnapshot> {
  const responder = scopedResponder(readToolStore(), options);
  h.operational.mockImplementation(responder.operational);
  h.raw.mockImplementation(responder.raw);
  return loadServiceSnapshot();
}

async function emptyLookups(): Promise<ProposalLookups> {
  return { members: await loadMemberNames([], new Map()), songs: await loadSongTitles([]) };
}

function roleOf(snapshot: ServiceSnapshot, id: string): SnapshotRow {
  const row = snapshot.roles.find((r) => r._id === id);
  if (!row) throw new Error(`fixture: no canonical role ${id}`);
  return row;
}

/**
 * A `PROPOSAL_PROJECTION`-shaped row, every field defaulted to `null` unless
 * given, except `_id`/`_rev` — `presentProposal` throws on a row with no id
 * (mirroring `presentService`), so every ad hoc row needs one; most tests here
 * don't care WHICH one, so it defaults rather than being repeated everywhere.
 */
function proposalRow(over: Record<string, unknown>): SnapshotRow {
  return {
    _id: "prop-test",
    _rev: "prop-test-rev",
    _createdAt: null,
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

function message(key: string, author: string | null, at: string, body = "body"): Record<string, unknown> {
  return { _key: key, _type: "proposal_message", author, author_role: "lead", kind: "lead_note", body, at };
}

beforeEach(() => {
  h.operational.mockReset();
  h.raw.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Linking (never a guess) ─────────────────────────────────────────────────

describe("resolveProposalServiceId", () => {
  it("resolves a weekend proposal to its role, by type + the role's own date", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({ service_type: "sunday", service_date: "2026-10-11" });
    expect(resolveProposalServiceId(snapshot, row)).toBe("role-sun-1011");
  });

  it("resolves a special proposal by service_ref", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({ service_type: "special", service_ref: "role-sp-1107" });
    expect(resolveProposalServiceId(snapshot, row)).toBe("role-sp-1107");
  });

  it("an unresolvable link (service_ref names no canonical role) is null, never a guess", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({ service_type: "special", service_ref: "role-missing" });
    expect(resolveProposalServiceId(snapshot, row)).toBeNull();
  });

  it("a weekend match against a duplicate target (ambiguous) is null, never an arbitrary pick", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({ service_type: "sunday", service_date: "2026-11-22" });
    expect(resolveProposalServiceId(snapshot, row)).toBeNull();
  });

  it("a malformed service_type is null", async () => {
    const snapshot = await snapshotOf();
    expect(resolveProposalServiceId(snapshot, proposalRow({ service_type: "weird" }))).toBeNull();
    expect(resolveProposalServiceId(snapshot, proposalRow({}))).toBeNull();
  });
});

// ── A7: the live thread only, never the frozen archive ──────────────────────

describe("presentProposal — the live thread only (A7)", () => {
  it("a proposal with only frozen lead_notes/admin_notes/team_notes and an empty messages[] reports an empty thread, and the note text appears nowhere in the payload", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({
      _id: "prop-notes-only",
      _rev: "rev-1",
      service_type: "special",
      service_ref: "role-sp-1107",
      service_date: "2026-11-07",
      status: "draft",
      messages: [],
      lead_notes: "SECRET_LEAD_NOTE",
      admin_notes: "SECRET_ADMIN_NOTE",
      team_notes: "SECRET_TEAM_NOTE",
    });
    const entry = presentProposal(snapshot, row, await emptyLookups(), "2026-09-30", false);
    expect(entry.messages).toEqual([]);
    expect(entry.messagesTotal).toBe(0);
    expect(entry.truncated).toBe(false);
    const text = JSON.stringify(entry);
    expect(text).not.toMatch(/SECRET_LEAD_NOTE|SECRET_ADMIN_NOTE|SECRET_TEAM_NOTE/);
  });
});

// ── threadOpen (CDMX calendar day, independent of status) ───────────────────

describe("presentProposal — threadOpen", () => {
  it("is open on the service's own date", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({ service_type: "special", service_date: "2026-09-30", status: "pending", messages: [] });
    expect(presentProposal(snapshot, row, await emptyLookups(), "2026-09-30", false).threadOpen).toBe(true);
  });

  it("is closed the day after the service", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({ service_type: "special", service_date: "2026-09-29", status: "pending", messages: [] });
    expect(presentProposal(snapshot, row, await emptyLookups(), "2026-09-30", false).threadOpen).toBe(false);
  });

  it("with the clock frozen at 2026-09-30T23:30:00-06:00 (already 2026-10-01 in UTC): a service dated 2026-09-30 is open, one dated 2026-09-29 is closed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN_EVENING));
    const snapshot = await snapshotOf();
    const lookups = await emptyLookups();
    // `serviceTodayIso()` is CDMX ("2026-09-30"), the discriminating case: a
    // UTC-derived "today" would already read "2026-10-01" and wrongly close
    // the 09-30 proposal's thread.
    const today = serviceTodayIso();
    expect(today).toBe("2026-09-30");
    const open = proposalRow({ service_type: "special", service_date: "2026-09-30", status: "pending", messages: [] });
    const closed = proposalRow({ service_type: "special", service_date: "2026-09-29", status: "pending", messages: [] });
    expect(presentProposal(snapshot, open, lookups, today, false).threadOpen).toBe(true);
    expect(presentProposal(snapshot, closed, lookups, today, false).threadOpen).toBe(false);
  });
});

// ── D6: month-mode truncation ────────────────────────────────────────────────

describe("presentProposal — D6 message truncation", () => {
  function fourteenMessages(): Record<string, unknown>[] {
    return Array.from({ length: 14 }, (_, i) =>
      message(`m${i + 1}`, UNSEATED_MEMBER_ID, `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`, `msg-${i + 1}`),
    );
  }

  it("{ month } keeps the last 10, chronological, with truncated: true and messagesTotal: 14", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({ service_type: "special", service_date: "2026-09-30", messages: fourteenMessages() });
    const lookups = { members: await loadMemberNames([UNSEATED_MEMBER_ID], snapshot.membersById), songs: await loadSongTitles([]) };
    const entry = presentProposal(snapshot, row, lookups, "2026-09-30", true);
    expect(entry.messagesTotal).toBe(14);
    expect(entry.truncated).toBe(true);
    expect(entry.messages).toHaveLength(10);
    expect(entry.messages[0]!.body).toBe("msg-5");
    expect(entry.messages[9]!.body).toBe("msg-14");
  });

  it("{ serviceId } (capMessages: false) returns the whole thread, all 14, untruncated", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({ service_type: "special", service_date: "2026-09-30", messages: fourteenMessages() });
    const lookups = { members: await loadMemberNames([UNSEATED_MEMBER_ID], snapshot.membersById), songs: await loadSongTitles([]) };
    const entry = presentProposal(snapshot, row, lookups, "2026-09-30", false);
    expect(entry.messagesTotal).toBe(14);
    expect(entry.truncated).toBe(false);
    expect(entry.messages).toHaveLength(14);
    expect(entry.messages[0]!.body).toBe("msg-1");
    expect(entry.messages[13]!.body).toBe("msg-14");
  });
});

// ── Author / lead / contributor name resolution ─────────────────────────────

describe("presentProposal — name resolution", () => {
  it("resolves a lead and a message author who is not seated on any role", async () => {
    const snapshot = await snapshotOf();
    expect(snapshot.membersById.has(UNSEATED_MEMBER_ID)).toBe(false);
    const row = proposalRow({
      service_type: "special",
      service_ref: "role-sp-1107",
      service_date: "2026-11-07",
      lead: UNSEATED_MEMBER_ID,
      contributors: [{ _key: "c1", person: UNSEATED_MEMBER_ID }],
      messages: [message("m1", UNSEATED_MEMBER_ID, "2026-11-01T10:00:00Z")],
    });
    const ids = proposalContentIds([row]);
    expect(ids.memberIds).toEqual([UNSEATED_MEMBER_ID]);
    const members = await loadMemberNames(ids.memberIds, snapshot.membersById);
    const entry = presentProposal(snapshot, row, { members, songs: await loadSongTitles([]) }, "2026-09-30", false);
    expect(entry.lead).toEqual({ memberId: UNSEATED_MEMBER_ID, name: "Pablo" });
    expect(entry.contributors).toEqual([{ memberId: UNSEATED_MEMBER_ID, name: "Pablo" }]);
    expect(entry.messages[0]!.authorName).toBe("Pablo");
  });

  it("an author whose id names no member gets authorName: null, never a throw", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({
      service_type: "special",
      service_ref: "role-sp-1107",
      messages: [message("m1", "mem-nowhere", "2026-11-01T10:00:00Z")],
    });
    const members = await loadMemberNames(["mem-nowhere"], snapshot.membersById);
    expect(members.ok).toBe(true);
    const entry = presentProposal(snapshot, row, { members, songs: await loadSongTitles([]) }, "2026-09-30", false);
    expect(entry.messages[0]!.authorName).toBeNull();
  });

  it("a genuinely unknown lead id (the lookup succeeded, that id just resolves to nothing) is missing: true, not unresolved", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({ service_type: "special", service_ref: "role-sp-1107", lead: "mem-nowhere" });
    const members = await loadMemberNames(["mem-nowhere"], snapshot.membersById);
    expect(members.ok).toBe(true);
    const entry = presentProposal(snapshot, row, { members, songs: await loadSongTitles([]) }, "2026-09-30", false);
    expect(entry.lead).toEqual({ memberId: "mem-nowhere", name: null, missing: true });
  });

  it("a lead with no reference at all is missing: true", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({ service_type: "special", service_ref: "role-sp-1107", lead: null });
    const entry = presentProposal(snapshot, row, await emptyLookups(), "2026-09-30", false);
    expect(entry.lead).toEqual({ memberId: null, name: null, missing: true });
  });
});

// ── Degraded supplementary lookups (missing vs unresolved, notes) ───────────

describe("presentProposal / presentProposalsForX — a failed lookup is unresolved, never silently missing", () => {
  it("a failed members lookup reports the lead and contributors as unresolved, not missing, and still returns the proposal", async () => {
    const snapshot = await snapshotOf();
    const row = proposalRow({
      service_type: "special",
      service_ref: "role-sp-1107",
      lead: UNSEATED_MEMBER_ID,
      contributors: [{ _key: "c1", person: UNSEATED_MEMBER_ID }],
    });
    const failedMembers = { ok: false, byId: new Map() };
    const entry = presentProposal(snapshot, row, { members: failedMembers, songs: await loadSongTitles([]) }, "2026-09-30", false);
    expect(entry.lead).toEqual({ memberId: UNSEATED_MEMBER_ID, name: null, unresolved: true });
    expect(entry.contributors).toEqual([{ memberId: UNSEATED_MEMBER_ID, name: null, unresolved: true }]);
  });

  it("presentProposalsForService: a failed members lookup adds a notes entry, the proposal is still returned", async () => {
    const snapshot = await snapshotOf();
    const role = roleOf(snapshot, "role-sun-1011");
    const failedMembers = { ok: false, byId: new Map() };
    const payload = presentProposalsForService(
      snapshot,
      role,
      { members: failedMembers, songs: await loadSongTitles([]) },
      "2026-09-30",
    );
    expect(payload.proposals).toHaveLength(1);
    expect(payload.proposals[0]!.lead.unresolved).toBe(true);
    expect(payload.notes).toEqual([
      "No se pudieron leer los nombres de algunos miembros; aparecen como unresolved: true, o sin nombre en los mensajes.",
    ]);
  });

  it("presentProposalsForMonth: a failed song-title lookup reports null titles plus a notes entry, proposals still returned", async () => {
    const snapshot = await snapshotOf();
    const failedSongs = { ok: false, byId: new Map() };
    const { members } = await emptyLookups();
    const payload = presentProposalsForMonth(snapshot, "2026-10", { members, songs: failedSongs }, "2026-09-30");
    expect(payload.proposals).toHaveLength(3);
    const withSongs = payload.proposals.find((p) => p.proposalId === "prop-sat-1003")!;
    expect(withSongs.songs[0]!.song).toEqual({ id: "song-3", title: null });
    expect(payload.notes).toEqual([
      "No se pudieron leer los títulos de las canciones; se muestran solo sus ids.",
    ]);
  });

  it("no notes at all when both lookups succeed", async () => {
    const snapshot = await snapshotOf();
    const role = roleOf(snapshot, "role-sun-1011");
    const payload = presentProposalsForService(snapshot, role, await emptyLookups(), "2026-09-30");
    expect(payload.notes).toBeUndefined();
  });
});

// ── presentProposal fails loud on a row with no real id ─────────────────────

describe("presentProposal — a row with no _id", () => {
  it("throws rather than shipping proposalId: \"\" (mirrors presentService)", async () => {
    const snapshot = await snapshotOf();
    const lookups = await emptyLookups();
    const row = proposalRow({ _id: null, service_type: "special" });
    expect(() => presentProposal(snapshot, row, lookups, "2026-09-30", false)).toThrow();
  });
});

// ── Selecting proposals and the payload builders ────────────────────────────

describe("proposalsForService / presentProposalsForService", () => {
  it("returns exactly the proposals linking to that role", async () => {
    const snapshot = await snapshotOf();
    const role = roleOf(snapshot, "role-sun-1011");
    const rows = proposalsForService(snapshot, role);
    expect(rows.map((r) => r._id)).toEqual(["prop-sun-1011"]);

    const payload = presentProposalsForService(snapshot, role, await emptyLookups(), "2026-09-30");
    expect(payload).toMatchObject({ serviceId: "role-sun-1011" });
    expect(payload.proposals).toHaveLength(1);
    expect(payload.proposals[0]!.proposalId).toBe("prop-sun-1011");
    expect(payload.proposals[0]!.serviceId).toBe("role-sun-1011");
    expect(payload.failedSources).toBeUndefined();
  });

  it("a role with no proposals reports an empty array, not a refusal", async () => {
    const snapshot = await snapshotOf();
    const role = roleOf(snapshot, "role-sat-1010");
    expect(presentProposalsForService(snapshot, role, await emptyLookups(), "2026-09-30").proposals).toEqual([]);
  });
});

describe("proposalsForMonth / presentProposalsForMonth", () => {
  it("returns every proposal whose OWN service_date falls in the month, unresolved links included", async () => {
    const snapshot = await snapshotOf();
    const payload = presentProposalsForMonth(snapshot, "2026-10", await emptyLookups(), "2026-09-30");
    expect(payload).toMatchObject({ month: "2026-10" });
    expect(payload.proposals.map((p) => [p.proposalId, p.serviceId]).sort()).toEqual(
      [
        ["prop-sat-1003", "role-sat-1003"],
        ["prop-sun-1011", "role-sun-1011"],
        ["prop-orphan", null],
      ].sort(),
    );
  });

  it("a month with no proposals is empty, not an error", async () => {
    const snapshot = await snapshotOf();
    expect(proposalsForMonth(snapshot, "2020-01")).toEqual([]);
    expect(presentProposalsForMonth(snapshot, "2020-01", await emptyLookups(), "2026-09-30").proposals).toEqual([]);
  });
});

// ── Readability ──────────────────────────────────────────────────────────────

describe("proposalsUnreadable", () => {
  it("is true when the roles domain failed", async () => {
    const snapshot = await snapshotOf({ fail: ["roles"] });
    expect(proposalsUnreadable(snapshot)).toBe(true);
  });

  it("is true when the proposals domain failed", async () => {
    const snapshot = await snapshotOf({ fail: ["proposals"] });
    expect(proposalsUnreadable(snapshot)).toBe(true);
  });

  it("is true when the proposal-drafts domain failed (sources.proposals covers both)", async () => {
    const snapshot = await snapshotOf({ fail: ["proposalDrafts"] });
    expect(proposalsUnreadable(snapshot)).toBe(true);
  });

  it("is false when both are ready", async () => {
    const snapshot = await snapshotOf();
    expect(proposalsUnreadable(snapshot)).toBe(false);
  });
});
