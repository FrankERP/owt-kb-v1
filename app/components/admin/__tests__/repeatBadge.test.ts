// The setlist repeat badge, and the future booking it used to call "esta sem.".
//
// `recentSongs` comes from GROQ with `week >= $cutoff` and NO upper bound, and
// the route keeps the LATEST week per song. So a song already booked months
// ahead arrived with a negative age, which passed the `> 4` filter, landed in
// the `<= 2` red class and rendered "esta sem." — a red "played this week"
// warning on songs that had not been played at all, burying the real signal.
//
// Suppressing negatives would have been the wrong fix: a song on tomorrow's
// Sunday while you edit Saturday is a genuine same-weekend repeat, and the most
// actionable warning of the lot.

import { describe, expect, it } from "vitest";

import { repeatBadgeFor } from "../SetlistEditor";

const TODAY = "2026-09-03"; // a Thursday

describe("repeatBadgeFor", () => {
  it("names a future booking as scheduled, not as played this week", () => {
    const far = repeatBadgeFor("2026-12-06", TODAY);
    expect(far?.label).toBe("ya programada");
    expect(far?.tone).toBe("upcoming");
  });

  it("still warns about the very next day — a same-weekend repeat", () => {
    // Editing Saturday while the song sits on tomorrow's Sunday.
    const tomorrow = repeatBadgeFor("2026-09-04", TODAY);
    expect(tomorrow?.label).toBe("ya programada");
    expect(tomorrow?.tone).toBe("upcoming");
  });

  it("reads today itself as this week, not as a future booking", () => {
    expect(repeatBadgeFor(TODAY, TODAY)).toEqual({ label: "esta sem.", tone: "recent" });
  });

  it("counts backwards in whole weeks", () => {
    expect(repeatBadgeFor("2026-08-30", TODAY)?.label).toBe("esta sem.");   // 4 days
    expect(repeatBadgeFor("2026-08-27", TODAY)?.label).toBe("hace 1 sem."); // 7 days
    expect(repeatBadgeFor("2026-08-13", TODAY)?.label).toBe("hace 3 sem."); // 21 days
  });

  it("turns amber past two weeks and disappears past four", () => {
    expect(repeatBadgeFor("2026-08-20", TODAY)?.tone).toBe("recent"); // 2 weeks
    expect(repeatBadgeFor("2026-08-13", TODAY)?.tone).toBe("older");  // 3 weeks
    expect(repeatBadgeFor("2026-08-06", TODAY)?.tone).toBe("older");  // 4 weeks — still shown
    expect(repeatBadgeFor("2026-07-30", TODAY)).toBeNull();           // 5 weeks — gone
  });

  it("is a pure function of two calendar days, so no clock can shift the label", () => {
    // The old version read `Date.now()` directly, so the same song could say
    // "esta sem." in the morning and "hace 1 sem." after lunch. `todayIso` is a
    // parameter now — the caller passes the Mexico City calendar day — and that
    // parameterisation IS the fix. This pins the boundary, not the wall clock:
    // no test here can prove time-of-day independence, because there is no
    // longer a clock to vary.
    expect(repeatBadgeFor("2026-08-27", "2026-09-03")?.label).toBe("hace 1 sem.");
    expect(repeatBadgeFor("2026-08-28", "2026-09-03")?.label).toBe("esta sem.");
    // Same pair, one day later: the boundary moves with the day, not the hour.
    expect(repeatBadgeFor("2026-08-28", "2026-09-04")?.label).toBe("hace 1 sem.");
  });

  it("renders nothing for an unusable date rather than guessing", () => {
    expect(repeatBadgeFor("", TODAY)).toBeNull();
    expect(repeatBadgeFor("no-es-fecha", TODAY)).toBeNull();
  });
});
