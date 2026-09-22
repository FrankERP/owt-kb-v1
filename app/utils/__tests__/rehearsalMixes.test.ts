// The rehearsal player's pure half: how mixes group, which one a member sees
// first, and how a 600-point envelope collapses to the bars a row can draw.
import { describe, expect, it } from "vitest";
import { INSTRUMENT_SEAT_OPTIONS } from "@/sanity/schemas/instrumentSeats";
import type { RehearsalMix } from "@/app/utils/interface";
import {
  FAMILY_ORDER, SEAT_TO_FAMILY, groupMixes, isActiveAt, mixLabel, mixTones, mixesForKey, preselectMix, waveformBars,
} from "../rehearsalMixes";

const mix = (over: Partial<RehearsalMix>): RehearsalMix => ({
  _key: over._key ?? Math.random().toString(36).slice(2),
  kind: "up", tone: "G", sourceHash: "abc",
  ...over,
});

const full = mix({ _key: "full", kind: "full" });
const eg2 = mix({ _key: "eg2", track: "EG 2", family: "electric" });
const eg1 = mix({ _key: "eg1", track: "EG 1", family: "electric" });
const bass = mix({ _key: "bass", track: "Bass", family: "bass" });
const organ = mix({ _key: "org", track: "Órgano", family: "organ" });

describe("SEAT_TO_FAMILY", () => {
  it("maps every app seat and nothing else", () => {
    expect(Object.keys(SEAT_TO_FAMILY).sort()).toEqual([...INSTRUMENT_SEAT_OPTIONS].sort());
    expect(SEAT_TO_FAMILY).toEqual({ Bass: "bass", Keys: "keys", Drums: "drums", EG: "electric", AG: "acoustic" });
  });
});

describe("groupMixes", () => {
  it("puts Full first, then families in FAMILY_ORDER, tracks sorted naturally", () => {
    const groups = groupMixes([eg2, organ, full, bass, eg1]);
    expect(groups.map((g) => g.family)).toEqual(["full", "bass", "organ", "electric"]);
    expect(groups[3].mixes.map((m) => m.track)).toEqual(["EG 1", "EG 2"]);
    expect(groups[0].label).toBe("Banda completa");
    expect(groups[3].label).toBe("Guitarra eléctrica");
  });
  it("drops nothing and tolerates an unknown family at the end", () => {
    const odd = mix({ _key: "odd", track: "Kazoo", family: "other" });
    const groups = groupMixes([odd, full]);
    expect(groups.map((g) => g.family)).toEqual(["full", "other"]);
    expect(groups[1].label).toBe("Otros");
  });
  it("returns [] for no mixes", () => expect(groupMixes([])).toEqual([]));
});

describe("mixLabel", () => {
  it("names Full in Spanish and UP mixes by their track", () => {
    expect(mixLabel(full)).toBe("Banda completa");
    expect(mixLabel(eg1)).toBe("EG 1");
  });
});

describe("preselectMix", () => {
  it("prefers the first track of the member's first instrument's family", () => {
    expect(preselectMix([full, eg2, eg1, bass], ["EG", "Bass"])?._key).toBe("eg1");
    expect(preselectMix([full, eg2, eg1, bass], ["Bass"])?._key).toBe("bass");
  });
  it("falls back to Full when the member has no instruments or none match", () => {
    expect(preselectMix([full, eg1], null)?._key).toBe("full");
    expect(preselectMix([full, eg1], ["Drums"])?._key).toBe("full");
  });
  it("falls back to the first mix when there is no Full, and null for none", () => {
    expect(preselectMix([eg2, eg1], ["Keys"])?._key).toBe("eg2");
    expect(preselectMix([], ["Keys"])).toBeNull();
  });
});

describe("waveformBars", () => {
  it("collapses 600 points to N bars by max, scaled to 0..1", () => {
    const peaks = Array.from({ length: 600 }, (_, i) => (i < 300 ? 255 : 51));
    const bars = waveformBars(peaks, 6);
    expect(bars).toHaveLength(6);
    expect(bars.slice(0, 3)).toEqual([1, 1, 1]);
    expect(bars[5]).toBeCloseTo(0.2, 2);
  });
  it("handles fewer points than bars and empty input", () => {
    expect(waveformBars([255, 0], 4)).toEqual([1, 1, 0, 0]);
    expect(waveformBars([], 3)).toEqual([0, 0, 0]);
  });
});

describe("isActiveAt", () => {
  it("is true inside a span, inclusive start, exclusive end", () => {
    const a = [{ _key: "a0", s: 10, e: 20 }, { _key: "a1", s: 30.5, e: 31 }];
    expect(isActiveAt(a, 10)).toBe(true);
    expect(isActiveAt(a, 19.99)).toBe(true);
    expect(isActiveAt(a, 20)).toBe(false);
    expect(isActiveAt(a, 30.7)).toBe(true);
    expect(isActiveAt(undefined, 5)).toBe(false);
  });
});

describe("FAMILY_ORDER", () => {
  it("covers the seven isolated families and nothing else", () => {
    expect(FAMILY_ORDER).toEqual(["bass", "keys", "organ", "synth", "drums", "electric", "acoustic"]);
  });
});

describe("mixTones / mixesForKey", () => {
  const g = [full, eg1, bass];
  const gb = [mix({ _key: "f-gb", kind: "full", tone: "Gb" }), mix({ _key: "eg1-gb", track: "EG 1", family: "electric", tone: "Gb" })];
  const ab = [mix({ _key: "f-ab", kind: "full", tone: "Ab" })];
  const all = [...gb, ...g, ...ab, mix({ _key: "junk", kind: "full", tone: "Modal" })];

  it("lists one spelling per pitch in pitch order and skips unparseable tones", () => {
    expect(mixTones(all)).toEqual(["Gb", "G", "Ab"]);
    expect(mixTones([mix({ tone: "C#" }), mix({ tone: "Db" })])).toEqual(["C#"]);
    expect(mixTones([])).toEqual([]);
  });

  it("matches the dial's key enharmonically and reports exact", () => {
    expect(mixesForKey(all, "F#")).toEqual({ tone: "Gb", exact: true, mixes: gb });
    expect(mixesForKey(all, "G")).toEqual({ tone: "G", exact: true, mixes: g });
  });

  it("falls back to the nearest key, lower on a tie, and says it is not exact", () => {
    expect(mixesForKey(all, "A")).toMatchObject({ tone: "Ab", exact: false });
    expect(mixesForKey(all, "E")).toMatchObject({ tone: "Gb", exact: false });
    // B: Ab is 3 below, G 4 below, Gb 5 below → Ab.
    expect(mixesForKey(all, "B")).toMatchObject({ tone: "Ab", exact: false });
    // C: Ab is 4 below, G 5 below, Gb 6 either way → Ab.
    expect(mixesForKey(all, "C")).toMatchObject({ tone: "Ab", exact: false });
    // Db: Gb is 5 ABOVE, Ab is 5 BELOW — a tie, and the lower key wins → Ab.
    expect(mixesForKey(all, "Db")).toMatchObject({ tone: "Ab", exact: false });
  });

  it("shows everything with no key or no parseable tones", () => {
    expect(mixesForKey(all, null)).toEqual({ tone: "Gb", exact: false, mixes: all });
    expect(mixesForKey(g, null)).toEqual({ tone: "G", exact: true, mixes: g });
    const modal = [mix({ tone: "Modal" })];
    expect(mixesForKey(modal, "G")).toEqual({ tone: null, exact: true, mixes: modal });
  });
});
