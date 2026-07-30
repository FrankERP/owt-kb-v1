// app/components/admin/__tests__/candidateRanking.test.ts
//
// The three signals the old form withheld until after save — availability,
// existing assignment, recent load — plus the one rule that must BLOCK rather
// than inform: the same person twice in one category.
import { describe, expect, it } from "vitest";

import { fohSeatDef, instrumentSeatDef, VOICE_SEATS } from "../seatModel";
import { rankCandidates, type AssignedSeat, type RankMember } from "../candidateRanking";
import type { ParticipantRole } from "@/app/utils/computeParticipation";

const LEAD = VOICE_SEATS[0];
const BGV = VOICE_SEATS[1];
const BASS = instrumentSeatDef("Bass");
const DATE = "2026-08-09";

const m = (id: string, name: string, types: string[], unavailable: string[] = []): RankMember =>
  ({ _id: id, member_name: name, memberType: types, unavailableDates: unavailable });

const MEMBERS: RankMember[] = [
  m("m1", "Frank", ["voz", "instrumento"]),
  m("m2", "Gaby", ["voz"]),
  m("m3", "Liu", ["voz"], [DATE]),
  m("m4", "Samo", ["instrumento"]),
  m("m5", "Nestor", []), // no memberType: eligible for nothing
];

const role = (over: Partial<ParticipantRole> = {}): ParticipantRole => ({
  _type: "sunday_role", date: "2026-08-02",
  leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over,
});

