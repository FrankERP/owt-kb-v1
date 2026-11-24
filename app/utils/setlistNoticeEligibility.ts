// app/utils/setlistNoticeEligibility.ts — when a live-setlist write may queue the
// debounced `setlist` email at all. One rule, two readers: `setlistUpsert`
// (`serviceMutationSideEffects.ts`), which mints the notice, and the MCP proposal
// check's forecast (`app/mcp/writes/reports.ts`, admin parity S1), which says
// whether one would be minted. Neutral on purpose: `reports.ts` value-imports no
// side-effect or commit module.

export interface SetlistNoticeEligibilityInput {
  /** The role's stored publication state. `published !== false` is visible. */
  published: unknown;
  roleId: string | null | undefined;
  serviceDate: string | null | undefined;
  /** Does the service hold ANY songs after the write? `[] -> []` says nothing. */
  hasSongs: boolean;
}

/** True when the write would queue a `setlist` notice (the flush may still drop it). */
export function setlistNoticeEligible(input: SetlistNoticeEligibilityInput): boolean {
  // `published !== false` — missing/true is member-visible (grandfathered).
  if (input.published === false) return false;
  if (!input.roleId) return false;
  // A notice with no usable date could never render a correct subject line —
  // `isPast` at flush is a lexicographic YYYY-MM-DD comparison with no defined
  // reading for `""`. Declining to mint the notice here is the right outcome,
  // not deferring to that comparison's incidental behavior.
  if (!input.serviceDate) return false;
  return input.hasSongs;
}
