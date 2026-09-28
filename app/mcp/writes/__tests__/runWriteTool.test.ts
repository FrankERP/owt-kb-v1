// app/mcp/writes/runWriteTool.ts — the write runner's phase rule (P3 step 7).
//
// A throw before the domain was called wrote nothing and says so; a throw at or
// after it is an unknown outcome and says to re-read. Either way no fragment of
// the thrown message — which is Sanity's own text in production — reaches the
// result or the log, and the call logs exactly one timing line.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  WRITE_PRE_FAILURE_MESSAGE,
  WRITE_UNKNOWN_OUTCOME_MESSAGE,
  runWriteTool,
  safeReportRead,
} from "../runWriteTool";

const LEAKY =
  "Request error while attempting to reach https://xyz.api.sanity.io/v2024-01-01/data/mutate/production?token=abc";
const LEAK_FRAGMENTS = ["xyz.api.sanity.io", "token=abc", "production", "Request error", "mutate"];

let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function logged(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).join("\n");
}

function expectNoLeak(result: CallToolResult) {
  for (const fragment of LEAK_FRAGMENTS) {
    expect(JSON.stringify(result)).not.toContain(fragment);
    expect(logged(error)).not.toContain(fragment);
    expect(logged(info)).not.toContain(fragment);
  }
}

function expectOneTimingLine(tool: string, outcome: string, code = "-") {
  expect(info).toHaveBeenCalledTimes(1);
  expect(info.mock.calls[0]).toHaveLength(1);
  expect(String(info.mock.calls[0][0])).toMatch(
    new RegExp(`^\\[mcp\\] tool=${tool} outcome=${outcome} code=${code} ms=\\d+$`),
  );
}

describe("runWriteTool — a throw in phase `pre`", () => {
  it("a throw from a pre-read returns «No se escribió nada.», with zero domain calls and nothing leaked", async () => {
    const domain = vi.fn(async () => ({ ok: true }));
    const preRead = vi.fn(async () => {
      throw new Error(LEAKY);
    });
    const result = await runWriteTool("unpublish_service", async ({ callDomain }) => {
      await preRead();
      await callDomain(domain);
      return { content: [{ type: "text", text: "no debería llegar aquí" }] };
    });

    expect(result).toEqual({ isError: true, content: [{ type: "text", text: WRITE_PRE_FAILURE_MESSAGE }] });
    expect(WRITE_PRE_FAILURE_MESSAGE.endsWith("No se escribió nada.")).toBe(true);
    expect(domain).not.toHaveBeenCalled();
    expectNoLeak(result);
    expect(error).toHaveBeenCalledWith("[mcp-write] tool failed before the domain call:", "unpublish_service");
    expect(error).toHaveBeenCalledTimes(1);
    expectOneTimingLine("unpublish_service", "error");
  });

  it("a synchronous throw in the handler body is `pre` too", async () => {
    const result = await runWriteTool("edit_setlist", () => {
      throw new Error(LEAKY);
    });
    expect(result.content).toEqual([{ type: "text", text: WRITE_PRE_FAILURE_MESSAGE }]);
    expectNoLeak(result);
    expectOneTimingLine("edit_setlist", "error");
  });

  it("a handler that never calls the domain stays `pre` even when it throws late", async () => {
    const result = await runWriteTool("swap_assignment", async () => {
      await Promise.resolve();
      await Promise.resolve();
      throw new Error("admission blew up");
    });
    expect(result.content).toEqual([{ type: "text", text: WRITE_PRE_FAILURE_MESSAGE }]);
  });
});

