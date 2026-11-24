// Native-app sign-in — the client registry: code, not data (ADR-0091, spec D3).
//
// Exactly two public clients. On a deployed origin (production, preview) each
// has ONE redirect: the verified `https` callback on that origin, which the OS
// delivers only to the app our domain vouches for (iOS Associated Domains,
// Android Digital Asset Links). The private-use scheme exists ONLY on the local
// origin, so the Simulator and the emulator can sign in against `next dev`
// before the Apple Team ID and the signing fingerprint exist. Never add the
// scheme, or any other redirect, to a deployed origin.

import { LOCAL_ORIGIN } from "@/app/mcp/oauth/origin";

export const APP_CLIENT_IDS = ["backstage-ios", "backstage-android"] as const;
export type AppClientId = (typeof APP_CLIENT_IDS)[number];
export type AppPlatform = "ios" | "android";

/** The scheme the apps register for local development only. */
export const LOCAL_APP_SCHEME = "app.vercel.owt-backstage";

const PLATFORM: Record<AppClientId, AppPlatform> = {
  "backstage-ios": "ios",
  "backstage-android": "android",
};

export function isAppClientId(value: unknown): value is AppClientId {
  return typeof value === "string" && (APP_CLIENT_IDS as readonly string[]).includes(value);
}

export function platformOf(clientId: AppClientId): AppPlatform {
  return PLATFORM[clientId];
}

/** The verified `https` callback of a client on an origin. */
export function verifiedCallbackFor(clientId: AppClientId, origin: string): string {
  return `${origin}/app/callback/${platformOf(clientId)}`;
}

/** Every redirect `clientId` may use on `origin`, exact strings. */
export function redirectsFor(clientId: AppClientId, origin: string): readonly string[] {
  const verified = verifiedCallbackFor(clientId, origin);
  if (origin !== LOCAL_ORIGIN) return [verified];
  return [verified, `${LOCAL_APP_SCHEME}:/oauth/callback/${platformOf(clientId)}`];
}

/** True when `redirectUri` is EXACTLY one of `clientId`'s redirects on `origin`. */
export function isRedirectAllowed(clientId: AppClientId, redirectUri: unknown, origin: string): boolean {
  return typeof redirectUri === "string" && redirectsFor(clientId, origin).includes(redirectUri);
}
