# Native Google SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google Sign-In work inside the Capacitor iOS/Android wrap by exchanging a native Google ID token for the existing NextAuth cookie session, with permanent-feeling login (silent re-auth) and a near-instant `disabled`-flag kill switch enforced per-request server-side.

**Architecture:** A native Google plugin returns an ID token; a new `google-native` NextAuth Credentials provider verifies it server-side and mints the same cookie session as web. A Node-side `assertMemberActive` guard runs on every authenticated route/page so a `disabled` member is cut within ~30s. Middleware (`proxy.ts`) stays a pure JWT gate. Web/desktop behavior is unchanged.

**Tech Stack:** Next.js 16 (App Router), NextAuth v4 (JWT sessions), Sanity v5, Capacitor 8, `@capgo/capacitor-social-login`, `google-auth-library`, Vitest (new, for unit tests).

**Spec:** `docs/superpowers/specs/2026-06-16-app-google-sso-design.md`

---

## File Structure

**New files**
- `app/utils/memberAccess.ts` — `assertMemberActive(sanityId)` + 30s TTL cache (one responsibility: live member-active check).
- `app/utils/authGuards.ts` — `requireActiveSession()` / `requireActiveManager()` shared API/page guards.
- `app/utils/googleIdToken.ts` — `verifyGoogleIdToken(idToken)` wrapper around `google-auth-library`.
- `app/components/NativeAuthBootstrap.tsx` — native-only client component for silent re-auth.
- `app/utils/native.ts` — `isNativeApp()` + lazy plugin import helpers (keeps Capacitor JS out of the web/SSR path).
- `vitest.config.ts`, `app/utils/__tests__/*.test.ts` — unit tests.

**Modified files**
- `sanity/schemas/worshipTeam.ts` — add `disabled` boolean.
- `auth.ts` — `google-native` provider; active-check in existing `authorize` + `jwt` refresh.
- `package.json` — deps + `test` script.
- Every `app/api/**` route + session-reading dynamic pages — call the shared guard.
- `app/api/practice-playlist/route.ts` — add auth (hard gap).
- `app/(client)/auth/signin/page.tsx` — native Google flow.
- `app/(client)/layout.tsx` — mount `NativeAuthBootstrap`.
- `capacitor.config.ts`, `ios/App/App/Info.plist`, `android/app/src/main/res/values/strings.xml` — native plugin config.

---

## Task 0: Dependencies & test harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install runtime + native deps**

```bash
cd ~/Documents/Builds/owt-kb-v1
npm i google-auth-library @capgo/capacitor-social-login @capacitor/core
npm i -D vitest
```

- [ ] **Step 2: Add a `test` script to `package.json`**

In the `"scripts"` block, add:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["app/**/*.test.ts"] },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
});
```

- [ ] **Step 4: Verify the runner works**

Run: `npx vitest run`
Expected: exits 0 with "No test files found" (no tests yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add google-auth-library, capgo social-login, vitest"
```

---

## Task 1: Add `disabled` flag to the member schema

**Files:**
- Modify: `sanity/schemas/worshipTeam.ts`

- [ ] **Step 1: Add the field** after the `role` field block:

```ts
    {
      name: "disabled",
      title: "Acceso deshabilitado",
      type: "boolean",
      initialValue: false,
      description: "Si está activo, este miembro pierde el acceso a la app en segundos (kill switch). Reversible.",
    },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemas/worshipTeam.ts
git commit -m "feat(schema): add disabled flag to teamMembers for access revocation"
```

---

## Task 2: `assertMemberActive` helper with TTL cache (TDD)

