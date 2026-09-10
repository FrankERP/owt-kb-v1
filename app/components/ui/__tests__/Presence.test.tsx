/** @vitest-environment jsdom */
// app/components/ui/__tests__/Presence.test.tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import Presence from "../Presence";

installMotionTestEnv();
afterEach(cleanup);

function Harness({
  show,
  onExited,
  onEntered,
}: {
  show: boolean;
  onExited?: () => void;
  onEntered?: () => void;
}) {
  return (
    <MotionProvider>
      <Presence
        show={show}
        variant="rise"
        role="status"
        data-testid="toast"
        onExited={onExited}
        onEntered={onEntered}
      >
        Guardado
      </Presence>
    </MotionProvider>
  );
}

describe("Presence", () => {
  it("renders its children when show is true, with the forwarded attributes", () => {
    render(<Harness show />);
    const el = screen.getByTestId("toast");
    expect(el.textContent).toBe("Guardado");
    expect(el.getAttribute("role")).toBe("status");
  });

  it("renders nothing when show is false from the start", () => {
    render(<Harness show={false} />);
    expect(screen.queryByTestId("toast")).toBeNull();
  });

  it("removes the element after show flips to false, and reports the exit", async () => {
    const onExited = vi.fn();
    const { rerender } = render(<Harness show onExited={onExited} />);
    expect(screen.getByTestId("toast")).toBeTruthy();
    rerender(<Harness show={false} onExited={onExited} />);
    await waitFor(() => expect(screen.queryByTestId("toast")).toBeNull());
    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
  });

  it("renders the requested element type", () => {
    render(
      <MotionProvider>
        <Presence show as="li" data-testid="row">fila</Presence>
      </MotionProvider>,
    );
    expect(screen.getByTestId("row").tagName).toBe("LI");
  });

  it("renders as a section host", () => {
    render(
      <MotionProvider>
        <Presence show as="section" data-testid="panel">panel</Presence>
      </MotionProvider>,
    );
    expect(screen.getByTestId("panel").tagName).toBe("SECTION");
  });

  it("accepts appear and forwards attributes on a first mount (behaviour of initial is not observable under skipAnimations)", () => {
    render(
      <MotionProvider>
        <Presence show appear variant="rise" data-testid="on-demand" role="status">
          Nueva fila
        </Presence>
      </MotionProvider>,
    );
    const el = screen.getByTestId("on-demand");
    expect(el.textContent).toBe("Nueva fila");
    expect(el.getAttribute("role")).toBe("status");
  });

  it("calls onEntered once after show flips false→true, and not on exit", async () => {
    const onEntered = vi.fn();
    const onExited = vi.fn();
    const { rerender } = render(<Harness show={false} onEntered={onEntered} onExited={onExited} />);
    expect(onEntered).not.toHaveBeenCalled();

    rerender(<Harness show onEntered={onEntered} onExited={onExited} />);
    await waitFor(() => expect(onEntered).toHaveBeenCalledTimes(1));

    rerender(<Harness show={false} onEntered={onEntered} onExited={onExited} />);
    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
    expect(onEntered).toHaveBeenCalledTimes(1);
  });

  it("applies the variant's motion styles to the host", () => {
    render(<Harness show />);
    const el = screen.getByTestId("toast");
    // Animations are skipped in tests (installMotionTestEnv), so motion writes the
    // final computed value synchronously — "rise" animates opacity to 1.
    expect(el.style.opacity).toBe("1");
  });

  it("renders the sheet variant without crashing, reaching opacity 1 after show flips true", async () => {
    // The sheet variant enters on SPRINGS.sheet instead of the tokenised ENTER —
    // a spring has no fixed duration, so it cannot be observed as a timed value
    // under jsdom/skipAnimations. This only asserts the variant wires up (no
    // crash) and lands at its resting opacity, not the spring's motion curve.
    const { rerender } = render(
      <MotionProvider>
        <Presence show={false} variant="sheet" data-testid="sheet">
          Reproductor
        </Presence>
      </MotionProvider>,
    );
    rerender(
      <MotionProvider>
        <Presence show variant="sheet" data-testid="sheet">
          Reproductor
        </Presence>
      </MotionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("sheet").style.opacity).toBe("1"));
  });
});
