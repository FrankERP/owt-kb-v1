/** @vitest-environment jsdom */
//
// A failed panel chunk stays INSIDE its panel, and «Reintentar» recovers.
//
// The bug this pins: `next/dynamic` in the App Router renders its `loading`
// component only as a Suspense fallback (`{ isLoading, pastDelay, error: null }`
// — it never passes `error` or `retry`), so a rejected `import()` throws through
// `React.lazy` to `app/(client)/error.tsx` and takes the whole of `/admin` down
// for one bad chunk. `PanelBoundary` catches it. Its «Reintentar» reloads the
// page by default — a rejected lazy is CACHED, so a local re-render cannot
// re-run the import — and takes an `onRetry` for a caller that can recover in
// place, which is the third case here: the child fails once, then succeeds.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import PanelBoundary from "../PanelBoundary";

/** React logs the caught error; the boundary working is the point, not the noise. */
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  cleanup();
});

function Boom(): React.ReactElement {
  throw new Error("Loading chunk 404 failed");
}

describe("PanelBoundary", () => {
  it("renders its child when nothing throws", () => {
    render(
      <PanelBoundary>
        <p>Contenido del panel</p>
      </PanelBoundary>,
    );
    expect(screen.getByText("Contenido del panel")).toBeTruthy();
  });

  it("renders the failure message and «Reintentar» when the child throws", () => {
    render(
      <PanelBoundary>
        <Boom />
      </PanelBoundary>,
    );
    expect(screen.getByText("No se pudo cargar esta sección.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("re-mounts the panel on «Reintentar» — a child that now succeeds renders", () => {
    // `onRetry`'s contract: the boundary clears its own failure and the caller
    // supplies a child that can render this time.
    function Host() {
      const [attempt, setAttempt] = useState(0);
      return (
        <PanelBoundary key={attempt} onRetry={() => setAttempt((n) => n + 1)}>
          {attempt === 0 ? <Boom /> : <p>Contenido del panel</p>}
        </PanelBoundary>
      );
    }
    render(<Host />);
    expect(screen.queryByText("Contenido del panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(screen.getByText("Contenido del panel")).toBeTruthy();
    expect(screen.queryByText("No se pudo cargar esta sección.")).toBeNull();
  });
});
