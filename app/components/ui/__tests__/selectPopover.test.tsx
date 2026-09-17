/** @vitest-environment jsdom */
// The desktop half of `ui/Select` (R5 ruling 8).
//
// jsdom has no `matchMedia`, and `installMotionTestEnv` — which every other
// primitive suite calls — stubs one that answers `matches: false` to everything.
// Both are the COARSE answer, so every existing suite keeps the native path with no
// change; this file is the only one that says otherwise, and it says it explicitly.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import Select from "../Select";

installMotionTestEnv();

const FINE = "(hover: hover) and (pointer: fine)";

/** Answer the fine-pointer query with `matches`; everything else stays false. */
function mockPointer(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === FINE ? matches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Warm the LazyMotion feature chunk (ADR-0031) once, as `Menu`'s own suite does.
beforeAll(async () => { await import("../motionFeatures"); });
afterEach(() => { cleanup(); mockPointer(false); });

const MESES = (
  <>
    <option value="1">Enero</option>
    <option value="2">Febrero</option>
    <option value="3">Marzo</option>
  </>
);

function Harness(props: React.ComponentProps<typeof Select>) {
  return (
    <MotionProvider>
      <Select {...props} />
    </MotionProvider>
  );
}

describe("Select — desktop popover", () => {
  describe("on a fine pointer", () => {
    beforeEach(async () => {
      mockPointer(true);
      await act(async () => {});
    });

    it("fronts the native select with a trigger that opens one menu item per option", async () => {
      render(<Harness id="mes" label="Mes" value="1" onChange={() => {}}>{MESES}</Harness>);
      await act(async () => {});
      const trigger = screen.getByRole("button");
      expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
      expect(trigger.textContent).toContain("Enero");
      expect(screen.queryByRole("menu")).toBeNull();

      fireEvent.click(trigger);
      expect(screen.getByRole("menu")).toBeTruthy();
      expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Enero", "Febrero", "Marzo"]);
    });

    it("fires onChange with the chosen value through a real event, and closes", async () => {
      const onChange = vi.fn((e: React.ChangeEvent<HTMLSelectElement>) => e.target.value);
      render(<Harness id="mes" label="Mes" value="1" onChange={onChange}>{MESES}</Harness>);
      await act(async () => {});
      fireEvent.click(screen.getByRole("button"));
      fireEvent.click(screen.getByRole("menuitem", { name: "Febrero" }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveReturnedWith("2");
      // A genuine event on the genuine element — not a hand-built `{ target }` shape.
      expect(onChange.mock.calls[0][0].target).toBe(screen.getByLabelText("Mes"));
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    });

    it("keeps the native select in the DOM, labelled, and the form value", async () => {
      render(<Harness id="mes" label="Mes" value="2" name="mes" onChange={() => {}}>{MESES}</Harness>);
      await act(async () => {});
      const native = screen.getByLabelText("Mes") as HTMLSelectElement;
      expect(native.tagName).toBe("SELECT");
      expect(native.value).toBe("2");
      expect(native.name).toBe("mes");
      expect(native.className).toContain("sr-only");
      expect(screen.getByRole("button").textContent).toContain("Febrero");
    });

    it("jumps focus to the next option starting with the typed letter, accent-insensitively", async () => {
      render(
        <Harness aria-label="Mes" value="1" onChange={() => {}}>
          <option value="1">Enero</option>
          <option value="2">Ábril</option>
          <option value="3">Agosto</option>
        </Harness>,
      );
      await act(async () => {});
      fireEvent.click(screen.getByRole("button"));
      const items = screen.getAllByRole("menuitem");
      items[0].focus();

      fireEvent.keyDown(items[0], { key: "a" });
      expect(document.activeElement).toBe(items[1]);
      fireEvent.keyDown(items[1], { key: "a" });
      expect(document.activeElement).toBe(items[2]);
    });

    it("names the trigger «campo: elección», so the bare label still finds only the native select", async () => {
      render(<Harness aria-label="Persona" value="1" onChange={() => {}}>{MESES}</Harness>);
      await act(async () => {});
      expect((screen.getByLabelText("Persona") as HTMLElement).tagName).toBe("SELECT");
      expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Persona: Enero");
    });

    it("honours popover={false} — the native path, untouched", async () => {
      render(<Harness id="mes" label="Mes" value="1" popover={false} onChange={() => {}}>{MESES}</Harness>);
      await act(async () => {});
      expect(screen.queryByRole("button")).toBeNull();
      expect((screen.getByLabelText("Mes") as HTMLSelectElement).className).not.toContain("sr-only");
    });
  });

  it("stays native on a coarse pointer", async () => {
    mockPointer(false);
    render(<Harness id="mes" label="Mes" value="1" onChange={() => {}}>{MESES}</Harness>);
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    const native = screen.getByLabelText("Mes") as HTMLSelectElement;
    expect(native.tagName).toBe("SELECT");
    expect(native.className).not.toContain("sr-only");
  });

  it("stays native when the environment answers no media query at all (SSR, first render)", async () => {
    // @ts-expect-error — the un-stubbed jsdom shape every other suite renders in.
    delete window.matchMedia;
    render(<Harness id="mes" label="Mes" value="1" onChange={() => {}}>{MESES}</Harness>);
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();
    expect((screen.getByLabelText("Mes") as HTMLSelectElement).tagName).toBe("SELECT");
  });
});