describe("runWriteTool — a throw in phase `domain`", () => {
  it("a throw from the domain function returns the unknown-outcome text, never «No se escribió nada.»", async () => {
    const domain = vi.fn(async () => {
      throw new Error(LEAKY);
    });
    const result = await runWriteTool("publish_service", async ({ callDomain }) => {
      await callDomain(domain);
      return { content: [{ type: "text", text: "no debería llegar aquí" }] };
    });

    expect(result).toEqual({ isError: true, content: [{ type: "text", text: WRITE_UNKNOWN_OUTCOME_MESSAGE }] });
    expect(WRITE_UNKNOWN_OUTCOME_MESSAGE).not.toContain("No se escribió nada");
    expect(domain).toHaveBeenCalledTimes(1);
    expectNoLeak(result);
    expect(error).toHaveBeenCalledWith("[mcp-write] tool failed at or after the domain call:", "publish_service");
    expect(error).toHaveBeenCalledTimes(1);
    expectOneTimingLine("publish_service", "error");
  });

  it("a domain function that throws SYNCHRONOUSLY is already on the domain side", async () => {
    const result = await runWriteTool("publish_service", async ({ callDomain }) => {
      await callDomain(() => {
        throw new Error(LEAKY);
      });
      return { content: [] };
    });
    expect(result.content).toEqual([{ type: "text", text: WRITE_UNKNOWN_OUTCOME_MESSAGE }]);
    expectNoLeak(result);
  });

  it("the phase never goes back: a throw while building the result of a committed write is still unknown", async () => {
    const domain = vi.fn(async () => ({ ok: true as const }));
    const result = await runWriteTool("swap_assignment", async ({ callDomain }) => {
      await callDomain(domain);
      throw new Error("report builder bug");
    });
    expect(domain).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([{ type: "text", text: WRITE_UNKNOWN_OUTCOME_MESSAGE }]);
    expectOneTimingLine("swap_assignment", "error");
  });

  it("control: a domain call made OUTSIDE callDomain is misreported as `pre` — which is what each tool's test catches", async () => {
    const domain = vi.fn(async () => {
      throw new Error("boom");
    });
    const result = await runWriteTool("edit_setlist", async () => {
      await domain();
      return { content: [] };
    });
    expect(result.content).toEqual([{ type: "text", text: WRITE_PRE_FAILURE_MESSAGE }]);
  });

  it("callDomain hands back the domain's own value", async () => {
    const outcome = { ok: false as const, status: 409, body: { error: "stale_revision" } };
    let seen: unknown = null;
    await runWriteTool("unpublish_service", async ({ callDomain }) => {
      seen = await callDomain(async () => outcome);
      return { content: [] };
    });
    expect(seen).toBe(outcome);
  });
});

describe("runWriteTool — a returned result", () => {
  it("passes a success through untouched and logs `outcome=ok code=-`", async () => {
    const ok: CallToolResult = { content: [{ type: "text", text: "{}" }], structuredContent: { ok: true } };
    const result = await runWriteTool("unpublish_service", async ({ callDomain }) => {
      await callDomain(async () => ({ ok: true }));
      return ok;
    });
    expect(result).toBe(ok);
    expect(error).not.toHaveBeenCalled();
    expectOneTimingLine("unpublish_service", "ok");
  });

  it("passes a refusal through untouched and logs its code", async () => {
    const refused: CallToolResult = {
      isError: true,
      content: [{ type: "text", text: "El servicio cambió desde que lo leíste. No se escribió nada." }],
      structuredContent: { refused: true, code: "stale_revision", detail: "revision_moved" },
    };
    const result = await runWriteTool("edit_setlist", async () => refused);
    expect(result).toBe(refused);
    expectOneTimingLine("edit_setlist", "refused", "stale_revision");
  });

  it("the timing line carries no argument, id or name", async () => {
    await runWriteTool("swap_assignment", async () => ({
      isError: true,
      content: [{ type: "text", text: "Ana no está disponible el 2026-10-04 (role-sun-1004)." }],
      structuredContent: { refused: true, code: "integrity_conflict", detail: "lock:missing_lock" },
    }));
    const line = String(info.mock.calls[0][0]);
    for (const fragment of ["Ana", "2026-10-04", "role-sun-1004", "lock", "missing_lock"]) {
      expect(line).not.toContain(fragment);
    }
  });
});

describe("safeReportRead", () => {
  it("returns the value of a read that succeeds", async () => {
    expect(await safeReportRead("member names", async () => ["Ana"])).toEqual({ ok: true, value: ["Ana"] });
    expect(error).not.toHaveBeenCalled();
  });

  it("catches a failed read HERE, logging a fixed tag and the label only", async () => {
    const read = await safeReportRead("read-back", async () => {
      throw new Error(LEAKY);
    });
    expect(read).toEqual({ ok: false });
    expect(error).toHaveBeenCalledWith("[mcp-write] report read failed:", "read-back");
    for (const fragment of LEAK_FRAGMENTS) expect(logged(error)).not.toContain(fragment);
  });

  it("keeps a committed write `ok` when a report read fails after the domain call", async () => {
    const result = await runWriteTool("unpublish_service", async ({ callDomain }) => {
      await callDomain(async () => ({ ok: true }));
      const names = await safeReportRead("member names", async () => {
        throw new Error("names down");
      });
      return {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { ok: true, namesResolved: names.ok },
      };
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ok: true, namesResolved: false });
    expectOneTimingLine("unpublish_service", "ok");
  });
});
