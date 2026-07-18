/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import CueDialog from "../CueDialog";
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
