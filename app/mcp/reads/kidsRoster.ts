// app/mcp/reads/kidsRoster.ts — the Oasis Kids roster the MCP Kids tools read (admin parity
// phase 3, S4): every pair (retired ones included, for names and history) and every Kids
// volunteer with their absences and the revision a write must assert. The same projections
// as the planner's `GET /api/kids/pairs` and `GET /api/kids/members`, on `operationalClient`
// as every MCP Sanity read (`mcpSanityClients.test.ts`). Neither type is a protected type,
// and nothing here reads `kidsSchedule` — the month's Sundays come from
// `app/utils/kidsScheduleReads.ts`, the one module allowed to read their drafts (ADR-0022).
//
// `"kids" in ministries` needs no `!defined(ministries)` arm: absent or empty normalizes to
// worship-only (`normalizeMinistries`), never to kids.

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import type { KidsRoom } from "@/app/utils/kidsTypes";

export interface KidsPairRow {
  readonly id: string;
  readonly name: string | null;
  readonly room: KidsRoom | null;
  /** `coalesce`d: a pair written before the field existed is active. */
  readonly active: boolean;
  readonly memberIds: readonly string[];
}

export interface KidsVolunteerRow {
  readonly _id: string;
  readonly _rev: string | null;
  readonly member_name: string | null;
  readonly alias: string | null;
  readonly unavailableDates: readonly string[];
  readonly unavailabilityNotes: readonly { date: string; note: string }[];
}

export const KIDS_PAIRS_QUERY = `*[_type == "kidsPair"] | order(name asc) {
    "id": _id, name, room,
    "active": coalesce(active, true),
    "memberIds": coalesce(members[]._ref, [])
  }`;

export const KIDS_VOLUNTEERS_QUERY = `*[_type == "teamMembers" && "kids" in ministries] | order(member_name asc) {
    _id, _rev, member_name, alias,
    "unavailableDates": coalesce(unavailableDates, []),
    "unavailabilityNotes": coalesce(unavailabilityNotes, [])
  }`;

export interface KidsRoster {
  readonly pairs: readonly KidsPairRow[];
  readonly volunteers: readonly KidsVolunteerRow[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

/** Both reads at once. A throw propagates: the tool runner answers its fixed text. */
export async function loadKidsRoster(): Promise<KidsRoster> {
  const [pairs, volunteers] = await Promise.all([
    operationalClient.fetch<unknown>(KIDS_PAIRS_QUERY),
    operationalClient.fetch<unknown>(KIDS_VOLUNTEERS_QUERY),
  ]);
  return {
    pairs: (Array.isArray(pairs) ? pairs : []).filter(isObj).filter((p) => typeof p.id === "string") as unknown as KidsPairRow[],
    volunteers: (Array.isArray(volunteers) ? volunteers : [])
      .filter(isObj)
      .filter((m) => typeof m._id === "string") as unknown as KidsVolunteerRow[],
  };
}
