// The editor's member tokens (plan T1.3, A5): opaque, stable across one lineage, different across
// lineages and secrets, and resolved only over the ids a call may name.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MEMBER_TOKEN_RE, memberToken, memberTokenKey, memberTokens } from "../memberTokens";

const KEY = new TextEncoder().encode("k".repeat(32));
const OTHER = new TextEncoder().encode("o".repeat(32));
const ROOT = "0123456789abcdefghjkmnpqrs";

describe("member tokens", () => {
  it("are 22 base64url characters that name nobody", () => {
    const t = memberToken(KEY, ROOT, "m-ana");
    expect(t).toMatch(MEMBER_TOKEN_RE);
    expect(t).not.toContain("ana");
  });

  it("are stable for one (secret, root, id) and differ when any of the three changes", () => {
    const t = memberToken(KEY, ROOT, "m-ana");
    expect(memberToken(KEY, ROOT, "m-ana")).toBe(t);
    expect(memberToken(KEY, ROOT, "m-bruno")).not.toBe(t);
    expect(memberToken(KEY, "zyxwvtsrqpnmkjhgfedcba9876", "m-ana")).not.toBe(t);
    expect(memberToken(OTHER, ROOT, "m-ana")).not.toBe(t);
  });

  it("resolve both ways over the given ids only; a malformed or foreign token is nobody", () => {
    const tokens = memberTokens(KEY, ROOT, ["m-ana", "m-bruno", "m-ana"]);
    expect(tokens.idOf(tokens.tokenOf("m-ana"))).toBe("m-ana");
    expect(tokens.idOf(tokens.tokenOf("m-bruno"))).toBe("m-bruno");
    // A seated member who left the pool is resolvable because the caller passes the seated ids too.
    expect(tokens.idOf(memberToken(KEY, ROOT, "m-gone"))).toBeNull();
    expect(memberTokens(KEY, ROOT, ["m-gone"]).idOf(memberToken(KEY, ROOT, "m-gone"))).toBe("m-gone");
    expect(tokens.idOf("m-ana")).toBeNull();
    expect(tokens.idOf(memberToken(OTHER, ROOT, "m-ana"))).toBeNull();
    expect(tokens.idOf("x".repeat(23))).toBeNull();
  });

  it("need the connector's secret: missing or short refuses", () => {
    expect(memberTokenKey({}).ok).toBe(false);
    expect(memberTokenKey({ MCP_OAUTH_SECRET: "short" }).ok).toBe(false);
    expect(memberTokenKey({ MCP_OAUTH_SECRET: "s".repeat(32) }).ok).toBe(true);
  });
});
