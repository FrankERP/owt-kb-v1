/**
 * The sessionStorage key `app/components/ActivityPing.tsx` uses to suppress its
 * own heartbeat within a session. `scripts/dev-verify.ts` seeds this key before
 * navigation so the runner never triggers the production `lastSeen` patch.
 *
 * Pulled into its own module (rather than a literal inline in the runner) so
 * `scripts/__tests__/devVerifyPingKey.test.ts` can import it without importing
 * the runner itself, which calls `process.exit` at module scope.
 */
export const PING_KEY = "owt_last_ping";
