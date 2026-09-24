// app/mcp/tools/__tests__/ping.test.ts — the `ping` tool's pure parts: the
// Mexico City timestamp, the result it returns, its failure result (E1), and
// the static proof that it reads nothing from the dataset. The route test
// (`app/api/__tests__/mcpRoute.test.ts`) covers it end to end.

import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { walkImportClosure } from "@/app/mcp/oauth/__tests__/importClosure";
import { mexicoCityTimestamp, pingResult } from "../ping";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("mexicoCityTimestamp", () => {
  it("renders an instant as ISO-8601 wall-clock time in America/Mexico_City with its offset", () => {
    expect(mexicoCityTimestamp(new Date("2026-09-24T18:30:05.123Z"))).toBe("2026-09-24T12:30:05-06:00");
  });

  it("computes the offset from the time-zone rules instead of hard-coding it", () => {
    // Mexico City observed daylight saving until 2022: on 1 July 2021 it was UTC-5.
    expect(mexicoCityTimestamp(new Date("2021-07-01T17:00:00Z"))).toBe("2021-07-01T12:00:00-05:00");
    expect(mexicoCityTimestamp(new Date("2021-01-15T18:00:00Z"))).toBe("2021-01-15T12:00:00-06:00");
  });

  it("keeps the local calendar day when UTC has already moved on", () => {
    expect(mexicoCityTimestamp(new Date("2026-09-25T03:30:00Z"))).toBe("2026-09-24T21:30:00-06:00");
  });

  it("writes local midnight as 00, never 24", () => {
    expect(mexicoCityTimestamp(new Date("2026-09-24T06:00:00Z"))).toBe("2026-09-24T00:00:00-06:00");
  });

  it("round-trips: parsing the string gives back the instant, to the second", () => {
    for (const iso of ["2026-09-24T18:30:05.999Z", "2021-07-01T04:59:59Z", "2026-01-01T00:00:00Z"]) {
      const instant = new Date(iso);
      expect(Date.parse(mexicoCityTimestamp(instant))).toBe(Math.floor(instant.getTime() / 1000) * 1000);
    }
  });

  it("does not depend on the process time zone (Vercel runs in UTC; the suite pins Mexico City)", () => {
    const instant = new Date("2026-09-25T03:30:00Z");
    for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      vi.stubEnv("TZ", tz);
      // Positive control: the process time zone really changed under the stub.
      expect(new Date("2026-09-25T03:30:00Z").getTimezoneOffset()).not.toBe(360);
      expect(mexicoCityTimestamp(instant)).toBe("2026-09-24T21:30:00-06:00");
    }
  });
});

describe("pingResult", () => {
  it("returns { ok, server, version, now } as JSON text AND as structured content", () => {
    const result = pingResult("abc1234", () => new Date("2026-09-24T18:30:05Z"));
    const expected = { ok: true, server: "owt-backstage", version: "abc1234", now: "2026-09-24T12:30:05-06:00" };
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(expected) }]);
    expect(result.structuredContent).toEqual(expected);
  });

  it("turns a failure into a Spanish tool error that carries no internals (E1)", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = pingResult("abc1234", () => {
      throw new Error("internal detail: sk-secret at ping.ts:12");
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const [block] = result.content;
    expect(block?.type).toBe("text");
    const text = block?.type === "text" ? block.text : "";
    expect(text).toMatch(/^No se pudo/);
    expect(text).not.toMatch(/internal|secret|ping\.ts|Error/);
    // The log line is fixed too.
    const lines = logged.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(lines).not.toMatch(/internal|secret/);
  });
});

describe("ping reads nothing from the dataset", () => {
  it("its import closure reaches no Sanity client, no grant store and no member lookup", () => {
    const repoRoot = process.cwd();
    const { files, externalSpecifiers } = walkImportClosure(path.join(repoRoot, "app/mcp/tools/ping.ts"), repoRoot);

    // Positive control: the walker does reach a Sanity client through the same machinery.
    const { files: storeClosure } = walkImportClosure(path.join(repoRoot, "app/mcp/oauth/grantStore.ts"), repoRoot);
    expect(storeClosure).toContain(path.join(repoRoot, "sanity/lib/serverClient.ts"));

    for (const file of files) {
      expect(path.relative(repoRoot, file), file).not.toMatch(/^sanity\/|grantStore|memberAccess|serverClient/);
    }
    const ALLOWED_EXTERNAL_SPECIFIERS = new Set(["zod", "@modelcontextprotocol/server"]);
    for (const specifier of externalSpecifiers) {
      expect(ALLOWED_EXTERNAL_SPECIFIERS.has(specifier), specifier).toBe(true);
    }
  });
});
