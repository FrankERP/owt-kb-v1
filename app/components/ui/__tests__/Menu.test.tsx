/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import Button from "../Button";
import Menu, { MenuItem, MenuSeparator } from "../Menu";

installMotionTestEnv();
afterEach(cleanup);

function Harness({ onSelect = vi.fn() }: { onSelect?: (v: string) => void }) {
  return (
    <MotionProvider>
      <Menu label="Más acciones" trigger={<Button aria-label="Más acciones">⋮</Button>} align="end">
        <MenuItem onSelect={() => onSelect("copiar")}>Copiar</MenuItem>
        <MenuItem onSelect={() => onSelect("publicar")}>Publicar</MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={() => onSelect("eliminar")}>Eliminar</MenuItem>
      </Menu>
    </MotionProvider>
  );
}

describe("Menu", () => {
  it("is closed by default with the trigger wired for a menu", () => {
    render(<Harness />);
    const t = screen.getByRole("button", { name: "Más acciones" });
    expect(t.getAttribute("aria-haspopup")).toBe("menu");
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on click, lists items, selects and closes", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    // Flush MotionProvider's async feature chunk (ADR-0031) before the exit under
    // test starts, same as CueDialog's motion suite — otherwise the LazyMotion
    // upgrade can land mid-exit and the panel's exit promise never resolves.
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    const menu = screen.getByRole("menu", { name: "Más acciones" });
    expect(menu.getAttribute("id")).toBe(screen.getByRole("button", { name: "Más acciones" }).getAttribute("aria-controls"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Publicar" }));
    expect(onSelect).toHaveBeenCalledWith("publicar");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("ArrowDown on the trigger opens and focuses the first item; arrows wrap; Escape closes and refocuses", async () => {
    render(<Harness />);
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Más acciones" });
    t.focus();
    fireEvent.keyDown(t, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copiar" })));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Eliminar" }));
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    document.removeEventListener("keydown", outer);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(t);
  });

  it("closes on an outside pointerdown", async () => {
    render(<div><Harness /><button>fuera</button></div>);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    fireEvent.pointerDown(screen.getByText("fuera"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("a danger item carries the negative tone class", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    expect(screen.getByRole("menuitem", { name: "Eliminar" }).className).toContain("text-negative-fg");
  });
});
