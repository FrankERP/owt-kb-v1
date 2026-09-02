import { describe, expect, it } from "vitest";
import { decideRequest, SIGNIN_CALLBACK_PATH } from "../lib/dev-verify/mutationPolicy";

const ORIGIN = "https://dev-owt-backstage.vercel.app";

describe("dev-verify mutation policy", () => {
  it("allows GET and HEAD everywhere", () => {
    for (const path of ["/", "/admin", "/api/admin/roles", "/api/cron/notify", "/_next/data/x.json"]) {
      expect(decideRequest({ method: "GET", url: ORIGIN + path, phase: "observe" })).toEqual({ action: "allow" });
      expect(decideRequest({ method: "HEAD", url: ORIGIN + path, phase: "observe" })).toEqual({ action: "allow" });
    }
  });

  it("blocks every non-GET method under /api/** while observing", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const path of ["/api/admin/roles/abc", "/api/me/theme", "/api/cron/notify", "/api/auth/signout"]) {
        expect(decideRequest({ method, url: ORIGIN + path, phase: "observe" }))
          .toEqual({ action: "block", reason: "mutation" });
      }
    }
  });

  it("allows ONLY the credentials callback POST, and only during sign-in", () => {
    expect(decideRequest({ method: "POST", url: ORIGIN + SIGNIN_CALLBACK_PATH, phase: "signin" })).toEqual({ action: "allow" });
    expect(decideRequest({ method: "POST", url: ORIGIN + SIGNIN_CALLBACK_PATH + "?x=1", phase: "signin" })).toEqual({ action: "allow" });
    expect(decideRequest({ method: "POST", url: ORIGIN + SIGNIN_CALLBACK_PATH, phase: "observe" }))
      .toEqual({ action: "block", reason: "mutation" });
    expect(decideRequest({ method: "POST", url: ORIGIN + "/api/auth/callback/google", phase: "signin" }))
      .toEqual({ action: "block", reason: "mutation" });
    expect(decideRequest({ method: "POST", url: ORIGIN + "/api/auth/signin/credentials", phase: "signin" }))
      .toEqual({ action: "block", reason: "mutation" });
  });

  it("allows NextAuth's csrf/session/providers GETs during sign-in (they are GETs)", () => {
    expect(decideRequest({ method: "GET", url: ORIGIN + "/api/auth/csrf", phase: "signin" })).toEqual({ action: "allow" });
    expect(decideRequest({ method: "GET", url: ORIGIN + "/api/auth/session", phase: "observe" })).toEqual({ action: "allow" });
  });

  it("blocks non-GET to non-/api paths too (server actions post to the page URL)", () => {
    expect(decideRequest({ method: "POST", url: ORIGIN + "/admin", phase: "observe" }))
      .toEqual({ action: "block", reason: "mutation" });
  });

  it("is case-insensitive on method", () => {
    expect(decideRequest({ method: "delete", url: ORIGIN + "/api/admin/roles/x", phase: "observe" }))
      .toEqual({ action: "block", reason: "mutation" });
    expect(decideRequest({ method: "get", url: ORIGIN + "/api/admin/roles", phase: "observe" })).toEqual({ action: "allow" });
  });
});
