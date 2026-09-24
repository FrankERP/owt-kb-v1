// scripts/__tests__/revokeMcpGrant.test.ts
//
// TDD for scripts/revoke-mcp-grant.mjs (P0 plan step 10, spec O9): the
// revocation script's pure argument parsing, grant selection and patch
// builder — the parts provable without a Sanity client. The live dry-run
// listing is proven by hand (see the step-10 report); this suite is what CI
// runs on every push.

import { describe, expect, it } from "vitest";

import { GRANT_FIELD, GRANT_FIELDS, GRANT_ID_PREFIX, MCP_OAUTH_GRANT_TYPE } from "@/app/mcp/oauth/documentTypes";

import {
  buildRevocationPatch,
  DEFAULT_REASON,
  GRANT_FIELDS as SCRIPT_GRANT_FIELDS,
  GRANT_ID_PREFIX as SCRIPT_GRANT_ID_PREFIX,
  GRANT_TYPE as SCRIPT_GRANT_TYPE,
  parseArgs,
  selectGrantsToRevoke,
} from "../revoke-mcp-grant.mjs";

describe("revoke-mcp-grant.mjs stays in sync with app/mcp/oauth/documentTypes.ts", () => {
  it("mirrors the type name, id prefix and field list exactly, order included", () => {
    // documentTypes.ts is import-free TypeScript (ruling R10); this script runs
    // under plain `node` and cannot import it, so it duplicates the constants.
    // This is the guard that keeps the duplicate from drifting.
    expect(SCRIPT_GRANT_TYPE).toBe(MCP_OAUTH_GRANT_TYPE);
    expect(SCRIPT_GRANT_ID_PREFIX).toBe(GRANT_ID_PREFIX);
    expect(SCRIPT_GRANT_FIELDS).toEqual([...GRANT_FIELDS]);
  });

  it("the three fields the patch builder sets are all declared grant fields", () => {
    for (const f of [GRANT_FIELD.revoked, GRANT_FIELD.revokedAt, GRANT_FIELD.revokedReason]) {
      expect(GRANT_FIELDS).toContain(f);
    }
  });
});

describe("parseArgs", () => {
  it("defaults to a plain listing: no id, no all, no apply, reason = manual", () => {
    expect(parseArgs([])).toEqual({ id: null, all: false, apply: false, reason: DEFAULT_REASON });
  });

  it("parses --id, --all, --apply and --reason", () => {
    expect(parseArgs(["--id", "mcpOauthGrant.abc", "--apply", "--reason", "compromised"])).toEqual({
      id: "mcpOauthGrant.abc",
      all: false,
      apply: true,
      reason: "compromised",
    });
    expect(parseArgs(["--all", "--apply"])).toEqual({ id: null, all: true, apply: true, reason: DEFAULT_REASON });
  });

  it("--id alone (no --apply) parses as a valid dry-run preview, not an error", () => {
    expect(parseArgs(["--id", "mcpOauthGrant.abc"])).toEqual({
      id: "mcpOauthGrant.abc",
      all: false,
      apply: false,
      reason: DEFAULT_REASON,
    });
  });

  it("--all alone (no --apply) parses as a valid dry-run preview, not an error", () => {
    expect(parseArgs(["--all"])).toEqual({ id: null, all: true, apply: false, reason: DEFAULT_REASON });
  });

  it("rejects --id and --all together", () => {
    expect(() => parseArgs(["--id", "mcpOauthGrant.abc", "--all"])).toThrow(/mutually exclusive/);
  });

  it("rejects --apply with neither --id nor --all", () => {
    expect(() => parseArgs(["--apply"])).toThrow(/needs --id or --all/);
  });

  it("rejects an --id that does not start with the grant id prefix", () => {
    expect(() => parseArgs(["--id", "not-a-grant-id"])).toThrow(/must start with/);
    expect(() => parseArgs(["--id", "mcpOauthCode.abc"])).toThrow(/must start with/);
  });

  it("rejects --id / --reason given with no value", () => {
    expect(() => parseArgs(["--id"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--reason"])).toThrow(/needs a value/);
  });

  it("rejects a value swallowed by the next flag instead of guessing", () => {
    expect(() => parseArgs(["--id", "--apply"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--reason", "--apply"])).toThrow(/needs a value/);
  });
});

describe("selectGrantsToRevoke", () => {
  const live = { _id: "mcpOauthGrant.live", revoked: false };
  const revoked = {
    _id: "mcpOauthGrant.revoked",
    revoked: true,
    revokedAt: "2026-01-01T00:00:00.000Z",
    revokedReason: "manual",
  };
  const grants = [live, revoked];

  it("--all selects every non-revoked grant and skips revoked ones", () => {
    expect(selectGrantsToRevoke(grants, { id: null, all: true })).toEqual([live]);
  });

  it("--id selects that one grant when it is live", () => {
    expect(selectGrantsToRevoke(grants, { id: "mcpOauthGrant.live", all: false })).toEqual([live]);
  });

  it("--id of an already-revoked grant revokes nothing", () => {
    expect(selectGrantsToRevoke(grants, { id: "mcpOauthGrant.revoked", all: false })).toEqual([]);
  });

  it("--id naming no fetched grant selects nothing (the caller reports 'no such grant')", () => {
    expect(selectGrantsToRevoke(grants, { id: "mcpOauthGrant.missing", all: false })).toEqual([]);
  });

  it("neither --id nor --all selects nothing", () => {
    expect(selectGrantsToRevoke(grants, { id: null, all: false })).toEqual([]);
  });
});

describe("buildRevocationPatch", () => {
  it("sets exactly revoked, revokedAt and revokedReason", () => {
    const patch = buildRevocationPatch({ reason: "manual", at: "2026-09-24T12:00:00.000Z" });
    expect(patch).toEqual({ revoked: true, revokedAt: "2026-09-24T12:00:00.000Z", revokedReason: "manual" });
    expect(Object.keys(patch).sort()).toEqual(["revoked", "revokedAt", "revokedReason"]);
  });

  it("carries the given reason and timestamp through unchanged", () => {
    const patch = buildRevocationPatch({ reason: "refresh_token_reuse", at: "2026-02-03T04:05:06.000Z" });
    expect(patch.revokedReason).toBe("refresh_token_reuse");
    expect(patch.revokedAt).toBe("2026-02-03T04:05:06.000Z");
  });
});
