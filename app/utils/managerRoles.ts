/**
 * The roles that pass `requireActiveManager` (cookie) and the native app's `"manager"` level
 * (`app/appAuth/levels.ts`, ADR-0091) — one definition both guards import, so they cannot drift.
 */
export const MANAGER_ROLES: readonly string[] = ["super-admin", "admin", "content-editor"];
