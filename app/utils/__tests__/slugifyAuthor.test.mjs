import { describe, it, expect } from "vitest";
import { slugifyAuthor } from "../slugifyAuthor.mjs";

describe("slugifyAuthor", () => {
  it("transliterates diacritics (NFD), not deletes them", () => {
    expect(slugifyAuthor("Un Corazón")).toBe("un-corazon");
    expect(slugifyAuthor("En Espíritu y En Verdad")).toBe("en-espiritu-y-en-verdad");
  });
  it("collapses & and repeated separators to a single dash", () => {
    expect(slugifyAuthor("Hillsong Young & Free")).toBe("hillsong-young-free");
  });
  it("lowercases and trims edge dashes", () => {
    expect(slugifyAuthor("  Chris Tomlin  ")).toBe("chris-tomlin");
  });
});
