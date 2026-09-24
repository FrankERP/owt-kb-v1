// `/oauth/authorize` — the consent page (P0 plan step 7, spec O1/O8).
//
// A Server Component, so — like `ajustesPage.test.tsx` — it is awaited and
// rendered to static markup with the session guard, the live member record,
// `next/headers` and `next/navigation` mocked. `redirect` and `notFound` THROW
// here, as the real ones do, so a test cannot pass by the page carrying on
// after one of them.
//
// What is pinned: the page never mints anything (no code-signing import, no
// grant store in its closure); a non-super-admin, an impersonating
// super-admin, or a missing session sees a rejection and is NEVER redirected;
// an unverified client or redirect target renders an error page and is never
// followed; the self-declared name is labelled unverified and isolated in a
// `<bdi>`; the form posts every validated field and offers exactly «Permitir»
// and «Cancelar»; and consent is never remembered — every request renders it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  getMemberAccess: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  host: "dev-owt-backstage.vercel.app",
}));

class RedirectThrown extends Error {}
class NotFoundThrown extends Error {}

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: h.host }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirect(url);
    throw new RedirectThrown(url);
  },
  notFound: () => {
    h.notFound();
    throw new NotFoundThrown("not found");
  },
}));
vi.mock("@/app/utils/authGuards", () => ({ requireActiveSession: () => h.requireActiveSession() }));
vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));
vi.mock("@/sanity/lib/serverClient", () => ({
  writeClient: { create: vi.fn(), patch: vi.fn() },
  serverClient: { fetch: vi.fn() },
}));

import AuthorizePage from "../page";
import { authorizeFormFields, validateAuthorizeRequest } from "@/app/mcp/oauth/authorizeRequest";
import { PREVIEW_ORIGIN, PRODUCTION_ORIGIN } from "@/app/mcp/oauth/origin";
import { s256Challenge } from "@/app/mcp/oauth/pkce";
import { CLAUDE_AI_REDIRECT_URI } from "@/app/mcp/oauth/redirects";
import { signClientId } from "@/app/mcp/oauth/tokens";
import { walkImportClosure } from "@/app/mcp/oauth/__tests__/importClosure";

const SECRET = "s".repeat(32);
const KEY = new TextEncoder().encode(SECRET);
const CHALLENGE = s256Challenge("v".repeat(43));
const REGISTERED_AT = new Date("2026-09-24T12:00:00Z");
const NOW = new Date("2026-09-24T12:03:30Z");

const SUPER_ADMIN_SESSION = { user: { sanityId: "frank", role: "super-admin", isImpersonating: false } };
const liveAccess = (role: string | null, active = true) => ({ active, role, ministries: ["worship"], managesMinistries: [] });

async function clientId(opts: { origin?: string; clientName?: string; redirectUris?: string[] } = {}) {
  return signClientId({
    key: KEY,
    origin: opts.origin ?? PREVIEW_ORIGIN,
    redirectUris: opts.redirectUris ?? [CLAUDE_AI_REDIRECT_URI],
    now: REGISTERED_AT,
    ...(opts.clientName !== undefined ? { clientName: opts.clientName } : {}),
  });
}

type Query = Record<string, string | string[] | undefined>;

async function query(overrides: Query = {}): Promise<Query> {
  return {
    response_type: "code",
    client_id: await clientId({ clientName: "Claude" }),
    redirect_uri: CLAUDE_AI_REDIRECT_URI,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "st-123",
    ...overrides,
  };
}

async function renderPage(q: Query): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve(q) }));
}

