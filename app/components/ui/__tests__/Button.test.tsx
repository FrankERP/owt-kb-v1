/** @vitest-environment jsdom */
// app/components/ui/__tests__/Button.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Button, { buttonClass } from "../Button";

afterEach(cleanup);

describe("Button", () => {
  it("defaults to a secondary, medium, type=button control with a visible focus ring", () => {
    render(<Button>Guardar</Button>);
    const b = screen.getByRole("button", { name: "Guardar" });
    expect(b.getAttribute("type")).toBe("button");
    expect(b.className).toContain("focus-visible:ring-2");
    expect(b.className).toContain("border-surface-accent-30");
    expect(b.className).toContain("active:translate-y-px");
  });

  it.each([
    ["primary", "bg-surface-accent-solid"],
    ["ghost", "text-mono-500"],
    ["danger", "bg-negative-surface/60"],
    ["icon", "w-9 h-9"],
    ["pill", "rounded-full"],
  ] as const)("variant %s carries its signature class", (variant, cls) => {
    render(<Button variant={variant} aria-label="x">x</Button>);
    expect(screen.getByRole("button").className).toContain(cls);
  });

  it("primary carries the hover sheen class; no other variant does", () => {
    expect(buttonClass("primary", "md")).toContain("brand-btn-sheen");
    expect(buttonClass("secondary", "md")).not.toContain("brand-btn-sheen");
  });

  it("size lg is the 44 px touch target", () => {
    render(<Button size="lg">Publicar</Button>);
    expect(screen.getByRole("button").className).toContain("min-h-[44px]");
  });

  it("busy sets aria-busy, swaps the label, and disables the control", () => {
    render(<Button busy busyLabel="Guardando…">Guardar</Button>);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b).toHaveProperty("disabled", true);
    expect(b.textContent).toContain("Guardando…");
  });

  it("href renders a link with the same classes", () => {
    render(<Button href="/" variant="primary">Ir al inicio</Button>);
    const a = screen.getByRole("link", { name: "Ir al inicio" });
    expect(a.getAttribute("href")).toBe("/");
    expect(a.className).toContain("bg-surface-accent-solid");
  });

  it("pill exposes aria-pressed from `active`", () => {
    render(<Button variant="pill" active>Oscuro</Button>);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("forwards onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ok</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
