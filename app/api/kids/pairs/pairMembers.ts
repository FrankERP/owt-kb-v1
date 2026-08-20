import { serverClient } from "@/sanity/lib/serverClient";
import { normalizeMinistries } from "@/app/ministries";

/**
 * Both seats of a pair must resolve to REAL kids `teamMembers`. Without this a
 * Kids manager can write ANY document id into `members[]._ref` — the ids of the
 * worship roster are one `GET /api/kids/members` away — and the reference lands
 * unchecked, which is the same hole the availability route closes on its target.
 *
 * `normalizeMinistries` is the SHARED rule (app/ministries.ts) — never re-derive
 * "absent means worship" here; a member predating the kids feature carries no
 * `ministries` field and is a worship member, not a seatable one.
 *
 * Returns an error string (the shape `validateMinistryWrite` uses) or null when
 * every id may be seated. POST and PATCH both call it, so they cannot drift.
 */
export async function validatePairMembers(memberIds: string[]): Promise<string | null> {
  const rows = await serverClient.fetch<{ _id: string; ministries?: unknown }[]>(
    `*[_type == "teamMembers" && _id in $ids]{ _id, ministries }`,
    { ids: memberIds },
  );
  const seatable = new Set(
    (rows ?? [])
      .filter((r) => normalizeMinistries(r.ministries).includes("kids"))
      .map((r) => r._id),
  );
  // A missing id fails the same way a worship id does: a Kids manager has no
  // business learning which of the two it was.
  return memberIds.every((id) => seatable.has(id)) ? null : "memberIds must be kids members";
}
