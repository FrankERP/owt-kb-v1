import { describe, it, expect } from "vitest";
import {
  stripDiacritics, normalizeForMatch, cleanTempoTags,
  mergeTagNames, matchRow, computeFieldUpdates,
  authorMatches, resolveMatchCollisions,
} from "../catalog-reconcile.mjs";

describe("normalizeForMatch", () => {
  it("lowercases, strips accents, drops subtitles and punctuation", () => {
    expect(normalizeForMatch("Cielo Y Tierra")).toBe(normalizeForMatch("Cielo y Tierra"));
    expect(normalizeForMatch("Sólo En Jesús")).toBe(normalizeForMatch("Solo En Jesús"));
    expect(normalizeForMatch("Donde Tú Estás (Where You Are)")).toBe(normalizeForMatch("Donde Tú Estás"));
    expect(normalizeForMatch("10,000 Razones (10,000 Reasons [Bless The Lord])")).toBe("10000 razones");
  });
});

describe("cleanTempoTags", () => {
  it("drops Alabanza/Adoración and dedupes, keeping tempo", () => {
    expect(cleanTempoTags(["Down Beat", "Alabanza", "Su Nombre"])).toEqual(["Down Beat", "Su Nombre"]);
    expect(cleanTempoTags(["Up Beat", "Adoración", "Up Beat"])).toEqual(["Up Beat"]);
  });
});

describe("mergeTagNames", () => {
  it("unions existing + incoming, then strips Alabanza/Adoración", () => {
    expect(mergeTagNames(["Up Beat", "Poder"], ["Up Beat", "Alabanza", "Promesas"]))
      .toEqual(["Up Beat", "Poder", "Promesas"]);
  });
});

describe("matchRow", () => {
  const existing = [
    { _id: "a", title: "Amor Sin Condición", author: "Marco Barrientos" },
    { _id: "b", title: "Amor Sin Condición (Reckless Love)", author: "Cory Asbury" },
    { _id: "c", title: "Cielo y Tierra", author: "Conquistando Fronteras" },
  ];
  it("matches one candidate by normalized title", () => {
    const r = matchRow({ title: "Cielo Y Tierra", author: "" }, existing);
    expect(r.status).toBe("matched");
    expect(r.matchId).toBe("c");
  });
  it("disambiguates a title collision by author", () => {
    const r = matchRow({ title: "Amor Sin Condición (Reckless Love)", author: "Cory Asbury" }, existing);
    expect(r.status).toBe("matched");
    expect(r.matchId).toBe("b");
  });
  it("flags ambiguous when author cannot disambiguate", () => {
    const r = matchRow({ title: "Amor Sin Condición", author: "Desconocido" }, existing);
    expect(r.status).toBe("ambiguous");
    expect(r.candidateIds.sort()).toEqual(["a", "b"]);
  });
  it("returns new when no candidate", () => {
    expect(matchRow({ title: "Es Navidad", author: "" }, existing).status).toBe("new");
  });
});

describe("resolveMatchCollisions", () => {
  it("keeps the author-matching row and demotes the rest to new", () => {
    const existingById = new Map([["d1", { author: "Un Corazón " }]]);
    const results = [
      { rowAuthor: "Un Corazón", status: "matched", matchId: "d1", candidateIds: ["d1"] },
      { rowAuthor: "Hillsong Worship", status: "matched", matchId: "d1", candidateIds: ["d1"] },
    ];
    resolveMatchCollisions(results, existingById);
    expect(results[0]).toMatchObject({ status: "matched", matchId: "d1" });
    expect(results[1]).toMatchObject({ status: "new", matchId: null, candidateIds: [] });
  });
  it("leaves a single (non-colliding) match untouched even if author differs (typo tolerance)", () => {
    const existingById = new Map([["d2", { author: "Elevation Worship" }]]);
    const results = [{ rowAuthor: "Elevantion Worship", status: "matched", matchId: "d2", candidateIds: ["d2"] }];
    resolveMatchCollisions(results, existingById);
    expect(results[0]).toMatchObject({ status: "matched", matchId: "d2" });
  });
});

describe("computeFieldUpdates", () => {
  const existing = { _id: "x", title: "Donde Tú Estás", author: "Conquistando Fronteras",
    key: "C", bpm: 70, timeSig: "", tagNames: ["Up Beat", "Poder"] };
  it("always sets the two URLs, sheet-wins on key/bpm, fills timeSig, never changes title", () => {
    const row = { title: "Donde Tú Estás (Where You Are)", author: "Conquistando Fronteras",
      key: "D", bpm: null, timeSig: "4/4", tags: ["Down Beat", "Alabanza"],
      musicalUrl: "https://youtu.be/m", lyricsUrl: null };
    const { set, conflicts } = computeFieldUpdates(existing, row);
    expect(set.musicalReferenceUrl).toBe("https://youtu.be/m");
    expect(set).not.toHaveProperty("lyricsVideoUrl");
    expect(set.key).toBe("D");
    expect(set).not.toHaveProperty("bpm");
    expect(set.timeSig).toBe("4/4");
    expect(set).not.toHaveProperty("title");
    expect(conflicts.some((c) => c.field === "title")).toBe(true);
  });
  it("flags a song left with no tempo tag", () => {
    const ex = { ...existing, tagNames: [] };
    const row = { title: "Desde Mi Interior", author: "", key: "", bpm: null, timeSig: "",
      tags: ["Rendición", "Gracia de Dios"], musicalUrl: null, lyricsUrl: null };
    const { flags } = computeFieldUpdates(ex, row);
    expect(flags).toContain("no-tempo-tag");
  });
});
