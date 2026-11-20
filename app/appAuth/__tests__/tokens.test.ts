// app/appAuth/__tests__/tokens.test.ts — the three app token kinds (spec D5):
// each verifies only as itself, only on its own origin, only under its own key,
// and the access token only for the exact audience `<origin>/api/app`.
import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { s256Challenge } from "@/app/mcp/oauth/pkce";
import { signAccessToken } from "@/app/mcp/oauth/tokens";
import {
  APP_ACCESS_TOKEN_TTL_SECONDS,
  APP_CODE_TTL_SECONDS,
  APP_REFRESH_TOKEN_TTL_SECONDS,
  appCodeBindingHolds,
  signAppAccessToken,
  signAppCode,
  signAppRefreshToken,
  verifyAppAccessToken,
  verifyAppCode,
  verifyAppRefreshToken,
} from "../tokens";

const KEY = new TextEncoder().encode("k".repeat(40));
const OTHER_KEY = new TextEncoder().encode("o".repeat(40));
const ORIGIN = "https://owt-backstage.vercel.app";
const PREVIEW = "https://dev-owt-backstage.vercel.app";
const NOW = new Date("2026-11-20T12:00:00.000Z");
const later = (s: number) => new Date(NOW.getTime() + s * 1000);
const VERIFIER = "v".repeat(43);
const CHALLENGE = s256Challenge(VERIFIER);
const ctx = { key: KEY, origin: ORIGIN, now: NOW };
const decode = (t: string) => JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;

describe("lifetimes", () => {
  it("are 60 s, 1 h and 90 d", () => {
    expect(APP_CODE_TTL_SECONDS).toBe(60);
    expect(APP_ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
    expect(APP_REFRESH_TOKEN_TTL_SECONDS).toBe(90 * 86400);
  });
});

describe("app code", () => {
  const sign = () =>
    signAppCode({ ...ctx, sub: "m1", clientId: "backstage-ios", redirectUri: `${ORIGIN}/app/callback/ios`, codeChallenge: CHALLENGE });

  it("round-trips its bindings and carries a fresh jti", async () => {
    const a = await sign();
    const b = await sign();
    const va = await verifyAppCode(a, ctx);
    expect(va).toMatchObject({ ok: true, claims: { sub: "m1", clientId: "backstage-ios", redirectUri: `${ORIGIN}/app/callback/ios`, codeChallenge: CHALLENGE } });
    expect(decode(a).jti).not.toBe(decode(b).jti);
    expect(decode(a).exp).toBe((decode(a).iat as number) + 60);
  });

  it("expires after 60 s, and is refused on another origin or key", async () => {
    const code = await sign();
    expect(await verifyAppCode(code, { ...ctx, now: later(61) })).toEqual({ ok: false, reason: "expired" });
    expect(await verifyAppCode(code, { ...ctx, origin: PREVIEW })).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyAppCode(code, { ...ctx, key: OTHER_KEY })).toEqual({ ok: false, reason: "invalid" });
  });

  it("binds client, exact redirect and the PKCE verifier", async () => {
    const v = await verifyAppCode(await sign(), ctx);
    if (!v.ok) throw new Error("expected ok");
    const good = { clientId: "backstage-ios", redirectUri: `${ORIGIN}/app/callback/ios`, codeVerifier: VERIFIER };
    expect(appCodeBindingHolds(v.claims, good)).toBe(true);
    expect(appCodeBindingHolds(v.claims, { ...good, clientId: "backstage-android" })).toBe(false);
    expect(appCodeBindingHolds(v.claims, { ...good, redirectUri: `${ORIGIN}/app/callback/android` })).toBe(false);
    expect(appCodeBindingHolds(v.claims, { ...good, codeVerifier: "w".repeat(43) })).toBe(false);
    expect(appCodeBindingHolds(v.claims, { ...good, codeVerifier: CHALLENGE })).toBe(false);
  });
});

describe("access token", () => {
  it("verifies for the exact audience and names its grant", async () => {
    const { token, expiresIn } = await signAppAccessToken({ ...ctx, sub: "m1", grantId: "appAuthGrant.g" });
    expect(expiresIn).toBe(3600);
    expect(decode(token).aud).toBe(`${ORIGIN}/api/app`);
    expect(await verifyAppAccessToken(token, ctx)).toMatchObject({ ok: true, claims: { sub: "m1", grantId: "appAuthGrant.g" } });
    expect(await verifyAppAccessToken(token, { ...ctx, now: later(3601) })).toEqual({ ok: false, reason: "expired" });
    expect(await verifyAppAccessToken(token, { ...ctx, origin: PREVIEW })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses an array audience that merely contains ours", async () => {
    const iat = Math.floor(NOW.getTime() / 1000);
    const forged = await new SignJWT({ typ: "app-at", aud: [`${ORIGIN}/api/app`, "x"], sub: "m1", grant: "g", jti: "j", iss: ORIGIN, iat, exp: iat + 60 })
      .setProtectedHeader({ alg: "HS256" })
      .sign(KEY);
    expect(await verifyAppAccessToken(forged, ctx)).toEqual({ ok: false, reason: "invalid" });
  });

  it("is never confused with the MCP connector's token (other typ, other audience)", async () => {
    // Even signed with the SAME bytes (the two secrets are distinct in every environment).
    const { token } = await signAccessToken({ key: KEY, origin: ORIGIN, now: NOW, sub: "m1", grantId: "mcpOauthGrant.g" });
    expect(await verifyAppAccessToken(token, ctx)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("refresh token", () => {
  it("carries the store's jti verbatim and lasts 90 days", async () => {
    const t = await signAppRefreshToken({ ...ctx, sub: "m1", grantId: "appAuthGrant.g", jti: "rjti-1" });
    expect(await verifyAppRefreshToken(t, ctx)).toEqual({ ok: true, claims: { sub: "m1", grantId: "appAuthGrant.g", jti: "rjti-1" } });
    expect(await verifyAppRefreshToken(t, { ...ctx, now: later(89 * 86400) })).toMatchObject({ ok: true });
    expect(await verifyAppRefreshToken(t, { ...ctx, now: later(90 * 86400 + 1) })).toEqual({ ok: false, reason: "expired" });
  });
});

describe("kinds never cross", () => {
  it("each token verifies only as itself", async () => {
    const code = await signAppCode({ ...ctx, sub: "m1", clientId: "backstage-ios", redirectUri: "r", codeChallenge: CHALLENGE });
    const { token: at } = await signAppAccessToken({ ...ctx, sub: "m1", grantId: "g" });
    const rt = await signAppRefreshToken({ ...ctx, sub: "m1", grantId: "g", jti: "j" });
    expect((await verifyAppAccessToken(code, ctx)).ok).toBe(false);
    expect((await verifyAppAccessToken(rt, ctx)).ok).toBe(false);
    expect((await verifyAppRefreshToken(at, ctx)).ok).toBe(false);
    expect((await verifyAppRefreshToken(code, ctx)).ok).toBe(false);
    expect((await verifyAppCode(at, ctx)).ok).toBe(false);
    expect((await verifyAppCode(rt, ctx)).ok).toBe(false);
  });

  it("refuses garbage and a short key without throwing", async () => {
    for (const t of ["", "a.b.c", null, undefined, 42]) {
      expect(await verifyAppAccessToken(t, ctx)).toEqual({ ok: false, reason: "invalid" });
    }
    await expect(signAppRefreshToken({ ...ctx, key: new Uint8Array(8), sub: "m", grantId: "g", jti: "j" })).rejects.toThrow();
  });
});
