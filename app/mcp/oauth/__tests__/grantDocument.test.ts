// app/mcp/oauth/__tests__/grantDocument.test.ts
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  CODE_REDEMPTION_FIELDS,
  CODE_REDEMPTION_ID_PREFIX,
  GRANT_FIELDS,
  GRANT_ID_PREFIX,
  MCP_OAUTH_CODE_REDEMPTION_TYPE,
  MCP_OAUTH_GRANT_TYPE,
  buildCodeRedemptionDocument,
  buildGrantDocument,
  buildRefreshRotationPatch,
  buildRevocationPatch,
  codeRedemptionId,
  isGrantId,
  newGrantId,
  parseGrantDocument,
} from "../grantDocument";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const ALLOWED_GRANT_KEYS = new Set<string>(["_id", "_type", ...GRANT_FIELDS]);
const CLIENT_ID = "eyJhbGciOiJIUzI1NiJ9.client-token-body.sig";

describe("constants", () => {
  it("pin the document contract step 3's schema is built against", () => {
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
    expect(MCP_OAUTH_GRANT_TYPE).toBe("mcpOauthGrant");
    expect(MCP_OAUTH_CODE_REDEMPTION_TYPE).toBe("mcpOauthCodeRedemption");
    // Dotted ids: never publicly readable.
    expect(GRANT_ID_PREFIX).toBe("mcpOauthGrant.");
    expect(CODE_REDEMPTION_ID_PREFIX).toBe("mcpOauthCode.");
  });
});

describe("grant ids", () => {
  it("newGrantId is a dotted uuid, and isGrantId recognises exactly that", () => {
    const id = newGrantId();
    expect(id).toMatch(/^mcpOauthGrant\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newGrantId()).not.toBe(id);
    expect(isGrantId(id)).toBe(true);
    for (const bad of ["", "mcpOauthGrant.", "mcpOauthGrant.x", "teamMembers.abc", id + "x", "drafts." + id, 42]) {
      expect(isGrantId(bad), String(bad)).toBe(false);
    }
  });
});

describe("buildGrantDocument", () => {
  const doc = buildGrantDocument({
    id: "mcpOauthGrant.3b241101-e2bb-4255-8caf-4136c566a962",
    sub: "member-1",
    clientId: CLIENT_ID,
    origin: "https://owt-backstage.vercel.app",
    refreshJti: "rjti-1",
    createdAt: "2026-09-24T12:00:00.000Z",
  });

  it("never sets a field outside the declared list", () => {
    for (const key of Object.keys(doc)) expect(ALLOWED_GRANT_KEYS.has(key), key).toBe(true);
  });

  it("stores the client HASH, never the client id", () => {
    expect(doc.clientHash).toBe(sha(CLIENT_ID));
    expect(JSON.stringify(doc)).not.toContain(CLIENT_ID);
  });

  it("is live, origin-bound and carries the first refresh jti", () => {
    expect(doc).toEqual({
      _id: "mcpOauthGrant.3b241101-e2bb-4255-8caf-4136c566a962",
      _type: "mcpOauthGrant",
      sub: "member-1",
      clientHash: sha(CLIENT_ID),
      origin: "https://owt-backstage.vercel.app",
      createdAt: "2026-09-24T12:00:00.000Z",
      currentRefreshJti: "rjti-1",
      revoked: false,
    });
  });
});

describe("patch builders", () => {
  it("rotation and revocation patches stay inside the declared list", () => {
    const rotation = buildRefreshRotationPatch({ refreshJti: "r2", at: "2026-09-24T12:00:00.000Z" });
    expect(rotation).toEqual({ currentRefreshJti: "r2", lastRefreshAt: "2026-09-24T12:00:00.000Z" });
    const revocation = buildRevocationPatch({ reason: "manual", at: "2026-09-24T12:00:00.000Z" });
    expect(revocation).toEqual({ revoked: true, revokedAt: "2026-09-24T12:00:00.000Z", revokedReason: "manual" });
    for (const key of [...Object.keys(rotation), ...Object.keys(revocation)]) {
      expect(ALLOWED_GRANT_KEYS.has(key), key).toBe(true);
    }
  });
});

describe("code redemption", () => {
  it("id is the dotted sha256 of the jti; body is redeemedAt only", () => {
    expect(codeRedemptionId("jti-1")).toBe("mcpOauthCode." + sha("jti-1"));
    const doc = buildCodeRedemptionDocument({ jti: "jti-1", redeemedAt: "2026-09-24T12:00:00.000Z" });
    expect(doc).toEqual({
      _id: "mcpOauthCode." + sha("jti-1"),
      _type: "mcpOauthCodeRedemption",
      redeemedAt: "2026-09-24T12:00:00.000Z",
    });
    expect(JSON.stringify(doc)).not.toContain("jti-1");
  });
});

describe("parseGrantDocument", () => {
  const stored = {
    _id: "mcpOauthGrant.3b241101-e2bb-4255-8caf-4136c566a962",
    _rev: "rev-1",
    _type: "mcpOauthGrant",
    sub: "member-1",
    clientHash: sha(CLIENT_ID),
    origin: "https://owt-backstage.vercel.app",
    createdAt: "2026-09-24T12:00:00.000Z",
    currentRefreshJti: "rjti-1",
    revoked: false,
  };

  it("parses a live grant", () => {
    expect(parseGrantDocument(stored)).toEqual({
      _id: stored._id,
      _rev: "rev-1",
      sub: "member-1",
      clientHash: stored.clientHash,
      origin: stored.origin,
      createdAt: stored.createdAt,
      lastRefreshAt: null,
      currentRefreshJti: "rjti-1",
      revoked: false,
    });
    expect(parseGrantDocument({ ...stored, lastRefreshAt: "2026-09-25T00:00:00.000Z" })?.lastRefreshAt).toBe(
      "2026-09-25T00:00:00.000Z",
    );
  });

  it("anything but revoked === false reads as revoked (fail closed)", () => {
    expect(parseGrantDocument({ ...stored, revoked: true })?.revoked).toBe(true);
    const { revoked: _drop, ...noFlag } = stored;
    expect(parseGrantDocument(noFlag)?.revoked).toBe(true);
    expect(parseGrantDocument({ ...stored, revoked: "false" })?.revoked).toBe(true);
  });

  it("missing or malformed documents parse to null", () => {
    expect(parseGrantDocument(null)).toBeNull();
    expect(parseGrantDocument(undefined)).toBeNull();
    for (const field of ["_id", "_rev", "sub", "clientHash", "origin", "currentRefreshJti"]) {
      const broken: Record<string, unknown> = { ...stored };
      delete broken[field];
      expect(parseGrantDocument(broken), field).toBeNull();
      expect(parseGrantDocument({ ...stored, [field]: "" }), field).toBeNull();
    }
  });
});
