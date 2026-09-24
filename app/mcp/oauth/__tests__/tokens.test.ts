// app/mcp/oauth/__tests__/tokens.test.ts
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

// Passthrough spy: the tokens really verify, and the tests can also pin the
// OPTIONS every verification hands jose (the mechanism the plan names).
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, jwtVerify: vi.fn(actual.jwtVerify) };
});

import { SignJWT, decodeJwt, jwtVerify, type JWTPayload } from "jose";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  checkCodeBinding,
  clientHashOf,
  sha256Hex,
  signAccessToken,
  signAuthorizationCode,
  signClientId,
  signRefreshToken,
  verifyAccessToken,
  verifyAuthorizationCode,
  verifyClientId,
  verifyRefreshToken,
} from "../tokens";
import { PREVIEW_ORIGIN, PRODUCTION_ORIGIN, resourceFor } from "../origin";
import { s256Challenge } from "../pkce";

const enc = new TextEncoder();
const KEY = enc.encode("k".repeat(32));
const OTHER_KEY = enc.encode("o".repeat(32));
const O = PRODUCTION_ORIGIN;
const T0 = new Date("2026-09-24T12:00:00Z");
const T0_S = Math.floor(T0.getTime() / 1000);
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(20) + "-._~" + "W".repeat(30);
const CHALLENGE = s256Challenge(VERIFIER);
const MEMBER = "member-abc";
const GRANT = "mcpOauthGrant.3b241101-e2bb-4255-8caf-4136c566a962";

const INVALID = { ok: false, reason: "invalid" };
const EXPIRED = { ok: false, reason: "expired" };

/** Hand-craft a token to exercise claims the module would never mint itself. */
function craft(payload: JWTPayload, key = KEY, alg = "HS256"): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg }).sign(key);
}

async function mintClient(origin = O, key = KEY, now = T0) {
  return signClientId({ key, origin, redirectUris: [CALLBACK], clientName: "Claude", now });
}

async function mintCode(origin = O, key = KEY, now = T0, clientId?: string) {
  return signAuthorizationCode({
    key,
    origin,
    sub: MEMBER,
    clientId: clientId ?? (await mintClient(origin, key, now)),
    redirectUri: CALLBACK,
    codeChallenge: CHALLENGE,
    now,
  });
}

