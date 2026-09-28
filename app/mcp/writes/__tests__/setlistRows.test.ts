// `edit_setlist`'s pure row translation (P3 step 11): the editor's full-
// replacement round trip (E6), duplicate songs (E3), the medley trigger rule
// and the explicit-link refusal (E5, I13), the leaders rule (F6) and the
// play-key blanking guard (E-key, F11).

import { describe, expect, it } from "vitest";
import { buildSetlistBodyRows, type SetlistRowInput, type SetlistRowsInput } from "../setlistRows";

function item(
  key: string,
  songId: string,
  extra: { play_key?: string | null; medley_tag?: string | null; leads?: string[] | null } = {},
) {
  return {
    _key: key,
    play_key: extra.play_key === undefined ? "G" : extra.play_key,
    medley_tag: extra.medley_tag ?? null,
    song: { _type: "reference", _ref: songId },
    leads:
      extra.leads === undefined || extra.leads === null
        ? null
        : extra.leads.map((id, i) => ({ _key: `${key}-l${i}`, _type: "reference", _ref: id })),
  };
}

/** Four stored rows: a medley (r1+r2, tag "abc"), then two singles. */
const STORED = [
  item("r1", "song-a", { play_key: "G", medley_tag: "abc", leads: ["mem-1"] }),
  item("r2", "song-b", { play_key: "D", medley_tag: "abc", leads: ["mem-1", "mem-2"] }),
  item("r3", "song-c", { play_key: "E" }),
  item("r4", "song-d", { play_key: null }),
];

function tags(): () => string {
  let n = 0;
  return () => `t${++n}`;
}

function run(rows: SetlistRowInput[], over: Partial<SetlistRowsInput> = {}) {
  return buildSetlistBodyRows({ stored: STORED, rows, worshipNight: false, newTag: tags(), ...over });
}

const ALL: SetlistRowInput[] = [{ rowKey: "r1" }, { rowKey: "r2" }, { rowKey: "r3" }, { rowKey: "r4" }];

describe("buildSetlistBodyRows — the round trip (E6)", () => {
  it("every attribute survives an untouched row, and the stored tags are carried as they are", () => {
    const out = run(ALL, { worshipNight: true });
    expect(out).toEqual({
      ok: true,
      normalized: false,
      songs: [
        { songId: "song-a", play_key: "G", medley_tag: "abc", leadIds: ["mem-1"] },
        { songId: "song-b", play_key: "D", medley_tag: "abc", leadIds: ["mem-1", "mem-2"] },
        { songId: "song-c", play_key: "E", leadIds: [] },
        { songId: "song-d", play_key: "", leadIds: [] },
      ],
    });
  });

  it("a key-only edit leaves every tag byte-identical", () => {
    const stored = [
      item("r1", "song-a", { medley_tag: "  odd  Tag " }),
      item("r2", "song-b", { medley_tag: "  odd  Tag " }),
      item("r3", "song-c"),
    ];
    const out = buildSetlistBodyRows({
      stored,
      rows: [{ rowKey: "r1" }, { rowKey: "r2" }, { rowKey: "r3", key: "A" }],
      worshipNight: false,
      newTag: tags(),
    });
    expect(out.ok && out.normalized).toBe(false);
    expect(out.ok && out.songs.map((s) => [s.medley_tag, s.play_key])).toEqual([
      ["  odd  Tag ", "G"],
      ["  odd  Tag ", "G"],
      [undefined, "A"],
    ]);
  });

  it("an explicit null clears the key and the tag; an absent attribute is kept", () => {
    const out = run([{ rowKey: "r1", key: null }, { rowKey: "r2", medleyTag: null }, { rowKey: "r3" }, { rowKey: "r4" }]);
    expect(out.ok && out.songs[0]).toEqual({ songId: "song-a", play_key: "" });
    // Clearing r2's tag orphans r1: both come out untagged, and nothing is refused.
    expect(out.ok && out.songs.map((s) => s.medley_tag)).toEqual([undefined, undefined, undefined, undefined]);
    expect(out.ok && out.songs[2].play_key).toBe("E");
  });

  it("a key that trims to nothing is a clear", () => {
    const out = run([{ rowKey: "r1", key: "   " }, { rowKey: "r2" }, { rowKey: "r3" }, { rowKey: "r4" }]);
    expect(out.ok).toBe(true);
    expect(out.ok && out.songs[0].play_key).toBe("   ");
  });

  it("a new row starts empty; a tail append re-derives nothing", () => {
    const out = run([...ALL, { songId: "song-e" }]);
    expect(out.ok && out.normalized).toBe(false);
    expect(out.ok && out.songs[4]).toEqual({ songId: "song-e", play_key: "" });
    expect(out.ok && out.songs[0].medley_tag).toBe("abc");
  });

  it("refuses a rowKey listed twice and one the stored setlist does not have, never guessing", () => {
    expect(run([{ rowKey: "r1" }, { rowKey: "r1" }])).toEqual({
      ok: false,
      refusal: { detail: "duplicate_row_key", position: 2, rowKey: "r1" },
    });
    expect(run([{ rowKey: "r1" }, { rowKey: "zz" }])).toEqual({
      ok: false,
      refusal: { detail: "unknown_row_key", position: 2, rowKey: "zz" },
    });
  });
});

