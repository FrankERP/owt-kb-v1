import { describe, it, expect } from "vitest";
import { parseAuthors, dedupeKey, buildFreq, canonicalName } from "../author-canon.mjs";

describe("parseAuthors", () => {
  it("splits on commas only; trims; drops empties; keeps & / y / Y names whole", () => {
    expect(parseAuthors("Matt Redman, En Espíritu Y En Verdad")).toEqual(["Matt Redman", "En Espíritu Y En Verdad"]);
    expect(parseAuthors("Hillsong Y&F")).toEqual(["Hillsong Y&F"]);
    expect(parseAuthors("Majo y Dan")).toEqual(["Majo y Dan"]);
    expect(parseAuthors("Marcos Witt, Marco Barrientos, Marcos Vidal")).toEqual(["Marcos Witt", "Marco Barrientos", "Marcos Vidal"]);
    expect(parseAuthors("")).toEqual([]);
    expect(parseAuthors(undefined)).toEqual([]);
  });
});

describe("dedupeKey", () => {
  it("collapses spelling aliases via ALIAS (after normalize deletes '&')", () => {
    expect(dedupeKey("Hillsong Y&F")).toBe("hillsong young free");
    expect(dedupeKey("Hillsong Young & Free")).toBe("hillsong young free");
    expect(dedupeKey("Bethel")).toBe("bethel music");
    expect(dedupeKey("Bethel Music")).toBe("bethel music");
  });
  it("collapses case/accent variants without an ALIAS entry", () => {
    expect(dedupeKey("En Espíritu Y En Verdad")).toBe(dedupeKey("En Espíritu y En Verdad"));
  });
  it("keeps genuinely distinct similar names apart", () => {
    const keys = new Set(["Marcos Witt", "Marco Barrientos", "Marcos Vidal"].map(dedupeKey));
    expect(keys.size).toBe(3);
  });
});

describe("canonicalName", () => {
  it("pins canonical display names per dedupeKey (no regression of the canonical-spelled member)", () => {
    const freq = buildFreq(["Hillsong Y&F", "Hillsong Y&F", "Hillsong Young & Free"]);
    expect(canonicalName("Hillsong Y&F", freq)).toBe("Hillsong Young & Free");
    expect(canonicalName("Hillsong Young & Free", freq)).toBe("Hillsong Young & Free");
  });
  it("pins EEYEV to the lowercase form regardless of input spelling", () => {
    const freq = buildFreq(["En Espíritu Y En Verdad", "En Espíritu y En Verdad"]);
    expect(canonicalName("En Espíritu Y En Verdad", freq)).toBe("En Espíritu y En Verdad");
    expect(canonicalName("En Espíritu y En Verdad", freq)).toBe("En Espíritu y En Verdad");
  });
  it("falls back to most-frequent raw for unmapped multi-spelling keys (tie -> lexicographic)", () => {
    const freq = buildFreq(["Foo Bar", "Foo  Bar", "Foo Bar"]); // both normalize to same key
    expect(canonicalName("Foo Bar", freq)).toBe("Foo Bar");
  });
});
