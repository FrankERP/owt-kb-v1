import { describe, it, expect } from "vitest";
import { buildCatalogIndex, matchSong } from "../setlist-match.mjs";

const posts = [
  { _id: "p1", title: "Vives En Mí (Wake)" },
  { _id: "p2", title: "Aquí Estoy (The Stand)" },
  { _id: "p3", title: "Salmo 23" },
  { _id: "a1", title: "Amor Sin Condición" },
  { _id: "a2", title: "Amor Sin Condición (Reckless Love)" },
];

describe("buildCatalogIndex + matchSong", () => {
  const idx = buildCatalogIndex(posts);
  it("matches the English part of a bilingual title", () => {
    expect(matchSong("Wake", idx)).toEqual({ postId: "p1" });
    expect(matchSong("The Stand", idx)).toEqual({ postId: "p2" });
  });
  it("matches the Spanish part / full title", () => {
    expect(matchSong("Vives en mí", idx)).toEqual({ postId: "p1" });
    expect(matchSong("Salmo 23", idx)).toEqual({ postId: "p3" });
  });
  it("returns candidates for an ambiguous normalized name (never silent-picks)", () => {
    const r = matchSong("Amor Sin Condición", idx);
    expect(r.candidates.sort()).toEqual(["a1", "a2"]);
  });
  it("honors the alias map and returns null for a genuine miss", () => {
    expect(matchSong("Avivanos", idx, { [normalize("Avivanos")]: "p3" })).toEqual({ postId: "p3" });
    expect(matchSong("Some Unknown Song", idx)).toBeNull();
  });
});

import { normalizeForMatch as normalize } from "../catalog-reconcile.mjs";
