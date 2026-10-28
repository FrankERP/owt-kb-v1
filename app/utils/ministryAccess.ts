import { LEVELED_MINISTRY_IDS, type MinistryId, type MinistryLevel } from "@/app/ministries";
import type { MemberAccess } from "./memberAccess";

/**
 * Pure answers to "what may this person do in this ministry", from ONE access
 * snapshot (`getMemberAccess` → `accessFromDoc`). The ministry guards in
 * `authGuards.ts` call these; nothing open-codes them (ADR-0075).
 *
 * Two permission shapes coexist on purpose: worship's level is the legacy
 * `role` and Kids' admin the legacy `managesMinistries`; a LEVELED ministry
 * (`LEVELED_MINISTRY_IDS`, today Jóvenes) keeps level and groups in
 * `ministryRoles`. For worship and kids these functions are today's guard
 * predicates verbatim — `ministryAccess.equivalence.test.ts` holds them to it.
 */
type Access = Pick<MemberAccess, "role" | "ministries" | "managesMinistries" | "ministryRoles">;

/** Membership, or super-admin. Worship's admin roles grant nothing here. */
export function isMinistryMember(a: Access, ministry: MinistryId): boolean {
  return a.role === "super-admin" || a.ministries.includes(ministry);
}

/**
 * Management, or super-admin. A leveled ministry: a member whose level there is
 * `admin`. Any other ministry: `managesMinistries`, which does NOT imply
 * membership (Frank, 2026-08-19).
 */
export function isMinistryManager(a: Access, ministry: MinistryId): boolean {
  if (a.role === "super-admin") return true;
  if (LEVELED_MINISTRY_IDS.includes(ministry)) return levelIn(a, ministry) === "admin";
  return a.managesMinistries.includes(ministry);
}

/**
 * A person's level in a leveled ministry: `null` for a non-member, `"member"`
 * for a member with no (valid) entry. No super-admin arm — a caller that wants
 * one adds it, as `isMinistryMember` does.
 */
export function levelIn(a: Access, ministry: MinistryId): MinistryLevel | null {
  if (!a.ministries.includes(ministry)) return null;
  return a.ministryRoles.find((r) => r.ministry === ministry)?.level ?? "member";
}

/** A person's groups in a leveled ministry; `[]` for a non-member or no entry. */
export function groupsIn(a: Access, ministry: MinistryId): string[] {
  if (!a.ministries.includes(ministry)) return [];
  return a.ministryRoles.find((r) => r.ministry === ministry)?.groups ?? [];
}
