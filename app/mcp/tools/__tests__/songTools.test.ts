// `search_songs` and `get_song` as tools (P1 step 5): registration, the strict
// input, the refusals, E1, and what actually reaches the model — the TEXT
// content as well as `structuredContent`.
//
// The route-level path (bearer check → MCP server → tool) is covered in
// `app/api/__tests__/mcpRoute.test.ts`; this file calls the tool functions and
// the registered handlers directly over the mocked Sanity client.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  operational: vi.fn(),
  raw: vi.fn(),
  /** When set, `loadSongCatalogue` rejects with it (the E1 test — the loader's OWN try/catch is bypassed). */
  catalogueFailure: null as Error | null,
  /** Same, for `loadSongDetailById`. */
  detailFailure: null as Error | null,
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.raw(...a) },
}));

vi.mock("@/app/mcp/reads/songCatalogue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/mcp/reads/songCatalogue")>();
  return {
    ...actual,
    loadSongCatalogue: () => (h.catalogueFailure ? Promise.reject(h.catalogueFailure) : actual.loadSongCatalogue()),
  };
});

vi.mock("@/app/mcp/reads/songDetail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/mcp/reads/songDetail")>();
  return {
    ...actual,
    loadSongDetailById: (id: string) => (h.detailFailure ? Promise.reject(h.detailFailure) : actual.loadSongDetailById(id)),
  };
});

import type { CallToolResult } from "@modelcontextprotocol/server";
import { READ_TOOL_FAILURE_MESSAGE } from "@/app/mcp/reads/errors";
import { songResponder, type SongResponder, type SongResponderOptions } from "@/app/mcp/reads/__tests__/songFixtures";
import { GET_SONG_INPUT, getSongResult, registerGetSong, SONG_UNREADABLE_MESSAGE } from "../getSong";
import { CATALOGUE_UNREADABLE_MESSAGE, registerSearchSongs, SEARCH_SONGS_INPUT, searchSongsResult } from "../searchSongs";

const TODAY = "2026-09-30T23:30:00-06:00";

let responder: SongResponder;

function wire(options: SongResponderOptions = {}) {
  responder = songResponder(options);
  h.operational.mockImplementation(responder.fetch);
}

beforeEach(() => {
  h.operational.mockReset();
  h.raw.mockReset();
  h.catalogueFailure = null;
  h.detailFailure = null;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TODAY));
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

/** Registers a tool on a stand-in server and returns what it registered. */
function registered(register: (server: never) => void) {
  const registerTool = vi.fn();
  register({ registerTool } as never);
  expect(registerTool).toHaveBeenCalledTimes(1);
  const [name, config, handler] = registerTool.mock.calls[0]!;
  return { name, config, handler } as {
    name: string;
    config: { title: string; description: string; inputSchema: typeof GET_SONG_INPUT; annotations: unknown };
    handler: (args: unknown) => Promise<CallToolResult>;
  };
}

describe("registration", () => {
  it.each([
    ["search_songs", registerSearchSongs],
    ["get_song", registerGetSong],
  ] as const)("%s is read-only and strict", (name, register) => {
    const tool = registered(register as (server: never) => void);
    expect(tool.name).toBe(name);
    expect(tool.config.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(tool.config.inputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it("get_song's description states the special exclusion, America/Mexico_City, and that playHistory is uncapped", () => {
    const { config } = registered(registerGetSong as (server: never) => void);
    expect(config.description).toMatch(/especiales NO cuentan/);
    expect(config.description).toMatch(/America\/Mexico_City/);
    expect(config.description).toMatch(/SIN LÍMITE/);
  });

  it("types each field strictly", () => {
    expect(SEARCH_SONGS_INPUT.safeParse({ query: "grande" }).success).toBe(true);
    expect(SEARCH_SONGS_INPUT.safeParse({ tags: ["up-beat"], limit: 5 }).success).toBe(true);
    expect(SEARCH_SONGS_INPUT.safeParse({ limit: 0 }).success).toBe(false);
    expect(SEARCH_SONGS_INPUT.safeParse({ limit: 51 }).success).toBe(false);
    expect(SEARCH_SONGS_INPUT.safeParse({ query: "x", extra: true }).success).toBe(false);
    expect(GET_SONG_INPUT.safeParse({ songId: "song-1" }).success).toBe(true);
    expect(GET_SONG_INPUT.safeParse({ slug: "x" }).success).toBe(true);
    expect(GET_SONG_INPUT.safeParse({ songId: "song-1", extra: true }).success).toBe(false);
  });
});

describe("search_songs", () => {
  it("finds a song by title, accent-insensitive", async () => {
    const result = await searchSongsResult({ query: "cancion" });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { songs: { id: string }[] };
    expect(payload.songs.map((s) => s.id)).toContain("song-cancion");
    expect(JSON.parse(text(result))).toEqual(result.structuredContent);
  });

  it("refuses with neither query nor tags", async () => {
    const result = await searchSongsResult({});
    expect(result.isError).toBe(true);
    expect(h.operational).not.toHaveBeenCalled();
  });

  it("refuses an unknown tag and lists the valid ones", async () => {
    const result = await searchSongsResult({ tags: ["no-existe"] });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("no-existe");
    expect(text(result)).toMatch(/up-beat/);
  });

  it("never returns a drafts.* song", async () => {
    const result = await searchSongsResult({ query: "fantasma" });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { songs: { id: string }[] };
    expect(payload.songs).toEqual([]);
  });

  it("refuses when the catalogue read failed — never an empty result list", async () => {
    wire({ failCatalogue: true });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await searchSongsResult({ query: "grande" });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: CATALOGUE_UNREADABLE_MESSAGE }] });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sk-fixture-secret");
    errorSpy.mockRestore();
  });

  it("turns an UNEXPECTED throw into the fixed Spanish error, never the error's text (E1)", async () => {
    h.catalogueFailure = new Error("boom sk-fixture-secret");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await searchSongsResult({ query: "grande" });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: READ_TOOL_FAILURE_MESSAGE }] });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sk-fixture-secret");
    errorSpy.mockRestore();
  });

  it("never touches the raw (draft-inventory) client — a post is not draft-gated", async () => {
    await searchSongsResult({ query: "grande" });
    expect(h.raw).not.toHaveBeenCalled();
  });

  it("makes exactly one read", async () => {
    await searchSongsResult({ query: "grande" });
    expect(responder.calls).toEqual(["catalogue"]);
  });
});

