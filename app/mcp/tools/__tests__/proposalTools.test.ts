// `list_proposals` as a tool (P1 step 7): registration, the strict input, the
// mutually-exclusive selector, the roles/proposals refusal, E1, and what
// actually reaches the model. The presenter's own linking, truncation and
// name-resolution behaviour is covered in
// `app/mcp/reads/__tests__/proposalPresenter.test.ts`; this file exercises the
// tool wrapper over the same P1 step-4 fixture matrix.
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
import { LIST_PROPOSALS_UNREADABLE_MESSAGE } from "@/app/mcp/reads/proposalPresenter";
import {
  FROZEN_EVENING,
  readToolStore,
  scopedResponder,
  type ScopedResponder,
  type ScopedResponderOptions,
} from "@/app/mcp/reads/__tests__/readToolFixtures";
import { LIST_PROPOSALS_INPUT, listProposalsResult, registerListProposals } from "../listProposals";

let errorSpy: ReturnType<typeof vi.spyOn>;
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
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FROZEN_EVENING));
  wire();
});

afterEach(() => {
  errorSpy.mockRestore();
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
    config: { title: string; description: string; inputSchema: typeof LIST_PROPOSALS_INPUT; annotations: unknown };
    handler: (args: unknown) => Promise<CallToolResult>;
  };
}

describe("registration", () => {
  it("is read-only, strict, and states the truncation and no-unread rules in Spanish", () => {
    const tool = registered(registerListProposals as (server: never) => void);
    expect(tool.name).toBe("list_proposals");
    expect(tool.config.annotations).toEqual({ readOnlyHint: true });
    expect(tool.config.inputSchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(tool.config.description).toMatch(/America\/Mexico_City/);
    expect(tool.config.description).toMatch(/truncated/);
    expect(tool.config.description).toMatch(/leído/);
    expect(tool.config.description).toMatch(/lead_notes\/admin_notes\/team_notes/);
  });

  it("types serviceId and month strictly", () => {
    expect(LIST_PROPOSALS_INPUT.safeParse({ serviceId: "role-sun-1011" }).success).toBe(true);
    expect(LIST_PROPOSALS_INPUT.safeParse({ month: "2026-10" }).success).toBe(true);
    expect(LIST_PROPOSALS_INPUT.safeParse({ month: "2026-13" }).success).toBe(false);
    expect(LIST_PROPOSALS_INPUT.safeParse({ month: "2026-10", extra: true }).success).toBe(false);
  });
});

describe("list_proposals", () => {
  it("refuses serviceId combined with month", async () => {
    const result = await listProposalsResult({ serviceId: "role-sun-1011", month: "2026-10" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/no se combina/);
    expect(h.operational).not.toHaveBeenCalled();
  });

  it("{ serviceId } returns that service's whole thread, with names resolved (including an unseated contributor)", async () => {
    const result = await listProposalsResult({ serviceId: "role-sun-1011" });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as {
      serviceId: string;
      proposals: {
        proposalId: string;
        serviceId: string | null;
        lead: { name: string | null };
        contributors: { name: string | null }[];
        messages: unknown[];
        messagesTotal: number;
        truncated: boolean;
      }[];
    };
    expect(payload.serviceId).toBe("role-sun-1011");
    expect(payload.proposals).toHaveLength(1);
    const [prop] = payload.proposals;
    expect(prop!.proposalId).toBe("prop-sun-1011");
    expect(prop!.serviceId).toBe("role-sun-1011");
    expect(prop!.lead.name).toBe("Luis");
    expect(prop!.contributors).toEqual([{ memberId: "mem-pablo", name: "Pablo" }]);
    expect(prop!.messagesTotal).toBe(2);
    expect(prop!.truncated).toBe(false);
    expect(prop!.messages).toHaveLength(2);
  });

  it("{ serviceId } refuses a drafts.* id before any read, the same way get_service does", async () => {
    const result = await listProposalsResult({ serviceId: "drafts.role-sp-draftonly" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/borrador/i);
    expect(h.operational).not.toHaveBeenCalled();
  });

  it("{ serviceId } refuses an id naming no service", async () => {
    const result = await listProposalsResult({ serviceId: "role-nonexistent" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/No existe un servicio/);
  });

  it("{ month } defaults to the current CDMX month", async () => {
    const result = await listProposalsResult({});
    const payload = result.structuredContent as { month: string; proposals: unknown[] };
    expect(payload.month).toBe("2026-09");
    expect(payload.proposals).toEqual([]);
  });

  it("{ month } links every proposal to its service, an unresolvable one included as null", async () => {
    const result = await listProposalsResult({ month: "2026-10" });
    const payload = result.structuredContent as { month: string; proposals: { proposalId: string; serviceId: string | null }[] };
    expect(payload.month).toBe("2026-10");
    expect(payload.proposals.map((p) => [p.proposalId, p.serviceId]).sort()).toEqual(
      [
        ["prop-sat-1003", "role-sat-1003"],
        ["prop-sun-1011", "role-sun-1011"],
        ["prop-orphan", null],
      ].sort(),
    );
  });

  it("refuses when the roles read failed — never an empty list", async () => {
    wire({ fail: ["roles"] });
    const result = await listProposalsResult({ month: "2026-10" });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(LIST_PROPOSALS_UNREADABLE_MESSAGE);
  });

  it("refuses when the proposals read failed — never an empty list", async () => {
    wire({ fail: ["proposals"] });
    const result = await listProposalsResult({ month: "2026-10" });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(LIST_PROPOSALS_UNREADABLE_MESSAGE);
  });

  it("turns any throw into the fixed Spanish error, never the error's text (E1)", async () => {
    h.snapshotFailure = new Error("boom token=sk-fixture-secret");
    const result = await listProposalsResult({});
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: READ_TOOL_FAILURE_MESSAGE }] });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sk-fixture-secret");
  });

  it("the registered handler is the same call", async () => {
    const { handler } = registered(registerListProposals as (server: never) => void);
    const result = await handler({ month: "2026-10" });
    expect((result.structuredContent as { month: string }).month).toBe("2026-10");
  });
});
