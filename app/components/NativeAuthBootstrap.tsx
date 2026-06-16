"use client";
import { useEffect } from "react";
import { useSession, signIn } from "next-auth/react";
import { isNativeApp } from "@/app/utils/native";

/**
 * Native-only: on cold start, if there's no session, silently try to re-auth
 * with Google so valid users never see a login screen. A disabled member's
 * google-native authorize rejects, so silent re-auth fails closed for them.
 */
export default function NativeAuthBootstrap() {
  const { status } = useSession();
  useEffect(() => {
    if (!isNativeApp() || status !== "unauthenticated") return;
    let cancelled = false;
    (async () => {
      const { nativeGoogleSilentIdToken } = await import("@/app/utils/native");
      const idToken = await nativeGoogleSilentIdToken();
      if (cancelled || !idToken) return;
      await signIn("google-native", { idToken, redirect: false });
    })();
    return () => { cancelled = true; };
  }, [status]);
  return null;
}
