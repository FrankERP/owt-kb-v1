// app/mcp/oauth/__tests__/documentTypes.test.ts
//
// Step 3: the two hidden, read-only OAuth-state Sanity document types.
//
// `documentTypes.ts` must carry NO imports (controller ruling R10), because
// `sanity/schemas/mcpOauthGrant.ts` and `mcpOauthCodeRedemption.ts` are bundled
// into the embedded Studio for the browser, and `grantDocument.ts` (which used
// to hold these constants) pulls in `node:crypto` and `./tokens` (→ `jose`).
// The two schema files IMPORT the type names and field names from
// `documentTypes.ts` (ruling R10a — never mirror them), so this suite is what
// proves the chain stays safe end to end: `documentTypes.ts` itself has zero
// imports, the schema files import nothing beyond `sanity` and
// `documentTypes.ts`, their declared field names equal the constants exactly,
// and no writer in `grantDocument.ts` ever sets a field outside them.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { mcpOauthCodeRedemption } from "@/sanity/schemas/mcpOauthCodeRedemption";
import { mcpOauthGrant } from "@/sanity/schemas/mcpOauthGrant";

import {
  CODE_REDEMPTION_FIELD,
  CODE_REDEMPTION_FIELDS,
  GRANT_FIELD,
  GRANT_FIELDS,
  MCP_OAUTH_CODE_REDEMPTION_TYPE,
  MCP_OAUTH_GRANT_TYPE,
} from "../documentTypes";
import {
  buildCodeRedemptionDocument,
  buildGrantDocument,
  buildRefreshRotationPatch,
  buildRevocationPatch,
} from "../grantDocument";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// __tests__ -> oauth -> mcp -> app -> repo root
const REPO_ROOT = path.resolve(HERE, "../../../..");

function fieldNames(schema: { fields?: unknown }): string[] {
  return ((schema.fields as { name: string }[] | undefined) ?? []).map((f) => f.name);
}

