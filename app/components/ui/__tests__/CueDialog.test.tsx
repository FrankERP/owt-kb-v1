/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPortal } from "react-dom";
import CueDialog, { useCueDialogFocusSatellite } from "../CueDialog";
import { CueDialogProvider } from "../CueDialogProvider";
import CueDialogStatus from "../CueDialogStatus";

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
  onDismiss?: (reason: "escape" | "backdrop") => void;
  onChildDismiss?: (reason: "escape" | "backdrop") => void;
}) {
  return (
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