describe("get_song", () => {
  it("by songId returns the declared field set, in the text too", async () => {
    const result = await getSongResult({ songId: "song-1" });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload.title).toBe("Grande es tu fidelidad");
    expect(payload.lyrics).toBe("hidden_by_chart");
    expect(payload.hasChordChart).toBe(true);
    expect((payload.playHistory as unknown[]).length).toBeGreaterThan(0);
    expect(JSON.parse(text(result))).toEqual(result.structuredContent);
    expect(text(result)).not.toContain("peaks");
  });

  it("by slug resolves the same song", async () => {
    const result = await getSongResult({ slug: "grande-es-tu-fidelidad" });
    expect((result.structuredContent as { title: string }).title).toBe("Grande es tu fidelidad");
  });

  it("refuses a slug two posts share, never picking one (Studio data problem, not enforced by Sanity)", async () => {
    const result = await getSongResult({ slug: "cancion-compartida" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/más de una canción/);
    expect(text(result)).toMatch(/songId/);
  });

  it("refuses neither songId nor slug", async () => {
    const result = await getSongResult({});
    expect(result.isError).toBe(true);
    expect(h.operational).not.toHaveBeenCalled();
  });

  it("refuses songId and slug together", async () => {
    const result = await getSongResult({ songId: "song-1", slug: "x" });
    expect(result.isError).toBe(true);
    expect(h.operational).not.toHaveBeenCalled();
  });

  it("refuses a drafts.* songId before any read", async () => {
    const result = await getSongResult({ songId: "drafts.song-1" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/drafts\.\*/);
    expect(h.operational).not.toHaveBeenCalled();
  });

  it("refuses an unknown songId", async () => {
    const result = await getSongResult({ songId: "song-does-not-exist" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/No existe/);
  });

  it("refuses a canonical id of another document type (never found by the post-only query)", async () => {
    const result = await getSongResult({ songId: "role-sun-1004" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/No existe/);
  });

  it("never touches the raw (draft-inventory) client — no role join for play history", async () => {
    await getSongResult({ songId: "song-1" });
    expect(h.raw).not.toHaveBeenCalled();
  });

  it("makes exactly the reads it needs: the song, then the weekend setlists", async () => {
    await getSongResult({ songId: "song-1" });
    expect(responder.calls).toEqual(["detailById", "setlists"]);
  });

  it("refuses when the song read failed", async () => {
    wire({ failDetail: true });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getSongResult({ songId: "song-1" });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: SONG_UNREADABLE_MESSAGE }] });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sk-fixture-secret");
    errorSpy.mockRestore();
  });

  it("turns an UNEXPECTED throw into the fixed Spanish error, never the error's text (E1)", async () => {
    h.detailFailure = new Error("boom sk-fixture-secret");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getSongResult({ songId: "song-1" });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: READ_TOOL_FAILURE_MESSAGE }] });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sk-fixture-secret");
    errorSpy.mockRestore();
  });

  it("never presents a failed play-history read as a known-empty answer (ruling 3)", async () => {
    wire({ failSetlists: true });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getSongResult({ songId: "song-1" });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { playHistory: unknown[]; notes?: string[] };
    expect(payload.playHistory).toEqual([]);
    expect(payload.notes).toEqual(expect.arrayContaining([expect.stringMatching(/historial/)]));
    errorSpy.mockRestore();
  });

  it("the registered handler is the same call", async () => {
    const { handler } = registered(registerGetSong as (server: never) => void);
    const result = await handler({ songId: "song-1" });
    expect((result.structuredContent as { title: string }).title).toBe("Grande es tu fidelidad");
  });
});
