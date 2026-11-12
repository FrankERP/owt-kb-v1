// Guards the `pop` keyframe/animation the Kids board and cards use for a chip
// that just landed (R6 Task 2). Kids code may NOT import `motion`
// (`motionImportBoundary.test.ts`), so this is a plain CSS animation declared
// once here and referenced as `animate-pop`.
import { describe, it, expect } from "vitest";
import config from "../../../tailwind.config";

describe("tailwind motion utilities", () => {
  it("declares pop on the slow token with an overshoot and a none end state", () => {
    const kf = (config.theme?.extend?.keyframes as Record<string, Record<string, Record<string, string>>>).pop;
    expect(kf["0%"].transform).toContain("scale(0.92)");
    expect(kf["60%"].transform).toContain("scale(1.04)");
    expect(kf["100%"].transform).toBe("none");
    expect((config.theme?.extend?.animation as Record<string, string>).pop).toBe(
      "pop var(--motion-slow) var(--ease-out) both",
    );
  });

  it("declares rail-draw: a scaleY from 0 that ends on none, on the reveal token (ADR-0087)", () => {
    // A Jóvenes meeting card's colour rail. It ends on `none`, not `scaleY(1)`: the rail is
    // `position: absolute` inside the card, and a transform left on it would make it a
    // containing block for nothing today and for a surprise tomorrow (MOTION.md rule 5).
    const kf = (config.theme?.extend?.keyframes as Record<string, Record<string, Record<string, string>>>)["rail-draw"];
    expect(kf.from.transform).toBe("scaleY(0)");
    expect(kf.to.transform).toBe("none");
    expect((config.theme?.extend?.animation as Record<string, string>)["rail-draw"]).toBe(
      "rail-draw var(--motion-reveal) var(--ease-out) both",
    );
  });
});
