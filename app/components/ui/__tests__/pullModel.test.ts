// The pull-to-refresh arithmetic (spec §12.8, decision L). Kept in its own
// neutral module because the gesture itself cannot be driven in jsdom with any
// fidelity — the numbers are where "the rail grows at half the finger's travel,
// caps, and fires at 72 px" is actually provable.
import { describe, expect, it } from "vitest";

import { MAX, THRESHOLD, pullProgress, railHeight, shouldRefresh } from "../pullModel";

describe("pullModel", () => {
  it("pins the two constants the rail and the gate are built from", () => {
    expect(THRESHOLD).toBe(72);
    expect(MAX).toBe(120);
  });

  describe("pullProgress", () => {
    it("is 0 at rest and never negative", () => {
      expect(pullProgress(0)).toBe(0);
      expect(pullProgress(-40)).toBe(0);
    });

    it("rises linearly to 1 at the threshold", () => {
      expect(pullProgress(8)).toBeCloseTo(8 / 72, 6);
      expect(pullProgress(36)).toBeCloseTo(0.5, 6);
      expect(pullProgress(72)).toBe(1);
    });

    it("clamps at 1 past the threshold, MAX and beyond", () => {
      expect(pullProgress(120)).toBe(1);
      expect(pullProgress(300)).toBe(1);
    });
  });

  describe("shouldRefresh", () => {
    it("fires at the threshold and not one pixel before", () => {
      expect(shouldRefresh(0)).toBe(false);
      expect(shouldRefresh(8)).toBe(false);
      expect(shouldRefresh(71)).toBe(false);
      expect(shouldRefresh(72)).toBe(true);
      expect(shouldRefresh(120)).toBe(true);
      expect(shouldRefresh(300)).toBe(true);
    });
  });

  describe("railHeight", () => {
    it("grows at half the finger's travel — the resistance", () => {
      expect(railHeight(0)).toBe(0);
      expect(railHeight(8)).toBe(4);
      expect(railHeight(72)).toBe(36);
    });

    it("caps at MAX / 2 however far the finger goes", () => {
      expect(railHeight(120)).toBe(60);
      expect(railHeight(300)).toBe(60);
    });

    it("never goes negative on an upward drag", () => {
      expect(railHeight(-90)).toBe(0);
    });
  });
});
