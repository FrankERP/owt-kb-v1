import { describe, expect, it } from "vitest";
import {
  canonicalizePlayHistory,
  canonicalLeadRefs,
  indexUniqueByKey,
  pickUnique,
  playHistoryTargetKey,
  serviceDayKey,
} from "@/app/utils/serviceReadSelect";

describe("pickUnique", () => {
  it("returns the single document when the group has exactly one", () => {
    expect(pickUnique([{ _id: "a" }])).toEqual({ _id: "a" });
  });

  it("fails closed to null for none, duplicate, null, and non-array", () => {
    expect(pickUnique([])).toBeNull();
    expect(pickUnique([{ _id: "a" }, { _id: "b" }])).toBeNull();
    expect(pickUnique(null)).toBeNull();
    expect(pickUnique(undefined)).toBeNull();
    // @ts-expect-error deliberately wrong type to prove runtime guard
    expect(pickUnique("not-an-array")).toBeNull();
  });
});

describe("playHistoryTargetKey", () => {
  it("keys weekend setlists by type:week", () => {
    expect(playHistoryTargetKey({ _type: "featuredSongs", week: "2026-07-05" })).toBe("featuredSongs:2026-07-05");
    expect(playHistoryTargetKey({ _type: "saturdarSongs", week: "2026-07-04" })).toBe("saturdarSongs:2026-07-04");
  });

  it("keys a special role by its id", () => {
    expect(playHistoryTargetKey({ _type: "special_role", _id: "sp-1", date: "2026-07-05" })).toBe("sp-1");
  });

  it("returns null for missing week/id or unknown type", () => {
    expect(playHistoryTargetKey({ _type: "featuredSongs" })).toBeNull();
    expect(playHistoryTargetKey({ _type: "special_role" })).toBeNull();
    expect(playHistoryTargetKey({ _type: "post", week: "2026-07-05" })).toBeNull();
    expect(playHistoryTargetKey(null)).toBeNull();
    expect(playHistoryTargetKey("x")).toBeNull();
  });
});

describe("canonicalizePlayHistory", () => {
  it("keeps distinct targets in first-occurrence order", () => {
    const rows = [
      { _type: "featuredSongs", week: "2026-07-05" },
      { _type: "saturdarSongs", week: "2026-06-27" },
      { _type: "featuredSongs", week: "2026-06-21" },
    ];
    const out = canonicalizePlayHistory(rows, playHistoryTargetKey);
    expect(out).toEqual(rows);
  });

  it("drops an ambiguous target (duplicate week) entirely — never double-counts", () => {
    const rows = [
      { _type: "featuredSongs", week: "2026-07-05", _id: "a" },
      { _type: "featuredSongs", week: "2026-07-05", _id: "b" }, // duplicate target
      { _type: "featuredSongs", week: "2026-06-21", _id: "c" },
    ];
    const out = canonicalizePlayHistory(rows, playHistoryTargetKey) as Array<{ _id: string }>;
    expect(out.map((r) => r._id)).toEqual(["c"]);
  });

  it("drops rows without a resolvable target key", () => {
    const rows = [
      { _type: "featuredSongs" }, // no week -> null key
      { _type: "featuredSongs", week: "2026-06-21" },
    ];
    const out = canonicalizePlayHistory(rows, playHistoryTargetKey) as Array<{ week?: string }>;
    expect(out).toEqual([{ _type: "featuredSongs", week: "2026-06-21" }]);
  });

  it("returns [] for a non-array input", () => {
    expect(canonicalizePlayHistory(null, playHistoryTargetKey)).toEqual([]);
    expect(canonicalizePlayHistory(undefined, playHistoryTargetKey)).toEqual([]);
  });

  it("never throws when the key function throws", () => {
    const out = canonicalizePlayHistory([{ x: 1 }], () => {
      throw new Error("boom");
    });
    expect(out).toEqual([]);
  });
});

describe("serviceDayKey", () => {
  it("returns the calendar day for a service date or a datetime string", () => {
    expect(serviceDayKey("2026-07-05")).toBe("2026-07-05");
    expect(serviceDayKey("2026-07-05T00:00:00Z")).toBe("2026-07-05");
  });

  it("returns null for malformed, impossible, or non-string values", () => {
    expect(serviceDayKey("2026-02-30")).toBeNull();
    expect(serviceDayKey("2026-13-01")).toBeNull();
    expect(serviceDayKey("07/05/2026")).toBeNull();
    expect(serviceDayKey("")).toBeNull();
    expect(serviceDayKey(undefined)).toBeNull();
    expect(serviceDayKey(null)).toBeNull();
    expect(serviceDayKey(20260705)).toBeNull();
    expect(serviceDayKey({ week: "2026-07-05" })).toBeNull();
  });
});

describe("indexUniqueByKey", () => {
  it("indexes rows whose key is unique", () => {
    const rows = [
      { week: "2026-07-05", id: "a" },
      { week: "2026-07-12", id: "b" },
    ];
    const map = indexUniqueByKey(rows, (r) => serviceDayKey(r.week));
    expect(map.get("2026-07-05")).toEqual(rows[0]);
    expect(map.get("2026-07-12")).toEqual(rows[1]);
    expect(map.size).toBe(2);
  });

  it("fails closed on a duplicate key — neither row wins", () => {
    const rows = [
      { week: "2026-07-05", id: "a" },
      { week: "2026-07-05", id: "b" },
      { week: "2026-07-12", id: "c" },
    ];
    const map = indexUniqueByKey(rows, (r) => serviceDayKey(r.week));
    expect(map.has("2026-07-05")).toBe(false);
    expect(map.get("2026-07-12")).toEqual(rows[2]);
  });

  it("drops rows with no resolvable key and preserves first-occurrence order", () => {
    const rows = [
      { week: "nope", id: "a" },
      { week: "2026-07-12", id: "b" },
      { week: "2026-07-05", id: "c" },
    ];
    const map = indexUniqueByKey(rows, (r) => serviceDayKey(r.week));
    expect([...map.keys()]).toEqual(["2026-07-12", "2026-07-05"]);
  });

  it("returns an empty map for non-array input and never throws on a throwing key fn", () => {
    expect(indexUniqueByKey(null, () => "k").size).toBe(0);
    expect(indexUniqueByKey(undefined, () => "k").size).toBe(0);
    expect(
      indexUniqueByKey([{ id: "a" }], () => {
        throw new Error("boom");
      }).size,
    ).toBe(0);
  });
});

describe("canonicalLeadRefs", () => {
  it("extracts unique lead refs from a canonical role projection", () => {
    const role = {
      Lead: [
        { _key: "k1", _type: "reference", _ref: "m1" },
        { _key: "k2", _type: "reference", _ref: "m2" },
        { _key: "k3", _type: "reference", _ref: "m1" }, // duplicate
      ],
    };
    expect(canonicalLeadRefs(role)).toEqual(["m1", "m2"]);
  });

  it("returns [] when Lead is missing, non-array, or malformed", () => {
    expect(canonicalLeadRefs({})).toEqual([]);
    expect(canonicalLeadRefs({ Lead: "nope" })).toEqual([]);
    expect(canonicalLeadRefs({ Lead: [{ _key: "k" }] })).toEqual([]); // no _ref
    expect(canonicalLeadRefs(null)).toEqual([]);
  });
});
