// app/appAuth/__tests__/androidGate.test.ts — the Android ≤ 11 block (spec §10
// A15, Frank 2026-11-19): Android passes only with a platform-version hint whose
// major is ≥ 12; without the hint it fails closed. Everything else passes.
import { describe, expect, it } from "vitest";
import { MIN_ANDROID_MAJOR, androidVersionAllows, isAndroidRequest } from "../androidGate";

const h = (init: Record<string, string>) => new Headers(init);
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

describe("android gate", () => {
  it("is 12", () => {
    expect(MIN_ANDROID_MAJOR).toBe(12);
  });

  it("recognises Android by the client hint first, then the User-Agent", () => {
    expect(isAndroidRequest(h({ "sec-ch-ua-platform": '"Android"' }))).toBe(true);
    expect(isAndroidRequest(h({ "user-agent": ANDROID_UA }))).toBe(true);
    // The hint wins over the UA (a desktop-mode Android sends a desktop UA but the real hint).
    expect(isAndroidRequest(h({ "sec-ch-ua-platform": '"macOS"', "user-agent": ANDROID_UA }))).toBe(false);
    expect(isAndroidRequest(h({ "user-agent": IPHONE_UA }))).toBe(false);
    expect(isAndroidRequest(h({}))).toBe(false);
  });

  it("lets every non-Android request through", () => {
    expect(androidVersionAllows(h({ "user-agent": IPHONE_UA }))).toEqual({ ok: true });
    expect(androidVersionAllows(h({ "sec-ch-ua-platform": '"Windows"', "sec-ch-ua-platform-version": '"3.0.0"' }))).toEqual({ ok: true });
  });

  it("allows Android 12 and newer", () => {
    for (const v of ['"12.0.0"', '"13.0.0"', '"15.1.2"', "14"]) {
      expect(androidVersionAllows(h({ "sec-ch-ua-platform": '"Android"', "sec-ch-ua-platform-version": v }))).toEqual({ ok: true });
    }
  });

  it("blocks Android 11 and older — the frozen «Android 10» UA never decides", () => {
    for (const v of ['"11.0.0"', '"10.0.0"', '"8.1.0"']) {
      expect(androidVersionAllows(h({ "user-agent": ANDROID_UA, "sec-ch-ua-platform": '"Android"', "sec-ch-ua-platform-version": v }))).toEqual({
        ok: false,
        reason: "android_too_old",
      });
    }
    // A real Android 14 still sends the reduced «Android 10» UA: the hint decides.
    expect(androidVersionAllows(h({ "user-agent": ANDROID_UA, "sec-ch-ua-platform-version": '"14.0.0"' }))).toEqual({ ok: true });
  });

  it("fails closed on Android without a readable hint", () => {
    for (const extra of [{} as Record<string, string>, { "sec-ch-ua-platform-version": '""' }, { "sec-ch-ua-platform-version": '"abc"' }, { "sec-ch-ua-platform-version": '"1234.0"' }]) {
      expect(androidVersionAllows(h({ "user-agent": ANDROID_UA, ...extra }))).toEqual({ ok: false, reason: "android_version_unknown" });
    }
  });
});
