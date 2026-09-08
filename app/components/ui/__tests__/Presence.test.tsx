/** @vitest-environment jsdom */
// app/components/ui/__tests__/Presence.test.tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import Presence from "../Presence";

installMotionTestEnv();
afterEach(cleanup);

function Harness({ show, onExited }: { show: boolean; onExited?: () => void }) {
  return (
    <MotionProvider>
      <Presence show={show} variant="rise" role="status" data-testid="toast" onExited={onExited}>
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

  it("renders on first mount when appear is set, with the forwarded attributes", () => {
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

  it("applies the variant's motion styles to the host", () => {
    render(<Harness show />);
    const el = screen.getByTestId("toast");
    // Animations are skipped in tests (installMotionTestEnv), so motion writes the
    // final computed value synchronously — "rise" animates opacity to 1.
    expect(el.style.opacity).toBe("1");
  });
});
