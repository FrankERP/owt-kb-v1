/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import { ToastProvider, useToast } from "../Toast";

installMotionTestEnv();
afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.useRealTimers(); });
beforeEach(() => vi.useFakeTimers());

function Trigger({ opts }: { opts: Parameters<ReturnType<typeof useToast>["toast"]>[0] }) {
  const { toast } = useToast();
  return <button onClick={() => toast(opts)}>go</button>;
}
const wrap = (ui: React.ReactNode) => render(<MotionProvider><ToastProvider>{ui}</ToastProvider></MotionProvider>);

describe("Toast", () => {
  it("shows a status toast and removes it after its duration", () => {
    // No `waitFor` here: with fake timers, its internal polling never fires (the
    // interval it schedules is itself faked), so it hangs rather than resolving
    // on its first, already-true check. `skipAnimations` makes the exit complete
    // in the same tick as the timer, so a direct assertion is enough.
    wrap(<Trigger opts={{ message: "Guardado" }} />);
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByRole("status").textContent).toContain("Guardado");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an error toast is an alert", () => {
    wrap(<Trigger opts={{ message: "Error al guardar", tone: "error" }} />);
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByRole("alert").textContent).toContain("Error al guardar");
  });

  it("hold keeps the toast until dismissed", () => {
    wrap(<Trigger opts={{ message: "Verifica", hold: true }} />);
    fireEvent.click(screen.getByText("go"));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(screen.getByRole("status").textContent).toContain("Verifica");
  });

  it("renders an action and runs it", () => {
    const onClick = vi.fn();
    wrap(<Trigger opts={{ message: "Cambios sin verificar", hold: true, action: { label: "Recargar", onClick } }} />);
    fireEvent.click(screen.getByText("go"));
    fireEvent.click(screen.getByRole("button", { name: "Recargar" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("portals outside the app root so it stays usable while a dialog inerts the page", () => {
    wrap(<Trigger opts={{ message: "Hola" }} />);
    fireEvent.click(screen.getByText("go"));
    const root = document.querySelector("[data-toast-root]");
    expect(root).not.toBeNull();
    expect(root!.querySelector("[role=status]")).not.toBeNull();
    expect(root!.closest("[data-cue-app-root]")).toBeNull();
  });

  it("caps the stack at three, dropping the oldest", () => {
    function FourTriggers() {
      const { toast } = useToast();
      return (
        <>
          <button onClick={() => toast({ message: "Uno", hold: true })}>one</button>
          <button onClick={() => toast({ message: "Dos", hold: true })}>two</button>
          <button onClick={() => toast({ message: "Tres", hold: true })}>three</button>
          <button onClick={() => toast({ message: "Cuatro", hold: true })}>four</button>
        </>
      );
    }
    wrap(<FourTriggers />);
    fireEvent.click(screen.getByText("one"));
    fireEvent.click(screen.getByText("two"));
    fireEvent.click(screen.getByText("three"));
    fireEvent.click(screen.getByText("four"));
    const visible = screen.getAllByRole("status");
    expect(visible).toHaveLength(3);
    expect(screen.queryByText("Uno")).toBeNull();
    expect(screen.getByText("Dos")).toBeTruthy();
    expect(screen.getByText("Tres")).toBeTruthy();
    expect(screen.getByText("Cuatro")).toBeTruthy();
  });
});
