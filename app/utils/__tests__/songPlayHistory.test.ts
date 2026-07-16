import { describe, expect, it } from "vitest";
import { buildPreviousKeysBySong } from "../songPlayHistory";

describe("buildPreviousKeysBySong", () => {
  it("returns unique keys in newest-first set order", () => {
    const result = buildPreviousKeysBySong([
      { songs: [{ songId: "song-1", play_key: "D" }, { songId: "song-2", play_key: "A" }] },
      { songs: [{ songId: "song-1", play_key: "E" }] },
      { songs: [{ songId: "song-1", play_key: "D" }] },
    ]);

    expect(result.get("song-1")).toEqual(["D", "E"]);
    expect(result.get("song-2")).toEqual(["A"]);
  });

  it("ignores incomplete history entries", () => {
    const result = buildPreviousKeysBySong([
      {
        songs: [
          { songId: "song-1", play_key: "" },
          { songId: "", play_key: "C" },
          { songId: "song-1", play_key: "  Bb  " },
        ],
      },
      { songs: null },
    ]);

    expect(result.get("song-1")).toEqual(["Bb"]);
    expect(result.size).toBe(1);
  });
});
