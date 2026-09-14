/** @vitest-environment jsdom */
// NavMenu is now an ACCOUNT menu, all widths (M1 follow-up F1): the destinations
// it used to repeat (Calendario, #Tags, Oasis Kids, Planear Kids, Admin) live in
// NavLinks/BottomNav now, and NavMenu keeps only Mi semana, Ajustes and Cerrar sesión.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";

installMotionTestEnv();

let session: { user: Record<string, unknown> } | null = null;
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: session, status: session ? "authenticated" : "unauthenticated" }),
  signOut: vi.fn(async () => {}),
}));

const { blackoutMock } = vi.hoisted(() => ({
  blackoutMock: vi.fn(() => ({ done: Promise.resolve(), cancel: vi.fn() })),
}));
vi.mock("@/app/components/ui/Blackout", () => ({ blackout: blackoutMock }));

import NavMenu from "../NavMenu";
import { signOut } from "next-auth/react";

const adminUser = { name: "Ana Admin", email: "ana@x", role: "admin", ministries: ["worship"], managesMinistries: [] };

function mount() {
  return render(
    <MotionProvider>
      <NavMenu />
    </MotionProvider>,
  );
}

beforeEach(() => {
  session = { user: adminUser };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ count: 0 }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("NavMenu — account menu", () => {
  it("once opened, shows Mi semana, Disponibilidad, Ajustes, Cerrar sesión and none of the retired destinations", async () => {
    mount();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /Menú de usuario/ }));
    const menu = screen.getByRole("menu", { name: "Menú de cuenta" });
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((n) => n.textContent?.trim());
    expect(items).toEqual(["Mi semana", "Disponibilidad", "Ajustes", "Cerrar sesión"]);
    // F3 fix (Frank's look, 2026-09-13): the menu is /me's only entry point, so
    // it must name all three halves — Mi semana at `/me`, Disponibilidad at
    // `/me/disponibilidad`, Ajustes at `/me/ajustes`.
    // Tema folded into Ajustes; it is no longer a menu item.
    expect(screen.getByRole("menuitem", { name: "Mi semana" }).getAttribute("href")).toBe("/me");
    expect(screen.getByRole("menuitem", { name: "Disponibilidad" }).getAttribute("href")).toBe("/me/disponibilidad");
    expect(screen.getByRole("menuitem", { name: "Ajustes" }).getAttribute("href")).toBe("/me/ajustes");
    expect(screen.queryByRole("menuitem", { name: "Tema" })).toBeNull();

    expect(screen.queryByRole("menuitem", { name: "Calendario" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "#Tags" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Admin" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Oasis Kids" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Planear Kids" })).toBeNull();
  });

  it("«Cerrar sesión» blacks out the page before it signs out", async () => {
    mount();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /Menú de usuario/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Cerrar sesión" }));
    });
    expect(blackoutMock).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    const blackoutOrder = blackoutMock.mock.invocationCallOrder[0];
    const signOutOrder = vi.mocked(signOut).mock.invocationCallOrder[0];
    expect(blackoutOrder).toBeLessThan(signOutOrder);
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/auth/signin" });
  });
});