**Files:**
- Create: `app/utils/memberAccess.ts`
- Test: `app/utils/__tests__/memberAccess.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/memberAccess.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...a: unknown[]) => fetchMock(...a) },
}));

import { isMemberActive, __clearMemberAccessCache } from "../memberAccess";

beforeEach(() => { fetchMock.mockReset(); __clearMemberAccessCache(); });

describe("isMemberActive", () => {
  it("returns true for an existing, non-disabled member", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: false });
    expect(await isMemberActive("m1")).toBe(true);
  });

  it("returns false when disabled is true", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: true });
    expect(await isMemberActive("m1")).toBe(false);
  });

  it("returns false when the member no longer exists", async () => {
    fetchMock.mockResolvedValueOnce(null);
    expect(await isMemberActive("gone")).toBe(false);
  });

  it("caches within the TTL (one fetch for two calls)", async () => {
    fetchMock.mockResolvedValue({ _id: "m1", disabled: false });
    await isMemberActive("m1");
    await isMemberActive("m1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a missing id as inactive without fetching", async () => {
    expect(await isMemberActive("")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run app/utils/__tests__/memberAccess.test.ts`
Expected: FAIL — cannot find module `../memberAccess`.

- [ ] **Step 3: Implement `app/utils/memberAccess.ts`**

```ts
import { serverClient } from "@/sanity/lib/serverClient";

const TTL_MS = 30_000;
type Entry = { active: boolean; expires: number };
const cache = new Map<string, Entry>();

/** For tests only. */
export function __clearMemberAccessCache() { cache.clear(); }

/**
 * Live "is this member still allowed in" check, backed by a 30s TTL cache.
 * A member is active iff their teamMembers doc exists and disabled !== true.
 * Reads via serverClient (useCdn:false) so the flag is never CDN-stale.
 */
export async function isMemberActive(sanityId: string | undefined | null): Promise<boolean> {
  if (!sanityId) return false;
  const now = Date.now();
  const hit = cache.get(sanityId);
  if (hit && hit.expires > now) return hit.active;

  const doc = await serverClient.fetch<{ _id: string; disabled?: boolean } | null>(
    `*[_type == "teamMembers" && _id == $id][0]{ _id, disabled }`,
    { id: sanityId }
  );
  const active = !!doc && doc.disabled !== true;
  cache.set(sanityId, { active, expires: now + TTL_MS });
  return active;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/utils/__tests__/memberAccess.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/memberAccess.ts app/utils/__tests__/memberAccess.test.ts
git commit -m "feat(auth): add isMemberActive live revocation check with 30s cache"
```

---

## Task 3: Shared API/page auth guards

**Files:**
- Create: `app/utils/authGuards.ts`

- [ ] **Step 1: Implement the guards**

```ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { isMemberActive } from "./memberAccess";

export type ActiveSession = Awaited<ReturnType<typeof getServerSession>>;

/**
 * Returns the session only if the (effective) member is still active.
 * Returns null for: no session, no sanityId, or a disabled/removed member.
 * Use the effective sanityId so an impersonated-but-disabled target is blocked.
 */
export async function requireActiveSession(): Promise<ActiveSession | null> {
  const session = await getServerSession(authOptions);
  const sanityId = session?.user?.sanityId;
  if (!sanityId) return null;
  if (!(await isMemberActive(sanityId))) return null;
  return session;
}

/** As above, but also requires an admin/super-admin/content-editor role. */
export async function requireActiveManager(): Promise<ActiveSession | null> {
  const session = await requireActiveSession();
  const role = session?.user?.role;
  if (!session || !role || !["super-admin", "admin", "content-editor"].includes(role)) return null;
  return session;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add app/utils/authGuards.ts
git commit -m "feat(auth): add requireActiveSession/requireActiveManager guards"
```

---

## Task 4: Enforce the guard on every authenticated surface

This closes the kill-switch coverage gaps from the spec (§7). Apply the **same transformation** to each route below: replace the existing local session check with the active-aware guard.

**Files (API — modify each):**
`app/api/me/route.ts`, `app/api/me/songs/route.ts`, `app/api/me/photo/route.ts`, `app/api/me/password/route.ts`, `app/api/me/proposals/**`, `app/api/song/[id]/route.ts`, `app/api/content/**`, `app/api/notifications/**`, `app/api/activity/ping/route.ts`, `app/api/admin/**` (all), `app/api/practice-playlist/route.ts`.

- [ ] **Step 1: Replace per-route session reads (non-admin routes)**

