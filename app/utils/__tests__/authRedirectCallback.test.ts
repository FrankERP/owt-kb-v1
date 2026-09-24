/**
 * `/oauth/authorize` stays behind the session middleware (`proxy.ts`) rather
 * than joining the MCP/OAuth routes' public exclusion list, because a
 * cookie-less browser can round-trip through `/auth/signin` and land back on
 * the consent screen with its full query string intact — but only because
 * NextAuth's next-auth v4 **default** `redirect` callback returns a relative
 * `callbackUrl` verbatim, query included (`node_modules/next-auth/core/lib/
 * default-callbacks.js`). `auth.ts` defines no custom `redirect` callback
 * today, which is what makes that assumption true.
 *
 * If a future change adds one — even for an unrelated reason, e.g. to force a
 * particular post-login landing page — and that callback does not also
 * preserve a relative URL's query string, the MCP consent flow breaks
 * silently: Claude sends the browser to `/oauth/authorize?client_id=...&...`,
 * sign-in swallows the query, and the user lands on a `/oauth/authorize` with
 * no request to validate. Nothing in the OAuth code would fail loudly — the
 * page just renders its own "invalid request" branch, which looks identical
 * to an actually-malformed request from Claude.
 *
 * This test is the guard CLAUDE.md's OAuth/MCP invariant names: it fails the
 * moment `authOptions.callbacks.redirect` becomes anything other than
 * `undefined`, so the person adding it is pointed here instead of discovering
 * the breakage through a support report from Frank's phone.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { patch: vi.fn(), create: vi.fn() },
}));
vi.mock("@/app/utils/memberAccess", () => ({
  isMemberActive: vi.fn(async () => true),
  getMemberAccess: vi.fn(),
}));
vi.mock("@/app/utils/googleIdToken", () => ({ verifyGoogleIdToken: vi.fn() }));
vi.mock("@/app/utils/srVerificationLoginEvent", () => ({
  createLoginEvent: vi.fn(),
  resolveVerificationOwnership: vi.fn(),
}));

describe("authOptions.callbacks.redirect", () => {
  it("is undefined, so NextAuth's default redirect callback runs", async () => {
    const { authOptions } = await import("@/auth");
    expect(authOptions.callbacks?.redirect).toBeUndefined();
  });
});
