// The editor's repeat-song history, extracted from the admin setlist GET so the
// MCP `edit_setlist` tool reads it the same way (P3 step 3). The GET's own route
// test still pins the wired behaviour; these pin the two pure pieces.

import { afterEach, describe, expect, it, vi } from "vitest";

import { recentSongUses, weeksAgoIso } from "../setlistRecentSongs";

const song = (id: string) => ({ song: { _id: id } });

describe("recentSongUses", () => {
  it("maps each song to its most recent past use across all three service kinds", () => {
    const uses = recentSongUses(
      {
        sunday: [{ week: "2026-07-12", songs: [song("a"), song("b")] }],
        saturday: [{ week: "2026-07-18", songs: [song("a")] }],
        special: [{ week: "2026-07-05", songs: [song("b"), song("c")] }],
      },
      "2026-08-02",
    );
    expect(uses).toEqual({ a: "2026-07-18", b: "2026-07-12", c: "2026-07-05" });
  });

  it("never warns a service about itself: its own date is skipped", () => {
    const uses = recentSongUses(
      {
        sunday: [
          { week: "2026-08-02", songs: [song("a")] },
          { week: "2026-07-26", songs: [song("b")] },
        ],
      },
      "2026-08-02",
    );
    expect(uses).toEqual({ b: "2026-07-26" });
  });

  it("skips a row without a string week, an entry without a song id and a non-array list", () => {
    const uses = recentSongUses(
      {
        sunday: [
          { songs: [song("a")] },
          { week: "2026-07-26", songs: [{ song: {} }, {}, song("b")] },
          { week: "2026-07-19", songs: "not-a-list" },
        ],
      },
      "2026-08-02",
    );
    expect(uses).toEqual({ b: "2026-07-26" });
  });

  it("reads an absent result as no history", () => {
    expect(recentSongUses(null, "2026-08-02")).toEqual({});
    expect(recentSongUses({}, "2026-08-02")).toEqual({});
  });
});

describe("weeksAgoIso", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts back n weeks and prints the Mexico City calendar day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T18:00:00Z")); // noon in Mexico City
    expect(weeksAgoIso(8)).toBe("2026-07-31");
  });

  it("uses the Mexico City day, not the UTC one, late in the evening", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T04:00:00Z")); // 22:00 on the 25th in Mexico City
    expect(weeksAgoIso(0)).toBe("2026-09-25");
  });
});
