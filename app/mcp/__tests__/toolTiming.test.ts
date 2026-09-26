// app/mcp/toolTiming.ts — the one `[mcp]` timing line (P3 step 7). Its shape is
// the contract `vercel logs --json` is read against, so it is pinned exactly.

import { afterEach, describe, expect, it, vi } from "vitest";
import { logToolTiming, resultOutcome, toolTimingLine } from "../toolTiming";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toolTimingLine", () => {
  it("is exactly `[mcp] tool=<name> outcome=<outcome> code=<code> ms=<n>`", () => {
    expect(toolTimingLine("publish_service", "refused", "stale_revision", 1234.4)).toBe(
      "[mcp] tool=publish_service outcome=refused code=stale_revision ms=1234",
    );
    expect(toolTimingLine("get_service", "ok", "-", 0)).toBe("[mcp] tool=get_service outcome=ok code=- ms=0");
  });

  it("drops a code that is not a bare machine token, so nothing else can ride on it", () => {
    for (const code of ["Stale", "token=abc", "a b", "x".repeat(65), "", "-x", "role-sun-1004"]) {
      expect(toolTimingLine("edit_setlist", "refused", code, 5)).toBe(
        "[mcp] tool=edit_setlist outcome=refused code=- ms=5",
      );
    }
  });

  it("rounds ms to a non-negative integer", () => {
    expect(toolTimingLine("t_x", "ok", "-", 12.6)).toMatch(/ ms=13$/);
    expect(toolTimingLine("t_x", "ok", "-", -3)).toMatch(/ ms=0$/);
    expect(toolTimingLine("t_x", "ok", "-", Number.NaN)).toMatch(/ ms=0$/);
  });
});

describe("resultOutcome", () => {
  it("reads ok, refused, and the refusal's own code", () => {
    expect(resultOutcome({ content: [] })).toEqual({ outcome: "ok", code: "-" });
    expect(resultOutcome({ isError: true, content: [] })).toEqual({ outcome: "refused", code: "-" });
    expect(
      resultOutcome({ isError: true, content: [], structuredContent: { refused: true, code: "not_found" } }),
    ).toEqual({ outcome: "refused", code: "not_found" });
  });

  it("never lets a non-token code through", () => {
    expect(
      resultOutcome({ isError: true, content: [], structuredContent: { code: "https://x.api.sanity.io" } }),
    ).toEqual({ outcome: "refused", code: "-" });
    expect(resultOutcome({ content: [], structuredContent: { code: 42 } })).toEqual({ outcome: "ok", code: "-" });
  });
});

describe("logToolTiming", () => {
  it("logs the line on console.info — never console.error — measured from the start mark", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockReturnValue(1500);
    logToolTiming("unpublish_service", "ok", "-", 1000);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[mcp] tool=unpublish_service outcome=ok code=- ms=500");
    expect(error).not.toHaveBeenCalled();
  });

  it("never throws, even when logging does", () => {
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("sink down");
    });
    expect(() => logToolTiming("ping_like", "ok", "-", 0)).not.toThrow();
  });
});
