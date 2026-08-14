import { describe, expect, it } from "vitest";
import {
  addChart,
  chartsFromSong,
  chartsToPayload,
  moveChart,
  removeChart,
  updateChart,
} from "../songFormCharts";

const THREE_CHARTS = [
  { _key: "k-g", key: "G", content: "[G]Grande es tu fidelidad" },
  { _key: "k-a", key: "A", content: "[A]Grande es tu fidelidad" },
  { _key: "k-c", key: "C", content: "[C]Grande es tu fidelidad" },
];

describe("songFormCharts", () => {
  it("a 3-chart song maps to payload with the same order, content, and _key values", () => {
    const drafts = chartsFromSong(THREE_CHARTS);
    expect(chartsToPayload(drafts)).toEqual([
      { _key: "k-g", key: "G", content: "[G]Grande es tu fidelidad" },
      { _key: "k-a", key: "A", content: "[A]Grande es tu fidelidad" },
      { _key: "k-c", key: "C", content: "[C]Grande es tu fidelidad" },
    ]);
  });

  it("add / remove / reorder each produce the expected payload", () => {
    let drafts = chartsFromSong(THREE_CHARTS);
    drafts = addChart(drafts, "D", () => "local-new");
    // New empty row is held in form state but dropped from the payload.
    expect(drafts).toHaveLength(4);
    expect(chartsToPayload(drafts)).toHaveLength(3);

    drafts = updateChart(drafts, "local-new", { content: "[D]Nueva" });
    expect(chartsToPayload(drafts)).toEqual([
      { _key: "k-g", key: "G", content: "[G]Grande es tu fidelidad" },
      { _key: "k-a", key: "A", content: "[A]Grande es tu fidelidad" },
      { _key: "k-c", key: "C", content: "[C]Grande es tu fidelidad" },
      { key: "D", content: "[D]Nueva" },
    ]);

    drafts = moveChart(drafts, "k-c", -1);
    expect(chartsToPayload(drafts).map((c) => c._key ?? c.content)).toEqual([
      "k-g",
      "k-c",
      "k-a",
      "[D]Nueva",
    ]);

    drafts = removeChart(drafts, "k-a");
    expect(chartsToPayload(drafts)).toEqual([
      { _key: "k-g", key: "G", content: "[G]Grande es tu fidelidad" },
      { _key: "k-c", key: "C", content: "[C]Grande es tu fidelidad" },
      { key: "D", content: "[D]Nueva" },
    ]);
  });

  it("dropping the last chart yields an empty chords payload", () => {
    const [only] = chartsFromSong([THREE_CHARTS[0]]);
    expect(chartsToPayload(removeChart([only], only.id))).toEqual([]);
  });

  it("chartsToPayload drops whitespace-only drafts and does not trim kept content", () => {
    const drafts = chartsFromSong([
      { _key: "k1", key: "G", content: "[G]  " },
      { _key: "k2", key: "A", content: "   " },
      { _key: "k3", key: "C", content: "" },
    ]);
    expect(chartsToPayload(drafts)).toEqual([
      { _key: "k1", key: "G", content: "[G]  " },
    ]);
  });

  it("chartsFromSong coerces missing key/content to empty strings", () => {
    const drafts = chartsFromSong([{ _key: "stub" }]);
    expect(drafts[0]).toMatchObject({ _key: "stub", key: "", content: "" });
    expect(chartsToPayload(drafts)).toEqual([]);
  });

  it("a song with no charts maps to an empty list", () => {
    expect(chartsFromSong(undefined)).toEqual([]);
    expect(chartsFromSong([])).toEqual([]);
    expect(chartsToPayload([])).toEqual([]);
  });
});
