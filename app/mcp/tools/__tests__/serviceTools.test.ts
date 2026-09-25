// `get_service` and `list_services` as tools (P1 step 4): registration, the
// strict input, the refusals, E1, and what actually reaches the model — the
// TEXT content as well as `structuredContent`.
//
// The route-level path (bearer check → MCP server → tool) is covered in
// `app/api/__tests__/mcpRoute.test.ts`; this file calls the tool functions and
// the registered handlers directly over the mocked clients.

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
import { FIXTURE_FAILURE_SECRET } from "@/app/mcp/reads/__tests__/serviceFixtures";
import { GET_SERVICE_INPUT, getServiceResult, registerGetService } from "../getService";
import { LIST_SERVICES_INPUT, listServicesResult, registerListServices } from "../listServices";

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

/** Registers a tool on a stand-in server and returns what it registered. */
function registered(register: (server: never) => void) {
  const registerTool = vi.fn();
  register({ registerTool } as never);
  expect(registerTool).toHaveBeenCalledTimes(1);
  const [name, config, handler] = registerTool.mock.calls[0]!;
  return { name, config, handler } as {
    name: string;
    config: { title: string; description: string; inputSchema: typeof GET_SERVICE_INPUT; annotations: unknown };
    handler: (args: unknown) => Promise<CallToolResult>;
  };
}

describe("registration", () => {
  it.each([
    ["get_service", registerGetService],
    ["list_services", registerListServices],
  ] as const)("%s is read-only, strict, and states the I7 rule in Spanish", (name, register) => {
    const tool = registered(register as (server: never) => void);
    expect(tool.name).toBe(name);
    expect(tool.config.annotations).toEqual({ readOnlyHint: true });
    expect(tool.config.inputSchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(tool.config.description).toMatch(/SIN CAMBIOS/);
    expect(tool.config.description).toMatch(/nunca los? construyas/);
    expect(tool.config.description).toMatch(/America\/Mexico_City/);
  });

  it("get_service says the default includes drafts, reports publication, and how to read publishCheck", () => {
    const { config } = registered(registerGetService as (server: never) => void);
    expect(config.description).toMatch(/INCLUIDOS los borradores/);
    expect(config.description).toMatch(/published: "draft" \| "published"/);
    expect(config.description).toMatch(/la verificación de publicación por servicio pasa ahora/);
  });

  it("types each field strictly", () => {
    expect(GET_SERVICE_INPUT.safeParse({ date: "2026-10-04", kind: "sunday" }).success).toBe(true);
    expect(GET_SERVICE_INPUT.safeParse({ kind: "sunday_role", date: "2026-10-04" }).success).toBe(false);
    expect(GET_SERVICE_INPUT.safeParse({ date: "4/10/2026" }).success).toBe(false);
    expect(LIST_SERVICES_INPUT.safeParse({ month: "2026-10" }).success).toBe(true);
    expect(LIST_SERVICES_INPUT.safeParse({ month: "2026-13" }).success).toBe(false);
    expect(LIST_SERVICES_INPUT.safeParse({ month: "2026-10", extra: true }).success).toBe(false);
  });
});

describe("get_service", () => {
  it("{} answers the next service in Mexico City (2026-09-30 at 23:30, already October in UTC), with its same-day sibling", async () => {
    const result = await getServiceResult({});
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload).toMatchObject({ serviceId: "role-sp-0930-a", date: "2026-09-30", published: "draft" });
    expect(payload.sameDayOthers).toEqual([
      { serviceId: "role-sp-0930-b", kind: "special", date: "2026-09-30", name: "Vigilia", time: "21:00" },
    ]);
  });

  it("puts the seat names and song titles in the TEXT content, not only in structuredContent", async () => {
    const result = await getServiceResult({ serviceId: "role-sun-1004" });
    const body = text(result);
    for (const name of ["Ana", "Sofía", "Lucho", "Grande es tu fidelidad", "set-sun-1004-rev", "role-sun-1004-rev"]) {
      expect(body).toContain(name);
    }
    expect(JSON.parse(body)).toEqual(result.structuredContent);
  });

  it("refuses a drafts.* id before reading anything, and never calls it published", async () => {
    const result = await getServiceResult({ serviceId: "drafts.role-sp-draftonly" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/borrador/);
    expect(text(result)).not.toMatch(/publicado/);
    expect(h.operational).not.toHaveBeenCalled();
    expect(h.raw).not.toHaveBeenCalled();
  });

  it("refuses an unknown id", async () => {
    const result = await getServiceResult({ serviceId: "role-missing" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/No existe/);
  });

  it("refuses an ambiguous camp day and lists the candidates, in the text too", async () => {
    const result = await getServiceResult({ date: "2026-10-17", kind: "special" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      candidates: [
        { serviceId: "role-sp-1017-a", kind: "special", date: "2026-10-17", name: "Campamento · Mañana", time: "09:00" },
        { serviceId: "role-sp-1017-b", kind: "special", date: "2026-10-17", name: "Campamento · Noche", time: "19:00" },
      ],
    });
    expect(text(result)).toContain("role-sp-1017-a");
    expect(text(result)).toContain("role-sp-1017-b");
  });

  it("refuses when the roles read failed — the catalogue is unknown, not empty", async () => {
    wire({ fail: ["roles"] });
    const result = await getServiceResult({ serviceId: "role-sun-1004" });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(CATALOGUE_UNREADABLE_MESSAGE);
    expect(result.structuredContent).toEqual({ failedSources: ["roles", "members"] });
    expect(JSON.stringify(result)).not.toContain(FIXTURE_FAILURE_SECRET);
  });

  it("answers with the data and failedSources when another domain failed", async () => {
    wire({ fail: ["proposals"] });
    const result = await getServiceResult({ serviceId: "role-sun-1004" });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as Record<string, unknown>).failedSources).toEqual(["proposals"]);
  });

  it("turns any throw into the fixed Spanish error, never the error's text (E1)", async () => {
    h.snapshotFailure = new Error(`boom ${FIXTURE_FAILURE_SECRET}`);
    const result = await getServiceResult({});
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: READ_TOOL_FAILURE_MESSAGE }] });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(FIXTURE_FAILURE_SECRET);
  });

  it("makes one snapshot load (eight reads), then only the content reads it needs", async () => {
    // Every name is in the snapshot's seat map; the titles are one `post` read.
    await getServiceResult({ serviceId: "role-sun-1004" });
    expect(responder.calls).toHaveLength(8);
    expect(new Set(responder.calls.map((c) => c.domain)).size).toBe(8);
    expect(responder.scopedCalls).toEqual(["songTitles"]);

    // A dangling seat is not in that map: one more names read. An ambiguous setlist has no rows: no titles read.
    wire();
    await getServiceResult({ serviceId: "role-sun-1025" });
    expect(responder.calls.map((c) => c.domain).filter((d) => d === "members")).toHaveLength(2);
    expect(responder.calls.at(-1)).toMatchObject({ domain: "members", params: { ids: ["mem-ghost"] } });
    expect(responder.scopedCalls).toEqual([]);
  });
});

