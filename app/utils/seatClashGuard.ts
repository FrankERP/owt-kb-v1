// app/utils/seatClashGuard.ts
//
// The server half of ADR-0078: a role write may not ADD a pair of seats one
// person may not hold on one service (`seatsClash`). Pure — no Sanity client, no
// I/O — so the four seat writers (`editRole`, `createRole`, `swapRoles`,
// `copyInstruments`) and the month confirm's pre-check (`runV3ConfirmAttempt`,
// v2's `handleConfirm`) judge with the same function.
//
// Why a DIFF and not "no clash in the result": a roster that already holds a
// clash (a member whose «Canta y toca a la vez» was later unticked) would
// otherwise refuse every unrelated edit — the date, the console, removing
// someone else — with a refusal about a seat nobody touched. Both sides are
// judged with the member's CURRENT flag (it has no history), so "already held"
// means exactly "this write did not create it". Per role, never across roles: a
// team swap that carries an old clash onto another service is refused there.

import { clashingPairs, normalizeSeatName, SINGS_AND_PLAYS_HINT, type SeatCategory } from "@/app/components/admin/seatModel";
import type { NormalizedSeats } from "@/app/utils/roleSeats";

export interface SeatRef {
  seatId: string;
  label: string;
  category: SeatCategory;
}

export interface AddedClash {
  memberId: string;
  /** Voices before instruments before FOH, so the sentence reads «Coro y Drums». */
  seats: [SeatRef, SeatRef];
}

/** One refused pair as it travels in a 400's `details.seatClashes`. */
export interface SeatClashDetail {
  memberId: string;
  name: string;
  seats: [string, string];
  /** `seatClashSentence`, built on the server so no client rebuilds it. */
  sentence: string;
}

/**
 * A member's display name: the trimmed alias, else the trimmed `member_name`, else "". The one rule
 * for the server's member reads (`loadMemberNamesByIds`, `loadCanonicalMembers`) and the confirm's
 * client map, so one person is never named two ways.
 */
export function memberDisplayName(row: { alias?: unknown; member_name?: unknown }): string {
  const alias = typeof row.alias === "string" ? row.alias.trim() : "";
  return alias || (typeof row.member_name === "string" ? row.member_name.trim() : "");
}

/** The marked ids and the names of a writer's member read (`loadCanonicalMembers`), as the guard takes them. */
export function clashInputsOf(members: ReadonlyMap<string, { singsAndPlays: boolean; name: string }>): {
  singsAndPlays: Set<string>;
  names: Map<string, string>;
} {
  const singsAndPlays = new Set<string>();
  const names = new Map<string, string>();
  for (const [id, m] of members) {
    if (m.singsAndPlays) singsAndPlays.add(id);
    if (m.name) names.set(id, m.name);
  }
  return { singsAndPlays, names };
}

/** The name used when a member has neither alias nor `member_name`, or is not in the read. */
export const UNKNOWN_MEMBER_NAME = "alguien que ya no está en Miembros";

const VOICE_REFS: { path: "leads" | "bgvs" | "chorus"; seat: SeatRef }[] = [
  { path: "leads", seat: { seatId: "lead", label: "Lead", category: "voz" } },
  { path: "bgvs", seat: { seatId: "bgv", label: "BGV", category: "voz" } },
  { path: "chorus", seat: { seatId: "coro", label: "Coro", category: "voz" } },
];

const CATEGORY_RANK: Record<SeatCategory, number> = { voz: 0, instrumento: 1, foh: 2 };
const VOICE_RANK: Record<string, number> = { lead: 0, bgv: 1, coro: 2 };

/**
 * One seat id per occurrence. The label part of an instrument or FOH id is
 * lowercased: `normalizeLabel` (both `normalizeSeats` and
 * `normalizeStoredSeats`) keeps case, so a stored «drums» and a requested
 * «Drums» are one seat and an old pair on it must not read as added. These ids
 * are compared only with each other — before against after — never with the
 * grid's.
 */
function slotSeat(category: "instrumento" | "foh", raw: string): SeatRef {
  const label = normalizeSeatName(raw);
  return { seatId: `${category}:${label.toLowerCase()}`, label, category };
}

function occurrences(seats: NormalizedSeats): Map<string, SeatRef[]> {
  const out = new Map<string, SeatRef[]>();
  const add = (memberId: string, seat: SeatRef) => {
    const list = out.get(memberId) ?? [];
    list.push(seat);
    out.set(memberId, list);
  };
  for (const { path, seat } of VOICE_REFS) for (const id of seats[path]) add(id, seat);
  for (const slot of seats.instruments) add(slot.personId, slotSeat("instrumento", slot.instrument));
  for (const slot of seats.foh) add(slot.personId, slotSeat("foh", slot.role));
  return out;
}

