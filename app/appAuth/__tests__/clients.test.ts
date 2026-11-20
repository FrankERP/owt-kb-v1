// app/appAuth/__tests__/clients.test.ts — the two static clients and their exact
// redirects (ADR-0091, spec D3): the private scheme exists ONLY on local.
import { describe, expect, it } from "vitest";
import { LOCAL_ORIGIN, PREVIEW_ORIGIN, PRODUCTION_ORIGIN } from "@/app/mcp/oauth/origin";
import {
  APP_CLIENT_IDS,
  LOCAL_APP_SCHEME,
  isAppClientId,
  isRedirectAllowed,
  platformOf,
  redirectsFor,
  verifiedCallbackFor,
} from "../clients";

describe("app clients", () => {
  it("knows exactly the two first-party clients", () => {
    expect([...APP_CLIENT_IDS]).toEqual(["backstage-ios", "backstage-android"]);
    expect(isAppClientId("backstage-ios")).toBe(true);
    expect(isAppClientId("backstage-android")).toBe(true);
    for (const v of ["backstage-web", "BACKSTAGE-IOS", "", null, undefined, 1, "toString", "constructor"]) {
      expect(isAppClientId(v)).toBe(false);
    }
  });

  it("maps each client to its platform", () => {
    expect(platformOf("backstage-ios")).toBe("ios");
    expect(platformOf("backstage-android")).toBe("android");
  });

  it("offers ONLY the verified https callback on production and preview", () => {
    for (const origin of [PRODUCTION_ORIGIN, PREVIEW_ORIGIN]) {
      expect(redirectsFor("backstage-ios", origin)).toEqual([`${origin}/app/callback/ios`]);
      expect(redirectsFor("backstage-android", origin)).toEqual([`${origin}/app/callback/android`]);
      expect(isRedirectAllowed("backstage-ios", `${LOCAL_APP_SCHEME}:/oauth/callback/ios`, origin)).toBe(false);
      expect(isRedirectAllowed("backstage-android", `${LOCAL_APP_SCHEME}:/oauth/callback/android`, origin)).toBe(false);
    }
  });

  it("adds the private scheme on local only", () => {
    expect(redirectsFor("backstage-ios", LOCAL_ORIGIN)).toEqual([
      `${LOCAL_ORIGIN}/app/callback/ios`,
      `${LOCAL_APP_SCHEME}:/oauth/callback/ios`,
    ]);
    expect(isRedirectAllowed("backstage-android", `${LOCAL_APP_SCHEME}:/oauth/callback/android`, LOCAL_ORIGIN)).toBe(true);
  });

  it("matches exact strings only — no cross-platform, prefix, query, case or port variant", () => {
    const o = PRODUCTION_ORIGIN;
    expect(isRedirectAllowed("backstage-ios", verifiedCallbackFor("backstage-ios", o), o)).toBe(true);
    for (const bad of [
      `${o}/app/callback/android`,
      `${o}/app/callback/ios/`,
      `${o}/app/callback/ios?x=1`,
      `${o}/app/callback/ios#f`,
      `${o}/APP/callback/ios`,
      `${o}:443/app/callback/ios`,
      `${PREVIEW_ORIGIN}/app/callback/ios`,
      `${LOCAL_APP_SCHEME}:/oauth/callback/android`,
      "",
      null,
      undefined,
    ]) {
      expect(isRedirectAllowed("backstage-ios", bad, o)).toBe(false);
    }
  });
});
