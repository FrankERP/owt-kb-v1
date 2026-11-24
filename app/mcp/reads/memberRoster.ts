// The people reads of the chat (admin parity phase 4, slice M, D10): every published person with what
// `/super-admin` → Personas shows, read through `memberView` (the guards' own reading: absent
// `ministries` ⇒ worship, a Jóvenes level only while in Jóvenes). `list_members` never carries an
// email; `get_member` does (D10). On `operationalClient`, as every MCP Sanity read
// (`mcpSanityClients.test.ts`); a failed read throws, so the tool answers a failure, never "nobody".

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import { STORED_MEMBER_PROJECTION, memberView, type MemberView, type StoredMember } from "@/app/utils/memberEdits";

export interface RosterMember {
  id: string;
  view: MemberView;
}

const ROSTER_QUERY = `*[_type == "teamMembers"] | order(lower(coalesce(alias, member_name)) asc)${STORED_MEMBER_PROJECTION}`;

export async function loadPeople(): Promise<RosterMember[]> {
  const rows: unknown = await operationalClient.fetch(ROSTER_QUERY, {});
  if (!Array.isArray(rows)) throw new Error("people read failed");
  return (rows as StoredMember[]).map((r) => ({ id: r._id, view: memberView(r) }));
}

export async function loadPerson(id: string): Promise<RosterMember | null> {
  const row = await operationalClient.fetch<StoredMember | null>(`*[_type == "teamMembers" && _id == $id][0]${STORED_MEMBER_PROJECTION}`, { id });
  return row && typeof row._id === "string" ? { id: row._id, view: memberView(row) } : null;
}

/** How many of these ids exist as published people (D7's retry check). */
export async function countExistingPeople(ids: readonly string[]): Promise<number> {
  const n = await operationalClient.fetch<number>(`count(*[_id in $ids])`, { ids: [...ids] });
  if (typeof n !== "number") throw new Error("people id read failed");
  return n;
}
