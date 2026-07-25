// Pure request/observed-state contract for the protected live-setlist writer
// (Service Readiness A2 §5).

import { describe, expect, it } from "vitest";
import {
  buildProposalSongDocs,
  buildSetlistSongDocs,
  buildWeekendSetlistDocument,
  compareObservedTarget,
  deterministicSetlistId,
  parseObservedTarget,
  parseSetlistWriteRequest,
  parseSongRows,
  setlistTypeForKind,
  SETLIST_SONGS_MAX,
} from "@/app/utils/setlistWriteRequest";

let n = 0;
const key = () => `k${++n}`;

describe("setlist target identity", () => {
  it("maps Sunday to featuredSongs and Saturday to the deliberate saturdarSongs typo", () => {
    expect(setlistTypeForKind("sunday")).toBe("featuredSongs");
    expect(setlistTypeForKind("saturday")).toBe("saturdarSongs");
    // A special service stores songs on the role itself — no setlist type.
    expect(setlistTypeForKind("special")).toBeNull();
    expect(setlistTypeForKind("midweek")).toBeNull();
  });

  it("derives ONE deterministic id per weekend target", () => {
    expect(deterministicSetlistId("featuredSongs", "2026-08-09")).toBe("featuredSongs.2026-08-09");
    expect(deterministicSetlistId("saturdarSongs", "2026-08-08")).toBe("saturdarSongs.2026-08-08");
  });

  it("refuses an unknown type or a non-calendar date", () => {
    expect(deterministicSetlistId("special_role", "2026-08-09")).toBeNull();
    expect(deterministicSetlistId("featuredSongs", "2026-02-30")).toBeNull();
    expect(deterministicSetlistId("featuredSongs", "2026-8-9")).toBeNull();
    expect(deterministicSetlistId("featuredSongs", undefined)).toBeNull();
  });
});

describe("parseObservedTarget", () => {
  it("accepts an explicit absence and an explicit singleton", () => {
    expect(parseObservedTarget({ state: "none" })).toEqual({ ok: true, value: { state: "none" } });
    expect(parseObservedTarget({ state: "single", id: "s1", rev: "r1" })).toEqual({
      ok: true,
      value: { state: "single", id: "s1", rev: "r1" },
    });
  });

  it.each([
    ["missing", undefined],
    ["not an object", "none"],
    ["unknown state", { state: "duplicate" }],
    ["none with a smuggled id", { state: "none", id: "s1" }],
    ["none with a smuggled rev", { state: "none", rev: "r1" }],
    ["single without an id", { state: "single", rev: "r1" }],
    ["single without a rev", { state: "single", id: "s1" }],
    ["single at a drafts id", { state: "single", id: "drafts.s1", rev: "r1" }],
    ["single with a blank rev", { state: "single", id: "s1", rev: "" }],
  ])("rejects %s", (_label, value) => {
    expect(parseObservedTarget(value).ok).toBe(false);
  });
});

describe("compareObservedTarget", () => {
  it("passes only when the client's view is exactly current", () => {
    expect(compareObservedTarget({ state: "none" }, { state: "none" })).toBeNull();
    expect(
      compareObservedTarget(
        { state: "single", id: "s1", rev: "r1" },
        { state: "single", id: "s1", rev: "r1" },
      ),
    ).toBeNull();
  });

  it("names each mismatch instead of merging or overwriting", () => {
    expect(compareObservedTarget({ state: "none" }, { state: "single", id: "s1", rev: "r1" })).toBe(
      "concurrent_creation",
    );
    expect(compareObservedTarget({ state: "single", id: "s1", rev: "r1" }, { state: "none" })).toBe(
      "target_vanished",
    );
    expect(
      compareObservedTarget(
        { state: "single", id: "s1", rev: "r1" },
        { state: "single", id: "s2", rev: "r1" },
      ),
    ).toBe("identity_mismatch");
    expect(
      compareObservedTarget(
        { state: "single", id: "s1", rev: "r1" },
        { state: "single", id: "s1", rev: "r2" },
      ),
    ).toBe("revision_mismatch");
  });
});

