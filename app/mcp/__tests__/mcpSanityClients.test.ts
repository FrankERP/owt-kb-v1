// Guard: code under `app/mcp/` reaches Sanity only through the canonical
// operational clients (spec I1).
//
// WHY THIS EXISTS. `protectedReadAudit` finds a protected read by resolving
// the query a client executes. The MCP read modules execute the canonical
// `serviceReadQueries` builders through a helper — `attempt(label, bound)` —
// so the query is a function PARAMETER: it is neither resolvable text nor a
// const bound to a builder, and the audit's fail-closed branch needs a
// protected type literal in the operation, which MCP files are forbidden to
// carry (I2). The P1 step-2 review proved the gap: swapping the snapshot's
// import to `serverClient` from `@/sanity/lib/client` left `scanSource` at
// zero sites. The snapshot's parity responder rejects a wrong-client read, but
// nothing covered the NEXT file that copies the pattern.
//
// So this guard checks the one fact the audit cannot: every git-tracked,
// non-test `.ts`/`.tsx` file under `app/mcp/` imports Sanity clients only from
// `sanity/lib/operationalClient`. Named imports and `createClient` locals are
// read by the audit's OWN `sanityClientIdentifiers`, so "what is a Sanity
// client" has one definition. The import forms that parser does not read
// (namespace, default, dynamic) are checked by module specifier, classified
// by the same helper.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isAuditedQuerySiteFile,
  sanityClientIdentifiers,
  stripComments,
} from "@/app/utils/protectedReadAudit";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Non-canonical clients an `app/mcp/` file may import, keyed by FILE and then
 * by identifier. Each entry is a structural property of the file, not a
 * convenience; a stale entry fails the suite.
 */
const ALLOWED: Record<string, { clients: string[]; reason: string }> = {
  "app/mcp/oauth/grantStore.ts": {
    clients: ["writeClient"],
    reason:
      "P0's OAuth grant store: the only writer of `mcpOauthGrant` / `mcpOauthCode.*` " +
      "documents, which are not protected service types and need the write token. It " +
      "never reads a protected type; `protectedReadAudit` still scans it.",
  },
};

/** True when `spec` is a Sanity client module other than `sanity/lib/operationalClient`. */
function isNonCanonicalClientModule(spec: string): boolean {
  const probe = sanityClientIdentifiers(`import { probe } from "${spec}";`);
  return probe.clients.has("probe") && !probe.operational.has("probe");
}

/** Namespace (`* as x`), default (`x` / `x, { … }`) and dynamic (`import("…")`) import specifiers. */
const OTHER_IMPORT_FORMS =
  /\bimport\s+(?!type\b)(?:\*\s*as\s+[\w$]+|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s+from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Every way `source` reaches Sanity outside the canonical clients, as readable findings. */
function nonCanonicalSanityAccess(source: string): string[] {
  const code = stripComments(source);
  const info = sanityClientIdentifiers(code);
  const out: string[] = [];
  for (const name of info.clients) {
    if (!info.operational.has(name)) out.push(`client ${name}`);
  }
  if (info.rawSanityHttp) out.push("raw api.sanity.io HTTP");
  for (const m of code.matchAll(OTHER_IMPORT_FORMS)) {
    const spec = m[1] ?? m[2];
    if (isNonCanonicalClientModule(spec)) out.push(`non-named import of ${spec}`);
  }
  return out;
}

function mcpSourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "app/mcp"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter((f) => /\.tsx?$/.test(f) && isAuditedQuerySiteFile(f));
}

const FILES = mcpSourceFiles();
const FINDINGS = new Map(
  FILES.map((f) => [f, nonCanonicalSanityAccess(readFileSync(path.join(REPO_ROOT, f), "utf8"))]),
);

describe("app/mcp reaches Sanity only through sanity/lib/operationalClient", () => {
  it("scans the real MCP sources (a scan matching nothing would pass forever)", () => {
    expect(FILES).toContain("app/mcp/reads/serviceSnapshot.ts");
    expect(FILES.some((f) => f.includes("__tests__"))).toBe(false);
    const snapshot = sanityClientIdentifiers(
      stripComments(readFileSync(path.join(REPO_ROOT, "app/mcp/reads/serviceSnapshot.ts"), "utf8")),
    );
    expect([...snapshot.operational].sort()).toEqual(["operationalClient", "rawIntegrityClient"]);
  });

  it("imports no other Sanity client, outside the documented exemptions", () => {
    const violations: string[] = [];
    for (const [file, findings] of FINDINGS) {
      const allowed = new Set((ALLOWED[file]?.clients ?? []).map((c) => `client ${c}`));
      for (const finding of findings) {
        if (!allowed.has(finding)) violations.push(`${file}: ${finding}`);
      }
    }
    expect(
      violations,
      "An app/mcp file imports a Sanity client other than operationalClient / rawIntegrityClient. " +
        "protectedReadAudit cannot see a query passed through a helper parameter, so this guard is " +
        "the only thing standing between it and a draft-leaking read. Import from " +
        "@/sanity/lib/operationalClient instead.",
    ).toEqual([]);
  });

  it("has no stale exemption", () => {
    for (const [file, { clients }] of Object.entries(ALLOWED)) {
      expect(FILES, `${file} is exempt but no longer exists`).toContain(file);
      for (const client of clients) {
        expect(FINDINGS.get(file), `${file} no longer imports ${client}; drop the exemption`).toContain(
          `client ${client}`,
        );
      }
    }
  });
});

describe("nonCanonicalSanityAccess — controls", () => {
  it("passes the canonical clients", () => {
    expect(
      nonCanonicalSanityAccess(
        `import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";\n` +
          `import * as oc from "@/sanity/lib/operationalClient";\n` +
          `import { groq } from "next-sanity";`,
      ),
    ).toEqual([]);
  });

  it("flags serverClient imported from @/sanity/lib/client (the review's swap)", () => {
    expect(nonCanonicalSanityAccess(`import { serverClient } from "@/sanity/lib/client";`)).toEqual([
      "client serverClient",
    ]);
  });

  it("flags the swap inside the real snapshot source", () => {
    const src = readFileSync(path.join(REPO_ROOT, "app/mcp/reads/serviceSnapshot.ts"), "utf8");
    const swapped = src.replace(
      `import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";`,
      `import { operationalClient, rawIntegrityClient } from "@/sanity/lib/client";`,
    );
    expect(swapped).not.toBe(src);
    expect(nonCanonicalSanityAccess(swapped)).toEqual([
      "client operationalClient",
      "client rawIntegrityClient",
    ]);
  });

  it("flags a local createClient, raw HTTP, and the import forms the named parser skips", () => {
    expect(
      nonCanonicalSanityAccess(
        `import { createClient } from "next-sanity";\nconst lake = createClient({});`,
      ),
    ).toEqual(["client lake"]);
    expect(nonCanonicalSanityAccess("await fetch(`https://x.api.sanity.io/v1/data`)")).toEqual([
      "raw api.sanity.io HTTP",
    ]);
    expect(nonCanonicalSanityAccess(`import * as lake from "@/sanity/lib/serverClient";`)).toEqual([
      "non-named import of @/sanity/lib/serverClient",
    ]);
    expect(nonCanonicalSanityAccess(`import lake from "@sanity/client";`)).toEqual([
      "non-named import of @sanity/client",
    ]);
    expect(
      nonCanonicalSanityAccess(`const { writeClient } = await import("@/sanity/lib/serverClient");`),
    ).toEqual(["non-named import of @/sanity/lib/serverClient"]);
  });
});
