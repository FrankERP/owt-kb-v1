// `POST /api/oauth/authorize` — P0 plan step 7, the ONLY thing that mints an
// authorization code.
//
// Registration is open to anyone, so the property this file exists for is the
// confused-deputy defence (spec O8): a code is issued only on an explicit
// «Permitir» POST, from a live super-admin who is not impersonating, whose
// fields re-validate from scratch (the page is never trusted), and nothing is
// remembered between requests. The session guard and the live member record
// are mocked (the repo convention — never `getServerSession`), and
// `sanity/lib/serverClient` is mocked only so a write would be SEEN: minting a
// code writes nothing.

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  getMemberAccess: vi.fn(),
  writeClientCreate: vi.fn(),
  writeClientPatch: vi.fn(),
  serverClientFetch: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({ requireActiveSession: () => h.requireActiveSession() }));
vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));
vi.mock("@/sanity/lib/serverClient", () => ({
  writeClient: { create: h.writeClientCreate, patch: h.writeClientPatch },
  serverClient: { fetch: h.serverClientFetch },
}));

import { GET, POST } from "@/app/api/oauth/authorize/route";
import { authorizeFormFields, validateAuthorizeRequest } from "@/app/mcp/oauth/authorizeRequest";
import { PREVIEW_ORIGIN, PRODUCTION_ORIGIN, resourceFor } from "@/app/mcp/oauth/origin";
import { s256Challenge } from "@/app/mcp/oauth/pkce";
import { CLAUDE_AI_REDIRECT_URI } from "@/app/mcp/oauth/redirects";
import { clientHashOf, signClientId, verifyAuthorizationCode } from "@/app/mcp/oauth/tokens";
import { walkImportClosure } from "@/app/mcp/oauth/__tests__/importClosure";

const SECRET = "s".repeat(32);
const KEY = new TextEncoder().encode(SECRET);
const VERIFIER = "v".repeat(43);
const CHALLENGE = s256Challenge(VERIFIER);
const LOOPBACK_URI = "http://127.0.0.1:51004/callback";
const PREVIEW_HOST = "dev-owt-backstage.vercel.app";
const PRODUCTION_HOST = "owt-backstage.vercel.app";

const SUPER_ADMIN_SESSION = { user: { sanityId: "frank", role: "super-admin", isImpersonating: false } };

function liveAccess(role: string | null, active = true) {
  return { active, role, ministries: ["worship"], managesMinistries: [] };
}

function stubEnv(env: { vercelEnv?: string; disabled?: string } = {}) {
  vi.stubEnv("VERCEL_ENV", env.vercelEnv ?? "preview");
  vi.stubEnv("MCP_OAUTH_SECRET", SECRET);
  if (env.disabled !== undefined) vi.stubEnv("MCP_DISABLED", env.disabled);
}

async function clientId(origin = PREVIEW_ORIGIN, redirectUris = [CLAUDE_AI_REDIRECT_URI, LOOPBACK_URI]) {
  return signClientId({ key: KEY, origin, redirectUris, clientName: "Claude" });
}

/**
 * Exactly what the consent page posts: the validated request's hidden fields
 * (from the SAME helper the page renders them with) plus the pressed button.
 */
async function pageForm(
  opts: { origin?: string; state?: string | null; redirectUri?: string; decision?: string | null; clientId?: string } = {},
): Promise<URLSearchParams> {
  const origin = opts.origin ?? PREVIEW_ORIGIN;
  const query = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId ?? (await clientId(origin)),
    redirect_uri: opts.redirectUri ?? CLAUDE_AI_REDIRECT_URI,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
  });
  if (opts.state !== null) query.set("state", opts.state ?? "st-123");
  const validated = await validateAuthorizeRequest(query, { origin, key: KEY });
  if (validated.kind !== "render") throw new Error(`fixture did not validate: ${validated.kind}`);
  const form = new URLSearchParams(authorizeFormFields(validated.request));
  if (opts.decision !== null) form.append("decision", opts.decision ?? "allow");
  return form;
}

interface PostOptions {
  host?: string;
  origin?: string | null; // null omits the header
  contentType?: string | null;
  contentLength?: string;
}

