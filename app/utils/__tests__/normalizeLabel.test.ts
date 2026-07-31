// The ONE normalization for a label that participates in a service's identity.
//
// It used to be hand-copied in `roleCreationReceipt` (which FINGERPRINTS with
// it), `roleWriteRequest` (which parses the request with it) and inline in
// `roleWriteOps` (which filters special occupancy with it) — and the planner
// grid needed a fourth copy on the client. A silent divergence between any two
// of them re-opens the duplicate-`special_role` failure: a second special whose
// name one side folds and the other does not finds no occupant, no 409 fires,
// and the first document is orphaned in silence.

import { describe, expect, it } from "vitest";

import { normalizeLabel, normalizeServiceName } from "../normalizeLabel";

describe("normalizeLabel", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeLabel("  Vigilia   de  Oración ")).toBe("Vigilia de Oración");
    expect(normalizeLabel("Vigilia\t\nde  Oración")).toBe("Vigilia de Oración");
  });

  it("normalizes to NFC, so a decomposed accent equals its composed form", () => {
    // Written as ESCAPES, not as literals: an editor, a linter or a copy-paste
    // would silently re-compose a decomposed literal and the test would then be
    // comparing a string to itself.
    const decomposed = "Oraci\u006F\u0301n"; // o + U+0301 COMBINING ACUTE ACCENT
    const composed = "Oraci\u00F3n"; // U+00F3 LATIN SMALL LETTER O WITH ACUTE
    expect(decomposed).toHaveLength(8);
    expect(composed).toHaveLength(7);
    expect(decomposed).not.toBe(composed);
    expect(normalizeLabel(decomposed)).toBe(composed);
  });

  it("does NOT fold case — 'Vigilia' and 'vigilia' are two different services", () => {
    expect(normalizeLabel("vigilia")).toBe("vigilia");
    expect(normalizeLabel("Vigilia")).toBe("Vigilia");
    expect(normalizeLabel("vigilia")).not.toBe(normalizeLabel("Vigilia"));
  });

  it("does NOT strip accents — 'Oración' and 'Oracion' stay distinct", () => {
    expect(normalizeLabel("Oración")).not.toBe(normalizeLabel("Oracion"));
  });

  it("returns null for a non-string or a value that normalizes to empty", () => {
    expect(normalizeLabel(undefined)).toBeNull();
    expect(normalizeLabel(null)).toBeNull();
    expect(normalizeLabel(42)).toBeNull();
    expect(normalizeLabel("")).toBeNull();
    expect(normalizeLabel("   ")).toBeNull();
  });
});

describe("normalizeServiceName", () => {
  it("is the same function, total over strings: absent or blank collapses to ''", () => {
    expect(normalizeServiceName(undefined)).toBe("");
    expect(normalizeServiceName("   ")).toBe("");
    expect(normalizeServiceName(null)).toBe("");
  });

  it("two nameless specials therefore share one collision key rather than each getting a null", () => {
    expect(normalizeServiceName(undefined)).toBe(normalizeServiceName(""));
  });

  it("agrees with normalizeLabel wherever normalizeLabel answers", () => {
    for (const v of ["Vigilia", "  Vigilia  de  Oración ", "vigilia", "Oración"]) {
      expect(normalizeServiceName(v)).toBe(normalizeLabel(v));
    }
  });
});
