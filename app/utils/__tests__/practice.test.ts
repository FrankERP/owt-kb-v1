import { describe, it, expect } from "vitest";
import { beatsPerBar, tempoPeriodMs, autoscrollPxPerSecond, countLyricLines } from "../practice";

describe("tempoPeriodMs", () => {
  it("computes the beat period from bpm", () => {
    expect(tempoPeriodMs(120)).toBe(500);
  });

  it("falls back to the default bpm when falsy", () => {
    expect(tempoPeriodMs(0)).toBe(750);
    expect(tempoPeriodMs(undefined)).toBe(750);
  });
});

describe("beatsPerBar", () => {
  it("reads the numerator of a time signature", () => {
    expect(beatsPerBar("4/4")).toBe(4);
    expect(beatsPerBar("6/8")).toBe(6);
    expect(beatsPerBar("3/4")).toBe(3);
  });

  it("falls back to four on anything it cannot parse", () => {
    expect(beatsPerBar("x")).toBe(4);
    expect(beatsPerBar("")).toBe(4);
    expect(beatsPerBar("0/4")).toBe(4);
    expect(beatsPerBar(null)).toBe(4);
    expect(beatsPerBar(undefined)).toBe(4);
  });
});

describe("autoscrollPxPerSecond", () => {
  it("computes speed from height, lines and bpm", () => {
    expect(autoscrollPxPerSecond(2400, 30, 120)).toBe(20);
  });

  it("clamps to the minimum speed", () => {
    expect(autoscrollPxPerSecond(1, 1000, 40)).toBe(8);
  });

  it("clamps to the maximum speed", () => {
    expect(autoscrollPxPerSecond(100000, 1, 240)).toBe(160);
  });
});

describe("countLyricLines", () => {
  it("counts non-blank, non-heading lines", () => {
    expect(countLyricLines("# Coro\nSanto\n\n[G]Digno")).toBe(2);
  });
});
