/** @vitest-environment jsdom */
// NavMenu is now an ACCOUNT menu, all widths (M1 follow-up F1): the destinations
// it used to repeat (Calendario, #Tags, Oasis Kids, Planear Kids, Admin) live in
// NavLinks/BottomNav now, and NavMenu keeps only Mi perfil, Tema and Cerrar sesión.
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

import NavMenu from "../NavMenu";

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
  it("once opened, shows Mi perfil, Tema, Cerrar sesión and none of the retired destinations", async () => {
    mount();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /Menú de usuario/ }));
    const menu = screen.getByRole("menu", { name: "Menú de cuenta" });
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((n) => n.textContent?.trim());
    expect(items).toEqual(["Mi perfil", "Tema", "Cerrar sesión"]);
    // F3: both point at the settings PAGE — «Mi perfil» is the profile editor,
    // which left `/me` with Tema and Tamaño de texto.
    expect(screen.getByRole("menuitem", { name: "Mi perfil" }).getAttribute("href")).toBe("/me/ajustes");
    expect(screen.getByRole("menuitem", { name: "Tema" }).getAttribute("href")).toBe("/me/ajustes#tema");

    expect(screen.queryByRole("menuitem", { name: "Calendario" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "#Tags" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Admin" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Oasis Kids" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Planear Kids" })).toBeNull();
  });
});