function importSpecifiers(src: string): string[] {
  return [...src.matchAll(/(?:^|\n)\s*import\b[^;]*?\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

const DOCUMENT_TYPES_SRC = readFileSync(path.join(HERE, "../documentTypes.ts"), "utf8");
const GRANT_SCHEMA_SRC = readFileSync(path.join(REPO_ROOT, "sanity/schemas/mcpOauthGrant.ts"), "utf8");
const CODE_REDEMPTION_SCHEMA_SRC = readFileSync(
  path.join(REPO_ROOT, "sanity/schemas/mcpOauthCodeRedemption.ts"),
  "utf8",
);

describe("documentTypes.ts is import-free", () => {
  it("carries no import or require statement (ruling R10)", () => {
    expect(DOCUMENT_TYPES_SRC).not.toMatch(/^\s*import\b/m);
    expect(DOCUMENT_TYPES_SRC).not.toMatch(/\brequire\(/);
  });

  it("Object.values(GRANT_FIELD) / CODE_REDEMPTION_FIELD equal the array constants exactly, order included", () => {
    // The name-keyed maps the schema files import for `name:` must never
    // drift from the arrays the writer-key checks below are built against.
    expect(Object.values(GRANT_FIELD)).toEqual([...GRANT_FIELDS]);
    expect(Object.keys(GRANT_FIELD)).toEqual([...GRANT_FIELDS]);
    expect(Object.values(CODE_REDEMPTION_FIELD)).toEqual([...CODE_REDEMPTION_FIELDS]);
    expect(Object.keys(CODE_REDEMPTION_FIELD)).toEqual([...CODE_REDEMPTION_FIELDS]);
  });
});

describe("grantDocument.ts re-exports the same constants unchanged", () => {
  it("pins the document contract (unchanged from step 2)", () => {
    expect(MCP_OAUTH_GRANT_TYPE).toBe("mcpOauthGrant");
    expect(MCP_OAUTH_CODE_REDEMPTION_TYPE).toBe("mcpOauthCodeRedemption");
    expect([...GRANT_FIELDS]).toEqual([
      "sub",
      "clientHash",
      "origin",
      "createdAt",
      "lastRefreshAt",
      "currentRefreshJti",
      "revoked",
      "revokedAt",
      "revokedReason",
    ]);
    expect([...CODE_REDEMPTION_FIELDS]).toEqual(["redeemedAt"]);
  });
});

describe("the schema files import their contract, and their import closure never reaches node:crypto or jose", () => {
  it("mcpOauthGrant.ts / mcpOauthCodeRedemption.ts import only sanity and ../../app/mcp/oauth/documentTypes", () => {
    const allowed = new Set(["sanity", "../../app/mcp/oauth/documentTypes"]);
    for (const src of [GRANT_SCHEMA_SRC, CODE_REDEMPTION_SCHEMA_SRC]) {
      for (const specifier of importSpecifiers(src)) {
        expect(allowed.has(specifier), specifier).toBe(true);
      }
    }
  });

  it("neither actually imports node:crypto or jose, by specifier — closing the chain", () => {
    // A blunt substring search over the whole file would false-positive on the
    // doc comments above, which name `node:crypto`/`jose` in prose to explain
    // WHY they must be absent. What actually matters is the import
    // SPECIFIERS, already enumerated by `importSpecifiers` above: neither
    // schema file imports them directly, and their only internal import
    // (`documentTypes.ts`) is independently asserted import-free. Together
    // that closes the chain end to end.
    for (const src of [GRANT_SCHEMA_SRC, CODE_REDEMPTION_SCHEMA_SRC, DOCUMENT_TYPES_SRC]) {
      const specifiers = importSpecifiers(src);
      expect(specifiers).not.toContain("node:crypto");
      expect(specifiers).not.toContain("jose");
    }
  });

  it("mcpOauthGrant.ts declares name: MCP_OAUTH_GRANT_TYPE, imported, not a literal", () => {
    expect(GRANT_SCHEMA_SRC).toMatch(/name:\s*MCP_OAUTH_GRANT_TYPE\b/);
    expect(GRANT_SCHEMA_SRC).not.toMatch(/name:\s*["']mcpOauthGrant["']/);
  });

  it("mcpOauthCodeRedemption.ts declares name: MCP_OAUTH_CODE_REDEMPTION_TYPE, imported, not a literal", () => {
    expect(CODE_REDEMPTION_SCHEMA_SRC).toMatch(/name:\s*MCP_OAUTH_CODE_REDEMPTION_TYPE\b/);
    expect(CODE_REDEMPTION_SCHEMA_SRC).not.toMatch(/name:\s*["']mcpOauthCodeRedemption["']/);
  });
});

describe("mcpOauthGrant schema", () => {
  it("is hidden, read-only, and named after MCP_OAUTH_GRANT_TYPE", () => {
    expect(mcpOauthGrant.name).toBe(MCP_OAUTH_GRANT_TYPE);
    expect(mcpOauthGrant.hidden).toBe(true);
    expect(mcpOauthGrant.readOnly).toBe(true);
  });

  it("declares exactly GRANT_FIELDS, in the same order", () => {
    expect(fieldNames(mcpOauthGrant)).toEqual([...GRANT_FIELDS]);
  });

  it("every field's name: comes from GRANT_FIELD.<key>, not a hand-typed literal", () => {
    for (const field of GRANT_FIELDS) {
      expect(GRANT_SCHEMA_SRC).toMatch(new RegExp(`name:\\s*GRANT_FIELD\\.${field}\\b`));
    }
  });

  it("never lets a writer set a field outside its declared fields", () => {
    const allowed = new Set<string>(["_id", "_type", ...fieldNames(mcpOauthGrant)]);

    const doc = buildGrantDocument({
      id: "mcpOauthGrant.3b241101-e2bb-4255-8caf-4136c566a962",
      sub: "member-1",
      clientId: "eyJhbGciOiJIUzI1NiJ9.client-token-body.sig",
      origin: "https://owt-backstage.vercel.app",
      refreshJti: "rjti-1",
      createdAt: "2026-09-24T12:00:00.000Z",
    });
    for (const key of Object.keys(doc)) expect(allowed.has(key), key).toBe(true);

    const rotation = buildRefreshRotationPatch({ refreshJti: "rjti-2", at: "2026-09-24T12:00:00.000Z" });
    for (const key of Object.keys(rotation)) expect(allowed.has(key), key).toBe(true);

    const revocation = buildRevocationPatch({ reason: "manual", at: "2026-09-24T12:00:00.000Z" });
    for (const key of Object.keys(revocation)) expect(allowed.has(key), key).toBe(true);
  });
});

describe("mcpOauthCodeRedemption schema", () => {
  it("is hidden, read-only, and named after MCP_OAUTH_CODE_REDEMPTION_TYPE", () => {
    expect(mcpOauthCodeRedemption.name).toBe(MCP_OAUTH_CODE_REDEMPTION_TYPE);
    expect(mcpOauthCodeRedemption.hidden).toBe(true);
    expect(mcpOauthCodeRedemption.readOnly).toBe(true);
  });

  it("declares exactly CODE_REDEMPTION_FIELDS", () => {
    expect(fieldNames(mcpOauthCodeRedemption)).toEqual([...CODE_REDEMPTION_FIELDS]);
  });

  it("its field's name: comes from CODE_REDEMPTION_FIELD.redeemedAt, not a hand-typed literal", () => {
    expect(CODE_REDEMPTION_SCHEMA_SRC).toMatch(/name:\s*CODE_REDEMPTION_FIELD\.redeemedAt\b/);
  });

  it("never lets a writer set a field outside its declared fields", () => {
    const allowed = new Set<string>(["_id", "_type", ...fieldNames(mcpOauthCodeRedemption)]);
    const doc = buildCodeRedemptionDocument({ jti: "jti-1", redeemedAt: "2026-09-24T12:00:00.000Z" });
    for (const key of Object.keys(doc)) expect(allowed.has(key), key).toBe(true);
  });
});
