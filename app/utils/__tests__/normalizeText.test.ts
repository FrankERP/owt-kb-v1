import { describe, it, expect } from "vitest";
import { normalizeText } from "../normalizeText";

describe("normalizeText", () => {
  it("returns empty string for nullish input", () => {
    expect(normalizeText(undefined)).toBe("");
    expect(normalizeText(null)).toBe("");
    expect(normalizeText("")).toBe("");
  });

  it("lowercases", () => {
    expect(normalizeText("HELLO")).toBe("hello");
  });

  it("strips Spanish accents so unaccented queries match", () => {
    expect(normalizeText("Adoración")).toBe("adoracion");
    expect(normalizeText("Jesús")).toBe("jesus");
    expect(normalizeText("Él es Dios")).toBe("el es dios");
    expect(normalizeText("Corazón")).toBe("corazon");
  });

  it("folds ñ to n (accent-insensitive: 'niño' matches 'nino')", () => {
    // NFD splits the precomposed ñ into "n" + combining tilde; we strip the
    // combining mark, so ñ folds to a bare "n" — intended for search matching.
    expect(normalizeText("Niño")).toBe("nino");
  });

  it("is idempotent", () => {
    const once = normalizeText("Aleluyá");
    expect(normalizeText(once)).toBe(once);
  });

  it("enables substring matching regardless of accents", () => {
    const haystack = normalizeText("Grande Es Tu Fidelidad");
    expect(haystack.includes(normalizeText("fidelidad"))).toBe(true);
  });
});
