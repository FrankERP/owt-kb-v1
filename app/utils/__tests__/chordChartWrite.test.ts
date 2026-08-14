import { describe, expect, it } from "vitest";
import { normalizeChordCharts } from "../chordChartWrite";

function mint() {
  let n = 0;
  return () => `minted-${++n}`;
}

describe("normalizeChordCharts", () => {
  it("preserves _key for existing charts and mints only for new ones", () => {
    const result = normalizeChordCharts(
      [
        { _key: "k-g", key: "G", content: "[G]Grande" },
        { key: "A", content: "[A]Grande" },
      ],
      mint(),
    );
    expect(result).toEqual({
      ok: true,
      charts: [
        { _type: "chord_chart", _key: "k-g", key: "G", content: "[G]Grande" },
        { _type: "chord_chart", _key: "minted-1", key: "A", content: "[A]Grande" },
      ],
    });
  });

  it("rejects colliding _key values", () => {
    const result = normalizeChordCharts(
      [
        { _key: "dup", key: "G", content: "[G]a" },
        { _key: "dup", key: "A", content: "[A]b" },
      ],
      mint(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/_key/i);
  });

  it("rejects a chart missing content", () => {
    const result = normalizeChordCharts([{ key: "G" }], mint());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/content/i);
  });

  it("rejects a non-array", () => {
    const result = normalizeChordCharts({ key: "G", content: "x" }, mint());
    expect(result.ok).toBe(false);
  });

  it("drops whitespace-only content and does not trim kept content", () => {
    const result = normalizeChordCharts(
      [
        { _key: "k1", key: "G", content: "[G]  " },
        { _key: "k2", key: "A", content: "   " },
        { key: "C", content: "" },
      ],
      mint(),
    );
    expect(result).toEqual({
      ok: true,
      charts: [
        { _type: "chord_chart", _key: "k1", key: "G", content: "[G]  " },
      ],
    });
  });

  it("rejects an invalid _key instead of minting over it", () => {
    const result = normalizeChordCharts(
      [{ _key: "bad key!", key: "G", content: "[G]a" }],
      mint(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/_key/i);
  });

  it("coerces a missing key to an empty string", () => {
    const result = normalizeChordCharts([{ content: "[G]a" }], mint());
    expect(result).toEqual({
      ok: true,
      charts: [{ _type: "chord_chart", _key: "minted-1", key: "", content: "[G]a" }],
    });
  });

  it("accepts an empty array", () => {
    expect(normalizeChordCharts([], mint())).toEqual({ ok: true, charts: [] });
  });
});
