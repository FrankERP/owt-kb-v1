// app/components/admin/candidateRanking.ts
//
// Who should fill this seat, in order, with the three signals the old form
// withheld until after save: availability on the date, whether the person is
// already assigned on this service, and how much they have served recently.
//
// This is NOT the solver. `gcf/owt_solver_v2.py` handles five VOICE role types
// only and requires 3-6 weeks, so a single service is not a valid input to it
// (design D5). This is a pure sort over data the panel already holds — instant,
// no Cloud Run call, and it works for instruments and FOH, which the solver
// cannot express at all.

import {
  computeParticipation,
  serviceWeekKey,
  type ParticipantRole,
} from "@/app/utils/computeParticipation";
import type { SeatCategory, SeatDef } from "./seatModel";

export interface RankMember {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  unavailableDates?: string[];
}

/** A seat already occupied on the service being edited. */
export interface AssignedSeat {
  seatId: string;
  category: SeatCategory;
  memberId: string;
}

export interface RankedCandidate {
  id: string;
  name: string;
  /** False when the member marked this date unavailable. Still selectable. */
  available: boolean;
  /** True when the member holds another seat on this service. */
  alreadyAssigned: boolean;
  /** Non-null = may NOT be selected, with the Spanish reason. */
  blockedReason: string | null;
  /** Services in the window, on the participation week rule. */
  load: number;
  /** One cell per week, oldest first. */
  recent: boolean[];
}

const displayName = (m: RankMember) => m.alias?.trim() || m.member_name;

/** Every member id serving in this role, across all five seat paths. */
function servingIds(role: ParticipantRole): string[] {
  return [
    ...(role.leads ?? []).map((p) => p._id),
    ...(role.bgvs ?? []).map((p) => p._id),
    ...(role.chorus ?? []).map((p) => p._id),
    ...(role.instruments ?? []).filter((s) => s.person).map((s) => s.person!._id),
    ...(role.foh ?? []).filter((s) => s.person).map((s) => s.person!._id),
  ];
}

export function rankCandidates(input: {
  seat: SeatDef;
  date: string;
  members: RankMember[];
  windowRoles: ParticipantRole[];
  assigned: AssignedSeat[];
  weeks?: number;
}): RankedCandidate[] {
  const { seat, date, members, windowRoles, assigned } = input;
  const weeks = input.weeks ?? 4;

  // Load comes from the shipped counter so the week rule (Saturday counts toward
  // the following Sunday) cannot drift between this and the participation sidebar.
  const loadById = new Map(computeParticipation(windowRoles).map((p) => [p.id, p.total]));

  // The most recent `weeks` week-keys present in the window, oldest first.
  const weekKeys = [...new Set(windowRoles.map(serviceWeekKey))].sort().slice(-weeks);
  const servedInWeek = new Map<string, Set<string>>();
  for (const role of windowRoles) {
    const key = serviceWeekKey(role);
    let set = servedInWeek.get(key);
    if (!set) servedInWeek.set(key, (set = new Set()));
    for (const id of servingIds(role)) set.add(id);
  }

  const seatById = new Map(assigned.map((a) => [a.memberId, a]));

  const rows: RankedCandidate[] = (members ?? [])
    .filter((m) => (m.memberType ?? []).includes(seat.memberType))
    .map((m) => {
      const held = seatById.get(m._id);
      // D4: same category is a real conflict (nobody sings Lead and BGV at once);
      // voz + instrumento is what Frank and Mkz actually do, so it only informs.
      const blockedReason =
        held && held.category === seat.category && held.seatId !== seat.id
          ? `Ya asignado en ${labelOfSeatId(held.seatId)}`
          : null;
      const strip = weekKeys.map((k) => servedInWeek.get(k)?.has(m._id) ?? false);
      // Pad on the left so every strip is the same width regardless of history.
      const recent = [...Array(Math.max(0, weeks - strip.length)).fill(false), ...strip];
      return {
        id: m._id,
        name: displayName(m),
        available: !(m.unavailableDates ?? []).includes(date),
        alreadyAssigned: !!held && held.seatId !== seat.id,
        blockedReason,
        load: loadById.get(m._id) ?? 0,
        recent,
      };
    });

  const rank = (c: RankedCandidate) =>
    (c.blockedReason ? 100 : 0) + (c.available ? 0 : 10) + (c.alreadyAssigned ? 1 : 0);

  return rows.sort(
    (a, b) => rank(a) - rank(b) || a.load - b.load || a.name.localeCompare(b.name, "es"),
  );
}

/** `lead` -> `Lead`, `instrumento:Bass` -> `Bass`. */
function labelOfSeatId(seatId: string): string {
  const tail = seatId.includes(":") ? seatId.slice(seatId.indexOf(":") + 1) : seatId;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}
