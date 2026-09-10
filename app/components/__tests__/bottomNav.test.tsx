/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";

installMotionTestEnv();

let pathname = "/";
let session: { user: Record<string, unknown> } | null = null;
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: session, status: session ? "authenticated" : "unauthenticated" }),
}));
vi.mock("@/app/utils/haptics", () => ({ haptic: vi.fn(async () => {}) }));

import BottomNav, { NAV_CLASS, NAV_H_VAR } from "../BottomNav";

function mount() {
  return render(
    <MotionProvider>
      <CueDialogProvider>
        <BottomNav />
      </CueDialogProvider>
    </MotionProvider>,
  );
}
const worshipUser = { name: "Ana", email: "ana@x", role: "member", ministries: ["worship"], managesMinistries: [] };

beforeEach(() => { pathname = "/"; session = { user: worshipUser }; });
afterEach(() => { cleanup(); document.documentElement.classList.remove(NAV_CLASS); document.documentElement.style.removeProperty(NAV_H_VAR); });

describe("BottomNav", () => {
  it("renders nothing signed out, on /auth and on /studio", () => {
    session = null; mount(); expect(screen.queryByRole("navigation", { name: "Navegación principal" })).toBeNull();
    cleanup(); session = { user: worshipUser }; pathname = "/auth/signin"; mount();
    expect(screen.queryByRole("navigation", { name: "Navegación principal" })).toBeNull();
  });

  // (a) a plain worship member: the three tabs cannot fit nothing that isn't
  // already a tab (no kids ministry, no admin role), so «Más» does not render
  // and the sheet never opens.
  it("shows Inicio · Calendario · Biblioteca for a plain worship member, with aria-current on the route and NO «Más» button", () => {
    pathname = "/schedule";
    mount();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    const names = Array.from(nav.querySelectorAll("a, button")).map((n) => n.textContent?.trim());
    expect(names).toEqual(["Inicio", "Calendario", "Biblioteca"]);
    expect(screen.getByRole("link", { name: "Calendario" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Biblioteca" }).getAttribute("href")).toBe("/tag");
    expect(nav.querySelectorAll("[data-sliding-indicator]")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Más" })).toBeNull();
  });

  it("shows Kids · Planear Kids for a kids manager with no worship ministry, and NO «Más» button", () => {
    session = { user: { ...worshipUser, ministries: ["kids"], managesMinistries: ["kids"] } };
    mount();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(Array.from(nav.querySelectorAll("a, button")).map((n) => n.textContent?.trim())).toEqual(["Kids", "Planear Kids"]);
    expect(screen.queryByRole("button", { name: "Más" })).toBeNull();
  });

  // A kids-only plain member has one tab (Kids) and no «Más» row — fewer than
  // two items is not a bar, so it renders nothing at all and publishes no
  // --bottom-nav-h / has-bottom-nav. Their avatar menu still carries Mi perfil.
  it("renders nothing for a kids-only plain member and publishes no bottom-nav variable or class", () => {
    session = { user: { ...worshipUser, ministries: ["kids"], managesMinistries: [] } };
    mount();
    expect(screen.queryByRole("navigation", { name: "Navegación principal" })).toBeNull();
    expect(document.documentElement.style.getPropertyValue(NAV_H_VAR)).toBe("");
    expect(document.documentElement.classList.contains(NAV_CLASS)).toBe(false);
  });

  it("never shows a Yo item in either tabs or the «Más» sheet", () => {
    session = { user: { ...worshipUser, role: "super-admin" } };
    mount();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(Array.from(nav.querySelectorAll("a, button")).map((n) => n.textContent?.trim())).not.toContain("Yo");
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    const dialog = screen.getByRole("dialog", { name: "Más" });
    expect(dialog.textContent).not.toMatch(/Yo/);
  });

  it("publishes its measured height on <html> while mounted and clears it on unmount", () => {
    const { unmount } = mount();
    const bar = screen.getByRole("navigation", { name: "Navegación principal" });
    Object.defineProperty(bar, "offsetHeight", { configurable: true, value: 64 });
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(document.documentElement.style.getPropertyValue(NAV_H_VAR)).toBe("64px");
    expect(document.documentElement.classList.contains(NAV_CLASS)).toBe(true);
    unmount();
    expect(document.documentElement.style.getPropertyValue(NAV_H_VAR)).toBe("");
    expect(document.documentElement.classList.contains(NAV_CLASS)).toBe(false);
  });

  // (b) an admin: no kids ministry, so the sheet holds Admin only.
  it("shows «Más» for an admin and the sheet lists Admin only", () => {
    session = { user: { ...worshipUser, role: "admin" } };
    mount();
    const button = screen.getByRole("button", { name: "Más" });
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Más" });
    expect(Array.from(dialog.querySelectorAll("a")).map((a) => a.textContent?.trim())).toEqual(["Admin"]);
    expect(screen.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe("/admin");
  });

  // (c) a super-admin spans both ministries and is a manager everywhere, so
  // the sheet lists all three rows, in tab-bar-then-admin order.
  it("shows «Más» for a super-admin and the sheet lists Kids, Planear Kids, Admin", () => {
    session = { user: { ...worshipUser, role: "super-admin" } };
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    const dialog = screen.getByRole("dialog", { name: "Más" });
    expect(Array.from(dialog.querySelectorAll("a")).map((a) => a.textContent?.trim())).toEqual(["Kids", "Planear Kids", "Admin"]);
  });

  // (d) Tema and Cerrar sesión moved to the avatar menu (NavMenu) — the sheet
  // never repeats them.
  it("never shows a Tema or Cerrar sesión row in the «Más» sheet", () => {
    session = { user: { ...worshipUser, role: "super-admin" } };
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    const dialog = screen.getByRole("dialog", { name: "Más" });
    expect(dialog.textContent).not.toMatch(/Tema/);
    expect(dialog.textContent).not.toMatch(/Cerrar sesión/);
  });
});
