/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import Button from "../Button";
import Menu, { MenuItem, MenuSeparator } from "../Menu";

installMotionTestEnv();
afterEach(cleanup);

// Warm the LazyMotion feature chunk (ADR-0031) once for the whole file, so every
// case — not just the ones that remember an `await act(async () => {})` — runs
// against a resolved `m.*` exit protocol. Without this the mitigation below is
// order-dependent: whichever test happens to run first pays the import cost.
beforeAll(async () => { await import("../motionFeatures"); });

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

function ExtendedHarness({ onSelect = vi.fn(), onOpenChange }: { onSelect?: (v: string) => void; onOpenChange?: (open: boolean) => void }) {
  return (
    <MotionProvider>
      <Menu label="Más acciones" trigger={<Button aria-label="Más acciones">⋮</Button>} align="end" onOpenChange={onOpenChange}>
        <MenuItem onSelect={() => onSelect("copiar")}>Copiar</MenuItem>
        <MenuItem disabled onSelect={() => onSelect("bloqueado")}>Bloqueado</MenuItem>
        <MenuItem href="/ajustes" onSelect={() => onSelect("ajustes")}>Ajustes</MenuItem>
        <MenuItem href="/archivo" disabled onSelect={() => onSelect("archivo")}>Archivo</MenuItem>
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
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener("keydown", outer);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(t);
  });

  it("ArrowDown on the trigger of a click-opened menu focuses the first item (the [open] effect does not re-run on an already-open menu)", async () => {
    render(<Harness />);
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Más acciones" });
    fireEvent.click(t);
    screen.getByRole("menu");
    fireEvent.keyDown(t, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copiar" }));
  });

  it("ArrowUp on the trigger of a click-opened menu focuses the last item", async () => {
    render(<Harness />);
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Más acciones" });
    fireEvent.click(t);
    screen.getByRole("menu");
    fireEvent.keyDown(t, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Eliminar" }));
  });

  it("Tab on the trigger of a click-opened menu closes it (no dead-open panel left behind)", async () => {
    render(<Harness />);
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Más acciones" });
    fireEvent.click(t);
    screen.getByRole("menu");
    fireEvent.keyDown(t, { key: "Tab" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("ArrowUp inside the panel when focus is outside the roving list (the panel itself) lands on the last item", async () => {
    render(<Harness />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    const menu = screen.getByRole("menu");
    menu.focus();
    expect(document.activeElement).toBe(menu);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Eliminar" }));
  });

  it("Home/End move focus to the first/last item", async () => {
    render(<Harness />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Eliminar" }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copiar" }));
  });

  it("Tab closes the menu", async () => {
    render(<Harness />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("calls onOpenChange with true then false exactly once each across open→close", async () => {
    const onOpenChange = vi.fn();
    render(<ExtendedHarness onOpenChange={onOpenChange} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(onOpenChange).toHaveBeenNthCalledWith(1, true);
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("selecting an item refocuses the trigger", async () => {
    render(<Harness />);
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Más acciones" });
    fireEvent.click(t);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copiar" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(t);
  });

  it("an href item renders a menuitem link and closes on click", async () => {
    render(<ExtendedHarness />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    const link = screen.getByRole("menuitem", { name: "Ajustes" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/ajustes");
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("a disabled item is skipped by ArrowDown, and a disabled href item renders no link", async () => {
    render(<ExtendedHarness />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    expect(screen.getByRole("menuitem", { name: "Archivo" }).tagName).toBe("BUTTON");
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copiar" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Ajustes" }));
  });

  it("closes on an outside pointerdown", async () => {
    render(<div><Harness /><button>fuera</button></div>);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    fireEvent.pointerDown(screen.getByText("fuera"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("merges the trigger's own ref: the caller's ref still receives the DOM node", () => {
    const ownRef = { current: null as HTMLButtonElement | null };
    render(
      <MotionProvider>
        <Menu label="Más acciones" trigger={<Button ref={ownRef} aria-label="Más acciones">⋮</Button>} align="end">
          <MenuItem onSelect={() => {}}>Copiar</MenuItem>
        </Menu>
      </MotionProvider>,
    );
    const t = screen.getByRole("button", { name: "Más acciones" });
    expect(ownRef.current).toBe(t);
  });

  it("a danger item carries the negative tone class", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    expect(screen.getByRole("menuitem", { name: "Eliminar" }).className).toContain("text-negative-fg");
  });
});

describe("Menu — portalled panel (R5 Task 7 fix round 1)", () => {
  /** Give the trigger a real box; jsdom measures everything as zero. */
  function stubRect(el: HTMLElement) {
    el.getBoundingClientRect = () =>
      ({ top: 100, bottom: 130, left: 200, right: 300, width: 100, height: 30, x: 200, y: 100, toJSON: () => ({}) }) as DOMRect;
  }

  it("renders the open panel as a child of document.body, not inside the trigger's wrapper", async () => {
    render(<Harness />);
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Más acciones" });
    fireEvent.click(t);
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(t.parentElement?.contains(menu)).toBe(false);
    // The id wiring survives the portal, so `aria-controls` still resolves.
    expect(document.getElementById(t.getAttribute("aria-controls")!)).toBe(menu);
  });

  it("positions the panel from the trigger's rect, below it, as a fixed box", async () => {
    render(<Harness />);
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Más acciones" });
    stubRect(t);
    fireEvent.click(t);
    const menu = screen.getByRole("menu") as HTMLElement;
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.top).toBe("138px");
    // align="end" pins the right edge to the trigger's.
    expect(menu.style.right).toBe(`${window.innerWidth - 300}px`);
    expect(menu.style.minWidth).toBe("100px");
  });

  it("Tab from a menuitem closes AND returns focus to the trigger (the portalled panel is the last child of body)", async () => {
    render(<Harness />);
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Más acciones" });
    fireEvent.click(t);
    const item = screen.getByRole("menuitem", { name: "Copiar" });
    item.focus();
    fireEvent.keyDown(item, { key: "Tab" });
    expect(document.activeElement).toBe(t);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("sizes the panel to the room it actually has, so it cannot hang off the viewport bottom", async () => {
    render(<Harness />);
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Más acciones" });
    // 260px of room below: more than the 240 flip threshold, less than the 320 cap.
    const vh = document.documentElement.clientHeight || window.innerHeight;
    t.getBoundingClientRect = () =>
      ({ top: vh - 290, bottom: vh - 260, left: 200, right: 300, width: 100, height: 30, x: 200, y: vh - 290, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(t);
    const menu = screen.getByRole("menu") as HTMLElement;
    expect(menu.style.position).toBe("fixed");
    expect(Number.parseInt(menu.style.maxHeight, 10)).toBeLessThanOrEqual(260);
    // The panel's box never reaches past the bottom edge.
    expect(Number.parseInt(menu.style.top, 10) + Number.parseInt(menu.style.maxHeight, 10)).toBeLessThanOrEqual(vh);
  });

  it("flips above the trigger when there is no room below, and caps itself at the room above", async () => {
    render(<Harness />);
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Más acciones" });
    const vh = document.documentElement.clientHeight || window.innerHeight;
    t.getBoundingClientRect = () =>
      ({ top: vh - 40, bottom: vh - 10, left: 200, right: 300, width: 100, height: 30, x: 200, y: vh - 40, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(t);
    const menu = screen.getByRole("menu") as HTMLElement;
    expect(menu.style.top).toBe("");
    // The panel's bottom edge sits GAP above the trigger's top.
    expect(menu.style.bottom).toBe("48px");
    expect(menu.style.transformOrigin).toContain("bottom");
    // `flipped` is a positioning decision, never a CSS declaration.
    expect(menu.getAttribute("style")).not.toContain("flipped");
  });

  it("is opaque, blurred behind, and opted out of pull-to-refresh", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("bg-surface-raised ");
    expect(menu.className).toContain("backdrop-blur-sm");
    expect(menu.hasAttribute("data-pull-ignore")).toBe(true);
  });

  it("a pointerdown INSIDE the portalled panel does not close it (it is no longer a DOM descendant of the root)", async () => {
    render(<Harness />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Copiar" }));
    await act(async () => {});
    expect(screen.queryByRole("menu")).toBeTruthy();
  });

  it("closes when an ancestor scrolls, but not when the panel itself scrolls", async () => {
    render(<Harness />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    const menu = screen.getByRole("menu");
    fireEvent.scroll(menu);
    await act(async () => {});
    expect(screen.queryByRole("menu")).toBeTruthy();
    fireEvent.scroll(document);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("the panel scrolls long lists instead of clipping them", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    const cls = screen.getByRole("menu").className;
    expect(cls).toContain("overflow-y-auto");
    expect(cls).not.toContain("overflow-hidden");
  });

  it("takes a root className, and a selected item is marked and takes keyboard entry focus", async () => {
    render(
      <MotionProvider>
        <Menu label="Mes" align="start" className="block w-full" trigger={<Button aria-label="Mes">Mes</Button>}>
          <MenuItem onSelect={() => {}}>Enero</MenuItem>
          <MenuItem selected onSelect={() => {}}>Febrero</MenuItem>
        </Menu>
      </MotionProvider>,
    );
    await act(async () => {});
    const t = screen.getByRole("button", { name: "Mes" });
    expect(t.parentElement?.className).toBe("relative block w-full");
    fireEvent.keyDown(t, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Febrero" })));
    expect(screen.getByRole("menuitem", { name: "Febrero" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Enero" }).getAttribute("aria-current")).toBeNull();
  });
});
