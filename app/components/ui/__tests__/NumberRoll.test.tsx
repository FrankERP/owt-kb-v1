/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MotionProvider } from "../MotionProvider";
import NumberRoll from "../NumberRoll";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

describe("NumberRoll", () => {
  it("renders the value as text", () => {
    render(<MotionProvider><NumberRoll value="En 4 días" /></MotionProvider>);
    expect(screen.getByText("En 4 días")).toBeTruthy();
    const hostElement = screen.getByText("En 4 días").parentElement;
    const classList = hostElement?.className.split(/\s+/) || [];
    expect(classList).toContain("relative");
    expect(classList).toContain("overflow-hidden");
  });

  it("swaps to the new value and drops the old one", async () => {
    const { rerender } = render(<MotionProvider><NumberRoll value={3} /></MotionProvider>);
    rerender(<MotionProvider><NumberRoll value={4} /></MotionProvider>);
    expect(screen.getByText("4")).toBeTruthy();
    // skipAnimations is on under the test env, so the exit completes synchronously.
    expect(screen.queryByText("3")).toBeNull();
  });
});
