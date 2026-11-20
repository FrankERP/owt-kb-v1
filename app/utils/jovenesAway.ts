// Who may be told that a Jóvenes pastor marked a day as «no disponible», and the two questions
// the planner's screen asks about those days (ADR-0090; plan
// `docs/superpowers/plans/2026-11-17-jovenes-away-in-planner.md` §3).
//
// Pure and neutral (no "use client", no server-only import): the server read
// (`jovenesPeople.ts`) decides with `awayVisibleTo`, and the planner's client components ask
// `isAway` / `awayNames` over the people they were handed.
//
// WHAT THIS IS NOT: a confidentiality boundary on the field. `teamMembers` is undotted in a public
// dataset until DEF-A-16 (ADR-0057, ADR-0081), so this decides what the APP sends and shows.

import type { MemberAccess } from "./memberAccess";
import { isMinistryManager, ledGroupsIn } from "./ministryAccess";

/** The reader's access snapshot, as the page's gate read it. Never an object a caller assembled. */
export type AwayReader = Pick<MemberAccess, "active" | "role" | "ministries" | "managesMinistries" | "ministryRoles">;

/**
 * May this reader see that this person marked days? A Jóvenes admin (super-admin included): every
 * Jóvenes member. A leader: only a member of a group they LEAD (`ledGroupsIn`, ADR-0085), which is
 * exactly who they can assign to a class. Anyone else, and anyone inactive: nobody.
 */
export function awayVisibleTo(reader: AwayReader, person: { groups: readonly string[] }): boolean {
  if (!reader.active) return false;
  if (isMinistryManager(reader, "jovenes")) return true;
  const led = ledGroupsIn(reader, "jovenes");
  return person.groups.some((g) => led.includes(g));
}

type Marked = { id: string; name: string; away?: readonly string[] };

/** Did this person mark this date, as far as this reader was told? No date or no `away`: no. */
export function isAway(person: Pick<Marked, "away"> | null | undefined, date: string | null | undefined): boolean {
  return !!date && !!person?.away?.includes(date);
}

/**
 * The names, among these member ids, of the people who marked this date: what a card says about a
 * meeting whose roster was built before someone marked the day. Each person once, in roster order.
 */
export function awayNames(people: readonly Marked[], memberIds: ReadonlyArray<string | null | undefined>, date: string): string[] {
  const ids = new Set(memberIds.filter((id): id is string => !!id));
  return people.filter((p) => ids.has(p.id) && isAway(p, date)).map((p) => p.name);
}

/** «Ana: no disponible ese día» / «Ana y Beto: no disponibles ese día». Never who marked it, never why. */
export function awayLine(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return `${list}: no ${names.length === 1 ? "disponible" : "disponibles"} ese día`;
}
