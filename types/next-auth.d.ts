import "next-auth";
import "next-auth/jwt";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: OWTRole;
      sanityId: string;
      alias?: string | null;
      isImpersonating?: boolean;
      realAdminName?: string;
      /**
       * Ministry membership/management, refreshed with the role on every token
       * refresh (same 30s TTL). RENDER-ONLY — nav filtering. Server-side
       * authorization re-reads `getMemberAccess`; never authorize off these.
       */
      ministries: string[];
      managesMinistries: string[];
    };
  }
  interface User {
    role?: OWTRole;
    sanityId?: string;
    alias?: string | null;
    /**
     * Service Readiness A3 §4 — isolated-verification run ownership, proven in the
     * credentials `authorize` step and consumed by `events.signIn` to stamp the
     * `loginEvent` so the run can delete exactly its own by `_id`.
     *
     * Present ONLY on an isolated verification deployment whose environment,
     * commit SHA, deployment id and live dataset lease all matched. It never
     * enters the JWT or the session (the `jwt` callback copies only
     * role/sanityId/alias), and it is never inferred from email, member id,
     * provider or timestamp.
     */
    srVerification?: {
      runId: string;
      attemptId: string;
      candidateSha: string;
      deploymentId: string;
    } | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: OWTRole;
    sanityId?: string;
    alias?: string | null;
    isImpersonating?: boolean;
    realAdminName?: string;
    /** Optional: tokens minted before ministries shipped carry neither key. */
    ministries?: string[];
    managesMinistries?: string[];
    __realAdmin?: {
      role: OWTRole;
      sanityId: string;
      name: string | null | undefined;
      alias: string | null | undefined;
      /** Snapshotted so "stop impersonating" restores the admin's own nav, not
       *  the target's. Optional for tokens minted before ministries shipped. */
      ministries?: string[];
      managesMinistries?: string[];
    };
  }
}
