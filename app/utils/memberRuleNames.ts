/**
 * Matching a solver rule's free-text `person` against a member, and the name
 * options the Persona dropdowns offer.
 *
 * Solver rules name people by string, not by reference, so every consumer needs
 * one shared answer to "does this rule name this member?". `dn()` in the planner
 * and `resolveToMemberName` use the same criterion.
 *
 * No "use client": both the planner model and client panels import this
 * (ADR-0028).
 */

export function displayMemberName(m: { member_name?: string; alias?: string }): string {
  return m.alias?.trim() || m.member_name || "";
}

/**
 * Persona dropdown options: every member, plus any names that must stay visible
 * while editing an existing rule. A rule can name someone who is no longer in
 * the roster at all, and a controlled `<select>` whose value is absent from its
 * options silently shows the wrong person — so `preserveNames` is not optional
 * polish.
 */
export function personNameOptions(
  members: Array<{ _id: string; member_name: string; alias?: string }>,
  preserveNames: string[] = [],
): string[] {
  const out = new Set(members.map(displayMemberName));
  for (const n of preserveNames) {
    const t = n.trim();
    if (t) out.add(t);
  }
  return [...out];
}

/** Same name-matching criterion as `resolveToMemberName` / planner `dn()`. */
export function rulePersonNamesMember(
  rulePerson: string,
  member: { member_name: string; alias?: string },
): boolean {
  const lo = rulePerson.toLowerCase().trim();
  if (!lo) return false;
  if (member.member_name.toLowerCase().trim() === lo) return true;
  return member.alias?.trim().toLowerCase() === lo;
}
