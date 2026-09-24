// `POST /api/oauth/token` — P0 plan step 8, the ONLY place grants are created
// and refresh tokens rotate. Ungated: anyone on the internet can reach it.
//
// The live member record is mocked (repo convention), and
// `sanity/lib/serverClient` is replaced by a small in-memory dataset, so the
// REAL grant store runs underneath the route: a second redemption of one code
// really hits a `create()` conflict, a superseded refresh jti really writes the
// revocation, and a lost revision race really comes back as a 409. That is what
// lets these tests assert the states the spec cares about (O4) — "the grant is
// now revoked", "the grant is NOT revoked" — rather than which mock was called.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The in-memory dataset is shared with the MCP route test (`inMemorySanity.ts`).
const h = await vi.hoisted(async () => {
  const { createInMemorySanity } = await import("./inMemorySanity");
  return { ...createInMemorySanity(), getMemberAccess: vi.fn() };
});

vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));
vi.mock("@/sanity/lib/serverClient", () => ({ writeClient: h.writeClient, serverClient: { fetch: vi.fn() } }));

import { POST } from "@/app/api/oauth/token/route";
import * as tokenRoute from "@/app/api/oauth/token/route";
import { __clearGrantCache } from "@/app/mcp/oauth/grantStore";
import { PREVIEW_ORIGIN, PRODUCTION_ORIGIN, resourceFor } from "@/app/mcp/oauth/origin";
import { s256Challenge } from "@/app/mcp/oauth/pkce";
import { CLAUDE_AI_REDIRECT_URI } from "@/app/mcp/oauth/redirects";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  clientHashOf,
  signAccessToken,
  signAuthorizationCode,
  signClientId,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "@/app/mcp/oauth/tokens";

const SECRET = "s".repeat(32);
const KEY = new TextEncoder().encode(SECRET);
const OTHER_KEY = new TextEncoder().encode("o".repeat(32));
const VERIFIER = "v".repeat(43);
const CHALLENGE = s256Challenge(VERIFIER);
const LOOPBACK_URI = "http://127.0.0.1:51004/callback";
const PREVIEW_HOST = "dev-owt-backstage.vercel.app";
const PRODUCTION_HOST = "owt-backstage.vercel.app";
const MEMBER = "frank";
const FORM = "application/x-www-form-urlencoded";

function liveAccess(role: string | null, active = true) {
  return { active, role, ministries: ["worship"], managesMinistries: [] };
}

function stubEnv(env: { vercelEnv?: string; disabled?: string } = {}) {
  vi.stubEnv("VERCEL_ENV", env.vercelEnv ?? "preview");
  vi.stubEnv("MCP_OAUTH_SECRET", SECRET);
  if (env.disabled !== undefined) vi.stubEnv("MCP_DISABLED", env.disabled);
}

function mintClient(
  opts: { origin?: string; redirectUris?: string[]; key?: Uint8Array } = {},
): Promise<string> {
  return signClientId({
    key: opts.key ?? KEY,
    origin: opts.origin ?? PREVIEW_ORIGIN,
    redirectUris: opts.redirectUris ?? [CLAUDE_AI_REDIRECT_URI, LOOPBACK_URI],
    clientName: "Claude",
  });
}

function mintCode(
  clientId: string,
  opts: { origin?: string; key?: Uint8Array; redirectUri?: string; sub?: string; now?: Date } = {},
): Promise<string> {
  return signAuthorizationCode({
    key: opts.key ?? KEY,
    origin: opts.origin ?? PREVIEW_ORIGIN,
    sub: opts.sub ?? MEMBER,
    clientId,
    redirectUri: opts.redirectUri ?? CLAUDE_AI_REDIRECT_URI,
    codeChallenge: CHALLENGE,
    ...(opts.now ? { now: opts.now } : {}),
  });
}

interface PostOptions {
  host?: string;
  contentType?: string | null; // null omits the header
  contentLength?: string;
  authorization?: string;
}

function post(body: URLSearchParams | string, opts: PostOptions = {}): Request {
  const headers: Record<string, string> = { host: opts.host ?? PREVIEW_HOST };
  if (opts.contentType !== null) headers["content-type"] = opts.contentType ?? FORM;
  if (opts.contentLength !== undefined) headers["content-length"] = opts.contentLength;
  if (opts.authorization !== undefined) headers.authorization = opts.authorization;
  return new Request("https://ignored.example/api/oauth/token", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : body.toString(),
  });
}