function seatOrder(a: SeatRef, b: SeatRef): number {
  const byCategory = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
  if (byCategory !== 0) return byCategory;
  if (a.category === "voz") return (VOICE_RANK[a.seatId] ?? 9) - (VOICE_RANK[b.seatId] ?? 9);
  return a.seatId < b.seatId ? -1 : a.seatId > b.seatId ? 1 : 0;
}

/** Each clashing pair of one member, keyed `seatIdA|seatIdB` (ordered), with a count. */
function pairsOf(refs: readonly SeatRef[], marked: boolean): Map<string, { count: number; seats: [SeatRef, SeatRef] }> {
  const out = new Map<string, { count: number; seats: [SeatRef, SeatRef] }>();
  for (const [i, j] of clashingPairs(refs, marked)) {
    const seats = [refs[i], refs[j]].sort(seatOrder) as [SeatRef, SeatRef];
    const key = `${seats[0].seatId}|${seats[1].seatId}`;
    const hit = out.get(key);
    if (hit) hit.count += 1;
    else out.set(key, { count: 1, seats });
  }
  return out;
}

/**
 * The clashing pairs `after` holds that `before` did not (`before = null` for a
 * create). Pairs are counted, so a third Lead copy beside an old duplicate is
 * still added. Removing one side of an old pair adds nothing. Output is sorted
 * by member id, then by seats, so a refusal reads the same on every retry.
 */
export function addedSeatClashes(
  before: NormalizedSeats | null,
  after: NormalizedSeats,
  singsAndPlays: ReadonlySet<string>,
): AddedClash[] {
  const beforeBy = before ? occurrences(before) : new Map<string, SeatRef[]>();
  const out: AddedClash[] = [];
  for (const [memberId, refs] of occurrences(after)) {
    const marked = singsAndPlays.has(memberId);
    const was = pairsOf(beforeBy.get(memberId) ?? [], marked);
    for (const [key, { count, seats }] of pairsOf(refs, marked)) {
      if (count > (was.get(key)?.count ?? 0)) out.push({ memberId, seats });
    }
  }
  return out.sort((a, b) =>
    a.memberId !== b.memberId
      ? a.memberId < b.memberId ? -1 : 1
      : seatOrder(a.seats[0], b.seats[0]) || seatOrder(a.seats[1], b.seats[1]),
  );
}

/**
 * The ONE Spanish sentence for a refused pair. A voice + instrument pair names
 * the way out (the Miembros checkbox), like C2's `clashReason`; two copies of
 * one seat read «aparece dos veces en Lead», never «en Lead y Lead».
 */
export function seatClashSentence(name: string, clash: AddedClash): string {
  const who = name.trim() || UNKNOWN_MEMBER_NAME;
  const [a, b] = clash.seats;
  if (a.seatId === b.seatId) return `${who} aparece dos veces en ${a.label} en el mismo servicio.`;
  const cross = new Set([a.category, b.category]);
  const hint = cross.has("voz") && cross.has("instrumento") ? `; ${SINGS_AND_PLAYS_HINT}` : "";
  return `${who} quedaría en ${a.label} y ${b.label} en el mismo servicio${hint}.`;
}

/** The wire entries of a refusal: names from the writer's member read, never a bare id as a name. */
export function seatClashDetails(
  clashes: readonly AddedClash[],
  names: ReadonlyMap<string, string>,
): SeatClashDetail[] {
  return clashes.map((clash) => {
    const name = names.get(clash.memberId)?.trim() || UNKNOWN_MEMBER_NAME;
    return {
      memberId: clash.memberId,
      name,
      seats: [clash.seats[0].label, clash.seats[1].label],
      sentence: seatClashSentence(name, clash),
    };
  });
}

/**
 * The sentences of a refusal body's `details.seatClashes`, for every client
 * that renders a writer's refusal. A malformed or absent detail yields `[]`, and
 * the caller falls back to its generic wording. Only `sentence` is read: a
 * renderer must never print `memberId` (on the MCP, members are tokens or
 * names — ADR-0062).
 */
export function seatClashSentencesOf(body: unknown): string[] {
  if (body === null || typeof body !== "object") return [];
  const details = (body as { details?: unknown }).details;
  if (details === null || typeof details !== "object") return [];
  const list = (details as { seatClashes?: unknown }).seatClashes;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list) {
    const sentence = entry !== null && typeof entry === "object" ? (entry as { sentence?: unknown }).sentence : null;
    if (typeof sentence === "string" && sentence.trim()) out.push(sentence.trim());
  }
  return out;
}

/** A seat writer's 400 `details` for an added clash: `serviceError("invalid_request", { details })`. */
export function seatClashErrorDetails(
  clashes: readonly AddedClash[],
  names: ReadonlyMap<string, string>,
): { issues: ["seat_clash"]; seatClashes: SeatClashDetail[] } {
  return { issues: ["seat_clash"], seatClashes: seatClashDetails(clashes, names) };
}
