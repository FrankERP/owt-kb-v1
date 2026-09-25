// `get_participation` as a tool (P1 step 6): registration, the strict input,
// the roles-read refusal, E1, and what actually reaches the model — the TEXT
// content as well as `structuredContent`. The presenter's own parity and
// degradation behaviour is covered in
// `app/mcp/reads/__tests__/participationPresenter.test.ts`; this file exercises
// the tool wrapper over the same P1 step-4 fixture matrix.
//
// The route-level path (bearer check → MCP server → tool) is covered in
// `app/api/__tests__/mcpRoute.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  operational: vi.fn(),
  raw: vi.fn(),
  /** When set, `loadServiceSnapshot` rejects with it (the E1 test). */
  snapshotFailure: null as Error | null,
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.raw(...a) },
}));

vi.mock("@/app/mcp/reads/serviceSnapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/mcp/reads/serviceSnapshot")>();
  return {
    ...actual,
    loadServiceSnapshot: () => (h.snapshotFailure ? Promise.reject(h.snapshotFailure) : actual.loadServiceSnapshot()),
  };
});

import type { CallToolResult } from "@modelcontextprotocol/server";
import { READ_TOOL_FAILURE_MESSAGE } from "@/app/mcp/reads/errors";
import { CATALOGUE_UNREADABLE_MESSAGE } from "@/app/mcp/reads/servicePresenter";
import {
  FROZEN_EVENING,
  readToolStore,
  scopedResponder,
  type ScopedResponder,
  type ScopedResponderOptions,
} from "@/app/mcp/reads/__tests__/readToolFixtures";
import { GET_PARTICIPATION_INPUT, getParticipationResult, registerGetParticipation } from "../getParticipation";

let responder: ScopedResponder;

function wire(options: ScopedResponderOptions = {}) {
  responder = scopedResponder(readToolStore(), options);
  h.operational.mockImplementation(responder.operational);
  h.raw.mockImplementation(responder.raw);
}

beforeEach(() => {
  h.operational.mockReset();
  h.raw.mockReset();
  h.snapshotFailure = null;
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
    config: { title: string; description: string; inputSchema: typeof GET_PARTICIPATION_INPUT; annotations: unknown };
    handler: (args: unknown) => Promise<CallToolResult>;
  };
}

describe("registration", () => {
  it("is read-only, strict, and states the drafts-included and especial rules in Spanish", () => {
    const tool = registered(registerGetParticipation as (server: never) => void);
    expect(tool.name).toBe("get_participation");
    expect(tool.config.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(tool.config.inputSchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(tool.config.description).toMatch(/America\/Mexico_City/);
    expect(tool.config.description).toMatch(/borradores incluidos/);
    expect(tool.config.description).toMatch(/especial/);
  });

  it("types month strictly", () => {
    expect(GET_PARTICIPATION_INPUT.safeParse({ month: "2026-09" }).success).toBe(true);
    expect(GET_PARTICIPATION_INPUT.safeParse({ month: "2026-13" }).success).toBe(false);
    expect(GET_PARTICIPATION_INPUT.safeParse({ month: "2026-09", extra: true }).success).toBe(false);
  });
});

describe("get_participation", () => {
  it("defaults to the current CDMX month and counts a special's voice seats as especial and inside total", async () => {
    const result = await getParticipationResult({});
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { month: string; members: { memberId: string; especial: number; total: number }[] };
    expect(payload.month).toBe("2026-09");
    const ana = payload.members.find((m) => m.memberId === "mem-ana")!;
    expect(ana.especial).toBe(1);
    expect(ana.total).toBe(2);
  });

  it("reports each included service's publication state, drafts included", async () => {
    const result = await getParticipationResult({});
    const payload = result.structuredContent as { services: { serviceId: string; published: string }[] };
    expect(payload.services).toEqual([
      { serviceId: "role-sun-0927", date: "2026-09-27", kind: "sunday", published: "published" },
      { serviceId: "role-sp-0930-a", date: "2026-09-30", kind: "special", published: "draft" },
      { serviceId: "role-sp-0930-b", date: "2026-09-30", kind: "special", published: "draft" },
    ]);
  });

  it("reports a seat whose member is missing from membersById, never dropping it", async () => {
    const result = await getParticipationResult({ month: "2026-10" });
    const payload = result.structuredContent as { members: { memberId: string; missing?: true }[] };
    expect(payload.members.find((m) => m.memberId === "mem-ghost")).toMatchObject({ missing: true });
  });

  it("resolves a member seated ONLY on a structurally invalid role, never reporting her missing", async () => {
    // `role-sp-1212-solo-invalid` is not groupable (a null Chorus), so the
    // snapshot's bulk membersById read never collects her ref — this proves
    // the tool's supplementary loadMemberNames call, not just the presenter's.
    const result = await getParticipationResult({ month: "2026-12" });
    const payload = result.structuredContent as { members: { memberId: string; name: string | null; missing?: true }[] };
    const tono = payload.members.find((m) => m.memberId === "mem-tono");
    expect(tono).toMatchObject({ name: "Tono" });
    expect(tono?.missing).toBeUndefined();
  });

  it("refuses when the roles read failed — never zero participation", async () => {
    wire({ fail: ["roles"] });
    const result = await getParticipationResult({ month: "2026-09" });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(CATALOGUE_UNREADABLE_MESSAGE);
    expect(result.structuredContent).toEqual({ failedSources: ["roles", "members"] });
  });

  it("turns any throw into the fixed Spanish error, never the error's text (E1)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.snapshotFailure = new Error("boom token=sk-fixture-secret");
    const result = await getParticipationResult({});
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: READ_TOOL_FAILURE_MESSAGE }] });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sk-fixture-secret");
    errorSpy.mockRestore();
  });

  it("the registered handler is the same call", async () => {
    const { handler } = registered(registerGetParticipation as (server: never) => void);
    const result = await handler({ month: "2026-09" });
    expect((result.structuredContent as { month: string }).month).toBe("2026-09");
  });
});