For each non-admin route, find its local auth preamble, e.g. in `app/api/me/route.ts`:

```ts
// DELETE the local helper:
async function getSessionMember() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.sanityId) return null;
  return session;
}
```

Replace the import + usage so each handler starts with:

```ts
import { requireActiveSession } from "@/app/utils/authGuards";
// ...
const session = await requireActiveSession();
if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

Remove now-unused `getServerSession`/`authOptions` imports where they were only used by the deleted helper.

- [ ] **Step 2: Replace admin-route role checks**

For each `app/api/admin/**` route, replace its local `requireManager()`/role gate with:

```ts
import { requireActiveManager } from "@/app/utils/authGuards";
// ...
const session = await requireActiveManager();
if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

Preserve any **stricter** per-route role logic (e.g. super-admin-only impersonation) by adding the specific role check *after* the guard.

- [ ] **Step 3: Fix the hard gap — `app/api/practice-playlist/route.ts`**

It currently reads no session. Add at the top of the handler:

```ts
import { requireActiveSession } from "@/app/utils/authGuards";
// ...inside the handler, before any data fetch:
const session = await requireActiveSession();
if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

- [ ] **Step 4: Guard session-reading dynamic pages**

In each page that calls `getServerSession` (`app/(client)/me/page.tsx`, `app/(client)/me/propose/[roleId]/*`, `app/(admin)/admin/*`), replace that call with the guard and redirect when null:

```ts
import { requireActiveSession } from "@/app/utils/authGuards"; // or requireActiveManager for admin
import { redirect } from "next/navigation";
// ...
const session = await requireActiveSession();
if (!session) redirect("/auth/signin");
```

> Note: the static pages `app/(client)/page.tsx` and `app/(client)/schedule/page.tsx` are intentionally left untouched (spec §3 accepted tradeoff — they read no session and stay statically cached).

- [ ] **Step 5: Typecheck and smoke-build**

Run: `npx tsc --noEmit && npx next build`
Expected: typecheck exits 0; build succeeds. (Build confirms no route accidentally lost its imports.)

- [ ] **Step 6: Commit**

```bash
git add app/api app/\(client\)/me app/\(admin\)
git commit -m "feat(auth): enforce active-member guard on all authenticated routes and pages"
```

---

## Task 5: Google ID-token verification helper (TDD)

**Files:**
- Create: `app/utils/googleIdToken.ts`
- Test: `app/utils/__tests__/googleIdToken.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class { verifyIdToken = verifyIdToken; },
}));

import { verifyGoogleIdToken, __setAllowedAudiences } from "../googleIdToken";

beforeEach(() => { verifyIdToken.mockReset(); __setAllowedAudiences(["web-id", "ios-id", "android-id"]); });

describe("verifyGoogleIdToken", () => {
  it("returns the email for a valid, verified token", async () => {
    verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ email: "a@b.com", email_verified: true }) });
    expect(await verifyGoogleIdToken("tok")).toEqual({ email: "a@b.com" });
  });

  it("rejects an unverified email", async () => {
    verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ email: "a@b.com", email_verified: false }) });
    await expect(verifyGoogleIdToken("tok")).rejects.toThrow(/email_verified/);
  });

  it("rejects when the library throws (bad signature / aud / exp)", async () => {
    verifyIdToken.mockRejectedValueOnce(new Error("Invalid token"));
    await expect(verifyGoogleIdToken("tok")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run app/utils/__tests__/googleIdToken.test.ts`
Expected: FAIL — cannot find module `../googleIdToken`.

- [ ] **Step 3: Implement `app/utils/googleIdToken.ts`**

```ts
import { OAuth2Client } from "google-auth-library";

// aud allowlist = our own OAuth client IDs (web + native). A token minted for
// any other app must be rejected. iOS/Android client IDs are separate from web.
let ALLOWED = [
  process.env.GOOGLE_CLIENT_ID,        // web (existing)
  process.env.GOOGLE_IOS_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
].filter(Boolean) as string[];

/** For tests only. */
export function __setAllowedAudiences(ids: string[]) { ALLOWED = ids; }