describe("buildSetlistBodyRows — medley re-derivation (E5)", () => {
  it("a removal re-derives the runs: the medley keeps a fresh tag, an orphaned stored tag is untagged", () => {
    const kept = run([{ rowKey: "r1" }, { rowKey: "r2" }, { rowKey: "r4" }]);
    expect(kept.ok && kept.normalized).toBe(true);
    expect(kept.ok && kept.songs.map((s) => s.medley_tag)).toEqual(["t1", "t1", undefined]);
    // Removing r2 orphans r1: untagged without a refusal.
    const orphaned = run([{ rowKey: "r1" }, { rowKey: "r3" }, { rowKey: "r4" }]);
    expect(orphaned.ok && orphaned.songs.map((s) => s.medley_tag)).toEqual([undefined, undefined, undefined]);
  });

  it("a reorder re-derives the runs", () => {
    const out = run([{ rowKey: "r1" }, { rowKey: "r3" }, { rowKey: "r2" }, { rowKey: "r4" }]);
    expect(out.ok && out.normalized).toBe(true);
    expect(out.ok && out.songs.map((s) => s.medley_tag)).toEqual([undefined, undefined, undefined, undefined]);
    const swapped = run([{ rowKey: "r2" }, { rowKey: "r1" }, { rowKey: "r3" }, { rowKey: "r4" }]);
    expect(swapped.ok && swapped.songs.map((s) => s.medley_tag)).toEqual(["t1", "t1", undefined, undefined]);
  });

  it("a mid-list insert re-derives the runs (it splits the medley)", () => {
    const out = run([{ rowKey: "r1" }, { songId: "song-e" }, { rowKey: "r2" }, { rowKey: "r3" }, { rowKey: "r4" }]);
    expect(out.ok && out.normalized).toBe(true);
    expect(out.ok && out.songs.map((s) => s.medley_tag)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("the same explicit tag on rows 1 and 2 links them", () => {
    const out = run([
      { rowKey: "r3", medleyTag: "x" },
      { rowKey: "r4", medleyTag: "x" },
      { rowKey: "r1" },
      { rowKey: "r2" },
    ]);
    expect(out.ok && out.songs.map((s) => s.medley_tag)).toEqual(["t1", "t1", "t2", "t2"]);
  });

  it("a new row may join a stored medley by naming its tag", () => {
    const out = run([...ALL.slice(0, 2), { songId: "song-e", medleyTag: "abc" }, ...ALL.slice(2)]);
    expect(out.ok && out.songs.map((s) => s.medley_tag)).toEqual(["t1", "t1", "t1", undefined, undefined]);
  });

  it("the same explicit tag on rows 1 and 3 is refused (medley_not_adjacent)", () => {
    expect(run([{ rowKey: "r3", medleyTag: "x" }, { rowKey: "r4" }, { songId: "song-e", medleyTag: "x" }])).toEqual({
      ok: false,
      refusal: { detail: "medley_not_adjacent", position: 1, songId: "song-c", rowKey: "r3" },
    });
  });

  it("a tag on one row that no neighbour carries is refused", () => {
    expect(run([...ALL, { songId: "song-e", medleyTag: "solo" }])).toEqual({
      ok: false,
      refusal: { detail: "medley_not_adjacent", position: 5, songId: "song-e" },
    });
  });

  it("two adjacent rows sent differently spelled tags are refused", () => {
    const out = run([{ rowKey: "r3", medleyTag: "Medley" }, { rowKey: "r4", medleyTag: "medley" }]);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.refusal.detail).toBe("medley_not_adjacent");
  });

  it("medleyTag: null clears without a refusal", () => {
    const out = run([{ rowKey: "r1", medleyTag: null }, { rowKey: "r2", medleyTag: null }, { rowKey: "r3" }, { rowKey: "r4" }]);
    expect(out.ok).toBe(true);
    expect(out.ok && out.songs.every((s) => s.medley_tag === undefined)).toBe(true);
  });
});

describe("buildSetlistBodyRows — duplicate songs (E3, D14)", () => {
  it("refuses a new row naming a song a kept row already names", () => {
    expect(run([...ALL, { songId: "song-c" }])).toEqual({
      ok: false,
      refusal: { detail: "duplicate_song", position: 5, songId: "song-c" },
    });
  });

  it("refuses two new rows naming one song", () => {
    expect(run([{ songId: "song-x" }, { songId: "song-x" }])).toEqual({
      ok: false,
      refusal: { detail: "duplicate_song", position: 1, songId: "song-x" },
    });
  });

  it("carries two kept rows that already name one song (a Studio duplicate), and allows removing one", () => {
    const stored = [item("d1", "song-a"), item("d2", "song-a", { play_key: "A" })];
    const both = buildSetlistBodyRows({ stored, rows: [{ rowKey: "d1" }, { rowKey: "d2" }], worshipNight: false, newTag: tags() });
    expect(both.ok && both.songs).toEqual([
      { songId: "song-a", play_key: "G" },
      { songId: "song-a", play_key: "A" },
    ]);
    const one = buildSetlistBodyRows({ stored, rows: [{ rowKey: "d2" }], worshipNight: false, newTag: tags() });
    expect(one.ok && one.songs).toEqual([{ songId: "song-a", play_key: "A" }]);
  });
});

describe("buildSetlistBodyRows — the play key (E-key)", () => {
  const long = "x".repeat(25);
  const stored = [item("k1", "song-a", { play_key: long }), item("k2", "song-b")];

  it("refuses a kept row whose stored key is 25 characters unless the row sends key", () => {
    expect(buildSetlistBodyRows({ stored, rows: [{ rowKey: "k1" }, { rowKey: "k2" }], worshipNight: false, newTag: tags() })).toEqual({
      ok: false,
      refusal: { detail: "stored_key_too_long", position: 1, rowKey: "k1", songId: "song-a" },
    });
    const replaced = buildSetlistBodyRows({
      stored,
      rows: [{ rowKey: "k1", key: "Bb" }, { rowKey: "k2" }],
      worshipNight: false,
      newTag: tags(),
    });
    expect(replaced.ok && replaced.songs[0].play_key).toBe("Bb");
    const cleared = buildSetlistBodyRows({
      stored,
      rows: [{ rowKey: "k1", key: null }, { rowKey: "k2" }],
      worshipNight: false,
      newTag: tags(),
    });
    expect(cleared.ok && cleared.songs[0].play_key).toBe("");
  });

  it("refuses a key of 24 × U+0958 (24 raw, 48 after NFC), which the writer would store blank", () => {
    const qa = "क़".repeat(24);
    expect(qa.length).toBe(24);
    expect(qa.normalize("NFC").length).toBe(48);
    expect(run([...ALL, { songId: "song-e", key: qa }])).toEqual({
      ok: false,
      refusal: { detail: "key_too_long", position: 5, songId: "song-e" },
    });
    expect(run([{ rowKey: "r1", key: qa }])).toEqual({
      ok: false,
      refusal: { detail: "key_too_long", position: 1, songId: "song-a", rowKey: "r1" },
    });
  });

  it("accepts a key of exactly 24 characters", () => {
    const out = run([...ALL, { songId: "song-e", key: "y".repeat(24) }]);
    expect(out.ok && out.songs[4].play_key).toBe("y".repeat(24));
  });
});

describe("buildSetlistBodyRows — leaders (F6)", () => {
  it("on a worship night every row carries leadIds: stored ones carried, explicit ones replacing", () => {
    const out = run([{ rowKey: "r1", leads: ["mem-9"] }, { rowKey: "r2" }, { rowKey: "r3", leads: [] }, { songId: "song-e" }], {
      worshipNight: true,
    });
    expect(out.ok && out.songs.map((s) => s.leadIds)).toEqual([["mem-9"], ["mem-1", "mem-2"], [], []]);
  });

  it("on any other service only a row with explicit, non-empty leads carries leadIds; leads: [] carries none", () => {
    const out = run([{ rowKey: "r1" }, { rowKey: "r2", leads: [] }, { rowKey: "r3", leads: ["mem-1"] }, { rowKey: "r4" }]);
    expect(out.ok && out.songs.map((s) => ("leadIds" in s ? s.leadIds : "none"))).toEqual(["none", "none", ["mem-1"], "none"]);
  });
});
