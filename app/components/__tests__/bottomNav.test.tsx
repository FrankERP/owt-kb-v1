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
  signOut: vi.fn(async () => {}),
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

  it("shows Inicio · Calendario · Biblioteca · Yo · Más for a worship member, with aria-current on the route", () => {
    pathname = "/schedule";
    mount();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    const names = Array.from(nav.querySelectorAll("a, button")).map((n) => n.textContent?.trim());
    expect(names).toEqual(["Inicio", "Calendario", "Biblioteca", "Yo", "Más"]);
    expect(screen.getByRole("link", { name: "Calendario" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Biblioteca" }).getAttribute("href")).toBe("/tag");
    expect(nav.querySelectorAll("[data-sliding-indicator]")).toHaveLength(1);
  });

  it("shows Kids · Planear Kids · Yo · Más for a kids manager with no worship ministry", () => {
    session = { user: { ...worshipUser, ministries: ["kids"], managesMinistries: ["kids"] } };
    mount();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(Array.from(nav.querySelectorAll("a, button")).map((n) => n.textContent?.trim())).toEqual(["Kids", "Planear Kids", "Yo", "Más"]);
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

  it("opens Más as a sheet dialog with Tema and Cerrar sesión, and Admin only for managers", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    const dialog = screen.getByRole("dialog", { name: "Más" });
    expect(dialog.querySelector('a[href="/me#tema"]')?.textContent).toContain("Tema");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    cleanup();
    session = { user: { ...worshipUser, role: "admin" } };
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    expect(screen.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe("/admin");
  });
});