const client = new OAuth2Client();

/** Verify a Google ID token (signature via JWKS, aud, iss, exp) and require a verified email. */
export async function verifyGoogleIdToken(idToken: string): Promise<{ email: string }> {
  const ticket = await client.verifyIdToken({ idToken, audience: ALLOWED });
  const payload = ticket.getPayload();
  if (!payload?.email) throw new Error("Google token has no email");
  if (payload.email_verified !== true) throw new Error("Google email_verified is false");
  return { email: payload.email };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/utils/__tests__/googleIdToken.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/googleIdToken.ts app/utils/__tests__/googleIdToken.test.ts
git commit -m "feat(auth): add Google ID-token verifier with aud allowlist + email_verified"
```

---

## Task 6: `google-native` Credentials provider

**Files:**
- Modify: `auth.ts`

- [ ] **Step 1: Add imports** at the top of `auth.ts`:

```ts
import { verifyGoogleIdToken } from "@/app/utils/googleIdToken";
import { isMemberActive } from "@/app/utils/memberAccess";
```

- [ ] **Step 2: Add the provider** to the `providers` array, after the existing `CredentialsProvider`:

```ts
    CredentialsProvider({
      id: "google-native",
      name: "Google (app)",
      credentials: { idToken: { label: "idToken", type: "text" } },
      async authorize(credentials) {
        if (!credentials?.idToken) return null;
        let email: string;
        try {
          ({ email } = await verifyGoogleIdToken(credentials.idToken));
        } catch {
          return null;
        }
        const member = await getMemberByEmail(email);
        if (!member?._id) return null;
        if (!(await isMemberActive(member._id))) return null; // disabled/removed
        return {
          id:       member._id,
          name:     member.member_name,
          email,
          image:    member.image ?? undefined,
          role:     member.role ?? "member",
          sanityId: member._id,
          alias:    member.alias ?? null,
        };
      },
    }),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add auth.ts
git commit -m "feat(auth): add google-native credentials provider (ID-token -> session)"
```

---

## Task 7: Active-check in existing auth paths

**Files:**
- Modify: `auth.ts`

- [ ] **Step 1: Block disabled members in the email/password `authorize`.** After the bcrypt check passes and before `return {`:

```ts
        if (!(await isMemberActive(member._id))) return null;
```

- [ ] **Step 2: Re-validate on token refresh in the `jwt` callback.** Inside the `if (user)` first-sign-in block is already covered by the providers. Add a refresh-time check: near the end of the `jwt` callback, before `return token;`, add:

```ts
      // Revocation: on token refresh, drop the session if the (effective) member
      // was disabled/removed. During impersonation, also require the REAL admin to
      // still be active, so a disabled super-admin can't keep operating as a target.
      const effectiveId = token.sanityId;
      const realAdminId = token.__realAdmin?.sanityId;
      if (
        (effectiveId && !(await isMemberActive(effectiveId))) ||
        (realAdminId && !(await isMemberActive(realAdminId)))
      ) {
        // Returning a token without sanityId makes proxy.ts + guards treat it as unauthenticated.
        return { ...token, sanityId: undefined, role: undefined };
      }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add auth.ts
git commit -m "feat(auth): reject disabled members in credentials authorize + jwt refresh"
```

---

## Task 8: Env vars & Google Cloud Console (manual prerequisite)

**Files:** none (config + console). Do this before Task 9–11 can be device-tested.

- [ ] **Step 1: Create native OAuth client IDs** in Google Cloud Console (project `eloquent-figure-421401`, the one already serving web Google login):
  1. APIs & Services → **Credentials** → **Create Credentials → OAuth client ID**.
  2. **iOS:** Application type *iOS*, Bundle ID `com.owtBackstage.app`. Copy the **Client ID** and note the **reversed client ID** (`com.googleusercontent.apps.XXX`).
  3. **Android:** Application type *Android*, Package `com.owtBackstage.app`, plus the signing-cert **SHA-1** (debug + release). Get SHA-1 with: `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android` (release: from your upload keystore).
  4. The existing **Web** client ID stays as-is (used as the server `aud` + the plugin's `webClientId`).

- [ ] **Step 2: Add env vars** to `.env.local` and to Vercel (Project → Settings → Environment Variables):

```
GOOGLE_IOS_CLIENT_ID=<ios client id>.apps.googleusercontent.com
GOOGLE_ANDROID_CLIENT_ID=<android client id>.apps.googleusercontent.com
# GOOGLE_CLIENT_ID (web) already exists
```

- [ ] **Step 3: Redeploy** so the server picks up the new audiences. No code change in this task.

---

## Task 9: Native plugin config (iOS + Android)

**Files:**
- Modify: `capacitor.config.ts`, `ios/App/App/Info.plist`, `android/app/src/main/res/values/strings.xml`

- [ ] **Step 1: iOS URL scheme.** In `ios/App/App/Info.plist`, add inside the top-level `<dict>`:

```xml
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>com.googleusercontent.apps.REVERSED_IOS_CLIENT_ID</string>
			</array>
		</dict>
	</array>
```

Replace `REVERSED_IOS_CLIENT_ID` with the reversed iOS client ID from Task 8.

- [ ] **Step 2: Android string.** In `android/app/src/main/res/values/strings.xml`, add:

```xml
    <string name="server_client_id">WEB_CLIENT_ID.apps.googleusercontent.com</string>
```

- [ ] **Step 3: Sync native projects**

```bash
npx cap sync ios
npx cap sync android
```

Expected: completes without error; the social-login plugin appears in the sync output.

- [ ] **Step 4: Commit**

```bash
git add capacitor.config.ts ios/App/App/Info.plist android/app/src/main/res/values/strings.xml
git commit -m "feat(mobile): configure native Google sign-in (URL scheme + server client id)"
```

---

## Task 10: Native detection + web sign-in flow

**Files:**
- Create: `app/utils/native.ts`
- Modify: `app/(client)/auth/signin/page.tsx`

- [ ] **Step 1: Create `app/utils/native.ts`**

```ts
// Lazily touches Capacitor so the web/SSR bundle is unaffected.
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as any).Capacitor;
  return !!cap?.isNativePlatform?.();
}

