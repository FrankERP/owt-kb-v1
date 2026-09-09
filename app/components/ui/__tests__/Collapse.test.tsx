/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import Collapse from "../Collapse";

installMotionTestEnv();
afterEach(cleanup);

// Warm the LazyMotion feature chunk (ADR-0031), precedent Menu.test.tsx.
beforeAll(async () => { await import("../motionFeatures"); });

const wrap = (open: boolean) => render(<MotionProvider><Collapse open={open} id="c"><button>dentro</button></Collapse></MotionProvider>);

describe("Collapse", () => {
  it("keeps children mounted while closed, but inert and hidden from AT", () => {
    wrap(false);
    const box = document.getElementById("c")!;
    expect(box.querySelector("button")).not.toBeNull();
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect((box as HTMLElement & { inert: boolean }).inert).toBe(true);
  });
  it("is open, reachable and not hidden when open", () => {
    wrap(true);
    const box = document.getElementById("c")!;
    expect(box.getAttribute("aria-hidden")).toBeNull();
    expect((box as HTMLElement & { inert: boolean }).inert).toBe(false);
    expect(screen.getByRole("button", { name: "dentro" })).toBeTruthy();
  });
  it("flips both attributes when toggled", async () => {
    const { rerender } = wrap(false);
    rerender(<MotionProvider><Collapse open id="c"><button>dentro</button></Collapse></MotionProvider>);
    await waitFor(() => expect(document.getElementById("c")!.getAttribute("aria-hidden")).toBeNull());
    rerender(<MotionProvider><Collapse open={false} id="c"><button>dentro</button></Collapse></MotionProvider>);
    await waitFor(() => expect(document.getElementById("c")!.getAttribute("aria-hidden")).toBe("true"));
  });
});
