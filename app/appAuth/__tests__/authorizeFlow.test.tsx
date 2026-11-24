// app/appAuth/__tests__/authorizeFlow.test.tsx — the confirmation screen and the
// POST behind its one visible tap (spec §3.1, §3.2, §10 A9): the screen never
// submits itself, the POST is same-origin only, re-runs the validator and the
// person check, mints a code only on «allow», and redirects exactly.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { s256Challenge } from "@/app/mcp/oauth/pkce";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  getMemberAccess: vi.fn(),
  serverFetch: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/app/utils/authGuards", () => ({ requireActiveSession: () => mocks.requireActiveSession() }));
vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (...a: unknown[]) => mocks.getMemberAccess(...a) }));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: (...a: unknown[]) => mocks.serverFetch(...a) } }));
vi.mock("next/headers", () => ({ headers: () => mocks.headers() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import AppAuthorizePage from "@/app/(appauth)/app/authorize/page";
import { GET as submitGET, POST as submitPOST } from "@/app/(appauth)/app/authorize/submit/route";
import { verifyAppCode } from "../tokens";

const SECRET = "s".repeat(40);
const KEY = new TextEncoder().encode(SECRET);
const ORIGIN = "http://localhost:3000";
const HOST = "localhost:3000";
const REDIRECT = `${ORIGIN}/app/callback/ios`;
const CHALLENGE = s256Challenge("v".repeat(43));
const STATE = "state-0123456789abcdef";
const ACTIVE = { active: true, role: "member", ministries: ["worship"], managesMinistries: [], ministryRoles: [] };
const QUERY = {
  response_type: "code",
  client_id: "backstage-ios",
  redirect_uri: REDIRECT,
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
  state: STATE,
};

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["APP_AUTH_SECRET", "APP_AUTH_DISABLED", "VERCEL_ENV"]) saved[k] = process.env[k];
  process.env.APP_AUTH_SECRET = SECRET;
  delete process.env.APP_AUTH_DISABLED;
  delete process.env.VERCEL_ENV;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(() => {
  mocks.requireActiveSession.mockReset().mockResolvedValue({ user: { sanityId: "m1" } });
  mocks.getMemberAccess.mockReset().mockResolvedValue(ACTIVE);
  mocks.serverFetch.mockReset().mockResolvedValue({ name: "Ana", photoUrl: null });
  mocks.headers.mockReset().mockResolvedValue(new Headers({ host: HOST }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/app/authorize (the confirmation screen)", () => {
  async function page(query: Record<string, string> = QUERY): Promise<string> {
    const el = await AppAuthorizePage({ searchParams: Promise.resolve(query) });
    return renderToStaticMarkup(el);
  }
  const forms = (html: string) => html.match(/<form\b[^>]*>/g) ?? [];

  it("shows one form with the two buttons and never submits itself", async () => {
    const html = await page();
    expect(forms(html)).toHaveLength(1);
    expect(forms(html)[0]).toMatch(/method="POST"/i);
    expect(forms(html)[0]).toContain('action="/app/authorize/submit"');
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
      text: m[2]!.replace(/<[^>]+>/g, "").trim(),
      name: /name="([^"]*)"/.exec(m[1]!)?.[1],
      value: /value="([^"]*)"/.exec(m[1]!)?.[1],
    }));
    expect(buttons).toEqual([
      { text: "Entrar a la app", name: "decision", value: "allow" },
      { text: "Cancelar", name: "decision", value: "deny" },
    ]);
    // No auto-submit: no script, no autofocus, no inline handler, no meta refresh.
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/autofocus/i);
    expect(html).not.toMatch(/\bon(load|focus|submit)=|http-equiv/i);
    expect(html).toContain("Ana");
    expect(html).toContain("Si no abriste la app Backstage, toca Cancelar.");
  });

  it("refuses impersonation, an inactive person and Android 11 with a message, no form", async () => {
    mocks.requireActiveSession.mockResolvedValueOnce({ user: { sanityId: "m1", isImpersonating: true } });
    expect(forms(await page())).toHaveLength(0);
    mocks.getMemberAccess.mockResolvedValueOnce({ ...ACTIVE, active: false });
    expect(forms(await page())).toHaveLength(0);
    mocks.headers.mockResolvedValueOnce(new Headers({ host: HOST, "sec-ch-ua-platform": '"Android"', "sec-ch-ua-platform-version": '"11.0.0"' }));
    const html = await page();
    expect(forms(html)).toHaveLength(0);
    expect(html).toContain("Android 12 o más nuevo");
  });

  it("shows an error page for an unverified redirect and redirects a verified one's errors", async () => {
    expect(forms(await page({ ...QUERY, redirect_uri: "https://evil.example/cb" }))).toHaveLength(0);
    expect(mocks.redirect).not.toHaveBeenCalled();
    await expect(page({ ...QUERY, code_challenge_method: "plain" })).rejects.toMatchObject({ url: expect.stringContaining("error=invalid_request") });
  });

  it("404s a foreign host", async () => {
    mocks.headers.mockResolvedValueOnce(new Headers({ host: "evil.example" }));
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("POST /app/authorize/submit", () => {
  function post(fields: Record<string, string>, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
    return submitPOST(new Request(`${ORIGIN}/app/authorize/submit`, {
      method: "POST",
      headers: { host: HOST, "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(fields).toString(),
    }));
  }

  it("mints a code bound to the person, the client, the redirect and the challenge, and 303s exactly", async () => {
    const res = await post({ ...QUERY, decision: "allow" });
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect([...loc.searchParams.keys()].sort()).toEqual(["code", "iss", "state"]);
    expect(loc.searchParams.get("state")).toBe(STATE);
    expect(loc.searchParams.get("iss")).toBe(ORIGIN);
    const v = await verifyAppCode(loc.searchParams.get("code"), { key: KEY, origin: ORIGIN });
    expect(v).toMatchObject({ ok: true, claims: { sub: "m1", clientId: "backstage-ios", redirectUri: REDIRECT, codeChallenge: CHALLENGE } });
  });

  it("answers «Cancelar» with access_denied and no code", async () => {
    const res = await post({ ...QUERY, decision: "deny" });
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("code")).toBeNull();
    expect(loc.searchParams.get("state")).toBe(STATE);
  });

  it("refuses a cross-site or same-site post, and a missing, null or foreign Origin", async () => {
    for (const h of [
      { "sec-fetch-site": "cross-site" } as Record<string, string>,
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "none" },
      {},
      { origin: "null" },
      { origin: "https://evil.example" },
    ]) {
      const res = await post({ ...QUERY, decision: "allow" }, h);
      expect(res.status).toBe(403);
      expect(res.headers.get("location")).toBeNull();
    }
    expect((await post({ ...QUERY, decision: "allow" }, { origin: ORIGIN })).status).toBe(303);
  });

  it("refuses no session, impersonation and an inactive person, minting nothing", async () => {
    mocks.requireActiveSession.mockResolvedValueOnce(null);
    expect((await post({ ...QUERY, decision: "allow" })).status).toBe(403);
    mocks.requireActiveSession.mockResolvedValueOnce({ user: { sanityId: "m1", isImpersonating: true } });
    expect((await post({ ...QUERY, decision: "allow" })).status).toBe(403);
    mocks.getMemberAccess.mockResolvedValueOnce({ ...ACTIVE, active: false });
    expect((await post({ ...QUERY, decision: "allow" })).status).toBe(403);
    mocks.getMemberAccess.mockRejectedValueOnce(new Error("down"));
    expect((await post({ ...QUERY, decision: "allow" })).status).toBe(503);
  });

  it("re-runs the validator on the posted fields and never trusts the page", async () => {
    const res = await post({ ...QUERY, redirect_uri: `${ORIGIN}/app/callback/android`, decision: "allow" });
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    const scheme = await post({ ...QUERY, redirect_uri: "app.vercel.owt-backstage:/oauth/callback/ios", decision: "allow" }, { origin: ORIGIN });
    expect(scheme.status).toBe(303); // local origin: the scheme is allowed here only
  });

  it("refuses a missing or repeated decision", async () => {
    expect((await post({ ...QUERY })).status).toBe(400);
    const body = new URLSearchParams({ ...QUERY });
    body.append("decision", "allow");
    body.append("decision", "deny");
    const res = await submitPOST(new Request(`${ORIGIN}/x`, { method: "POST", headers: { host: HOST, "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" }, body: body.toString() }));
    expect(res.status).toBe(400);
  });

  it("answers a GET (a session that expired before the tap) with a page, never a code", async () => {
    const res = await submitGET();
    expect(res.status).toBe(405);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("Vuelve a la app y toca Entrar otra vez");
  });
});