describe("list_services", () => {
  it("defaults to the current month in Mexico City (September at 23:30 on the 30th)", async () => {
    const result = await listServicesResult({});
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { month: string; services: { serviceId: string }[] };
    expect(payload.month).toBe("2026-09");
    expect(payload.services.map((s) => s.serviceId)).toEqual(["role-sun-0927", "role-sp-0930-a", "role-sp-0930-b"]);
  });

  it("answers an explicit month, as JSON text equal to structuredContent", async () => {
    const result = await listServicesResult({ month: "2026-10" });
    const payload = result.structuredContent as { services: unknown[] };
    expect(payload.services).toHaveLength(9);
    expect(JSON.parse(text(result))).toEqual(result.structuredContent);
  });

  it("refuses when the roles read failed — never services: []", async () => {
    wire({ fail: ["roles"] });
    const result = await listServicesResult({ month: "2026-10" });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(CATALOGUE_UNREADABLE_MESSAGE);
    expect(result.structuredContent).toEqual({ failedSources: ["roles", "members"] });
    expect(JSON.stringify(result)).not.toContain('"services"');
  });

  it("turns any throw into the fixed Spanish error (E1)", async () => {
    h.snapshotFailure = new Error(`boom ${FIXTURE_FAILURE_SECRET}`);
    const result = await listServicesResult({});
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: READ_TOOL_FAILURE_MESSAGE }] });
  });

  it("the registered handler is the same call", async () => {
    const { handler } = registered(registerListServices as (server: never) => void);
    const result = await handler({ month: "2026-10" });
    expect((result.structuredContent as { month: string }).month).toBe("2026-10");
  });
});
