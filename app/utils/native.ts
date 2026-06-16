// Lazily touches Capacitor so the web/SSR bundle is unaffected.
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

let socialLoginPromise: ReturnType<typeof loadSocialLogin> | null = null;

async function loadSocialLogin() {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  // NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID must equal the server's GOOGLE_IOS_CLIENT_ID,
  // and NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID must equal GOOGLE_CLIENT_ID — the server
  // verifies the ID token's `aud` against those server-side values.
  await SocialLogin.initialize({
    google: {
      iOSClientId: process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID,
      webClientId: process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      mode: "online",
    },
  });
  return SocialLogin;
}

function getSocialLogin() {
  if (!socialLoginPromise) socialLoginPromise = loadSocialLogin();
  return socialLoginPromise;
}

/**
 * Best-effort SILENT Google sign-in for app cold start: only proceeds if the
 * device already has a Google session (isLoggedIn), so logged-out users are not
 * shown an account picker. The capgo plugin has no true no-UI restore that
 * returns a fresh idToken, so this calls login() only when already authorized.
 * Returns null if not logged in or on any error.
 */
export async function nativeGoogleSilentIdToken(): Promise<string | null> {
  try {
    const SocialLogin = await getSocialLogin();
    const status = await SocialLogin.isLoggedIn({ provider: "google" });
    if (!status?.isLoggedIn) return null;
    const res = await SocialLogin.login({ provider: "google", options: { scopes: ["email", "profile"] } });
    const result = res?.result as { idToken?: string | null } | undefined;
    return result?.idToken ?? null;
  } catch (err) {
    console.error("[native] silent Google re-auth failed:", err);
    return null;
  }
}

/** Native Google sign-in → returns a Google ID token, or null on cancel/failure. */
export async function nativeGoogleIdToken(): Promise<string | null> {
  try {
    const SocialLogin = await getSocialLogin();
    const res = await SocialLogin.login({ provider: "google", options: { scopes: ["email", "profile"] } });
    // res.result is GoogleLoginResponse (online | offline union); in online mode idToken is present
    const result = res?.result as { idToken?: string | null } | undefined;
    return result?.idToken ?? null;
  } catch (err) {
    console.error("[native] Google sign-in failed:", err);
    return null;
  }
}
