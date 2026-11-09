import { serverClient } from "@/sanity/lib/serverClient";

export type JovenesPerson = { id: string; name: string };

// The people a Jóvenes editor can pick for a seat or a program line: Jóvenes' members with app
// access, by display name. Ids and names only — the same two fields every seat already shows
// to the ministry. The server judges each pick again (W5: an active member of the ministry and,
// for a group's event, of one of its groups), so this list is a convenience, not a boundary.
const QUERY = `*[_type == "teamMembers" && !(_id in path("drafts.**")) && "jovenes" in ministries && disabled != true]{
  "id": _id,
  "name": coalesce(alias, member_name)
} | order(lower(name) asc)`;

export async function readJovenesPeople(): Promise<JovenesPerson[]> {
  const rows = await serverClient.fetch<unknown>(QUERY);
  return (Array.isArray(rows) ? rows : []).filter(
    (r): r is JovenesPerson => !!r && typeof r.id === "string" && typeof r.name === "string" && r.name.trim() !== "",
  );
}
