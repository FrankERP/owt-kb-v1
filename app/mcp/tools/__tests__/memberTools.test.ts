// `get_member_availability` as a tool (P1 step 6): registration, the strict
// input, the mutually-exclusive selector, the I5 worship-audience filter, D8's
// ambiguous-name refusal, and E1 — the TEXT content as well as
// `structuredContent`.
//
// The route-level path (bearer check → MCP server → tool) is covered in
// `app/api/__tests__/mcpRoute.test.ts`; this file calls the tool function and
// the registered handler directly over the mocked Sanity client.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  operational: vi.fn(),
  /** When set, `loadWorshipMemberDirectory` rejects with it (the E1 test — the loader's OWN try/catch is bypassed). */
  directoryFailure: null as Error | null,
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: vi.fn() },
}));

vi.mock("@/app/mcp/reads/memberDirectory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/mcp/reads/memberDirectory")>();
  return {
    ...actual,
    loadWorshipMemberDirectory: () =>
      h.directoryFailure ? Promise.reject(h.directoryFailure) : actual.loadWorshipMemberDirectory(),
  };
});

import type { CallToolResult } from "@modelcontextprotocol/server";
import { READ_TOOL_FAILURE_MESSAGE } from "@/app/mcp/reads/errors";
import { memberResponder, type MemberResponder, type MemberResponderOptions } from "@/app/mcp/reads/__tests__/memberFixtures";
import {
  DIRECTORY_UNREADABLE_MESSAGE,
  GET_MEMBER_AVAILABILITY_INPUT,
  getMemberAvailabilityResult,
  registerGetMemberAvailability,
} from "../getMemberAvailability";

const FROZEN_EVENING = "2026-09-30T23:30:00-06:00";

let responder: MemberResponder;

function wire(options: MemberResponderOptions = {}) {
  responder = memberResponder(options);
  h.operational.mockImplementation(responder.fetch);
}

beforeEach(() => {
  h.operational.mockReset();
  h.directoryFailure = null;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FROZEN_EVENING));
  wire();
});

afterEach(() => {
  vi.useRealTimers();
});

function text(result: CallToolResult): string {
  const [first] = result.content as { type: string; text: string }[];
  expect(first!.type).toBe("text");
  return first!.text;
}

/** Registers the tool on a stand-in server and returns what it registered. */
function registered(register: (server: never) => void) {
  const registerTool = vi.fn();
  register({ registerTool } as never);
  expect(registerTool).toHaveBeenCalledTimes(1);
  const [name, config, handler] = registerTool.mock.calls[0]!;
  return { name, config, handler } as {
    name: string;
    config: { title: string; description: string; inputSchema: typeof GET_MEMBER_AVAILABILITY_INPUT; annotations: unknown };
    handler: (args: unknown) => Promise<CallToolResult>;
  };
}

