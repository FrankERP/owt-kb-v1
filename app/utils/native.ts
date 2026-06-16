// Lazily touches Capacitor so the web/SSR bundle is unaffected.
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

let initialized = false;
async function getSocialLogin() {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  if (!initialized) {
    await SocialLogin.initialize({
      google: {
        iOSClientId: process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID,
        webClientId: process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        mode: "online",
      },
    });
    initialized = true;
  }
  return SocialLogin;
}

/** Native Google sign-in → returns a Google ID token, or null on cancel/failure. */
export async function nativeGoogleIdToken(): Promise<string | null> {
  try {
    const SocialLogin = await getSocialLogin();
    const res = await SocialLogin.login({ provider: "google", options: { scopes: ["email", "profile"] } });
    // res.result is GoogleLoginResponse (online | offline union); in online mode idToken is present
    const result = res?.result as { idToken?: string | null } | undefined;
    return result?.idToken ?? null;
  } catch {
    return null;
  }
}
