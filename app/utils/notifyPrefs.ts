// The single per-type email preference resolver. Every sender goes through it —
// nothing reads `notifPrefs` fields directly — so a member's choice cannot be
// honoured on one path and ignored on another.

export type NotifyKind = "assigned" | "removed" | "roleChanged" | "setlist" | "proposals";

export const NOTIFY_PREF_FIELD: Record<NotifyKind, string> = {
  assigned: "emailAssigned",
  removed: "emailRemoved",
  roleChanged: "emailRoleChanged",
  setlist: "emailSetlist",
  proposals: "emailProposals",
};

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
