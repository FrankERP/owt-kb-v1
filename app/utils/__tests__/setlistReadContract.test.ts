import { describe, expect, it } from "vitest";
import {
  buildSetlistRead,
  canEditSetlistResponse,
  contentStateFromProjectedSongs,
  type SetlistRead,
} from "@/app/utils/setlistReadContract";

const RECENT = { "song-1": "2026-07-12" };

function entry(over: Record<string, unknown> = {}) {
  return {
    _key: "k1",
    play_key: "G",
    medley_tag: undefined,
    songRef: "song-1",
    song: { _id: "song-1", title: "Sólo en Jesús", author: "OWT", key: "G", slug: "solo-en-jesus" },
    ...over,
  };
}

describe("contentStateFromProjectedSongs", () => {
  it("returns empty for an empty array", () => {
    expect(contentStateFromProjectedSongs([])).toBe("empty");
  });

  it("returns ready when every entry has a resolvable song and a play_key", () => {
    expect(contentStateFromProjectedSongs([entry(), entry({ _key: "k2" })])).toBe("ready");
  });

  it("returns incomplete when a structurally safe entry has a blank play_key", () => {
    expect(contentStateFromProjectedSongs([entry(), entry({ _key: "k2", play_key: "" })])).toBe("incomplete");
  });

  it.each([
    ["not an array", null],
    ["not an array (object)", { nope: true }],
    ["missing _key", [entry({ _key: "" })]],
    ["duplicate _key", [entry(), entry()]],
    ["missing song reference", [entry({ songRef: undefined, song: null })]],
    ["dangling song reference", [entry({ song: null })]],
    ["non-object entry", ["nope"]],
  ])("returns invalid for %s", (_label, songs) => {
    expect(contentStateFromProjectedSongs(songs)).toBe("invalid");
  });

  it("never reports a dangling reference as ordinary incomplete", () => {
    expect(contentStateFromProjectedSongs([entry({ play_key: "", song: null })])).toBe("invalid");
  });
});

describe("buildSetlistRead", () => {
  it("returns none with an observed none state and null identity", () => {
    const read = buildSetlistRead([], [], RECENT);
    expect(read).toEqual({
      targetState: "none",
      observed: { state: "none" },
      setlistId: null,
      songs: [],
      recentSongs: RECENT,
    });
  });

  it("returns a singleton with contentState, observed id/rev and the preserved fields", () => {
    const songs = [entry()];
    const read = buildSetlistRead([{ id: "sl-1", rev: "rev-1", songs }], [], RECENT);
    expect(read).toMatchObject({
      targetState: "single",
      contentState: "ready",
      observed: { state: "single", id: "sl-1", rev: "rev-1" },
      setlistId: "sl-1",
      recentSongs: RECENT,
    });
    expect(read.songs).toEqual(songs);
  });

  it("treats a missing songs field as an empty singleton, not invalid content", () => {
    const read = buildSetlistRead([{ id: "sl-1", rev: "rev-1", songs: [] }], [], RECENT);
    expect(read).toMatchObject({ targetState: "single", contentState: "empty", songs: [] });
  });

  it("returns duplicate with conflictingIds and a null/empty target", () => {
    const read = buildSetlistRead(
      [
        { id: "sl-1", rev: "r1", songs: [] },
        { id: "sl-2", rev: "r2", songs: [] },
      ],
      [],
      RECENT,
    );
    expect(read).toEqual({
      targetState: "duplicate",
      conflictingIds: ["sl-1", "sl-2"],
      draftIds: [],
      setlistId: null,
      songs: [],
      recentSongs: RECENT,
    });
  });

  it("returns draft_conflict whenever a relevant raw draft exists, even for a clean singleton", () => {
    const read = buildSetlistRead(
      [{ id: "sl-1", rev: "r1", songs: [entry()] }],
      ["drafts.sl-1"],
      RECENT,
    );
    expect(read).toEqual({
      targetState: "draft_conflict",
      draftIds: ["drafts.sl-1"],
      canonicalIds: ["sl-1"],
      setlistId: null,
      songs: [],
      recentSongs: RECENT,
    });
  });

  it("returns invalid with a reason and recordIds for a malformed canonical record", () => {
    const read = buildSetlistRead([{ id: "sl-1", rev: "", songs: [] }], [], RECENT);
    expect(read).toMatchObject({
      targetState: "invalid",
      recordIds: ["sl-1"],
      setlistId: null,
      songs: [],
      recentSongs: RECENT,
    });
    expect((read as { reason: string }).reason).toBeTruthy();
  });

  it("keeps recentSongs on every branch", () => {
    const reads: SetlistRead[] = [
      buildSetlistRead([], [], RECENT),
      buildSetlistRead([{ id: "a", rev: "r", songs: [] }], [], RECENT),
      buildSetlistRead([{ id: "a", rev: "r", songs: [] }, { id: "b", rev: "r", songs: [] }], [], RECENT),
      buildSetlistRead([{ id: "a", rev: "r", songs: [] }], ["drafts.a"], RECENT),
      buildSetlistRead([{ id: "a", rev: "", songs: [] }], [], RECENT),
    ];
    for (const read of reads) {
      expect(read.recentSongs).toEqual(RECENT);
      expect(Array.isArray(read.songs)).toBe(true);
      expect("setlistId" in read).toBe(true);
    }
  });
});

