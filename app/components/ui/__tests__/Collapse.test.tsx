/** @vitest-environment jsdom */
import { useEffect } from "react";
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

  // The regression: with the latch flipped in an effect, the opening commit still
  // carried inert + aria-hidden, and a PARENT effect (IntegrityQueuePanel focuses
  // an entry right after opening) ran against that stale DOM — focus refused,
  // silently, with the ref already cleared. Both assertions are synchronous on
  // purpose: `waitFor` would hide exactly this one-commit lag.
  it("is reachable in the SAME commit that opens it, parent effects included", () => {
    const seen: { ariaHidden: string | null; inert: boolean }[] = [];
    // Stands in for the panel: an effect on `open`, so it runs after Collapse's.
    function Parent({ open }: { open: boolean }) {
      useEffect(() => {
        if (!open) return;
        const el = document.getElementById("c") as HTMLElement & { inert: boolean };
        seen.push({ ariaHidden: el.getAttribute("aria-hidden"), inert: el.inert });
      }, [open]);
      return <MotionProvider><Collapse open={open} id="c"><button>dentro</button></Collapse></MotionProvider>;
    }
    const { rerender } = render(<Parent open={false} />);
    rerender(<Parent open />);
    const box = document.getElementById("c") as HTMLElement & { inert: boolean };
    expect(box.getAttribute("aria-hidden")).toBeNull();
    expect(box.inert).toBe(false);
    expect(seen).toEqual([{ ariaHidden: null, inert: false }]);
  });

  it("keeps the animated element unstyled and puts className on the inner div", () => {
    render(<MotionProvider><Collapse open id="c" className="p-4 border"><button>dentro</button></Collapse></MotionProvider>);
    // Padding on the animated box floors its height above zero under border-box,
    // so a closed Collapse would reserve blank space forever.
    const box = document.getElementById("c")!;
    expect(box.className).toBe("");
    const inner = box.firstElementChild!;
    expect(inner.className).toBe("p-4 border");
    expect(inner.querySelector("button")).not.toBeNull();
  });
});