describe("parseSongRows", () => {
  it("normalizes play keys and medley tags, preserving request ORDER", () => {
    const parsed = parseSongRows([
      { songId: "song-2", play_key: "  G  " },
      { songId: "song-1", play_key: "A", medley_tag: " m1 " },
    ]);
    expect(parsed).toEqual({
      ok: true,
      value: [
        { songId: "song-2", playKey: "G", medleyTag: null },
        { songId: "song-1", playKey: "A", medleyTag: "m1" },
      ],
    });
  });

  it("accepts an empty setlist and a blank play key", () => {
    expect(parseSongRows([])).toEqual({ ok: true, value: [] });
    expect(parseSongRows([{ songId: "song-1" }])).toEqual({
      ok: true,
      value: [{ songId: "song-1", playKey: "", medleyTag: null }],
    });
  });

  it.each([
    ["a missing list", undefined],
    ["a non-array", { songId: "song-1" }],
    ["a malformed row", [null]],
    ["a blank song id", [{ songId: "" }]],
    ["a drafts song id", [{ songId: "drafts.song-1" }]],
    ["a non-string play key", [{ songId: "song-1", play_key: 3 }]],
    ["a blank medley tag", [{ songId: "song-1", medley_tag: "  " }]],
  ])("rejects %s rather than silently dropping it", (_label, value) => {
    expect(parseSongRows(value).ok).toBe(false);
  });

  it("bounds the list length", () => {
    const rows = Array.from({ length: SETLIST_SONGS_MAX + 1 }, (_, i) => ({ songId: `song-${i}` }));
    expect(parseSongRows(rows)).toEqual({ ok: false, issues: ["songs_length"] });
  });
});

describe("stored song documents", () => {
  it("gives every item its own _key and omits blank optional fields", () => {
    n = 0;
    expect(
      buildSetlistSongDocs([{ songId: "song-1", playKey: "", medleyTag: null }], key),
    ).toEqual([{ _type: "setlist_song", _key: "k1", song: { _type: "reference", _ref: "song-1" } }]);
    n = 0;
    expect(
      buildProposalSongDocs([{ songId: "song-1", playKey: "G", medleyTag: "m" }], key),
    ).toEqual([
      {
        _type: "proposal_song",
        _key: "k1",
        play_key: "G",
        medley_tag: "m",
        song: { _type: "reference", _ref: "song-1" },
      },
    ]);
  });

  it("builds a weekend setlist document AT the deterministic id, with _type only on create", () => {
    n = 0;
    const doc = buildWeekendSetlistDocument({
      setlistType: "saturdarSongs",
      week: "2026-08-08",
      songs: buildSetlistSongDocs([{ songId: "song-1", playKey: "G", medleyTag: null }], key),
      teamNotes: "Salmo 100",
    });
    expect(doc).toEqual({
      _id: "saturdarSongs.2026-08-08",
      _type: "saturdarSongs",
      week: "2026-08-08",
      team_notes: "Salmo 100",
      songs: [
        { _type: "setlist_song", _key: "k1", play_key: "G", song: { _type: "reference", _ref: "song-1" } },
      ],
    });
  });

  it("omits team_notes entirely when none is supplied, and refuses an unusable target", () => {
    const doc = buildWeekendSetlistDocument({ setlistType: "featuredSongs", week: "2026-08-09", songs: [] });
    expect(doc).not.toHaveProperty("team_notes");
    expect(
      buildWeekendSetlistDocument({ setlistType: "featuredSongs", week: "2026-02-30", songs: [] }),
    ).toBeNull();
  });
});

describe("parseSetlistWriteRequest", () => {
  const base = {
    type: "sunday",
    week: "2026-08-09",
    observed: { state: "none" },
    songs: [{ songId: "song-1", play_key: "G" }],
  };

  it("parses a weekend save", () => {
    const parsed = parseSetlistWriteRequest(base);
    expect(parsed).toEqual({
      ok: true,
      value: {
        kind: "sunday",
        week: "2026-08-09",
        roleId: null,
        setlistType: "featuredSongs",
        observed: { state: "none" },
        songs: [{ songId: "song-1", playKey: "G", medleyTag: null }],
      },
    });
  });

  it("parses a special save and keeps the role id as the target", () => {
    const parsed = parseSetlistWriteRequest({
      ...base,
      type: "special",
      roleId: "role-sp",
      observed: { state: "single", id: "role-sp", rev: "r1" },
    });
    expect(parsed.ok && parsed.value.roleId).toBe("role-sp");
    expect(parsed.ok && parsed.value.setlistType).toBeNull();
  });

  it.each([
    ["an unknown service kind", { ...base, type: "midweek" }],
    ["a malformed week", { ...base, week: "09-08-2026" }],
    ["an impossible calendar day", { ...base, week: "2026-02-30" }],
    ["a special save with no roleId", { ...base, type: "special" }],
    ["a special save with a drafts roleId", { ...base, type: "special", roleId: "drafts.role-sp" }],
    ["a missing observed state", { ...base, observed: undefined }],
    ["a missing song list", { ...base, songs: undefined }],
    ["a non-object payload", null],
  ])("rejects %s before any read", (_label, body) => {
    expect(parseSetlistWriteRequest(body).ok).toBe(false);
  });
});