function post(body: URLSearchParams | string, opts: PostOptions = {}): Request {
  const headers: Record<string, string> = { host: opts.host ?? PREVIEW_HOST };
  if (opts.contentType !== null) headers["content-type"] = opts.contentType ?? "application/x-www-form-urlencoded";
  if (opts.origin !== null) headers.origin = opts.origin ?? PREVIEW_ORIGIN;
  if (opts.contentLength !== undefined) headers["content-length"] = opts.contentLength;
  return new Request("https://ignored.example/api/oauth/authorize", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : body.toString(),
  });
}

/** Asserts a refusal shown to the human: JSON, no-store, and NO redirect anywhere. */
async function expectNoRedirect(res: Response, status: number): Promise<Record<string, unknown>> {
  expect(res.status).toBe(status);
  expect(res.headers.get("location")).toBeNull();
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  const text = await res.text();
  expect(text).not.toMatch(/eyJ|Error|at |MCP_|SECRET/);
  return JSON.parse(text) as Record<string, unknown>;
}

function expectSeeOther(res: Response): URL {
  expect(res.status).toBe(303);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const location = res.headers.get("location");
  expect(location).not.toBeNull();
  return new URL(location!);
}

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  vi.clearAllMocks();
  stubEnv();
  h.requireActiveSession.mockResolvedValue(SUPER_ADMIN_SESSION);
  h.getMemberAccess.mockResolvedValue(liveAccess("super-admin"));
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("POST /api/oauth/authorize — «Permitir» mints a code", () => {
  it("303s to the verified redirect_uri with code, state and iss; the code verifies and is bound to the request", async () => {
    const id = await clientId();
    const res = await POST(post(await pageForm({ clientId: id })));
    const url = expectSeeOther(res);
    expect(url.origin + url.pathname).toBe(CLAUDE_AI_REDIRECT_URI);
    expect([...url.searchParams.keys()]).toEqual(["code", "state", "iss"]);
    expect(url.searchParams.get("state")).toBe("st-123");
    expect(url.searchParams.get("iss")).toBe(PREVIEW_ORIGIN);

    const verified = await verifyAuthorizationCode(url.searchParams.get("code"), { key: KEY, origin: PREVIEW_ORIGIN });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");
    expect(verified.claims.sub).toBe("frank");
    expect(verified.claims.clientHash).toBe(clientHashOf(id));
    expect(verified.claims.redirectUri).toBe(CLAUDE_AI_REDIRECT_URI);
    expect(verified.claims.codeChallenge).toBe(CHALLENGE);
    expect(verified.claims.resource).toBe(resourceFor(PREVIEW_ORIGIN));
    // 60 s, not a second more.
    expect(verified.claims.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(60);
  });

  it("works on production with the claude callback, and the code is production's", async () => {
    stubEnv({ vercelEnv: "production" });
    const res = await POST(
      post(await pageForm({ origin: PRODUCTION_ORIGIN }), { host: PRODUCTION_HOST, origin: PRODUCTION_ORIGIN }),
    );
    const url = expectSeeOther(res);
    expect(url.searchParams.get("iss")).toBe(PRODUCTION_ORIGIN);
    const onProd = await verifyAuthorizationCode(url.searchParams.get("code"), { key: KEY, origin: PRODUCTION_ORIGIN });
    expect(onProd.ok).toBe(true);
    const onPreview = await verifyAuthorizationCode(url.searchParams.get("code"), { key: KEY, origin: PREVIEW_ORIGIN });
    expect(onPreview.ok).toBe(false);
  });

  it("the loopback redirect (preview) keeps its own query and gets the code appended", async () => {
    const withQuery = "http://127.0.0.1:51004/callback?session=x%202";
    const id = await clientId(PREVIEW_ORIGIN, [withQuery]);
    const res = await POST(post(await pageForm({ clientId: id, redirectUri: withQuery })));
    const location = res.headers.get("location")!;
    expect(res.status).toBe(303);
    expect(location.startsWith(withQuery + "&code=")).toBe(true);
  });

  it("no state in the request → none in the response", async () => {
    const url = expectSeeOther(await POST(post(await pageForm({ state: null }))));
    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.has("code")).toBe(true);
  });

  it("writes nothing and logs nothing — no code, no client_id, no state", async () => {
    const res = await POST(post(await pageForm({ state: "private-state" })));
    expect(res.status).toBe(303);
    expect(h.writeClientCreate).not.toHaveBeenCalled();
    expect(h.writeClientPatch).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("the code's subject is the session's member id and the role that decides is the LIVE one", async () => {
    // A stale session copy saying "member" does not block a live super-admin…
    h.requireActiveSession.mockResolvedValue({ user: { sanityId: "frank", role: "member", isImpersonating: false } });
    const ok = await POST(post(await pageForm()));
    expect(ok.status).toBe(303);
    expect(h.getMemberAccess).toHaveBeenCalledWith("frank");

    // …and a stale session copy saying "super-admin" does not let a demoted member through.
    h.requireActiveSession.mockResolvedValue(SUPER_ADMIN_SESSION);
    h.getMemberAccess.mockResolvedValue(liveAccess("admin"));
    await expectNoRedirect(await POST(post(await pageForm())), 403);
  });
});

describe("POST /api/oauth/authorize — «Cancelar»", () => {
  it("303s with error=access_denied, state and iss, and no code", async () => {
    const url = expectSeeOther(await POST(post(await pageForm({ decision: "deny" }))));
    expect(url.origin + url.pathname).toBe(CLAUDE_AI_REDIRECT_URI);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("st-123");
    expect(url.searchParams.get("iss")).toBe(PREVIEW_ORIGIN);
    expect(url.searchParams.has("code")).toBe(false);
  });
});

describe("POST /api/oauth/authorize — the decision field", () => {
  it("missing, unknown or duplicated → 400, no redirect", async () => {
    await expectNoRedirect(await POST(post(await pageForm({ decision: null }))), 400);
    await expectNoRedirect(await POST(post(await pageForm({ decision: "maybe" }))), 400);
    await expectNoRedirect(await POST(post(await pageForm({ decision: "ALLOW" }))), 400);
    const both = await pageForm({ decision: "allow" });
    both.append("decision", "deny");
    await expectNoRedirect(await POST(post(both)), 400);
    const twice = await pageForm({ decision: "allow" });
    twice.append("decision", "allow");
    await expectNoRedirect(await POST(post(twice)), 400);
  });
});

describe("POST /api/oauth/authorize — the session (never redirected to the client)", () => {
  it.each(["member", "admin", "content-editor", null])("a live %s → 403", async (role) => {
    h.getMemberAccess.mockResolvedValue(liveAccess(role));
    const body = await expectNoRedirect(await POST(post(await pageForm())), 403);
    expect(body).toEqual({ error: "forbidden" });
  });

  it("an inactive member record → 403", async () => {
    h.getMemberAccess.mockResolvedValue(liveAccess("super-admin", false));
    await expectNoRedirect(await POST(post(await pageForm())), 403);
  });

  it("an impersonating super-admin → 403, whatever the target's role", async () => {
    h.requireActiveSession.mockResolvedValue({
      user: { sanityId: "target", role: "super-admin", isImpersonating: true },
    });
    const body = await expectNoRedirect(await POST(post(await pageForm())), 403);
    expect(body).toEqual({ error: "forbidden" });
  });

  it("no session → 401", async () => {
    h.requireActiveSession.mockResolvedValue(null);
    const body = await expectNoRedirect(await POST(post(await pageForm())), 401);
    expect(body).toEqual({ error: "unauthorized" });
  });

  it("a non-super-admin is refused even where the request itself would earn an error redirect", async () => {
    h.getMemberAccess.mockResolvedValue(liveAccess("member"));
    const form = await pageForm();
    form.set("code_challenge_method", "plain");
    await expectNoRedirect(await POST(post(form)), 403);
    form.set("decision", "deny");
    await expectNoRedirect(await POST(post(form)), 403);
  });
});

describe("POST /api/oauth/authorize — never trusts the page", () => {
  it("a tampered redirect_uri → 400, never followed", async () => {
    const form = await pageForm();
    form.set("redirect_uri", "https://evil.example/cb");
    const res = await POST(post(form));
    await expectNoRedirect(res, 400);
  });

  it("a redirect_uri the client registered but this origin does not allow → 400 (production, loopback)", async () => {
    stubEnv({ vercelEnv: "production" });
    const id = await signClientId({ key: KEY, origin: PRODUCTION_ORIGIN, redirectUris: [LOOPBACK_URI] });
    const form = new URLSearchParams({
      response_type: "code",
      client_id: id,
      redirect_uri: LOOPBACK_URI,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      decision: "allow",
    });
    await expectNoRedirect(await POST(post(form, { host: PRODUCTION_HOST, origin: PRODUCTION_ORIGIN })), 400);
  });

  it("a tampered or foreign client_id → 400", async () => {
    const form = await pageForm();
    form.set("client_id", "garbage");
    await expectNoRedirect(await POST(post(form)), 400);

    const foreign = await pageForm();
    foreign.set("client_id", await clientId(PRODUCTION_ORIGIN, [CLAUDE_AI_REDIRECT_URI]));
    await expectNoRedirect(await POST(post(foreign)), 400);
  });

  it("a duplicated redirect_uri → 400", async () => {
    const form = await pageForm();
    form.append("redirect_uri", CLAUDE_AI_REDIRECT_URI);
    await expectNoRedirect(await POST(post(form)), 400);
  });

  it("plain PKCE posted directly → an error redirect, never a code", async () => {
    const form = await pageForm();
    form.set("code_challenge_method", "plain");
    const url = expectSeeOther(await POST(post(form)));
    expect(url.searchParams.get("error")).toBe("invalid_request");
    expect(url.searchParams.has("code")).toBe(false);
  });

  it("a foreign resource posted directly → invalid_target, never a code", async () => {
    const form = await pageForm();
    form.set("resource", resourceFor(PRODUCTION_ORIGIN));
    const url = expectSeeOther(await POST(post(form)));
    expect(url.searchParams.get("error")).toBe("invalid_target");
    expect(url.searchParams.has("code")).toBe(false);
  });
});

describe("POST /api/oauth/authorize — consent is never remembered (O8)", () => {
  it("a returning client needs its own «Permitir» every time", async () => {
    const id = await clientId();
    const first = expectSeeOther(await POST(post(await pageForm({ clientId: id }))));
    const second = expectSeeOther(await POST(post(await pageForm({ clientId: id }))));
    // Two approvals, two distinct single-use codes.
    expect(first.searchParams.get("code")).not.toBe(second.searchParams.get("code"));

    // A third request from the same client with no approval gets no code…
    await expectNoRedirect(await POST(post(await pageForm({ clientId: id, decision: null }))), 400);
    // …and a «Cancelar» after two approvals is still a denial.
    const denied = expectSeeOther(await POST(post(await pageForm({ clientId: id, decision: "deny" }))));
    expect(denied.searchParams.get("error")).toBe("access_denied");
    expect(denied.searchParams.has("code")).toBe(false);
  });
});

describe("POST /api/oauth/authorize — Origin (R16)", () => {
  it("a foreign Origin → 403, no redirect", async () => {
    for (const origin of ["https://evil.example", PRODUCTION_ORIGIN, "null", ""]) {
      const res = await POST(post(await pageForm(), { origin }));
      await expectNoRedirect(res, 403);
    }
  });

  it("an absent Origin is allowed (the header is optional); the canonical one is allowed", async () => {
    expect((await POST(post(await pageForm(), { origin: null }))).status).toBe(303);
    expect((await POST(post(await pageForm(), { origin: PREVIEW_ORIGIN }))).status).toBe(303);
  });

  it("the Origin check runs before the session is read", async () => {
    await POST(post(await pageForm(), { origin: "https://evil.example" }));
    expect(h.requireActiveSession).not.toHaveBeenCalled();
  });
});

describe("POST /api/oauth/authorize — body handling", () => {
  it("a wrong or missing Content-Type → 400", async () => {
    const form = await pageForm();
    await expectNoRedirect(await POST(post(form, { contentType: "application/json" })), 400);
    await expectNoRedirect(await POST(post(form, { contentType: "text/plain" })), 400);
    await expectNoRedirect(await POST(post(form, { contentType: null })), 400);
  });

  it("a charset parameter on the form media type is fine", async () => {
    const res = await POST(post(await pageForm(), { contentType: "application/x-www-form-urlencoded; charset=UTF-8" }));
    expect(res.status).toBe(303);
  });

  it("an oversized declared Content-Length → 400 without reading", async () => {
    await expectNoRedirect(await POST(post(await pageForm(), { contentLength: String(1024 * 1024) })), 400);
  });

  it("an oversized body actually read → 400", async () => {
    const form = await pageForm();
    form.set("padding", "x".repeat(64 * 1024));
    await expectNoRedirect(await POST(post(form)), 400);
  });

  it("a body that is not UTF-8 → 400", async () => {
    const req = new Request("https://ignored.example/api/oauth/authorize", {
      method: "POST",
      headers: { host: PREVIEW_HOST, "content-type": "application/x-www-form-urlencoded", origin: PREVIEW_ORIGIN },
      body: new Uint8Array([0x61, 0x3d, 0xff, 0xfe]),
    });
    await expectNoRedirect(await POST(req), 400);
  });
});

describe("/api/oauth/authorize — preflight and GET", () => {
  it("MCP_DISABLED → 503 before anything else", async () => {
    stubEnv({ disabled: "1" });
    const res = await POST(post(await pageForm()));
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
    expect(h.requireActiveSession).not.toHaveBeenCalled();
  });

  it("a non-canonical host → 404", async () => {
    const res = await POST(post(await pageForm(), { host: "owt-backstage-abc123-frank-rochas-projects.vercel.app" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(h.requireActiveSession).not.toHaveBeenCalled();
  });

  it("GET never issues a code: 405 with Allow: POST, even with a valid query and a super-admin session", async () => {
    const query = await pageForm();
    const res = await GET(
      new Request(`https://ignored.example/api/oauth/authorize?${query}`, { headers: { host: PREVIEW_HOST } }),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.requireActiveSession).not.toHaveBeenCalled();
  });

  it("GET still answers the preflight first (kill switch, foreign host)", async () => {
    stubEnv({ disabled: "1" });
    expect((await GET(new Request("https://ignored.example/", { headers: { host: PREVIEW_HOST } }))).status).toBe(503);
    vi.unstubAllEnvs();
    stubEnv();
    expect((await GET(new Request("https://ignored.example/", { headers: { host: "evil.example" } }))).status).toBe(404);
  });
});

describe("/api/oauth/authorize — static import closure", () => {
  const repoRoot = process.cwd();
  const abs = (rel: string) => path.join(repoRoot, rel);
  const entry = abs("app/api/oauth/authorize/route.ts");

  it("never reaches the grant store or its document module, not even through the session guard", () => {
    // Positive control: the walker does find these files where they ARE reachable.
    const { files: storeClosure } = walkImportClosure(abs("app/mcp/oauth/grantStore.ts"), repoRoot);
    expect(storeClosure).toContain(abs("app/mcp/oauth/grantDocument.ts"));
    expect(storeClosure).toContain(abs("sanity/lib/serverClient.ts"));

    const { files } = walkImportClosure(entry, repoRoot);
    expect(files).toContain(abs("app/mcp/oauth/tokens.ts"));
    for (const forbidden of ["app/mcp/oauth/grantStore.ts", "app/mcp/oauth/grantDocument.ts"]) {
      expect([...files], forbidden).not.toContain(abs(forbidden));
    }
  });

  it("adds no path to Sanity of its own: outside the session guard it never reaches serverClient", () => {
    // `requireActiveSession` and `getMemberAccess` are the app's existing,
    // read-only session boundary — every gated route reaches Sanity through
    // them. Treat them as leaves and prove the rest of the closure (this
    // route, the OAuth core it uses) never touches the module that exports
    // `writeClient`.
    const boundary = [abs("app/utils/authGuards.ts"), abs("app/utils/memberAccess.ts")];
    const { files, externalSpecifiers } = walkImportClosure(entry, repoRoot, { leaves: boundary });
    for (const b of boundary) expect(files).toContain(b);
    expect([...files]).not.toContain(abs("sanity/lib/serverClient.ts"));
    const ALLOWED_EXTERNAL_SPECIFIERS = new Set(["node:crypto", "jose"]);
    for (const specifier of externalSpecifiers) {
      expect(ALLOWED_EXTERNAL_SPECIFIERS.has(specifier), specifier).toBe(true);
    }
  });
});
