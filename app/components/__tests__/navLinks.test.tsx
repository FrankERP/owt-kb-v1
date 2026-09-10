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

function mount(props: { schedule?: boolean; tags?: boolean } = {}) {
  return render(
    <MotionProvider>
      <NavLinks {...props} />
    </MotionProvider>,
  );
}

const adminUser = { name: "Ana", email: "ana@x", role: "admin", ministries: ["worship"] };
const kidsUser = { name: "Kiko", email: "kiko@x", role: "member", ministries: ["kids"] };

beforeEach(() => { pathname = "/"; session = null; });
afterEach(() => { cleanup(); });

describe("NavLinks", () => {
  it("renders the four worship links for an admin at /schedule with aria-current on Calendario", () => {
    pathname = "/schedule";
    session = { user: adminUser };
    mount({ schedule: true, tags: true });
    const nav = screen.getByLabelText("Secciones");
    const links = Array.from(nav.querySelectorAll("a")).map((n) => n.textContent?.trim());
    expect(links).toEqual(["Calendario", "Biblioteca", "Yo", "Admin"]);
    expect(screen.getByRole("link", { name: "Calendario" }).getAttribute("aria-current")).toBe("page");
    expect(nav.querySelectorAll("[data-sliding-indicator]")).toHaveLength(1);
  });

  it("renders nothing signed out", () => {
    session = null;
    mount({ schedule: true, tags: true });
    expect(screen.queryByLabelText("Secciones")).toBeNull();
  });

  it("hides Calendario/Biblioteca for a kids-only member and shows Kids", () => {
    session = { user: kidsUser };
    mount({ schedule: true, tags: true });
    const nav = screen.getByLabelText("Secciones");
    const links = Array.from(nav.querySelectorAll("a")).map((n) => n.textContent?.trim());
    expect(links).toEqual(["Kids", "Yo"]);
  });
});