describe("canEditSetlistResponse", () => {
  const base = { setlistId: null, songs: [], recentSongs: {} };

  it("opens editable state for a canonical none target", () => {
    const res = canEditSetlistResponse({ ...base, targetState: "none", observed: { state: "none" } });
    expect(res.editable).toBe(true);
  });

  it.each(["empty", "incomplete", "ready"] as const)(
    "opens editable state for a singleton with contentState %s",
    (contentState) => {
      const res = canEditSetlistResponse({
        ...base,
        setlistId: "sl-1",
        targetState: "single",
        contentState,
        observed: { state: "single", id: "sl-1", rev: "r1" },
      });
      expect(res.editable).toBe(true);
    },
  );

  it.each([
    [
      "singleton with invalid content",
      {
        ...base,
        setlistId: "sl-1",
        targetState: "single",
        contentState: "invalid",
        observed: { state: "single", id: "sl-1", rev: "r1" },
      },
      "invalid_content",
    ],
    [
      "duplicate target",
      { ...base, targetState: "duplicate", conflictingIds: ["a", "b"], draftIds: [] },
      "duplicate",
    ],
    [
      "draft conflict",
      { ...base, targetState: "draft_conflict", draftIds: ["drafts.a"], canonicalIds: ["a"] },
      "draft_conflict",
    ],
    [
      "invalid target",
      { ...base, targetState: "invalid", reason: "malformed_canonical_record", recordIds: ["a"] },
      "invalid_target",
    ],
    ["missing targetState", { ...base }, "malformed"],
    ["unknown targetState", { ...base, targetState: "weird" }, "malformed"],
    ["non-object response", null, "malformed"],
    ["error body", { error: "Forbidden" }, "malformed"],
    ["songs not an array", { setlistId: null, songs: "nope", recentSongs: {}, targetState: "none", observed: { state: "none" } }, "malformed"],
    [
      "recentSongs missing",
      { setlistId: null, songs: [], targetState: "none", observed: { state: "none" } },
      "malformed",
    ],
    [
      "singleton without an observed revision",
      {
        ...base,
        setlistId: "sl-1",
        targetState: "single",
        contentState: "ready",
        observed: { state: "single", id: "sl-1", rev: "" },
      },
      "malformed",
    ],
    [
      "singleton without a contentState",
      {
        ...base,
        setlistId: "sl-1",
        targetState: "single",
        observed: { state: "single", id: "sl-1", rev: "r1" },
      },
      "malformed",
    ],
  ])("stays non-editable for %s", (_label, body, issue) => {
    const res = canEditSetlistResponse(body);
    expect(res.editable).toBe(false);
    expect(res.editable === false && res.issue).toBe(issue);
  });

  it("never converts a failure state into an editable empty setlist", () => {
    const res = canEditSetlistResponse({
      ...base,
      targetState: "duplicate",
      conflictingIds: ["a", "b"],
      draftIds: [],
    });
    expect(res.editable).toBe(false);
    // No `read` payload is exposed, so no caller can render an "empty" editor.
    expect((res as unknown as { read?: unknown }).read).toBeUndefined();
  });
});
