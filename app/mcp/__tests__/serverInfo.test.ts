// app/mcp/__tests__/serverInfo.test.ts — the MCP server's name and version
// (R22): `serverInfo` at `initialize` and `ping`'s payload report the same pair.

import { describe, expect, it } from "vitest";
import { MCP_SERVER_NAME, mcpServerVersion } from "../serverInfo";

describe("MCP server identity", () => {
  it("is named owt-backstage", () => {
    expect(MCP_SERVER_NAME).toBe("owt-backstage");
  });

  it("reports the first 7 characters of the deployed commit", () => {
    expect(mcpServerVersion({ VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567" })).toBe("0123456");
  });

  it('reports "local" when no commit is deployed', () => {
    expect(mcpServerVersion({})).toBe("local");
    expect(mcpServerVersion({ VERCEL_GIT_COMMIT_SHA: undefined })).toBe("local");
    expect(mcpServerVersion({ VERCEL_GIT_COMMIT_SHA: "" })).toBe("local");
  });
});
