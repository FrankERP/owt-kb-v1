// Native-app sign-in — the Android version gate (spec 2026-11-19 §10 A15, Frank's
// decision of 2026-11-20). On Android 11 and older another installed app can be
// offered our `https` sign-in redirect in the system chooser, so sign-in from
// those phones is refused outright — for EVERY client id, because the attack
// works with any `https` redirect on our domain.
//
// The real version comes from Chrome's User-Agent Client Hints: the reduced
// `User-Agent` string freezes it at «Android 10». The page and the POST answer
// `Accept-CH`/`Critical-CH` (APP_AUTHORIZE_CLIENT_HINT_HEADERS, set in
// `next.config.mjs`) so Chrome retries the navigation carrying
// `Sec-CH-UA-Platform-Version`. Fail closed: an Android request without a
// readable version is refused. Pure: reads headers only.

/** The client hint the gate needs. */
export const PLATFORM_VERSION_HINT = "Sec-CH-UA-Platform-Version";

/** The lowest Android major version allowed to sign in to the app. */
export const MIN_ANDROID_MAJOR = 12;

export type AndroidGateResult = { ok: true } | { ok: false; reason: "android_too_old" | "android_version_unknown" };

/** A structured-header string `"12.0.0"` → 12; anything else → null. */
function majorOf(hint: string | null): number | null {
  if (hint === null) return null;
  const m = /^\s*"?(\d{1,3})(?:\.\d+)*"?\s*$/.exec(hint);
  return m ? Number(m[1]) : null;
}

/** True when the request comes from an Android browser (client hint first, then the User-Agent). */
export function isAndroidRequest(headers: Pick<Headers, "get">): boolean {
  const platform = headers.get("sec-ch-ua-platform");
  if (platform !== null) return platform.trim().replace(/^"|"$/g, "").toLowerCase() === "android";
  return /\bandroid\b/i.test(headers.get("user-agent") ?? "");
}

/**
 * Non-Android requests pass. An Android request passes only with a
 * `Sec-CH-UA-Platform-Version` whose major is ≥ 12.
 */
export function androidVersionAllows(headers: Pick<Headers, "get">): AndroidGateResult {
  if (!isAndroidRequest(headers)) return { ok: true };
  const major = majorOf(headers.get(PLATFORM_VERSION_HINT.toLowerCase()));
  if (major === null) return { ok: false, reason: "android_version_unknown" };
  return major >= MIN_ANDROID_MAJOR ? { ok: true } : { ok: false, reason: "android_too_old" };
}