describe("hashing", () => {
  it("clientHashOf is the sha256 hex of the whole client_id string", () => {
    const id = "eyJ.whole.token";
    expect(clientHashOf(id)).toBe(createHash("sha256").update(id, "utf8").digest("hex"));
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("jose options", () => {
  it("every kind pins HS256 and the issuer, and REQUIRES its claims (never 'where present')", async () => {
    const spy = vi.mocked(jwtVerify);
    const lastOptions = () => spy.mock.calls[spy.mock.calls.length - 1][2];
    const clientId = await mintClient();

    await verifyClientId(clientId, { key: KEY, origin: O });
    expect(lastOptions()).toMatchObject({ algorithms: ["HS256"], issuer: O });
    expect(lastOptions()?.requiredClaims).toEqual(expect.arrayContaining(["typ", "iss", "iat"]));

    await verifyAuthorizationCode(await mintCode(O, KEY, T0, clientId), { key: KEY, origin: O, now: T0 });
    expect(lastOptions()).toMatchObject({ algorithms: ["HS256"], issuer: O });
    expect(lastOptions()?.requiredClaims).toEqual(expect.arrayContaining(["typ", "iss", "exp"]));

    const { token } = await signAccessToken({ key: KEY, origin: O, sub: MEMBER, grantId: GRANT, now: T0 });
    await verifyAccessToken(token, { key: KEY, origin: O, now: T0 });
    expect(lastOptions()).toMatchObject({ algorithms: ["HS256"], issuer: O, audience: resourceFor(O) });
    expect(lastOptions()?.requiredClaims).toEqual(expect.arrayContaining(["typ", "iss", "exp", "aud"]));

    const rt = await signRefreshToken({ key: KEY, origin: O, sub: MEMBER, grantId: GRANT, jti: "r", now: T0 });
    await verifyRefreshToken(rt, { key: KEY, origin: O, now: T0 });
    expect(lastOptions()).toMatchObject({ algorithms: ["HS256"], issuer: O });
    expect(lastOptions()?.requiredClaims).toEqual(expect.arrayContaining(["typ", "iss", "exp"]));
  });
});

describe("TTLs", () => {
  it("code 60 s, access 7 d, refresh 30 d", () => {
    expect(CODE_TTL_SECONDS).toBe(60);
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(7 * 24 * 3600);
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(30 * 24 * 3600);
  });
});

describe("client id", () => {
  it("round-trips and carries no expiry", async () => {
    const clientId = await mintClient();
    const payload = decodeJwt(clientId);
    expect(payload).toMatchObject({ typ: "client", iss: O, redirect_uris: [CALLBACK], client_name: "Claude", iat: T0_S });
    expect(payload.exp).toBeUndefined();
    // Years later it still verifies: DCR clients are long-lived.
    const res = await verifyClientId(clientId, { key: KEY, origin: O, now: at(3 * 365 * 24 * 3600) });
    expect(res).toEqual({
      ok: true,
      claims: { redirectUris: [CALLBACK], clientName: "Claude", issuedAt: T0_S },
    });
  });

  it("client_name is optional", async () => {
    const clientId = await signClientId({ key: KEY, origin: O, redirectUris: [CALLBACK], now: T0 });
    const res = await verifyClientId(clientId, { key: KEY, origin: O });
    expect(res.ok && res.claims.clientName).toBeNull();
  });

  it("a client id minted on preview is refused by production", async () => {
    const previewClient = await mintClient(PREVIEW_ORIGIN, KEY);
    expect(await verifyClientId(previewClient, { key: KEY, origin: O })).toEqual(INVALID);
  });

  it("another secret is refused", async () => {
    expect(await verifyClientId(await mintClient(O, OTHER_KEY), { key: KEY, origin: O })).toEqual(INVALID);
  });

  it("requires typ, iss and iat", async () => {
    const base = { typ: "client", iss: O, redirect_uris: [CALLBACK], iat: T0_S };
    for (const drop of ["typ", "iss", "iat"] as const) {
      const payload: JWTPayload = { ...base };
      delete payload[drop];
      expect(await verifyClientId(await craft(payload), { key: KEY, origin: O }), drop).toEqual(INVALID);
    }
  });

  it("requires a non-empty array of string redirect_uris", async () => {
    for (const redirect_uris of [undefined, [], "https://claude.ai/api/mcp/auth_callback", [42]]) {
      const token = await craft({ typ: "client", iss: O, iat: T0_S, redirect_uris });
      expect(await verifyClientId(token, { key: KEY, origin: O })).toEqual(INVALID);
    }
  });

  it("a code presented as a client id is refused", async () => {
    expect(await verifyClientId(await mintCode(), { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });
});

describe("authorization code", () => {
  it("round-trips with every binding and a 60 s expiry", async () => {
    const clientId = await mintClient();
    const code = await mintCode(O, KEY, T0, clientId);
    const res = await verifyAuthorizationCode(code, { key: KEY, origin: O, now: at(59) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.claims).toMatchObject({
      sub: MEMBER,
      clientHash: clientHashOf(clientId),
      redirectUri: CALLBACK,
      codeChallenge: CHALLENGE,
      resource: resourceFor(O),
      expiresAt: T0_S + 60,
    });
    expect(res.claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(decodeJwt(code)).toMatchObject({ typ: "code", iss: O, client: clientHashOf(clientId) });
  });

  it("every code has a fresh jti", async () => {
    const a = decodeJwt(await mintCode());
    const b = decodeJwt(await mintCode());
    expect(a.jti).not.toBe(b.jti);
  });

  it("an expired code is refused as expired", async () => {
    const code = await mintCode();
    expect(await verifyAuthorizationCode(code, { key: KEY, origin: O, now: at(60) })).toEqual(EXPIRED);
    expect(await verifyAuthorizationCode(code, { key: KEY, origin: O, now: at(3600) })).toEqual(EXPIRED);
  });

  it("a code signed with another secret is refused", async () => {
    const code = await mintCode(O, OTHER_KEY);
    expect(await verifyAuthorizationCode(code, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });

  it("a code with a wrong iss is refused (same secret)", async () => {
    const code = await mintCode(PREVIEW_ORIGIN, KEY);
    expect(await verifyAuthorizationCode(code, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });

  it("a client id presented as a code is refused", async () => {
    expect(await verifyAuthorizationCode(await mintClient(), { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });

  it("a missing required claim is refused", async () => {
    const full: JWTPayload = {
      typ: "code",
      iss: O,
      sub: MEMBER,
      client: clientHashOf("c"),
      redirect_uri: CALLBACK,
      code_challenge: CHALLENGE,
      resource: resourceFor(O),
      jti: "11111111-2222-4333-8444-555555555555",
      iat: T0_S,
      exp: T0_S + 60,
    };
    // Sanity check: the full crafted payload verifies.
    expect((await verifyAuthorizationCode(await craft(full), { key: KEY, origin: O, now: T0 })).ok).toBe(true);
    for (const drop of ["typ", "iss", "exp", "sub", "client", "redirect_uri", "code_challenge", "resource", "jti"]) {
      const payload = { ...full };
      delete payload[drop];
      expect(
        await verifyAuthorizationCode(await craft(payload), { key: KEY, origin: O, now: T0 }),
        drop,
      ).toEqual(INVALID);
    }
  });

  it("a code bound to another resource is refused", async () => {
    const token = await craft({
      typ: "code",
      iss: O,
      sub: MEMBER,
      client: clientHashOf("c"),
      redirect_uri: CALLBACK,
      code_challenge: CHALLENGE,
      resource: resourceFor(PREVIEW_ORIGIN),
      jti: "11111111-2222-4333-8444-555555555555",
      exp: T0_S + 60,
    });
    expect(await verifyAuthorizationCode(token, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });
});

describe("checkCodeBinding", () => {
  it("passes when client, redirect_uri and PKCE all match", async () => {
    const clientId = await mintClient();
    const res = await verifyAuthorizationCode(await mintCode(O, KEY, T0, clientId), { key: KEY, origin: O, now: T0 });
    if (!res.ok) throw new Error("setup");
    expect(checkCodeBinding(res.claims, { clientId, redirectUri: CALLBACK, codeVerifier: VERIFIER })).toEqual({ ok: true });
    expect(checkCodeBinding(res.claims, { clientId: clientId + "x", redirectUri: CALLBACK, codeVerifier: VERIFIER })).toEqual({
      ok: false,
      reason: "client_mismatch",
    });
    expect(checkCodeBinding(res.claims, { clientId, redirectUri: CALLBACK + "/", codeVerifier: VERIFIER })).toEqual({
      ok: false,
      reason: "redirect_uri_mismatch",
    });
    expect(checkCodeBinding(res.claims, { clientId, redirectUri: CALLBACK, codeVerifier: "z".repeat(43) })).toEqual({
      ok: false,
      reason: "pkce_mismatch",
    });
    expect(checkCodeBinding(res.claims, { clientId, redirectUri: CALLBACK, codeVerifier: CHALLENGE })).toEqual({
      ok: false,
      reason: "pkce_mismatch",
    });
  });
});

describe("access token", () => {
  it("round-trips with aud = this origin's resource and a 7-day expiry", async () => {
    const { token, expiresIn } = await signAccessToken({ key: KEY, origin: O, sub: MEMBER, grantId: GRANT, now: T0 });
    expect(expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(decodeJwt(token)).toMatchObject({ typ: "at", iss: O, aud: resourceFor(O), sub: MEMBER, grant: GRANT });
    const res = await verifyAccessToken(token, { key: KEY, origin: O, now: at(ACCESS_TOKEN_TTL_SECONDS - 1) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.claims).toMatchObject({
      sub: MEMBER,
      grantId: GRANT,
      resource: resourceFor(O),
      expiresAt: T0_S + ACCESS_TOKEN_TTL_SECONDS,
    });
    expect(await verifyAccessToken(token, { key: KEY, origin: O, now: at(ACCESS_TOKEN_TTL_SECONDS) })).toEqual(EXPIRED);
  });

  it("a token minted on the other deployment fails twice over", async () => {
    const other = await signAccessToken({ key: OTHER_KEY, origin: PREVIEW_ORIGIN, sub: MEMBER, grantId: GRANT, now: T0 });
    expect(await verifyAccessToken(other.token, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
    // Even with a shared secret, iss/aud still refuse it.
    const sameKey = await signAccessToken({ key: KEY, origin: PREVIEW_ORIGIN, sub: MEMBER, grantId: GRANT, now: T0 });
    expect(await verifyAccessToken(sameKey.token, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });

  it("a wrong aud is refused", async () => {
    const base = { typ: "at", iss: O, sub: MEMBER, grant: GRANT, jti: "j", exp: T0_S + 60 };
    for (const aud of [resourceFor(PREVIEW_ORIGIN), resourceFor(O) + "/", O, [resourceFor(O), "https://evil.example/api/mcp"]]) {
      const token = await craft({ ...base, aud });
      expect(await verifyAccessToken(token, { key: KEY, origin: O, now: T0 }), JSON.stringify(aud)).toEqual(INVALID);
    }
    // Missing aud entirely.
    expect(await verifyAccessToken(await craft(base), { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });

  it("a missing required claim is refused", async () => {
    const full: JWTPayload = { typ: "at", iss: O, aud: resourceFor(O), sub: MEMBER, grant: GRANT, jti: "j", exp: T0_S + 60 };
    expect((await verifyAccessToken(await craft(full), { key: KEY, origin: O, now: T0 })).ok).toBe(true);
    for (const drop of ["typ", "iss", "aud", "exp", "sub", "grant", "jti"]) {
      const payload = { ...full };
      delete payload[drop];
      expect(await verifyAccessToken(await craft(payload), { key: KEY, origin: O, now: T0 }), drop).toEqual(INVALID);
    }
  });

  it("a refresh token presented as an access token is refused", async () => {
    const rt = await signRefreshToken({ key: KEY, origin: O, sub: MEMBER, grantId: GRANT, jti: "r1", now: T0 });
    expect(await verifyAccessToken(rt, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
    // …even if someone added the right aud to it.
    const rtWithAud = await craft({ typ: "rt", iss: O, aud: resourceFor(O), sub: MEMBER, grant: GRANT, jti: "r", exp: T0_S + 60 });
    expect(await verifyAccessToken(rtWithAud, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });

  it("an authorization code presented as an access token is refused", async () => {
    expect(await verifyAccessToken(await mintCode(), { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });

  it("only HS256 is accepted", async () => {
    const full = { typ: "at", iss: O, aud: resourceFor(O), sub: MEMBER, grant: GRANT, jti: "j", exp: T0_S + 60 };
    expect(await verifyAccessToken(await craft(full, KEY, "HS512"), { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
    // alg "none": header + payload + empty signature.
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${b64({ alg: "none" })}.${b64(full)}.`;
    expect(await verifyAccessToken(none, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });

  it("garbage never throws", async () => {
    for (const token of ["", "a.b.c", "not-a-jwt", undefined, null, 42, {}] as unknown[]) {
      expect(await verifyAccessToken(token, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
    }
  });

  it("a short key never verifies and never signs", async () => {
    const { token } = await signAccessToken({ key: KEY, origin: O, sub: MEMBER, grantId: GRANT, now: T0 });
    expect(await verifyAccessToken(token, { key: new Uint8Array(0), origin: O, now: T0 })).toEqual(INVALID);
    expect(await verifyAccessToken(token, { key: enc.encode("k".repeat(31)), origin: O, now: T0 })).toEqual(INVALID);
    await expect(
      signAccessToken({ key: enc.encode("k".repeat(31)), origin: O, sub: MEMBER, grantId: GRANT, now: T0 }),
    ).rejects.toThrow();
  });
});

describe("refresh token", () => {
  it("round-trips with the given jti and a 30-day expiry", async () => {
    const rt = await signRefreshToken({ key: KEY, origin: O, sub: MEMBER, grantId: GRANT, jti: "rjti-1", now: T0 });
    const payload = decodeJwt(rt);
    expect(payload).toMatchObject({ typ: "rt", iss: O, sub: MEMBER, grant: GRANT, jti: "rjti-1" });
    expect(payload.aud).toBeUndefined();
    const res = await verifyRefreshToken(rt, { key: KEY, origin: O, now: at(REFRESH_TOKEN_TTL_SECONDS - 1) });
    expect(res).toEqual({
      ok: true,
      claims: { sub: MEMBER, grantId: GRANT, jti: "rjti-1", expiresAt: T0_S + REFRESH_TOKEN_TTL_SECONDS },
    });
    expect(await verifyRefreshToken(rt, { key: KEY, origin: O, now: at(REFRESH_TOKEN_TTL_SECONDS) })).toEqual(EXPIRED);
  });

  it("an access token presented as a refresh token is refused", async () => {
    const { token } = await signAccessToken({ key: KEY, origin: O, sub: MEMBER, grantId: GRANT, now: T0 });
    expect(await verifyRefreshToken(token, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });

  it("wrong secret and wrong iss are refused", async () => {
    const other = await signRefreshToken({ key: OTHER_KEY, origin: O, sub: MEMBER, grantId: GRANT, jti: "r", now: T0 });
    expect(await verifyRefreshToken(other, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
    const preview = await signRefreshToken({ key: KEY, origin: PREVIEW_ORIGIN, sub: MEMBER, grantId: GRANT, jti: "r", now: T0 });
    expect(await verifyRefreshToken(preview, { key: KEY, origin: O, now: T0 })).toEqual(INVALID);
  });

  it("a missing required claim is refused", async () => {
    const full: JWTPayload = { typ: "rt", iss: O, sub: MEMBER, grant: GRANT, jti: "r", exp: T0_S + 60 };
    expect((await verifyRefreshToken(await craft(full), { key: KEY, origin: O, now: T0 })).ok).toBe(true);
    for (const drop of ["typ", "iss", "exp", "sub", "grant", "jti"]) {
      const payload = { ...full };
      delete payload[drop];
      expect(await verifyRefreshToken(await craft(payload), { key: KEY, origin: O, now: T0 }), drop).toEqual(INVALID);
    }
  });
});