describe("rankCandidates", () => {
  it("admits only members carrying the seat's memberType", () => {
    const ids = rankCandidates({ seat: LEAD, date: DATE, members: MEMBERS, windowRoles: [], assigned: [] })
      .map((c) => c.id);
    expect(ids).toContain("m1");
    expect(ids).toContain("m2");
    expect(ids).not.toContain("m4"); // instrumento only
    expect(ids).not.toContain("m5"); // no memberType at all
  });

  it("marks the date's unavailable members without removing them", () => {
    const liu = rankCandidates({ seat: LEAD, date: DATE, members: MEMBERS, windowRoles: [], assigned: [] })
      .find((c) => c.id === "m3");
    // Still selectable: an admin may knowingly override. Never silent.
    expect(liu).toMatchObject({ available: false, blockedReason: null });
  });

  it("BLOCKS a second seat in the same category and says why", () => {
    const assigned: AssignedSeat[] = [{ seatId: "lead", category: "voz", memberId: "m1" }];
    const frank = rankCandidates({ seat: BGV, date: DATE, members: MEMBERS, windowRoles: [], assigned })
      .find((c) => c.id === "m1");
    expect(frank?.alreadyAssigned).toBe(true);
    expect(frank?.blockedReason).toBe("Ya asignado en Lead");
  });

  it("ALLOWS voz + instrumento and only informs", () => {
    // Frank leads and plays EG on real services; the board must not fight that.
    const assigned: AssignedSeat[] = [{ seatId: "lead", category: "voz", memberId: "m1" }];
    const frank = rankCandidates({ seat: BASS, date: DATE, members: MEMBERS, windowRoles: [], assigned })
      .find((c) => c.id === "m1");
    expect(frank).toMatchObject({ alreadyAssigned: true, blockedReason: null });
  });

  it("counts load and builds the strip on the same week rule as participation", () => {
    const windowRoles = [
      role({ date: "2026-07-19", leads: [{ _id: "m2" }] }),
      role({ date: "2026-08-02", leads: [{ _id: "m2" }] }),
      // A Saturday counts toward the FOLLOWING Sunday: same week as 2026-08-02.
      role({ _type: "saturday_role", date: "2026-08-01", bgvs: [{ _id: "m2" }] }),
    ];
    const gaby = rankCandidates({
      seat: LEAD, date: DATE, members: MEMBERS, windowRoles, assigned: [], weeks: 4,
    }).find((c) => c.id === "m2");
    expect(gaby?.load).toBe(3);
    expect(gaby?.recent).toHaveLength(4);
    expect(gaby?.recent.filter(Boolean).length).toBeGreaterThan(0);
  });

  it("orders available and unblocked first, then by lowest load, then by name", () => {
    const windowRoles = [
      role({ date: "2026-08-02", leads: [{ _id: "m2" }] }),
      role({ date: "2026-07-26", leads: [{ _id: "m2" }] }),
    ];
    const assigned: AssignedSeat[] = [{ seatId: "lead", category: "voz", memberId: "m1" }];
    const order = rankCandidates({ seat: BGV, date: DATE, members: MEMBERS, windowRoles, assigned })
      .map((c) => c.id);
    // m2 free with load 2 → first. m3 unavailable → after. m1 blocked → last.
    expect(order).toEqual(["m2", "m3", "m1"]);
  });

  it("returns an empty list rather than throwing on empty input", () => {
    expect(rankCandidates({ seat: LEAD, date: DATE, members: [], windowRoles: [], assigned: [] })).toEqual([]);
  });

  // The solver (gcf/owt_solver_v2.py) handles voice roles only — instrument and
  // FOH load is a signal ONLY this board can surface. computeParticipation keeps
  // instrWeeks/fohWeeks OUT of `total` (voice-only), so load must be read from
  // the category-matching field or it silently reads as 0 for these two seats.
  it("counts load for an instrument seat from instrument history, not voice total", () => {
    const windowRoles = [
      role({ date: "2026-07-19", instruments: [{ person: { _id: "m4" } }] }),
      role({ date: "2026-07-26", instruments: [{ person: { _id: "m4" } }] }),
      role({ date: "2026-08-02", instruments: [{ person: { _id: "m4" } }] }),
    ];
    const samo = rankCandidates({
      seat: BASS, date: DATE, members: MEMBERS, windowRoles, assigned: [], weeks: 4,
    }).find((c) => c.id === "m4");
    expect(samo?.load).toBe(3);
    expect(samo?.recent.filter(Boolean).length).toBe(3);
  });

  it("counts load for a FOH seat from FOH history, not voice total", () => {
    const CONSOLE = fohSeatDef("Console");
    const fohMembers: RankMember[] = [
      ...MEMBERS,
      m("m6", "Toño", ["foh"]),
    ];
    const windowRoles = [
      role({ date: "2026-07-19", foh: [{ person: { _id: "m6" } }] }),
      role({ date: "2026-08-02", foh: [{ person: { _id: "m6" } }] }),
    ];
    const tono = rankCandidates({
      seat: CONSOLE, date: DATE, members: fohMembers, windowRoles, assigned: [], weeks: 4,
    }).find((c) => c.id === "m6");
    expect(tono?.load).toBe(2);
    expect(tono?.recent.filter(Boolean).length).toBe(2);
  });

  // CRITICAL FINDING: `recent` used to be built from `servingIds`, which merges
  // ALL FIVE seat paths regardless of the seat being ranked. `load` was already
  // category-aware (loadField above). For a member with genuine cross-category
  // history — exactly the voz+instrumento members the design accommodates —
  // the strip lit up for weeks that had nothing to do with the seat's category,
  // contradicting the number. These three tests pin "load === count of true
  // cells in recent" for each category, using a member who served in a
  // DIFFERENT category in one of the weeks.
  //
  // Window-width note: all three windows below hold only 2 distinct week keys
  // against a strip width of 4 (weeks: 4), so the strip is never truncated
  // relative to the load window and the equality is not vacuous.
  it("agrees: load equals the count of true cells in recent for an instrumento seat (cross-category member)", () => {
    const windowRoles = [
      role({ date: "2026-07-19", leads: [{ _id: "m1" }] }), // voice week — must NOT count
      role({ date: "2026-08-02", instruments: [{ person: { _id: "m1" } }] }), // instrument week
    ];
    const frank = rankCandidates({
      seat: BASS, date: DATE, members: MEMBERS, windowRoles, assigned: [], weeks: 4,
    }).find((c) => c.id === "m1");
    expect(frank?.load).toBe(1);
    expect(frank?.recent.filter(Boolean).length).toBe(frank?.load);
  });

  it("agrees: load equals the count of true cells in recent for a voz seat (cross-category member)", () => {
    const windowRoles = [
      role({ date: "2026-07-19", instruments: [{ person: { _id: "m1" } }] }), // instrument week — must NOT count
      role({ date: "2026-08-02", leads: [{ _id: "m1" }] }), // voice week
    ];
    const frank = rankCandidates({
      seat: LEAD, date: DATE, members: MEMBERS, windowRoles, assigned: [], weeks: 4,
    }).find((c) => c.id === "m1");
    expect(frank?.load).toBe(1);
    expect(frank?.recent.filter(Boolean).length).toBe(frank?.load);
  });

  it("agrees: load equals the count of true cells in recent for a foh seat (cross-category member)", () => {
    const CONSOLE = fohSeatDef("Console");
    const fohMembers: RankMember[] = [...MEMBERS, m("m6", "Toño", ["foh", "instrumento"])];
    const windowRoles = [
      role({ date: "2026-07-19", instruments: [{ person: { _id: "m6" } }] }), // instrument week — must NOT count
      role({ date: "2026-08-02", foh: [{ person: { _id: "m6" } }] }), // foh week
    ];
    const tono = rankCandidates({
      seat: CONSOLE, date: DATE, members: fohMembers, windowRoles, assigned: [], weeks: 4,
    }).find((c) => c.id === "m6");
    expect(tono?.load).toBe(1);
    expect(tono?.recent.filter(Boolean).length).toBe(tono?.load);
  });

  // FINDING C1 (double-duty block bypassed): `seatById` used to be a Map keyed
  // by memberId, which keeps only the LAST entry for a member holding two
  // seats. SeatBoard builds `assigned` in seat order — voces, then
  // instrumentos, then FOH (SeatBoard.tsx) — so an instrument seat always
  // overwrote a voice one, silently erasing the voice-seat conflict. A member
  // must keep ALL of their held seats so a same-category conflict is caught
  // no matter which seat happened to be built last.
  it("BLOCKS a same-category conflict even when the member ALSO holds a different-category seat built later", () => {
    const assigned: AssignedSeat[] = [
      { seatId: "lead", category: "voz", memberId: "m1" },
      { seatId: "instrumento:EG", category: "instrumento", memberId: "m1" },
    ];
    const frank = rankCandidates({ seat: BGV, date: DATE, members: MEMBERS, windowRoles: [], assigned })
      .find((c) => c.id === "m1");
    expect(frank?.blockedReason).toBe("Ya asignado en Lead");
  });

  it("BLOCKS a same-category instrument conflict even when the member ALSO holds a voice seat", () => {
    const assigned: AssignedSeat[] = [
      { seatId: "lead", category: "voz", memberId: "m1" },
      { seatId: "instrumento:EG", category: "instrumento", memberId: "m1" },
    ];
    const frank = rankCandidates({ seat: BASS, date: DATE, members: MEMBERS, windowRoles: [], assigned })
      .find((c) => c.id === "m1");
    expect(frank?.blockedReason).toBe("Ya asignado en EG");
  });

  it("never blocks on the seat's own occupant, even while holding an unrelated-category seat too", () => {
    const assigned: AssignedSeat[] = [
      { seatId: "lead", category: "voz", memberId: "m1" },
      { seatId: "instrumento:EG", category: "instrumento", memberId: "m1" },
    ];
    const frank = rankCandidates({ seat: LEAD, date: DATE, members: MEMBERS, windowRoles: [], assigned })
      .find((c) => c.id === "m1");
    // The seat being targeted is one of Frank's own held seats — excluded from
    // the conflict search by seatId, regardless of what else he holds.
    expect(frank?.blockedReason).toBeNull();
  });

  it("does not report alreadyAssigned for a member whose only held seat IS the seat being targeted", () => {
    const assigned: AssignedSeat[] = [{ seatId: "lead", category: "voz", memberId: "m1" }];
    const frank = rankCandidates({ seat: LEAD, date: DATE, members: MEMBERS, windowRoles: [], assigned })
      .find((c) => c.id === "m1");
    expect(frank?.blockedReason).toBeNull();
    expect(frank?.alreadyAssigned).toBe(false);
  });
});
