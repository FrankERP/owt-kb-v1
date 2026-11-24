// Guard (spec D6): the shared grant-store protocol and the native-app door reach
// Sanity only where the design says. `app/oauthCore/` imports NO Sanity client —
// it writes through the client its family injects — and under `app/appAuth/`
// only the store (`grantStore.ts`) holds one, the write client, because the
// grant documents have dotted ids that an untokened read cannot see. Every
// other module goes through the store. Same detector as the MCP guard
// (`app/mcp/__tests__/mcpSanityClients.test.ts`): `protectedReadAudit`'s own
// `sanityClientIdentifiers`, plus the import forms it does not parse.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sanityClientIdentifiers, stripComments } from "@/app/utils/protectedReadAudit";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ALLOWED: Record<string, string[]> = {
  "app/appAuth/grantStore.ts": ["writeClient"],
};

const OTHER_IMPORT_FORMS =
  /\bimport\s+(?!type\b)(?:\*\s*as\s+[\w$]+|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s+from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function isClientModule(spec: string): boolean {
  return sanityClientIdentifiers(`import { probe } from "${spec}";`).clients.has("probe");
}

function sanityAccess(source: string): string[] {
  const code = stripComments(source);
  const info = sanityClientIdentifiers(code);
  const out = [...info.clients].map((c) => `client ${c}`);
  if (info.rawSanityHttp) out.push("raw api.sanity.io HTTP");
  for (const m of code.matchAll(OTHER_IMPORT_FORMS)) {
    const spec = m[1] ?? m[2]!;
    if (isClientModule(spec)) out.push(`non-named import of ${spec}`);
  }
  return out;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(REPO, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(REPO, rel)).isDirectory()) {
      if (name !== "__tests__") out.push(...sources(rel));
    } else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

const FILES = [...sources("app/oauthCore"), ...sources("app/appAuth")];

describe("app/oauthCore and app/appAuth reach Sanity only through the app store's write client", () => {
  it("scans the real sources", () => {
    expect(FILES).toContain("app/oauthCore/grantStoreProtocol.ts");
    expect(FILES).toContain("app/appAuth/requireAppSession.ts");
  });

  it("imports no Sanity client outside the store", () => {
    const violations: string[] = [];
    for (const f of FILES) {
      const allowed = new Set((ALLOWED[f] ?? []).map((c) => `client ${c}`));
      for (const finding of sanityAccess(readFileSync(path.join(REPO, f), "utf8"))) {
        if (!allowed.has(finding)) violations.push(`${f}: ${finding}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("has no stale exemption", () => {
    for (const [f, clients] of Object.entries(ALLOWED)) {
      const found = sanityAccess(readFileSync(path.join(REPO, f), "utf8"));
      for (const c of clients) expect(found).toContain(`client ${c}`);
    }
  });

  it("the detector sees a swap", () => {
    expect(sanityAccess(`import { serverClient } from "@/sanity/lib/serverClient";`)).toEqual(["client serverClient"]);
  });
});