function codeForm(fields: { code: string; clientId: string; redirectUri?: string; verifier?: string }): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code: fields.code,
    redirect_uri: fields.redirectUri ?? CLAUDE_AI_REDIRECT_URI,
    client_id: fields.clientId,
    code_verifier: fields.verifier ?? VERIFIER,
  });
}

function refreshForm(refreshToken: string, clientId: string): URLSearchParams {
  return new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
}

interface TokenBody {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

async function expectTokens(res: Response): Promise<TokenBody> {
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("pragma")).toBe("no-cache");
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  const body = (await res.json()) as TokenBody;
  expect(Object.keys(body).sort()).toEqual(["access_token", "expires_in", "refresh_token", "token_type"]);
  expect(body.token_type).toBe("Bearer");
  expect(body.expires_in).toBe(ACCESS_TOKEN_TTL_SECONDS);
  return body;
}

/** RFC 6749 §5.2 error: fixed JSON, no-store, no echo of anything presented. */
async function expectError(res: Response, error: string, status = error === "server_error" ? 500 : 400) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  const text = await res.text();
  expect(text).not.toMatch(/eyJ|Error|at |MCP_|SECRET|Sanity|conflict|v{43}/);
  const body = JSON.parse(text) as Record<string, unknown>;
  expect(body.error).toBe(error);
  for (const key of Object.keys(body)) expect(["error", "error_description"]).toContain(key);
  return body;
}

/** A full code exchange: the tokens and the ids behind them. */
async function exchange(opts: { clientId?: string } = {}) {
  const clientId = opts.clientId ?? (await mintClient());
  const code = await mintCode(clientId);
  const tokens = await expectTokens(await POST(post(codeForm({ code, clientId }))));
  const rt = await verifyRefreshToken(tokens.refresh_token, { key: KEY, origin: PREVIEW_ORIGIN });
  if (!rt.ok) throw new Error("fixture: refresh token did not verify");
  return { clientId, code, tokens, grantId: rt.claims.grantId, refreshJti: rt.claims.jti };
}

function grantDoc(id: string) {
  return h.docs.get(id);
}

let consoleSpies: ReturnType<typeof vi.spyOn>[];

function consoleText(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")))
    .join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.reset();
  __clearGrantCache();
  stubEnv();
  h.getMemberAccess.mockResolvedValue(liveAccess("super-admin"));
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  // Whatever happened, nothing secret-bearing reached a log line.
  expect(consoleText()).not.toMatch(/eyJ|v{43}/);
  vi.unstubAllEnvs();
  for (const spy of consoleSpies) spy.mockRestore();
});

// ── authorization_code ─────────────────────────────────────────────────────

