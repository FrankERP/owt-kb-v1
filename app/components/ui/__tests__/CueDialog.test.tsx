/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPortal } from "react-dom";
import CueDialog, { useCueDialogFocusSatellite } from "../CueDialog";
import { CueDialogProvider, type DismissReason } from "../CueDialogProvider";
import CueDialogStatus from "../CueDialogStatus";
import { MotionProvider } from "../MotionProvider";
import Menu, { MenuItem } from "../Menu";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();

let originalOffsetParent: PropertyDescriptor | undefined;

beforeAll(() => {
  originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentNode; },
  });
});

afterAll(() => {
  if (originalOffsetParent) Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

function Harness({
  open,
  childOpen = false,
  onDismiss = vi.fn(),
  onChildDismiss = vi.fn(),
}: {
  open: boolean;
  childOpen?: boolean;
  onDismiss?: (reason: DismissReason) => void;
  onChildDismiss?: (reason: DismissReason) => void;
}) {
  return (
    <MotionProvider>
      <CueDialogProvider>
        <button data-testid="trigger">Abrir</button>
        <CueDialog open={open} title="Editar canción" onDismiss={onDismiss}>
          <div className="p-4">
            <button>Guardar</button>
            <button>Cancelar</button>
            <CueDialogStatus tone="error">Error local</CueDialogStatus>
            <CueDialog open={childOpen} title="Confirmar" onDismiss={onChildDismiss}>
              <button>Volver</button>
            </CueDialog>
          </div>
        </CueDialog>
      </CueDialogProvider>
    </MotionProvider>
  );
}

describe("CueDialog", () => {
  it("renders in a portal with dialog semantics and local status", () => {
    const { getByRole } = render(<Harness open />);

    const dialog = getByRole("dialog", { name: "Editar canción" });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(getByRole("alert").textContent).toBe("Error local");
    expect(document.querySelector("[data-cue-dialog-root]")?.contains(dialog)).toBe(true);
  });

  it("moves focus into the dialog and traps tab wrapping", () => {
    const { getByRole } = render(<Harness open />);

    const close = getByRole("button", { name: "Cerrar diálogo" });
    const cancel = getByRole("button", { name: "Cancelar" });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it("reports Escape and backdrop dismissal reasons only for the top layer", () => {
    const onDismiss = vi.fn();
    const onChildDismiss = vi.fn();
    render(
      <Harness open childOpen onDismiss={onDismiss} onChildDismiss={onChildDismiss} />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onChildDismiss).toHaveBeenCalledWith("escape");
    expect(onDismiss).not.toHaveBeenCalled();

    cleanup();
    const backdropDismiss = vi.fn();
    render(<Harness open childOpen onDismiss={onDismiss} onChildDismiss={backdropDismiss} />);
    const childBackdrop = document.querySelector<HTMLElement>('[data-cue-layer]:not([aria-hidden]) [data-cue-backdrop]');
    expect(childBackdrop).not.toBeNull();
    fireEvent.click(childBackdrop as HTMLElement);
    expect(backdropDismiss).toHaveBeenCalledWith("backdrop");
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

/**
 * ── Focus satellites ───────────────────────────────────────────────────────
 *
 * The case this was built for was the Tablero, whose participation rail
 * `createPortal`ed itself onto `document.body` so WebKit would paint it — and
 * whose Voces/Instrumentos `<select>` therefore left the dialog's Tab ring.
 * That surface has since been deleted, so THESE TESTS ARE NOW THE ONLY
 * COVERAGE of the mechanism, and the reason `useCueDialogFocusSatellite`
 * survives with no production caller: the next dialog descendant that portals a
 * control out of the shell hits the same mouse-only regression.
 *
 * They always used a stand-in portal rather than the rail itself, so they pin
 * the MECHANISM (`useCueDialogFocusSatellite` + the union + the ordering) and
 * never depended on the retired component. The stand-in portals to
 * `document.body` exactly as the rail did, so the satellite genuinely lands
 * after the shell in the document, as in production.
 *
 * WHAT THESE CANNOT SEE: jsdom implements no sequential focus navigation, so a
 * `Tab` the trap deliberately does NOT intercept (every interior step) moves
 * nothing here. Only the two forced ends of the ring are observable in jsdom.
 * The interior steps were checked by hand in a real browser — see the report at
 * `.superpowers/sdd/tablero-keyboard-report.md`.
 */
function Satellite({ target, children }: { target?: HTMLElement | null; children: React.ReactNode }) {
  const railRef = useCueDialogFocusSatellite();
  // No `target` means `document.body`, which is what the retired rail did.
  // React appends the portal's content at mount time, and the dialog's children
  // only mount once the provider's `[data-cue-dialog-root]` exists — so the
  // satellite genuinely lands AFTER the shell in the document, as in production.
  return createPortal(<div ref={railRef}>{children}</div>, target ?? document.body);
}

describe("CueDialog focus satellites", () => {
  function SatelliteHarness({
    target,
    mounted = true,
    childOpen = false,
  }: {
    target?: HTMLElement | null;
    mounted?: boolean;
    childOpen?: boolean;
  }) {
    return (
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open title="Tablero" onDismiss={vi.fn()}>
            <div className="p-4">
              <button>Guardar</button>
              <button>Cancelar</button>
              {mounted && (
                <Satellite target={target}>
                  <select aria-label="Vista">
                    <option value="voces">Voces</option>
                  </select>
                </Satellite>
              )}
              <CueDialog open={childOpen} title="Confirmar" onDismiss={vi.fn()}>
                <button>Volver</button>
              </CueDialog>
            </div>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>
    );
  }

  it("puts a portalled satellite in the ring, last, when it follows the shell", () => {
    const { getByRole } = render(<SatelliteHarness />);

    const close = getByRole("button", { name: "Cerrar diálogo" });
    const select = getByRole("combobox", { name: "Vista" });

    // Initial focus is unchanged by the satellite: the dialog's own first stop.
    expect(document.activeElement).toBe(close);

    // Tab off the ring's last stop wraps to the first — proving the select IS
    // the last stop, i.e. it is in the ring and it is after the shell.
    select.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    // ...and the cycle closes the other way: Shift+Tab off the first stop.
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(select);
  });

  it("orders the ring by document position, not by registration", () => {
    // Same satellite, but PREPENDED to `body`, so it precedes the dialog shell.
    // The ring must follow the document, because the interior Tab steps it
    // delegates to the browser do.
    const target = document.createElement("div");
    document.body.prepend(target);
    const { getByRole } = render(<SatelliteHarness target={target} />);

    const close = getByRole("button", { name: "Cerrar diálogo" });
    const cancel = getByRole("button", { name: "Cancelar" });
    const select = getByRole("combobox", { name: "Vista" });

    expect(document.activeElement).toBe(close);

    // The select is now FIRST, so Shift+Tab off it wraps to the shell's last.
    select.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);

    // ...and Tab off the shell's last reaches the select.
    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(select);
  });

  it("drops a satellite from the ring when it unmounts", () => {
    const { getByRole, rerender } = render(<SatelliteHarness />);

    const close = getByRole("button", { name: "Cerrar diálogo" });
    const cancel = getByRole("button", { name: "Cancelar" });
    expect(document.activeElement).toBe(close);

    rerender(<SatelliteHarness mounted={false} />);

    // Back to the shell's own ring — the pinned behaviour of every other dialog.
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it("leaves an unregistered portalled node out of the ring", () => {
    // The inertness guarantee for every consumer that never opts in: a stray
    // portal on `body` — a toast, another dialog's shell — is not a satellite.
    const stray = document.createElement("div");
    const strayButton = document.createElement("button");
    strayButton.textContent = "Intruso";
    stray.appendChild(strayButton);
    document.body.appendChild(stray);

    const { getByRole } = render(<Harness open />);
    const close = getByRole("button", { name: "Cerrar diálogo" });
    const cancel = getByRole("button", { name: "Cancelar" });

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it("does not lend a parent's satellite to a nested dialog's ring", () => {
    const { getByRole } = render(<SatelliteHarness childOpen />);

    // The child owns the trap. Its ring is its own close button plus "Volver" —
    // the parent's satellite belongs to the parent.
    const childClose = getByRole("button", { name: "Cerrar diálogo" });
    const volver = getByRole("button", { name: "Volver" });
    expect(document.activeElement).toBe(childClose);

    childClose.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(volver);
  });
});

/**
 * ── Motion (spec §4, §19.4) ────────────────────────────────────────────────
 *
 * Animations are skipped under `installMotionTestEnv`, so an exit resolves on
 * the next frame rather than after EXIT_MS — the assertions below pin the
 * ORDER (mounted → unregistered → focus restored), never the duration.
 */
describe("CueDialog motion", () => {
  it("keeps the dialog mounted until the exit completes, then restores focus to the opener", async () => {
    const { rerender } = render(<Harness open={false} />);
    // MotionProvider loads its feature set as an async chunk (ADR-0031). Until it
    // lands, `m.*` elements have no exit protocol and AnimatePresence unmounts them
    // synchronously — the documented degradation, and not what this test is about.
    // Flushing the import first is what makes the assertion below about the EXIT.
    await act(async () => {});
    screen.getByTestId("trigger").focus();
    rerender(<Harness open />);
    await act(async () => {});
    expect(document.querySelector("[data-cue-layer]")).not.toBeNull();
    rerender(<Harness open={false} />);
    // Exit is in flight: still mounted, still registered (app root still inert).
    expect(document.querySelector("[data-cue-layer]")).not.toBeNull();
    await waitFor(() => expect(document.querySelector("[data-cue-layer]")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("trigger")));
    expect(document.body.style.overflow).toBe("");
  });

  it("renders no Cue eyebrow above the title", () => {
    render(<Harness open />);
    expect(screen.queryByText("Cue")).toBeNull();
    expect(screen.getByRole("heading", { name: "Editar canción" })).toBeTruthy();
  });

  it("dismisses a sheet with reason drag when the handle is dragged past the threshold", () => {
    const onDismiss = vi.fn();
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}>
            <button>Ok</button>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    // 200 px over a full second (0.2 px/ms, under the 0.5 px/ms flick arm), so only
    // the distance arm can dismiss. Without the clock jsdom's instant move reads as
    // 200 px/ms and the case would pass with the distance arm deleted.
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = document.querySelector<HTMLElement>("[data-cue-handle]")!;
      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
      clock = 1000;
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300, isPrimary: true });
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 300 });
    } finally {
      now.mockRestore();
    }
    expect(onDismiss).toHaveBeenCalledWith("drag");
  });

  it("dismisses a sheet when the TITLE BAR is dragged, not only the handle", () => {
    // The whole head is the grip (Frank, dev, 2026-09-09): a finger on «Detalle»
    // must work exactly like one on the pill.
    const onDismiss = vi.fn();
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}>
            <button>Ok</button>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const heading = screen.getByRole("heading", { name: "Detalle" });
      fireEvent.pointerDown(heading, { pointerId: 1, clientY: 100, isPrimary: true });
      clock = 1000;
      fireEvent.pointerMove(heading, { pointerId: 1, clientY: 300, isPrimary: true });
      fireEvent.pointerUp(heading, { pointerId: 1, clientY: 300 });
    } finally {
      now.mockRestore();
    }
    expect(onDismiss).toHaveBeenCalledWith("drag");
  });

  it("keeps the close button inside the grip a tap, never a drag", () => {
    // A pointerdown on × must not start tracking. What this proves is exactly that —
    // no drag reason fires from the ×. The reason the guard exists (with pointer
    // capture a real browser retargets the pointerup to the head and the button's
    // click never fires) is NOT observable in jsdom, which has no setPointerCapture
    // and dispatches `click` regardless; only a browser look can confirm that half.
    const onDismiss = vi.fn();
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}>
            <button>Ok</button>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    const close = screen.getByRole("button", { name: "Cerrar diálogo" });
    fireEvent.pointerDown(close, { pointerId: 1, clientY: 100, isPrimary: true });
    fireEvent.pointerMove(close, { pointerId: 1, clientY: 400, isPrimary: true });
    fireEvent.pointerUp(close, { pointerId: 1, clientY: 400, isPrimary: true });
    expect(onDismiss).not.toHaveBeenCalledWith("drag");
    fireEvent.click(close);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith("escape");
  });

  it("hides the × on a phone sheet for sighted users but keeps it for the accessibility tree", () => {
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open mode="sheet" title="Detalle" onDismiss={() => {}}>
            <button>Ok</button>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    const close = screen.getByRole("button", { name: "Cerrar diálogo" });
    // Token match, not a regex: `\bsr-only\b` also matches inside `not-sr-only`.
    const tokens = close.className.split(/\s+/);
    expect(tokens).toContain("sr-only");
    expect(tokens).toContain("focus-visible:not-sr-only");
    expect(tokens).toContain("focus-visible:h-9");
    expect(tokens).toContain("focus-visible:w-9");
  });

  it("keeps the × visible on a modal, where nothing can be dragged", () => {
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open mode="modal" title="Detalle" onDismiss={() => {}}>
            <button>Ok</button>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    const close = screen.getByRole("button", { name: "Cerrar diálogo" });
    expect(close.className).not.toMatch(/sr-only/);
  });

  it("springs a sheet back when the drag is short and slow", () => {
    const onDismiss = vi.fn();
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}>
            <button>Ok</button>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    // "Slow" is a claim about ELAPSED TIME, and a jsdom gesture takes none: 20 px
    // between two synchronous events reads as 20 px/ms, forty times the flick
    // threshold, and would dismiss for the right reason on a wrong clock. Driving
    // `performance.now` — the only clock the handlers read — is what makes this a
    // 20 px drag over 400 ms (0.05 px/ms) instead of an instantaneous one.
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = document.querySelector<HTMLElement>("[data-cue-handle]")!;
      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
      clock = 400;
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 120, isPrimary: true });
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 120 });
    } finally {
      now.mockRestore();
    }
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("springs the sheet back when the consumer REFUSES the dismissal", async () => {
    // `DayCard` and `ServicesPanel` both ignore a dismissal while a save is in
    // flight, so "onDismiss was called" is not "the sheet went away". Without the
    // spring on this branch the sheet stays where the finger left it, for good.
    const onDismiss = vi.fn(); // a refusing consumer: called, does nothing
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}>
            <button>Ok</button>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    // Let the enter animation settle first: while it is in flight it owns `y` and
    // overwrites the drag on the next frame, which would make the mid-drag
    // assertion below read `none` and the whole test vacuous.
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    const shell = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const handle = document.querySelector<HTMLElement>("[data-cue-handle]")!;

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300, isPrimary: true });
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(shell.style.transform).toBe("translateY(200px)");

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 300, isPrimary: true });
    expect(onDismiss).toHaveBeenCalledWith("drag");
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(shell.style.transform).toBe("none");
  });

  it("does not dismiss a sheet when the gesture is CANCELLED past the threshold", async () => {
    // The OS took the pointer (a system edge swipe, an incoming call). Distance is
    // irrelevant: a cancel is not a release.
    const onDismiss = vi.fn();
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}>
            <button>Ok</button>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    const shell = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const handle = document.querySelector<HTMLElement>("[data-cue-handle]")!;

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300, isPrimary: true });
    fireEvent.pointerCancel(handle, { pointerId: 1, clientY: 300, isPrimary: true });
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(shell.style.transform).toBe("none");
  });

  it("gives a sheet the card's motion on a ≥640px viewport, with no drag", () => {
    // `mode="sheet"` is a sheet only on a phone — the `sm:` classes make it the same
    // centred card a modal renders, and the handle is `sm:hidden`. The gesture has to
    // follow the layout or a laptop dismisses a card by an invisible grip.
    // `installMotionTestEnv` stubs `matchMedia` with `matches: false`, which is the
    // phone path every other sheet test above runs on; this one overrides it for the
    // width query only, so motion still reads `prefers-reduced-motion` as false.
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query === "(min-width: 640px)",
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    const onDismiss = vi.fn();
    try {
      render(
        <MotionProvider>
          <CueDialogProvider>
            <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}>
              <button>Ok</button>
            </CueDialog>
          </CueDialogProvider>
        </MotionProvider>,
      );
      // No drag at this width, so the × must stay a visible control.
      const close = screen.getByRole("button", { name: "Cerrar diálogo" });
      expect(close.className.split(/\s+/)).not.toContain("sr-only");
      const handle = document.querySelector<HTMLElement>("[data-cue-handle]")!;
      // A drag that would dismiss twice over on a phone (300 px, instantly).
      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 400, isPrimary: true });
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 400, isPrimary: true });
    } finally {
      Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: original });
    }
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses a sheet on a short but fast flick", () => {
    const onDismiss = vi.fn();
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}>
            <button>Ok</button>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    // The other half of the OR: 20 px is far under the 150 px threshold, but 20 px
    // in 10 ms is 2 px/ms and the sheet goes.
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = document.querySelector<HTMLElement>("[data-cue-handle]")!;
      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
      clock = 10;
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 120, isPrimary: true });
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 120 });
    } finally {
      now.mockRestore();
    }
    expect(onDismiss).toHaveBeenCalledWith("drag");
  });

  it("lets a Menu inside the dialog own Escape: first closes the menu, second the dialog", () => {
    const onDismiss = vi.fn();
    render(
      <MotionProvider>
        <CueDialogProvider>
          <CueDialog open title="Detalle" onDismiss={onDismiss}>
            <Menu label="Más" trigger={<button type="button">Más acciones</button>}>
              <MenuItem onSelect={() => {}}>Uno</MenuItem>
            </Menu>
          </CueDialog>
        </CueDialogProvider>
      </MotionProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Más acciones" });
    fireEvent.click(trigger);
    const item = screen.getByRole("menuitem", { name: "Uno" });
    fireEvent.keyDown(item, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(document.activeElement ?? trigger, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledWith("escape");
  });

  it("decides sheet-or-card when it opens and keeps it while open", () => {
    // Opens as a phone sheet (matchMedia false), then the viewport crosses 640px:
    // the handle keeps its drag until the dialog closes.
    const onDismiss = vi.fn();
    const { rerender } = render(
      <MotionProvider><CueDialogProvider>
        <CueDialog open mode="sheet" title="Detalle" onDismiss={onDismiss}><button>Ok</button></CueDialog>
      </CueDialogProvider></MotionProvider>,
    );
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      writable: true, configurable: true,
      value: (query: string) => ({ matches: query === "(min-width: 640px)", media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
    });
    try {
      rerender(
        <MotionProvider><CueDialogProvider>
          <CueDialog open mode="sheet" title="Detalle (re-render)" onDismiss={onDismiss}><button>Ok</button></CueDialog>
        </CueDialogProvider></MotionProvider>,
      );
      const handle = document.querySelector<HTMLElement>("[data-cue-handle]")!;
      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100, isPrimary: true });
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 400, isPrimary: true });
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 400, isPrimary: true });
    } finally {
      Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: original });
    }
    expect(onDismiss).toHaveBeenCalledWith("drag");
  });
});
