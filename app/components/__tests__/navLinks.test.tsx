/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";

installMotionTestEnv();

let pathname = "/";
let session: { user: Record<string, unknown> } | null = null;
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: session, status: session ? "authenticated" : "unauthenticated" }),
}));

import NavLinks from "../NavLinks";

function mount() {
  return render(
    <MotionProvider>
      <NavLinks />
    </MotionProvider>,
  );
}

const adminUser = { name: "Ana", email: "ana@x", role: "admin", ministries: ["worship"] };
const kidsUser = { name: "Kiko", email: "kiko@x", role: "member", ministries: ["kids"] };
const kidsManagerUser = { name: "Marta", email: "marta@x", role: "member", ministries: ["kids"], managesMinistries: ["kids"] };

beforeEach(() => { pathname = "/"; session = null; });
afterEach(() => { cleanup(); });

describe("NavLinks", () => {
  it("renders the worship links for an admin at /schedule with aria-current on Calendario", () => {
    pathname = "/schedule";
    session = { user: adminUser };
    mount();
    const nav = screen.getByLabelText("Secciones");
    const links = Array.from(nav.querySelectorAll("a")).map((n) => n.textContent?.trim());
    expect(links).toEqual(["Calendario", "Biblioteca", "Admin"]);
    expect(screen.getByRole("link", { name: "Calendario" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Biblioteca" }).getAttribute("href")).toBe("/biblioteca");
    expect(nav.querySelectorAll("[data-sliding-indicator]")).toHaveLength(1);
  });

  it("shows Calendario and Biblioteca to every worship member, on every page", () => {
    // R5 ruling 9: the `schedule`/`tags` props are gone. They were passed
    // inconsistently — the row changed shape between pages, and dropped both
    // links entirely on /kids — for a pair of links whose real gate is
    // ministry membership, which `inWorship` already carries.
    pathname = "/kids";
    session = { user: { name: "Bea", email: "bea@x", role: "member", ministries: ["worship"] } };
    mount();
    const nav = screen.getByLabelText("Secciones");
    const links = Array.from(nav.querySelectorAll("a")).map((n) => n.textContent?.trim());
    expect(links).toEqual(["Calendario", "Biblioteca"]);
  });

  it("renders nothing signed out", () => {
    session = null;
    mount();
    expect(screen.queryByLabelText("Secciones")).toBeNull();
  });

  it("hides Calendario/Biblioteca for a kids-only member and shows Kids", () => {
    session = { user: kidsUser };
    mount();
    const nav = screen.getByLabelText("Secciones");
    const links = Array.from(nav.querySelectorAll("a")).map((n) => n.textContent?.trim());
    expect(links).toEqual(["Kids"]);
  });

  it("shows Planear Kids for a kids manager but not for a plain kids member", () => {
    session = { user: kidsManagerUser };
    mount();
    const nav = screen.getByLabelText("Secciones");
    const links = Array.from(nav.querySelectorAll("a")).map((n) => n.textContent?.trim());
    expect(links).toEqual(["Kids", "Planear Kids"]);

    cleanup();
    session = { user: kidsUser };
    mount();
    const nav2 = screen.getByLabelText("Secciones");
    const links2 = Array.from(nav2.querySelectorAll("a")).map((n) => n.textContent?.trim());
    expect(links2).not.toContain("Planear Kids");
  });
});
