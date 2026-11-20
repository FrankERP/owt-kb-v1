// app/appAuth/__tests__/appAuthHeaders.test.ts — the native-app sign-in pages'
// headers (spec §3.1, §3.5), asserted on next.config.mjs itself. Next sends the
// LAST entry's value when two entries set the same key on a path, so the app
// entries must come AFTER the global one or the global X-Frame-Options and
// Referrer-Policy would win.
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config.mjs";

type Entry = { source: string; headers: { key: string; value: string }[] };

async function entries(): Promise<Entry[]> {
  return (await nextConfig.headers!()) as Entry[];
}

/** What Next would send for `path`, given entries in order (last write wins). Literal sources only. */
function effective(list: Entry[], pathname: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of list) {
    const re = new RegExp("^" + e.source.replace(/\(\.\*\)/g, ".*") + "$");
    if (re.test(pathname)) for (const h of e.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

describe("native-app sign-in headers", () => {
  it("the confirmation page and its POST: no framing, same-origin referrer, no cache, the Android version hint", async () => {
    const list = await entries();
    for (const p of ["/app/authorize", "/app/authorize/submit"]) {
      expect(effective(list, p)).toMatchObject({
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'",
        "referrer-policy": "same-origin",
        "cache-control": "no-store",
        "accept-ch": "Sec-CH-UA-Platform-Version",
        "critical-ch": "Sec-CH-UA-Platform-Version",
      });
    }
  });

  it("the callback pages: no referrer, no cache, no index, no framing", async () => {
    const list = await entries();
    for (const p of ["/app/callback/ios", "/app/callback/android"]) {
      expect(effective(list, p)).toMatchObject({
        "referrer-policy": "no-referrer",
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
        "x-frame-options": "DENY",
      });
    }
  });

  it("the app entries come after the global one", async () => {
    const list = await entries();
    const global = list.findIndex((e) => e.source === "/(.*)");
    expect(global).toBeGreaterThanOrEqual(0);
    for (const s of ["/app/authorize", "/app/authorize/submit", "/app/callback/ios", "/app/callback/android"]) {
      expect(list.findIndex((e) => e.source === s)).toBeGreaterThan(global);
    }
  });

  it("leaves every other page as it was", async () => {
    const other = effective(await entries(), "/me");
    expect(other["x-frame-options"]).toBe("SAMEORIGIN");
    expect(other["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(other["accept-ch"]).toBeUndefined();
  });
});
