// app/mcp/oauth/__tests__/documentTypes.test.ts
//
// Step 3: the two hidden, read-only OAuth-state Sanity document types.
//
// `documentTypes.ts` must carry NO imports (controller ruling R10), because
// `sanity/schemas/mcpOauthGrant.ts` and `mcpOauthCodeRedemption.ts` are bundled
// into the embedded Studio for the browser, and `grantDocument.ts` (which used
// to hold these constants) pulls in `node:crypto` and `./tokens` (→ `jose`).
// The two schema files MIRROR the type names and field lists instead of
// importing them, so this suite is what keeps the two in sync: it asserts the
// schema's declared field names equal the constants exactly, and that no
// writer in `grantDocument.ts` ever sets a field outside them.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { mcpOauthCodeRedemption } from "@/sanity/schemas/mcpOauthCodeRedemption";
import { mcpOauthGrant } from "@/sanity/schemas/mcpOauthGrant";

import {
  CODE_REDEMPTION_FIELDS,
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

function fieldNames(schema: { fields?: unknown }): string[] {
  return ((schema.fields as { name: string }[] | undefined) ?? []).map((f) => f.name);
}

describe("documentTypes.ts is import-free", () => {
  it("carries no import or require statement (ruling R10)", () => {
    const src = readFileSync(path.join(HERE, "../documentTypes.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\brequire\(/);
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

describe("mcpOauthGrant schema", () => {
  it("is hidden, read-only, and named after MCP_OAUTH_GRANT_TYPE", () => {
    expect(mcpOauthGrant.name).toBe(MCP_OAUTH_GRANT_TYPE);
    expect(mcpOauthGrant.hidden).toBe(true);
    expect(mcpOauthGrant.readOnly).toBe(true);
  });

  it("declares exactly GRANT_FIELDS, in the same order", () => {
    expect(fieldNames(mcpOauthGrant)).toEqual([...GRANT_FIELDS]);
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

  it("never lets a writer set a field outside its declared fields", () => {
    const allowed = new Set<string>(["_id", "_type", ...fieldNames(mcpOauthCodeRedemption)]);
    const doc = buildCodeRedemptionDocument({ jti: "jti-1", redeemedAt: "2026-09-24T12:00:00.000Z" });
    for (const key of Object.keys(doc)) expect(allowed.has(key), key).toBe(true);
  });
});
