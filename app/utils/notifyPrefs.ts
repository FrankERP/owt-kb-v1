// The single per-type email preference resolver. Every sender goes through it —
// nothing reads `notifPrefs` fields directly — so a member's choice cannot be
// honoured on one path and ignored on another.

export type NotifyKind = "assigned" | "removed" | "roleChanged" | "setlist" | "proposals";

// `as const satisfies` keeps the values as string literals (not widened to
// `string`), so callers can derive a precise union of field names — see
// `EmailPrefValues` in EmailPrefToggles.tsx, which types the resolved-values
// bag so a partial one is a compile error instead of a silent fallback.
export const NOTIFY_PREF_FIELD = {
  assigned: "emailAssigned",
  removed: "emailRemoved",
  roleChanged: "emailRoleChanged",
  setlist: "emailSetlist",
  proposals: "emailProposals",
} as const satisfies Record<NotifyKind, string>;

/**
 * Opt-out semantics with a legacy fallback and NO data migration: an explicit
 * boolean on the per-type field wins; otherwise the pre-existing
 * `notifPrefs.email` decides. A member who opted out before per-type toggles
 * existed therefore stays opted out of all five.
 */
export function wantsNotification(prefs: unknown, kind: NotifyKind): boolean {
  const bag = (prefs && typeof prefs === "object" ? prefs : {}) as Record<string, unknown>;
  const specific = bag[NOTIFY_PREF_FIELD[kind]];
  if (typeof specific === "boolean") return specific;
  return bag.email !== false;
}