describe("registration", () => {
  it("is read-only, strict, and states the worship-only and mutual-exclusion rules in Spanish", () => {
    const tool = registered(registerGetMemberAvailability as (server: never) => void);
    expect(tool.name).toBe("get_member_availability");
    expect(tool.config.annotations).toEqual({ readOnlyHint: true });
    expect(tool.config.inputSchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(tool.config.description).toMatch(/America\/Mexico_City/);
    expect(tool.config.description).toMatch(/SOLO al equipo de alabanza/);
    expect(tool.config.description).toMatch(/nunca ambos/);
  });

  it("types each field strictly", () => {
    expect(GET_MEMBER_AVAILABILITY_INPUT.safeParse({ month: "2026-09" }).success).toBe(true);
    expect(GET_MEMBER_AVAILABILITY_INPUT.safeParse({ month: "2026-13" }).success).toBe(false);
    expect(GET_MEMBER_AVAILABILITY_INPUT.safeParse({ memberId: "mem-ana" }).success).toBe(true);
    expect(GET_MEMBER_AVAILABILITY_INPUT.safeParse({ name: "Ana" }).success).toBe(true);
    expect(GET_MEMBER_AVAILABILITY_INPUT.safeParse({ memberId: "mem-ana", extra: true }).success).toBe(false);
  });
});

describe("get_member_availability", () => {
  it("with no selector, defaults to the current CDMX month and returns the whole worship team, ordered by name", async () => {
    const result = await getMemberAvailabilityResult({});
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { month: string; members: { memberId: string; name: string | null }[] };
    expect(payload.month).toBe("2026-09");
    // Kids-only "Kiki" is absent even though nothing selected her explicitly (I5).
    const names = payload.members.map((m) => m.name);
    expect(names).not.toContain("Kiki");
    expect(names).toEqual([...names].sort((a, b) => (a ?? "").localeCompare(b ?? "", "es")));
  });

  it("a member with no ministries field is present, and one with worship+kids is present", async () => {
    const result = await getMemberAvailabilityResult({});
    const payload = result.structuredContent as { members: { memberId: string }[] };
    const ids = payload.members.map((m) => m.memberId);
    expect(ids).toContain("mem-sofia"); // no `ministries` at all
    expect(ids).toContain("mem-mix"); // ["worship", "kids"]
    expect(ids).not.toContain("mem-kiki"); // kids-only
  });

  it("resolves one member by memberId", async () => {
    const result = await getMemberAvailabilityResult({ memberId: "mem-luis" });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { members: Record<string, unknown>[] };
    expect(payload.members).toHaveLength(1);
    expect(payload.members[0]).toMatchObject({ memberId: "mem-luis", name: "Luis", alias: "Lucho" });
  });

  it("reports tipo as MEMBER_TYPE_LABEL's Spanish labels", async () => {
    const result = await getMemberAvailabilityResult({ memberId: "mem-ana" });
    const payload = result.structuredContent as { members: { tipo: string[] }[] };
    expect(payload.members[0]!.tipo).toEqual(["Voz", "Líder Domingo"]);
  });

  it("flags a disabled member, never hiding them (spec D7)", async () => {
    const result = await getMemberAvailabilityResult({ memberId: "mem-luis" });
    const payload = result.structuredContent as { members: { disabled: boolean }[] };
    expect(payload.members[0]!.disabled).toBe(true);
  });

  it("refuses a kids-only memberId with the SAME message as an unknown one, so as not to leak it", async () => {
    const unknown = await getMemberAvailabilityResult({ memberId: "mem-nope" });
    const kidsOnly = await getMemberAvailabilityResult({ memberId: "mem-kiki" });
    expect(unknown.isError).toBe(true);
    expect(kidsOnly.isError).toBe(true);
    expect(text(kidsOnly)).toBe(text(unknown));
    expect(h.operational).toHaveBeenCalled(); // the id is checked against a real read, not rejected by shape alone
  });

  it("refuses a drafts.* memberId as an invalid id, before any read", async () => {
    const result = await getMemberAvailabilityResult({ memberId: "drafts.mem-ana" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/id de documento válido/);
    expect(h.operational).not.toHaveBeenCalled();
  });

  it("matches a name exactly after normalizeText — accent-insensitive, case-insensitive", async () => {
    const result = await getMemberAvailabilityResult({ name: "sofia" });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { members: { memberId: string }[] };
    expect(payload.members).toHaveLength(1);
    expect(payload.members[0]!.memberId).toBe("mem-sofia");
  });

  it("matches an alias the same way", async () => {
    const result = await getMemberAvailabilityResult({ name: "Lucho" });
    const payload = result.structuredContent as { members: { memberId: string }[] };
    expect(payload.members.map((m) => m.memberId)).toEqual(["mem-luis"]);
  });

  it("refuses an ambiguous name and lists the candidates", async () => {
    const result = await getMemberAvailabilityResult({ name: "Popo" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      candidates: [
        { memberId: "mem-popo-1", name: "Guadalupe", alias: "Popo" },
        { memberId: "mem-popo-2", name: "Josefina", alias: "Popo" },
      ],
    });
  });

  it("refuses both memberId and name together", async () => {
    const result = await getMemberAvailabilityResult({ memberId: "mem-ana", name: "Ana" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/no se combina/);
    expect(h.operational).not.toHaveBeenCalled();
  });

  it("filters unavailable dates to the month and attaches the matching note", async () => {
    const september = await getMemberAvailabilityResult({ memberId: "mem-ana", month: "2026-09" });
    const octoberPayload = await getMemberAvailabilityResult({ memberId: "mem-ana", month: "2026-10" });
    expect((september.structuredContent as { members: { unavailable: unknown[] }[] }).members[0]!.unavailable).toEqual([
      { date: "2026-09-05", note: "Viaje" },
    ]);
    expect((octoberPayload.structuredContent as { members: { unavailable: unknown[] }[] }).members[0]!.unavailable).toEqual([
      { date: "2026-10-01" },
    ]);
  });

  it("refuses when the directory read failed", async () => {
    wire({ failDirectory: true });
    const result = await getMemberAvailabilityResult({});
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(DIRECTORY_UNREADABLE_MESSAGE);
  });

  it("turns any throw into the fixed Spanish error, never the error's text (E1)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.directoryFailure = new Error("boom token=sk-fixture-secret");
    const result = await getMemberAvailabilityResult({});
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: READ_TOOL_FAILURE_MESSAGE }] });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sk-fixture-secret");
    errorSpy.mockRestore();
  });

  it("the registered handler is the same call", async () => {
    const { handler } = registered(registerGetMemberAvailability as (server: never) => void);
    const result = await handler({ memberId: "mem-luis" });
    expect((result.structuredContent as { members: { memberId: string }[] }).members[0]!.memberId).toBe("mem-luis");
  });
});