let initialized = false;
async function getSocialLogin() {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  if (!initialized) {
    await SocialLogin.initialize({
      google: { webClientId: process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID! },
    });
    initialized = true;
  }
  return SocialLogin;
}

/** Native Google sign-in → returns a Google ID token, or null on cancel/failure. */
export async function nativeGoogleIdToken(): Promise<string | null> {
  try {
    const SocialLogin = await getSocialLogin();
    const res: any = await SocialLogin.login({ provider: "google", options: { scopes: ["email", "profile"] } });
    return res?.result?.idToken ?? null;
  } catch {
    return null;
  }
}
```

> Add `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` (= the web client ID) to env (`.env.local` + Vercel). Verify the exact `initialize`/`login`/`idToken` shape against the installed `@capgo/capacitor-social-login` version's README; adjust property names if the version differs.

- [ ] **Step 2: Wire the sign-in page.** In `app/(client)/auth/signin/page.tsx`, change the Google button's handler so it uses the native flow in-app and the redirect on web:

```tsx
import { isNativeApp, nativeGoogleIdToken } from "@/app/utils/native";
// ...
async function handleGoogle() {
  if (isNativeApp()) {
    const idToken = await nativeGoogleIdToken();
    if (!idToken) { setCredError("No se pudo iniciar sesión con Google."); return; }
    const res = await signIn("google-native", { idToken, callbackUrl, redirect: false });
    if (res?.error) setCredError("Acceso denegado."); else window.location.assign(callbackUrl || "/");
    return;
  }
  signIn("google", { callbackUrl }); // unchanged web behavior
}
// change the button's onClick from `() => signIn("google", { callbackUrl })` to `handleGoogle`
```

- [ ] **Step 3: Typecheck + web build (ensure SSR/web unaffected)**

Run: `npx tsc --noEmit && npx next build`
Expected: exits 0; build succeeds (dynamic import keeps Capacitor out of the server bundle).

- [ ] **Step 4: Commit**

```bash
git add app/utils/native.ts app/\(client\)/auth/signin/page.tsx
git commit -m "feat(mobile): native Google sign-in on the app, web redirect unchanged"
```

---

## Task 11: Silent re-auth

**Files:**
- Create: `app/components/NativeAuthBootstrap.tsx`
- Modify: `app/(client)/layout.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";
import { useEffect } from "react";
import { useSession, signIn } from "next-auth/react";
import { isNativeApp } from "@/app/utils/native";

