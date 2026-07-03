import { describe, it, expect } from "vitest";
import { buildRuns, normalizeMedleyTags } from "../medley";

type S = { id: string; medley_tag?: string };
const s = (id: string, medley_tag?: string): S => ({ id, medley_tag });

describe("buildRuns", () => {
  it("returns [] for no songs", () => {
    expect(buildRuns([])).toEqual([]);
  });

  it("makes every untagged song a single, with 1-based positions", () => {
    const runs = buildRuns([s("a"), s("b"), s("c")]);
    expect(runs).toEqual([
      { kind: "single", song: s("a"), n: 1 },
      { kind: "single", song: s("b"), n: 2 },
      { kind: "single", song: s("c"), n: 3 },
    ]);
  });

  it("groups consecutive songs sharing a tag into one medley", () => {
    const runs = buildRuns([s("a", "m1"), s("b", "m1"), s("c", "m1")]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({
      kind: "medley",
      songs: [
        { song: s("a", "m1"), n: 1 },
        { song: s("b", "m1"), n: 2 },
        { song: s("c", "m1"), n: 3 },
      ],
    });
  });

  it("keeps singles and medleys in order with continuous numbering", () => {
    const runs = buildRuns([s("a"), s("b", "m1"), s("c", "m1"), s("d")]);
    expect(runs).toEqual([
      { kind: "single", song: s("a"), n: 1 },
      { kind: "medley", songs: [{ song: s("b", "m1"), n: 2 }, { song: s("c", "m1"), n: 3 }] },
      { kind: "single", song: s("d"), n: 4 },
    ]);
  });

  it("splits two adjacent medleys that use different tags", () => {
    const runs = buildRuns([s("a", "m1"), s("b", "m1"), s("c", "m2"), s("d", "m2")]);
    expect(runs).toHaveLength(2);
    expect(runs[0].kind).toBe("medley");
    expect(runs[1].kind).toBe("medley");
    if (runs[0].kind === "medley") expect(runs[0].songs.map(x => x.song.id)).toEqual(["a", "b"]);
    if (runs[1].kind === "medley") expect(runs[1].songs.map(x => x.song.id)).toEqual(["c", "d"]);
  });

  it("does not merge the same tag when it is not adjacent", () => {
    const runs = buildRuns([s("a", "m1"), s("b"), s("c", "m1")]);
    // three separate runs; the tagged ones are length-1 medley runs
    expect(runs).toHaveLength(3);
    expect(runs[0].kind).toBe("medley");
    expect(runs[1].kind).toBe("single");
    expect(runs[2].kind).toBe("medley");
  });

  it("treats an empty-string tag as untagged (single)", () => {
    const runs = buildRuns([s("a", "")]);
    expect(runs).toEqual([{ kind: "single", song: s("a", ""), n: 1 }]);
  });
});

describe("normalizeMedleyTags", () => {
  // Deterministic tag generator for assertions.
  const seq = () => {
    let i = 0;
    return () => `t${++i}`;
  };

  it("returns a new array and does not mutate the input", () => {
    const input = [s("a", "x"), s("b", "x")];
    const out = normalizeMedleyTags(input, seq());
    expect(out).not.toBe(input);
    expect(input[0].medley_tag).toBe("x"); // input untouched
  });

  it("clears a lone tag (a medley of one is not a medley)", () => {
    const out = normalizeMedleyTags([s("a", "x")], seq());
    expect(out[0].medley_tag).toBeUndefined();
  });

  it("assigns a fresh shared tag to a run of >= 2", () => {
    const out = normalizeMedleyTags([s("a", "old"), s("b", "old")], seq());
    expect(out[0].medley_tag).toBe("t1");
    expect(out[1].medley_tag).toBe("t1");
  });

  it("clears two different adjacent lone tags", () => {
    const out = normalizeMedleyTags([s("a", "x"), s("b", "y")], seq());
    expect(out.map(e => e.medley_tag)).toEqual([undefined, undefined]);
  });

  it("keeps a pair and drops a trailing orphan of a different tag", () => {
    const out = normalizeMedleyTags([s("a", "x"), s("b", "x"), s("c", "z")], seq());
    expect(out[0].medley_tag).toBe("t1");
    expect(out[1].medley_tag).toBe("t1");
    expect(out[2].medley_tag).toBeUndefined();
  });

  it("preserves untagged songs and normalizes a following pair", () => {
    const out = normalizeMedleyTags([s("a"), s("b", "x"), s("c", "x")], seq());
    expect(out[0].medley_tag).toBeUndefined();
    expect(out[1].medley_tag).toBe("t1");
    expect(out[2].medley_tag).toBe("t1");
  });

  it("gives two separate adjacent groups distinct fresh tags", () => {
    // Same stored tag on all four, but a gap-less split isn't possible here;
    // instead two groups separated by a single: [x,x] u [x,x] with a break.
    const out = normalizeMedleyTags(
      [s("a", "x"), s("b", "x"), s("c"), s("d", "x"), s("e", "x")],
      seq(),
    );
    expect(out[0].medley_tag).toBe("t1");
    expect(out[1].medley_tag).toBe("t1");
    expect(out[2].medley_tag).toBeUndefined();
    expect(out[3].medley_tag).toBe("t2");
    expect(out[4].medley_tag).toBe("t2");
    expect(out[0].medley_tag).not.toBe(out[3].medley_tag);
  });

  it("is structurally idempotent (re-normalizing keeps groupings)", () => {
    const once = normalizeMedleyTags([s("a", "x"), s("b", "x"), s("c")], seq());
    const twice = normalizeMedleyTags(once, seq());
    // Same grouping shape: [pair, single]
    expect([!!twice[0].medley_tag, !!twice[1].medley_tag, !!twice[2].medley_tag])
      .toEqual([true, true, false]);
    expect(twice[0].medley_tag).toBe(twice[1].medley_tag);
  });
});