/** React's attribute escaping, reversed — enough to read hidden-input values back. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function hiddenFields(html: string): [string, string][] {
  return [...html.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)"\/>/g)].map((m) => [
    unescapeHtml(m[1]!),
    unescapeHtml(m[2]!),
  ]);
}

function expectNoConsent(html: string) {
  expect(html).not.toContain("<form");
  expect(html).not.toContain("Permitir");
  expect(h.redirect).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("MCP_OAUTH_SECRET", SECRET);
  h.host = "dev-owt-backstage.vercel.app";
  h.requireActiveSession.mockResolvedValue(SUPER_ADMIN_SESSION);
  h.getMemberAccess.mockResolvedValue(liveAccess("super-admin"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("/oauth/authorize — consent for a live super-admin", () => {
  it("shows the declared name as UNVERIFIED inside <bdi>, the full redirect URI, the age and the warning", async () => {
    const html = await renderPage(await query());
    expect(html).toContain("Nombre declarado por la aplicación (no verificado)");
    expect(html).toContain("<bdi>Claude</bdi>");
    expect(html).toContain(CLAUDE_AI_REDIRECT_URI);
    expect(html).toContain("hace 3 minutos");
    expect(html).toContain("Aprueba sólo si acabas de iniciar esta conexión en Claude");
    expect(h.redirect).not.toHaveBeenCalled();
    expect(h.getMemberAccess).toHaveBeenCalledWith("frank");
  });

  it("posts to /api/oauth/authorize with exactly the validated fields as hidden inputs", async () => {
    const q = await query();
    const html = await renderPage(q);
    const forms = html.match(/<form\b[^>]*>/g) ?? [];
    expect(forms).toHaveLength(1);
    expect(forms[0]).toContain('method="POST"');
    expect(forms[0]).toContain('action="/api/oauth/authorize"');

    const validated = await validateAuthorizeRequest(new URLSearchParams(q as Record<string, string>), {
      origin: PREVIEW_ORIGIN,
      key: KEY,
    });
    if (validated.kind !== "render") throw new Error("fixture did not validate");
    expect(hiddenFields(html)).toEqual(authorizeFormFields(validated.request));
  });

  it("offers exactly two house buttons, «Cancelar» first, told apart by name/value", async () => {
    const html = await renderPage(await query());
    const buttons = [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)];
    expect(buttons.map((m) => m[2])).toEqual(["Cancelar", "Permitir"]);
    for (const [, attrs] of buttons) {
      expect(attrs).toContain('type="submit"');
      expect(attrs).toContain('name="decision"');
      expect(attrs).toMatch(/class="[^"]*rounded-lg/); // the house Button, not a bare <button>
    }
    expect(buttons[0]![1]).toContain('value="deny"');
    expect(buttons[1]![1]).toContain('value="allow"');
  });

  it("a client with no registered name shows a neutral placeholder, still marked unverified", async () => {
    const html = await renderPage(await query({ client_id: await clientId() }));
    expect(html).toContain("Nombre declarado por la aplicación (no verificado)");
    expect(html).toContain("Sin nombre declarado");
    expect(html).not.toContain("<bdi>");
  });

  it("a hostile declared name is escaped, never markup", async () => {
    const html = await renderPage(await query({ client_id: await clientId({ clientName: '<img src=x onerror="1">' }) }));
    expect(html).not.toContain("<img");
    expect(html).toContain("<bdi>&lt;img src=x onerror=&quot;1&quot;&gt;</bdi>");
  });

  it("state and an already-encoded value survive into the form unchanged", async () => {
    const html = await renderPage(await query({ state: 'a%20b&c="d"' }));
    expect(hiddenFields(html)).toContainEqual(["state", 'a%20b&c="d"']);
  });

  it("consent is never remembered: the same client, twice, renders the form twice", async () => {
    const q = await query();
    expect(await renderPage(q)).toContain("<form");
    expect(await renderPage(q)).toContain("<form");
  });
});

describe("/oauth/authorize — the session: rejection shown here, never redirected", () => {
  it("an impersonating super-admin is told to leave impersonation, before any role read", async () => {
    h.requireActiveSession.mockResolvedValue({ user: { sanityId: "target", role: "super-admin", isImpersonating: true } });
    const html = await renderPage(await query());
    expect(html).toContain("sal de la suplantación para conectar");
    expectNoConsent(html);
    expect(h.getMemberAccess).not.toHaveBeenCalled();
  });

  it.each(["member", "admin", "content-editor", null])("a live %s is rejected", async (role) => {
    h.getMemberAccess.mockResolvedValue(liveAccess(role));
    const html = await renderPage(await query());
    expect(html).toContain("Sólo un super-admin puede autorizar conexiones");
    expectNoConsent(html);
  });

  it("the LIVE role decides, not the session copy", async () => {
    h.getMemberAccess.mockResolvedValue(liveAccess("admin"));
    expectNoConsent(await renderPage(await query()));

    h.requireActiveSession.mockResolvedValue({ user: { sanityId: "frank", role: "member", isImpersonating: false } });
    h.getMemberAccess.mockResolvedValue(liveAccess("super-admin"));
    expect(await renderPage(await query())).toContain("<form");
  });

  it("an inactive live record is rejected", async () => {
    h.getMemberAccess.mockResolvedValue(liveAccess("super-admin", false));
    expectNoConsent(await renderPage(await query()));
  });

  it("no session → a sign-in message, no form, no redirect", async () => {
    h.requireActiveSession.mockResolvedValue(null);
    const html = await renderPage(await query());
    expect(html).toContain("Inicia sesión");
    expectNoConsent(html);
  });

  it("a non-super-admin with a request that would earn an error redirect is still only rejected", async () => {
    h.getMemberAccess.mockResolvedValue(liveAccess("member"));
    expectNoConsent(await renderPage(await query({ code_challenge_method: "plain" })));
  });
});

describe("/oauth/authorize — unverified client or redirect target: an error page, never followed", () => {
  it("an invalid client_id", async () => {
    const html = await renderPage(await query({ client_id: "garbage" }));
    expect(html).toContain("Solicitud no válida");
    expectNoConsent(html);
  });

  it("a client id from another origin", async () => {
    const html = await renderPage(
      await query({ client_id: await clientId({ origin: PRODUCTION_ORIGIN }) }),
    );
    expect(html).toContain("Solicitud no válida");
    expectNoConsent(html);
  });

  it("a mismatched redirect_uri is neither followed nor echoed", async () => {
    const html = await renderPage(await query({ redirect_uri: "https://evil.example/cb" }));
    expect(html).toContain("Solicitud no válida");
    expect(html).not.toContain("evil.example");
    expectNoConsent(html);
  });

  it("a duplicated redirect_uri", async () => {
    const html = await renderPage(await query({ redirect_uri: [CLAUDE_AI_REDIRECT_URI, CLAUDE_AI_REDIRECT_URI] }));
    expect(html).toContain("Solicitud no válida");
    expectNoConsent(html);
  });
});

describe("/oauth/authorize — later errors redirect to the verified redirect_uri", () => {
  it("plain PKCE → redirect with error=invalid_request, state and iss", async () => {
    await expect(renderPage(await query({ code_challenge_method: "plain" }))).rejects.toBeInstanceOf(RedirectThrown);
    expect(h.redirect).toHaveBeenCalledTimes(1);
    const url = new URL(h.redirect.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe(CLAUDE_AI_REDIRECT_URI);
    expect(url.searchParams.get("error")).toBe("invalid_request");
    expect(url.searchParams.get("state")).toBe("st-123");
    expect(url.searchParams.get("iss")).toBe(PREVIEW_ORIGIN);
    expect(url.searchParams.has("code")).toBe(false);
  });

  it("response_type=token → unsupported_response_type", async () => {
    await expect(renderPage(await query({ response_type: "token" }))).rejects.toBeInstanceOf(RedirectThrown);
    const url = new URL(h.redirect.mock.calls[0]![0] as string);
    expect(url.searchParams.get("error")).toBe("unsupported_response_type");
  });
});

describe("/oauth/authorize — the preflight (R17)", () => {
  it("MCP_DISABLED → a «no disponible» message, before the session is read", async () => {
    vi.stubEnv("MCP_DISABLED", "1");
    const html = await renderPage(await query());
    expect(html).toContain("no está disponible");
    expectNoConsent(html);
    expect(h.requireActiveSession).not.toHaveBeenCalled();
  });

  it("a missing secret → the same «no disponible» message", async () => {
    vi.stubEnv("MCP_OAUTH_SECRET", undefined);
    const html = await renderPage(await query());
    expect(html).toContain("no está disponible");
    expectNoConsent(html);
  });

  it("a non-canonical host → notFound()", async () => {
    h.host = "owt-backstage-abc123-frank-rochas-projects.vercel.app";
    await expect(renderPage(await query())).rejects.toBeInstanceOf(NotFoundThrown);
    expect(h.notFound).toHaveBeenCalledTimes(1);
    expect(h.requireActiveSession).not.toHaveBeenCalled();
  });
});

describe("/oauth/authorize — the page never mints and never reaches the grant store", () => {
  const repoRoot = process.cwd();
  const abs = (rel: string) => path.join(repoRoot, rel);
  const entry = abs("app/(client)/oauth/authorize/page.tsx");

  it("its source never names the code signer", () => {
    expect(readFileSync(entry, "utf8")).not.toMatch(/signAuthorizationCode|writeClient|grantStore/);
  });

  it("its import closure never reaches grantStore/grantDocument, and outside the session guard never reaches serverClient", () => {
    const { files: storeClosure } = walkImportClosure(abs("app/mcp/oauth/grantStore.ts"), repoRoot);
    expect(storeClosure).toContain(abs("app/mcp/oauth/grantDocument.ts"));

    const { files } = walkImportClosure(entry, repoRoot);
    expect(files).toContain(abs("app/mcp/oauth/authorizeRequest.ts"));
    for (const forbidden of ["app/mcp/oauth/grantStore.ts", "app/mcp/oauth/grantDocument.ts"]) {
      expect([...files], forbidden).not.toContain(abs(forbidden));
    }

    const boundary = [abs("app/utils/authGuards.ts"), abs("app/utils/memberAccess.ts")];
    const pruned = walkImportClosure(entry, repoRoot, { leaves: boundary });
    expect([...pruned.files]).not.toContain(abs("sanity/lib/serverClient.ts"));
    const ALLOWED_EXTERNAL_SPECIFIERS = new Set([
      "next",
      "next/headers",
      "next/navigation",
      "next/link",
      "react",
      "node:crypto",
      "jose",
    ]);
    for (const specifier of pruned.externalSpecifiers) {
      expect(ALLOWED_EXTERNAL_SPECIFIERS.has(specifier), specifier).toBe(true);
    }
  });
});
