import { describe, expect, it } from "vitest";
import { TONE_RAIL } from "../agenda";
import { COUNTDOWN_CHIP, MINE_CHIP, SERVICE_TONE } from "../serviceToneStyle";

describe("SERVICE_TONE", () => {
  it("has a tone for every day the rail knows, each with the parts a card reads", () => {
    expect(Object.keys(SERVICE_TONE).sort()).toEqual(Object.keys(TONE_RAIL).sort());
    for (const tone of Object.values(SERVICE_TONE)) {
      expect(Object.keys(tone).sort()).toEqual(["chip", "edge", "ink", "solid", "wash"]);
    }
  });

  it("gives a worship day the hue its rail already has — the tile and the rail never disagree", () => {
    for (const [tone, token] of [["sun", "accent"], ["sat", "warning-fg"], ["special", "info-fg"]] as const) {
      expect(TONE_RAIL[tone]).toContain(`bg-${token}`);
      expect(SERVICE_TONE[tone].ink).toBe(`text-${token}`);
      expect(SERVICE_TONE[tone].wash).toContain(`bg-${token}/`);
    }
  });

  it("never spends the «tú» green or the key's rose on a day", () => {
    const every = Object.values(SERVICE_TONE).flatMap((tone) => Object.values(tone)).join(" ");
    expect(every).not.toMatch(/positive|key-fg/);
  });
});

describe("the head's chips", () => {
  it("«tú» is the app's one green; the countdown beside it is neutral", () => {
    expect(MINE_CHIP).toContain("text-positive-fg");
    expect(COUNTDOWN_CHIP).not.toMatch(/positive|accent/);
  });
});