/**
 * Native-only: on cold start, if there's no session, silently try to re-auth
 * with Google so valid users never see a login screen. A disabled member's
 * google-native authorize will reject, so silent re-auth fails closed for them.
 */
export default function NativeAuthBootstrap() {
  const { status } = useSession();
  useEffect(() => {
    if (!isNativeApp() || status !== "unauthenticated") return;
    let cancelled = false;
    (async () => {
      const { nativeGoogleIdToken } = await import("@/app/utils/native");
      const idToken = await nativeGoogleIdToken().catch(() => null); // silent attempt
      if (cancelled || !idToken) return;
      await signIn("google-native", { idToken, redirect: false });
    })();
    return () => { cancelled = true; };
  }, [status]);
  return null;
}
```

> Verify whether the installed plugin exposes a true **silent** restore (no UI). If `login()` always shows UI, use the plugin's restore/`isLoggedIn` API for the silent path and keep `login()` only for the explicit button. Adjust this component to call the silent method; fall back to the login screen if unavailable.

- [ ] **Step 2: Mount it** in `app/(client)/layout.tsx` inside `<Provider>` (which must expose `SessionProvider`; confirm `app/utils/Provider` wraps `SessionProvider`, add it if missing):

```tsx
import NativeAuthBootstrap from "../components/NativeAuthBootstrap";
// inside <Provider> ... before {children} or alongside other globals:
<NativeAuthBootstrap />
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: exits 0; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/components/NativeAuthBootstrap.tsx app/\(client\)/layout.tsx
git commit -m "feat(mobile): silent Google re-auth on app cold start"
```

---

## Task 12: Device verification & revocation test (manual)

**Files:** none. Requires a deploy of the web changes + an Xcode rebuild for the native plugin.

- [ ] **Step 1: Deploy + rebuild.** Push all commits, wait for Vercel "Ready", then `npx cap sync ios && npx cap open ios` → Run on device.

- [ ] **Step 2: Fresh Google login (iOS).** Sign out → tap "Continuar con Google" → native Google sheet appears → select account → lands on home, logged in. Confirm no "FR"-style fallback and the session cookie persists across app relaunch.

- [ ] **Step 3: Silent re-auth.** Force-quit and reopen → you are still logged in with no login screen shown.

- [ ] **Step 4: Kill switch.** In Sanity Studio, set your test member's `disabled` = true. Within ~30s, in the app: opening a song's floating card / `/me` / any admin action returns Unauthorized, and a fresh login is refused. Re-enable (`disabled` = false) → access returns. Record the observed lockout time.

- [ ] **Step 5: Web unaffected.** On desktop, Google login still works via redirect; email/password still works.

- [ ] **Step 6: Run the unit suite once more**

Run: `npm test`
Expected: all tests pass.

---

## Self-review notes (for the implementer)
- The plugin API (`initialize`/`login`/silent restore, and the exact `idToken` path) is the one external unknown — verify against the installed `@capgo/capacitor-social-login` version and adjust Tasks 10–11 accordingly. Everything server-side (Tasks 1–7) is fully specified and unit-tested.
- `aud` allowlist = web + iOS + Android client IDs (Task 5). Do not narrow it to only the web ID, or native tokens will be rejected.
- Static `schedule`/home pages are intentionally not guarded (spec §3); do not "fix" them.