describe("POST /api/oauth/token — authorization_code", () => {
  it("exchanges a code for an access token (aud, sub, grant) and a refresh token on a new grant", async () => {
    const clientId = await mintClient();
    const code = await mintCode(clientId);
    const tokens = await expectTokens(await POST(post(codeForm({ code, clientId }))));

    const at = await verifyAccessToken(tokens.access_token, { key: KEY, origin: PREVIEW_ORIGIN });
    expect(at.ok).toBe(true);
    if (!at.ok) throw new Error("unreachable");
    expect(at.claims.resource).toBe(resourceFor(PREVIEW_ORIGIN));
    expect(at.claims.sub).toBe(MEMBER);
    // ~7 days, from the module's constant.
    expect(at.claims.expiresAt - Math.floor(Date.now() / 1000)).toBeGreaterThan(ACCESS_TOKEN_TTL_SECONDS - 60);

    const rt = await verifyRefreshToken(tokens.refresh_token, { key: KEY, origin: PREVIEW_ORIGIN });
    expect(rt.ok).toBe(true);
    if (!rt.ok) throw new Error("unreachable");
    expect(rt.claims.sub).toBe(MEMBER);
    expect(rt.claims.grantId).toBe(at.claims.grantId);
    expect(rt.claims.expiresAt - Math.floor(Date.now() / 1000)).toBeGreaterThan(REFRESH_TOKEN_TTL_SECONDS - 60);

    // The grant: stored, live, bound to the subject, the client (by hash) and this origin,
    // and its current refresh jti is the one inside the refresh token.
    const grant = grantDoc(at.claims.grantId);
    expect(grant).toMatchObject({
      _type: "mcpOauthGrant",
      sub: MEMBER,
      clientHash: clientHashOf(clientId),
      origin: PREVIEW_ORIGIN,
      revoked: false,
      currentRefreshJti: rt.claims.jti,
    });
    // The code was redeemed exactly once, before the grant was created.
    expect(h.creates.map((d) => d._type)).toEqual(["mcpOauthCodeRedemption", "mcpOauthGrant"]);
    expect(h.getMemberAccess).toHaveBeenCalledWith(MEMBER);
    // Nothing logged on success.
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("accepts the resource when it is sent and equals the code's", async () => {
    const clientId = await mintClient();
    const form = codeForm({ code: await mintCode(clientId), clientId });
    form.set("resource", resourceFor(PREVIEW_ORIGIN));
    await expectTokens(await POST(post(form)));
  });

  it("works on production with the claude callback", async () => {
    stubEnv({ vercelEnv: "production" });
    const clientId = await mintClient({ origin: PRODUCTION_ORIGIN, redirectUris: [CLAUDE_AI_REDIRECT_URI] });
    const code = await mintCode(clientId, { origin: PRODUCTION_ORIGIN });
    const tokens = await expectTokens(await POST(post(codeForm({ code, clientId }), { host: PRODUCTION_HOST })));
    const at = await verifyAccessToken(tokens.access_token, { key: KEY, origin: PRODUCTION_ORIGIN });
    expect(at.ok && at.claims.resource).toBe(resourceFor(PRODUCTION_ORIGIN));
  });

  it("a code is single-use: the second redemption is refused and creates no second grant", async () => {
    const { clientId, code } = await exchange();
    const grantsBefore = h.creates.filter((d) => d._type === "mcpOauthGrant").length;
    await expectError(await POST(post(codeForm({ code, clientId }))), "invalid_grant");
    expect(h.creates.filter((d) => d._type === "mcpOauthGrant").length).toBe(grantsBefore);
  });

  it("a wrong PKCE verifier → invalid_grant, and the code is NOT consumed", async () => {
    const clientId = await mintClient();
    const code = await mintCode(clientId);
    await expectError(await POST(post(codeForm({ code, clientId, verifier: "w".repeat(43) }))), "invalid_grant");
    await expectError(await POST(post(codeForm({ code, clientId, verifier: "short" }))), "invalid_grant");
    expect(h.creates).toEqual([]);
    // The right verifier still works afterwards.
    await expectTokens(await POST(post(codeForm({ code, clientId }))));
  });

  it("a redirect_uri other than the code's → invalid_grant", async () => {
    const clientId = await mintClient();
    const code = await mintCode(clientId); // bound to the claude callback
    await expectError(await POST(post(codeForm({ code, clientId, redirectUri: LOOPBACK_URI }))), "invalid_grant");
    await expectError(
      await POST(post(codeForm({ code, clientId, redirectUri: CLAUDE_AI_REDIRECT_URI + "/" }))),
      "invalid_grant",
    );
    expect(h.creates).toEqual([]);
  });

  it("a redirect_uri equal to the code's but off this origin's allowlist → invalid_grant (loopback on production)", async () => {
    stubEnv({ vercelEnv: "production" });
    const clientId = await mintClient({ origin: PRODUCTION_ORIGIN, redirectUris: [LOOPBACK_URI] });
    const code = await mintCode(clientId, { origin: PRODUCTION_ORIGIN, redirectUri: LOOPBACK_URI });
    const res = await POST(post(codeForm({ code, clientId, redirectUri: LOOPBACK_URI }), { host: PRODUCTION_HOST }));
    await expectError(res, "invalid_grant");
    expect(h.creates).toEqual([]);
  });

  it("a redirect_uri equal to the code's but not one of the client's registered URIs → invalid_grant", async () => {
    const clientId = await mintClient({ redirectUris: [CLAUDE_AI_REDIRECT_URI] });
    const code = await mintCode(clientId, { redirectUri: LOOPBACK_URI }); // allowlisted on preview, not registered
    await expectError(await POST(post(codeForm({ code, clientId, redirectUri: LOOPBACK_URI }))), "invalid_grant");
    expect(h.creates).toEqual([]);
  });

  it("an expired code → invalid_grant", async () => {
    const clientId = await mintClient();
    const code = await mintCode(clientId, { now: new Date(Date.now() - 61_000) });
    await expectError(await POST(post(codeForm({ code, clientId }))), "invalid_grant");
    expect(h.creates).toEqual([]);
  });

  it("a code minted for another client_id → invalid_grant", async () => {
    const mine = await mintClient();
    const theirs = await mintClient({ redirectUris: [CLAUDE_AI_REDIRECT_URI] });
    const code = await mintCode(theirs);
    await expectError(await POST(post(codeForm({ code, clientId: mine }))), "invalid_grant");
    expect(h.creates).toEqual([]);
  });

  it("a code from another origin, or signed with another secret → invalid_grant", async () => {
    const clientId = await mintClient();
    const fromProduction = await mintCode(clientId, { origin: PRODUCTION_ORIGIN });
    await expectError(await POST(post(codeForm({ code: fromProduction, clientId }))), "invalid_grant");
    const otherSecret = await mintCode(clientId, { key: OTHER_KEY });
    await expectError(await POST(post(codeForm({ code: otherSecret, clientId }))), "invalid_grant");
    await expectError(await POST(post(codeForm({ code: "garbage", clientId }))), "invalid_grant");
    expect(h.creates).toEqual([]);
  });

  it("a token of another kind presented as the code → invalid_grant", async () => {
    const clientId = await mintClient();
    const rt = await signRefreshToken({ key: KEY, origin: PREVIEW_ORIGIN, sub: MEMBER, grantId: "g", jti: "j" });
    await expectError(await POST(post(codeForm({ code: rt, clientId }))), "invalid_grant");
    await expectError(await POST(post(codeForm({ code: clientId, clientId }))), "invalid_grant");
  });

  it("a client_id that does not verify for this origin → invalid_client", async () => {
    const good = await mintClient();
    const code = await mintCode(good);
    for (const clientId of [
      "garbage",
      await mintClient({ origin: PRODUCTION_ORIGIN }),
      await mintClient({ key: OTHER_KEY }),
      code, // a code is not a client id
    ]) {
      await expectError(await POST(post(codeForm({ code, clientId }))), "invalid_client");
    }
    expect(h.creates).toEqual([]);
  });

  it("a resource other than the code's → invalid_target, and the code is NOT consumed", async () => {
    const clientId = await mintClient();
    const code = await mintCode(clientId);
    for (const resource of [resourceFor(PRODUCTION_ORIGIN), "", resourceFor(PREVIEW_ORIGIN) + "/"]) {
      const form = codeForm({ code, clientId });
      form.set("resource", resource);
      await expectError(await POST(post(form)), "invalid_target");
    }
    const mixed = codeForm({ code, clientId });
    mixed.append("resource", resourceFor(PREVIEW_ORIGIN));
    mixed.append("resource", resourceFor(PRODUCTION_ORIGIN));
    await expectError(await POST(post(mixed)), "invalid_target");
    expect(h.creates).toEqual([]);
  });

  it("missing required parameters → invalid_request", async () => {
    const clientId = await mintClient();
    const code = await mintCode(clientId);
    for (const drop of ["code", "redirect_uri", "client_id", "code_verifier"]) {
      const form = codeForm({ code, clientId });
      form.delete(drop);
      await expectError(await POST(post(form)), "invalid_request");
      const empty = codeForm({ code, clientId });
      empty.set(drop, "");
      await expectError(await POST(post(empty)), "invalid_request");
    }
    expect(h.creates).toEqual([]);
  });
});

// ── refresh_token ──────────────────────────────────────────────────────────

describe("POST /api/oauth/token — refresh_token", () => {
  it("rotates: new access and refresh tokens, whose jti is the grant's new currentRefreshJti", async () => {
    const { clientId, tokens, grantId, refreshJti } = await exchange();
    const next = await expectTokens(await POST(post(refreshForm(tokens.refresh_token, clientId))));

    const rt = await verifyRefreshToken(next.refresh_token, { key: KEY, origin: PREVIEW_ORIGIN });
    expect(rt.ok).toBe(true);
    if (!rt.ok) throw new Error("unreachable");
    expect(rt.claims.grantId).toBe(grantId);
    expect(rt.claims.sub).toBe(MEMBER);
    expect(rt.claims.jti).not.toBe(refreshJti);
    // The jti in the new token is exactly the one the store patched in, under the revision guard.
    const rotation = h.patches.find((p) => p.set && "currentRefreshJti" in p.set);
    expect(rotation?.ifRevisionId).toBeDefined();
    expect(rotation?.set?.currentRefreshJti).toBe(rt.claims.jti);
    expect(grantDoc(grantId)?.currentRefreshJti).toBe(rt.claims.jti);
    expect(grantDoc(grantId)?.revoked).toBe(false);

    const at = await verifyAccessToken(next.access_token, { key: KEY, origin: PREVIEW_ORIGIN });
    expect(at.ok).toBe(true);
    if (!at.ok) throw new Error("unreachable");
    expect(at.claims).toMatchObject({ sub: MEMBER, grantId, resource: resourceFor(PREVIEW_ORIGIN) });

    // And the rotated token rotates again.
    await expectTokens(await POST(post(refreshForm(next.refresh_token, clientId))));
    expect(h.getMemberAccess).toHaveBeenCalledWith(MEMBER);
  });

  it("accepts the resource when it is this origin's; refuses any other with invalid_target", async () => {
    const { clientId, tokens, grantId } = await exchange();
    const wrong = refreshForm(tokens.refresh_token, clientId);
    wrong.set("resource", resourceFor(PRODUCTION_ORIGIN));
    await expectError(await POST(post(wrong)), "invalid_target");
    expect(grantDoc(grantId)?.revoked).toBe(false);

    const right = refreshForm(tokens.refresh_token, clientId);
    right.set("resource", resourceFor(PREVIEW_ORIGIN));
    await expectTokens(await POST(post(right)));
  });

  it("a superseded refresh jti revokes the WHOLE grant — the winner's new tokens included (O4)", async () => {
    const { clientId, tokens, grantId } = await exchange();
    const next = await expectTokens(await POST(post(refreshForm(tokens.refresh_token, clientId))));

    // The old refresh token again: refused, and the grant is revoked for reuse.
    await expectError(await POST(post(refreshForm(tokens.refresh_token, clientId))), "invalid_grant");
    const revocation = h.patches.find((p) => p.set?.revoked === true);
    expect(revocation?.id).toBe(grantId);
    expect(revocation?.set?.revokedReason).toBe("refresh_token_reuse");
    expect(grantDoc(grantId)?.revoked).toBe(true);

    // The token that won the race is dead too.
    await expectError(await POST(post(refreshForm(next.refresh_token, clientId))), "invalid_grant");
  });

  it("a lost revision race is refused WITHOUT revoking the grant", async () => {
    const { clientId, tokens, grantId } = await exchange();
    // Another instance commits between our fresh read and our patch.
    h.hooks.beforeCommit = () => h.bumpRev(grantId);
    await expectError(await POST(post(refreshForm(tokens.refresh_token, clientId))), "invalid_grant");
    expect(grantDoc(grantId)?.revoked).toBe(false);
    expect(h.patches.some((p) => p.set?.revoked === true)).toBe(false);
  });

  it("a revoked grant → invalid_grant", async () => {
    const { clientId, tokens, grantId } = await exchange();
    grantDoc(grantId)!.revoked = true;
    await expectError(await POST(post(refreshForm(tokens.refresh_token, clientId))), "invalid_grant");
  });

  it("a missing grant → invalid_grant", async () => {
    const { clientId, tokens, grantId } = await exchange();
    h.docs.delete(grantId);
    await expectError(await POST(post(refreshForm(tokens.refresh_token, clientId))), "invalid_grant");
    // Never written back into existence.
    expect(h.docs.has(grantId)).toBe(false);
  });

  it("the grant is read fresh, never from the 30 s cache", async () => {
    const { clientId, tokens, grantId } = await exchange();
    // Prime the cache with the live grant, then revoke it behind the cache's back.
    const { loadGrant } = await import("@/app/mcp/oauth/grantStore");
    expect((await loadGrant(grantId)).ok).toBe(true);
    grantDoc(grantId)!.revoked = true;
    await expectError(await POST(post(refreshForm(tokens.refresh_token, clientId))), "invalid_grant");
  });

  it("a client_id other than the grant's → invalid_grant, grant untouched", async () => {
    const { tokens, grantId } = await exchange();
    const other = await mintClient({ redirectUris: [CLAUDE_AI_REDIRECT_URI] });
    await expectError(await POST(post(refreshForm(tokens.refresh_token, other))), "invalid_grant");
    expect(grantDoc(grantId)?.revoked).toBe(false);
    expect(h.patches).toEqual([]);
  });

  it("a client_id that does not verify for this origin → invalid_client", async () => {
    const { tokens } = await exchange();
    for (const clientId of ["garbage", await mintClient({ origin: PRODUCTION_ORIGIN })]) {
      await expectError(await POST(post(refreshForm(tokens.refresh_token, clientId))), "invalid_client");
    }
    expect(h.patches).toEqual([]);
  });

  it("the grant's subject must be the refresh token's subject (R13)", async () => {
    const { clientId, grantId, refreshJti } = await exchange();
    // A validly signed refresh token naming this grant and its current jti, for someone else.
    const forged = await signRefreshToken({ key: KEY, origin: PREVIEW_ORIGIN, sub: "mallory", grantId, jti: refreshJti });
    await expectError(await POST(post(refreshForm(forged, clientId))), "invalid_grant");
    expect(grantDoc(grantId)?.revoked).toBe(false);
    expect(grantDoc(grantId)?.currentRefreshJti).toBe(refreshJti);
    expect(h.getMemberAccess).not.toHaveBeenCalledWith("mallory");
  });

  it("a grant issued by another origin is refused and NOT revoked (R9)", async () => {
    const { clientId, tokens, grantId } = await exchange();
    grantDoc(grantId)!.origin = PRODUCTION_ORIGIN;
    await expectError(await POST(post(refreshForm(tokens.refresh_token, clientId))), "invalid_grant");
    expect(grantDoc(grantId)?.revoked).toBe(false);
  });

  it("an invalid, expired, foreign or wrong-kind refresh token → invalid_grant, no store read", async () => {
    const { clientId, tokens, grantId, refreshJti } = await exchange();
    const fetchSpy = vi.spyOn(h.writeClient, "fetch");
    const candidates = [
      "garbage",
      tokens.access_token, // an access token is not a refresh token
      await signRefreshToken({
        key: KEY,
        origin: PREVIEW_ORIGIN,
        sub: MEMBER,
        grantId,
        jti: refreshJti,
        now: new Date(Date.now() - (REFRESH_TOKEN_TTL_SECONDS + 60) * 1000),
      }),
      await signRefreshToken({ key: OTHER_KEY, origin: PREVIEW_ORIGIN, sub: MEMBER, grantId, jti: refreshJti }),
      await signRefreshToken({ key: KEY, origin: PRODUCTION_ORIGIN, sub: MEMBER, grantId, jti: refreshJti }),
      // R12 at the route: an EXPIRED access token presented as a refresh token.
      (
        await signAccessToken({
          key: KEY,
          origin: PREVIEW_ORIGIN,
          sub: MEMBER,
          grantId,
          now: new Date(Date.now() - (ACCESS_TOKEN_TTL_SECONDS + 60) * 1000),
        })
      ).token,
    ];
    for (const rt of candidates) {
      await expectError(await POST(post(refreshForm(rt, clientId))), "invalid_grant");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(grantDoc(grantId)?.revoked).toBe(false);
    fetchSpy.mockRestore();
  });

  it("missing required parameters → invalid_request", async () => {
    const { clientId, tokens } = await exchange();
    for (const drop of ["refresh_token", "client_id"]) {
      const form = refreshForm(tokens.refresh_token, clientId);
      form.delete(drop);
      await expectError(await POST(post(form)), "invalid_request");
    }
  });
});

// ── the subject, at both grants ────────────────────────────────────────────

describe("POST /api/oauth/token — the subject must still be a live super-admin", () => {
  const refusals: [string, ReturnType<typeof liveAccess>][] = [
    ["demoted to admin", liveAccess("admin")],
    ["a member", liveAccess("member")],
    ["no role", liveAccess(null)],
    ["disabled", liveAccess("super-admin", false)],
  ];

  it.each(refusals)("authorization_code: %s → invalid_grant, code not consumed, no grant", async (_label, access) => {
    const clientId = await mintClient();
    const code = await mintCode(clientId);
    h.getMemberAccess.mockResolvedValue(access);
    await expectError(await POST(post(codeForm({ code, clientId }))), "invalid_grant");
    expect(h.getMemberAccess).toHaveBeenCalledWith(MEMBER);
    expect(h.creates).toEqual([]);
  });

  it.each(refusals)("refresh_token: %s → invalid_grant, nothing rotated", async (_label, access) => {
    const { clientId, tokens, grantId, refreshJti } = await exchange();
    h.getMemberAccess.mockResolvedValue(access);
    await expectError(await POST(post(refreshForm(tokens.refresh_token, clientId))), "invalid_grant");
    expect(grantDoc(grantId)?.currentRefreshJti).toBe(refreshJti);
    expect(h.patches).toEqual([]);
  });
});

// ── server failures ────────────────────────────────────────────────────────

describe("POST /api/oauth/token — server failures are a fixed server_error", () => {
  it("a redemption write that fails for any reason but a replay → 500, no grant", async () => {
    const clientId = await mintClient();
    h.failNext.create = Object.assign(new Error("Sanity said something internal about eyJsecret"), { statusCode: 503 });
    await expectError(await POST(post(codeForm({ code: await mintCode(clientId), clientId }))), "server_error");
    expect(h.creates).toEqual([]);
  });

  it("an untyped 409 on redemption is a server_error, not a replay", async () => {
    const clientId = await mintClient();
    h.failNext.create = Object.assign(new Error("conflict"), { statusCode: 409 });
    // sanityConflictKind → "conflict", not "already_exists".
    await expectError(await POST(post(codeForm({ code: await mintCode(clientId), clientId }))), "server_error");
  });

  it("the grant create failing → 500, no tokens", async () => {
    const clientId = await mintClient();
    const code = await mintCode(clientId);
    // First create (redemption) succeeds; the grant create fails.
    const realCreate = h.writeClient.create;
    let calls = 0;
    const spy = vi.spyOn(h.writeClient, "create").mockImplementation(async (doc) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error("boom"), { statusCode: 500 });
      return realCreate.call(h.writeClient, doc);
    });
    await expectError(await POST(post(codeForm({ code, clientId }))), "server_error");
    spy.mockRestore();
  });

  it("a grant read failing → 500", async () => {
    const { clientId, tokens } = await exchange();
    h.failNext.fetch = new Error("network");
    await expectError(await POST(post(refreshForm(tokens.refresh_token, clientId))), "server_error");
  });

  it("a rotation write failing with a non-conflict error → 500, grant not revoked", async () => {
    const { clientId, tokens, grantId } = await exchange();
    h.failNext.commit = Object.assign(new Error("boom"), { statusCode: 500 });
    await expectError(await POST(post(refreshForm(tokens.refresh_token, clientId))), "server_error");
    expect(grantDoc(grantId)?.revoked).toBe(false);
  });

  it("the member lookup throwing → 500 at both grants", async () => {
    const clientId = await mintClient();
    h.getMemberAccess.mockRejectedValue(new Error("sanity down"));
    await expectError(await POST(post(codeForm({ code: await mintCode(clientId), clientId }))), "server_error");
    expect(h.creates).toEqual([]);

    h.getMemberAccess.mockResolvedValue(liveAccess("super-admin"));
    const { clientId: c2, tokens } = await exchange();
    h.getMemberAccess.mockRejectedValue(new Error("sanity down"));
    await expectError(await POST(post(refreshForm(tokens.refresh_token, c2))), "server_error");
  });
});

// ── request shape ──────────────────────────────────────────────────────────

describe("POST /api/oauth/token — request shape", () => {
  it("a wrong or missing Content-Type → invalid_request", async () => {
    const clientId = await mintClient();
    const form = codeForm({ code: await mintCode(clientId), clientId });
    for (const contentType of ["application/json", "text/plain", "multipart/form-data", null]) {
      await expectError(await POST(post(form, { contentType })), "invalid_request");
    }
    expect(h.creates).toEqual([]);
  });

  it("a charset parameter on the form media type is fine", async () => {
    const clientId = await mintClient();
    const form = codeForm({ code: await mintCode(clientId), clientId });
    await expectTokens(await POST(post(form, { contentType: `${FORM}; charset=UTF-8` })));
  });

  it("a duplicated parameter → invalid_request", async () => {
    const clientId = await mintClient();
    const code = await mintCode(clientId);
    for (const [name, value] of [
      ["grant_type", "authorization_code"],
      ["code", code],
      ["redirect_uri", CLAUDE_AI_REDIRECT_URI],
      ["client_id", clientId],
      ["code_verifier", VERIFIER],
    ] as const) {
      const form = codeForm({ code, clientId });
      form.append(name, value);
      await expectError(await POST(post(form)), "invalid_request");
    }
    const { tokens } = await exchange({ clientId });
    const twice = refreshForm(tokens.refresh_token, clientId);
    twice.append("refresh_token", tokens.refresh_token);
    await expectError(await POST(post(twice)), "invalid_request");
  });

  it("a client_secret parameter → 400 invalid_client, no challenge (public clients only)", async () => {
    const clientId = await mintClient();
    const form = codeForm({ code: await mintCode(clientId), clientId });
    form.set("client_secret", "anything");
    const res = await POST(post(form));
    expect(res.headers.get("www-authenticate")).toBeNull();
    await expectError(res, "invalid_client");
    const empty = codeForm({ code: await mintCode(clientId), clientId });
    empty.set("client_secret", "");
    await expectError(await POST(post(empty)), "invalid_client");
    expect(h.creates).toEqual([]);
  });

  it("an Authorization: Basic header → 401 invalid_client with a Basic challenge (RFC 6749 §5.2)", async () => {
    // The client attempted authentication through the Authorization header,
    // so §5.2 owes a 401 whose WWW-Authenticate names the scheme it used.
    const clientId = await mintClient();
    const form = codeForm({ code: await mintCode(clientId), clientId });
    for (const authorization of ["Basic Y2xpZW50OnNlY3JldA==", "basic Y2xpZW50OnNlY3JldA==", "BASIC"]) {
      const res = await POST(post(form, { authorization }));
      expect(res.headers.get("www-authenticate"), authorization).toBe('Basic realm="owt-backstage"');
      const body = await expectError(res, "invalid_client", 401);
      expect(body.error_description).toBe("client authentication is not supported: clients are public");
    }
    // Basic AND a client_secret: the header was still attempted, so still the 401.
    const both = codeForm({ code: await mintCode(clientId), clientId });
    both.set("client_secret", "anything");
    await expectError(await POST(post(both, { authorization: "Basic Y2xpZW50OnNlY3JldA==" })), "invalid_client", 401);
    expect(h.creates).toEqual([]);
  });

  it("every other invalid_client stays a 400 without a challenge", async () => {
    // A client id this origin never minted.
    const foreign = await mintClient({ key: OTHER_KEY });
    const res = await POST(post(codeForm({ code: await mintCode(foreign), clientId: foreign })));
    expect(res.headers.get("www-authenticate")).toBeNull();
    await expectError(res, "invalid_client");
    // Another scheme in the header is not client authentication — the Bearer
    // here is ignored and the exchange proceeds.
    const clientId = await mintClient();
    const bearer = await POST(post(codeForm({ code: await mintCode(clientId), clientId }), { authorization: "Bearer x" }));
    expect(bearer.headers.get("www-authenticate")).toBeNull();
    await expectTokens(bearer);
  });

  it("an unsupported grant_type → unsupported_grant_type; a missing one → invalid_request", async () => {
    for (const grantType of ["password", "client_credentials", "implicit", "AUTHORIZATION_CODE"]) {
      await expectError(
        await POST(post(new URLSearchParams({ grant_type: grantType }))),
        "unsupported_grant_type",
      );
    }
    await expectError(await POST(post(new URLSearchParams({ code: "x" }))), "invalid_request");
    await expectError(await POST(post(new URLSearchParams({ grant_type: "" }))), "invalid_request");
    await expectError(await POST(post("")), "invalid_request");
  });

  it("an oversized declared Content-Length → invalid_request without reading", async () => {
    const clientId = await mintClient();
    const form = codeForm({ code: await mintCode(clientId), clientId });
    await expectError(await POST(post(form, { contentLength: String(1024 * 1024) })), "invalid_request");
  });

  it("an oversized body actually read → invalid_request", async () => {
    const clientId = await mintClient();
    const form = codeForm({ code: await mintCode(clientId), clientId });
    form.set("padding", "x".repeat(64 * 1024));
    await expectError(await POST(post(form)), "invalid_request");
    expect(h.creates).toEqual([]);
  });

  it("a body that is not UTF-8 → invalid_request", async () => {
    const req = new Request("https://ignored.example/api/oauth/token", {
      method: "POST",
      headers: { host: PREVIEW_HOST, "content-type": FORM },
      body: new Uint8Array([0x61, 0x3d, 0xff, 0xfe]),
    });
    await expectError(await POST(req), "invalid_request");
  });

  it("unknown parameters (scope included) are ignored", async () => {
    const clientId = await mintClient();
    const form = codeForm({ code: await mintCode(clientId), clientId });
    form.set("scope", "anything");
    form.set("unknown", "x");
    await expectTokens(await POST(post(form)));
  });
});

// ── preflight, headers, route shape ────────────────────────────────────────

describe("/api/oauth/token — preflight and route shape", () => {
  it("MCP_DISABLED → 503 before anything else", async () => {
    stubEnv({ disabled: "1" });
    const clientId = await mintClient();
    const res = await POST(post(codeForm({ code: await mintCode(clientId), clientId })));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.creates).toEqual([]);
    expect(h.getMemberAccess).not.toHaveBeenCalled();
  });

  it("a non-canonical host → 404", async () => {
    const clientId = await mintClient();
    const res = await POST(
      post(codeForm({ code: await mintCode(clientId), clientId }), {
        host: "owt-backstage-abc123-frank-rochas-projects.vercel.app",
      }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(h.creates).toEqual([]);
  });

  it("the preflight runs before the body is even looked at", async () => {
    stubEnv({ disabled: "1" });
    expect((await POST(post("garbage", { contentType: "text/plain" }))).status).toBe(503);
  });

  it("exports POST only, and is dynamic", () => {
    const exported = Object.keys(tokenRoute).filter((k) => /^(GET|HEAD|PUT|PATCH|DELETE|OPTIONS|POST)$/.test(k));
    expect(exported).toEqual(["POST"]);
    expect(tokenRoute.dynamic).toBe("force-dynamic");
  });
});
