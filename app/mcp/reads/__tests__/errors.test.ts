// app/mcp/reads/errors.ts — the P1 read tools' shared result builders (spec
// E1). `runReadTool` proves a thrown Sanity-shaped error never reaches the
// model or the log; `refusalResult`/`successResult` are covered for their own
// contract, matched against `ping.ts`'s established shape.

import { afterEach, describe, expect, it, vi } from "vitest";
import { READ_TOOL_FAILURE_MESSAGE, refusalResult, runReadTool, successResult } from "../errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runReadTool", () => {
  it("turns a thrown Sanity-shaped error into the fixed Spanish message, with none of it in the result or the log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky =
      "Request error while attempting to reach https://xyz.api.sanity.io/v2024-01-01/data/query/production?token=abc";
    const result = await runReadTool("get_service", () => {
      throw new Error(leaky);
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: READ_TOOL_FAILURE_MESSAGE }]);

    // Not even a fragment of the leaked message survives — token, host or path.
    for (const fragment of ["xyz.api.sanity.io", "token=abc", "production", "Request error"]) {
      expect(JSON.stringify(result)).not.toContain(fragment);
    }

    const loggedText = logged.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(loggedText).toContain("get_service");
    for (const fragment of ["xyz.api.sanity.io", "token=abc", "production", "Request error"]) {
      expect(loggedText).not.toContain(fragment);
    }
  });

  it("logs the fixed tag and only the tool name", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await runReadTool("search_songs", () => {
      throw new Error("boom");
    });
    expect(logged).toHaveBeenCalledWith("[mcp-read] tool failed:", "search_songs");
  });

  it("catches a rejected promise the same as a synchronous throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runReadTool("get_song", async () => {
      throw new Error("async boom");
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: READ_TOOL_FAILURE_MESSAGE }]);
  });

  it("passes a handler's own result through untouched on success", async () => {
    const ok = successResult({ ok: true });
    const result = await runReadTool("ping_like", () => ok);
    expect(result).toBe(ok);
  });
});

describe("refusalResult", () => {
  it("carries the caller's own Spanish message as a tool error", () => {
    const result = refusalResult("No se encontró ningún miembro con ese nombre.");
    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "No se encontró ningún miembro con ese nombre." }],
    });
  });

  it("carries candidate data alongside the message", () => {
    const candidates = [{ id: "1", name: "Ana" }, { id: "2", name: "Ana María" }];
    const result = refusalResult("El nombre es ambiguo; hay varias personas que coinciden.", { candidates });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "El nombre es ambiguo; hay varias personas que coinciden." },
    ]);
    expect(result.structuredContent).toEqual({ candidates });
  });
});

describe("successResult", () => {
  it("carries the payload as JSON text AND as structuredContent (ping.ts's shape)", () => {
    const payload = { ok: true, server: "owt-backstage", items: [1, 2, 3] };
    const result = successResult(payload);
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
    expect(result.structuredContent).toEqual(payload);
  });
});
