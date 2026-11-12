import { serverClient } from "@/sanity/lib/serverClient";
import { accessFromDoc, type MemberAccessDoc } from "./memberAccess";
import { groupsIn } from "./ministryAccess";

/** `groups`: the Jóvenes groups the person is IN (membership, never leadership), for the class pickers. */
export type JovenesPerson = { id: string; name: string; groups: string[] };

// The people a Jóvenes editor can pick for a seat or a program line: Jóvenes' members with app
// access, by display name, with the groups they belong to (group membership is already public —
// base plan 2026-10-30 §8 — and a group's class picker offers only that group's members, plan
// 2026-11-12 §4). The server judges each pick again (W5: an active member of the ministry and,
// for a group's event, of one of its groups), so this list is a convenience, not a boundary.
const QUERY = `*[_type == "teamMembers" && !(_id in path("drafts.**")) && "jovenes" in ministries && disabled != true]{
  _id, disabled, role, ministries, managesMinistries, ministryRoles,
  "name": coalesce(alias, member_name)
} | order(lower(name) asc)`;

type Row = MemberAccessDoc & { name?: unknown };

export async function readJovenesPeople(): Promise<JovenesPerson[]> {
  const rows = await serverClient.fetch<unknown>(QUERY);
  return (Array.isArray(rows) ? (rows as Row[]) : [])
    .filter((r): r is Row & { name: string } => !!r && typeof r._id === "string" && typeof r.name === "string" && r.name.trim() !== "")
    .map((r) => ({ id: r._id, name: r.name, groups: groupsIn(accessFromDoc(r), "jovenes") }));
}
