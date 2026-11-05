// The super-admin page (ADR-0075, Frank 2026-10-29): «Personas» — every member
// of every ministry — lives OUTSIDE worship's /admin. The page is the screen's
// gate (the member routes check the same role themselves); /admin sends an old
// `?tab=members` link there.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as { user: { sanityId: string; role: string } } | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));
vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: async () => h.session,
  requireActiveManager: async () =>
    h.session && ["super-admin", "admin", "content-editor"].includes(h.session.user.role) ? h.session : null,
}));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/admin/SuperAdminPanel", () => ({ default: () => null }));
vi.mock("@/app/components/admin/AdminPanel", () => ({ default: () => null }));
vi.mock("@/app/utils/solverDeployment", () => ({ resolveSolverEngine: () => "v3" }));

import SuperAdminPage from "@/app/(client)/super-admin/page";
import AdminPage from "@/app/(client)/admin/page";

const as = (role: string) => { h.session = { user: { sanityId: "m1", role } }; };

beforeEach(() => { h.session = null; });

describe("/super-admin", () => {
  it("sends a visitor with no active session to sign in, back to this page", async () => {
    await expect(SuperAdminPage()).rejects.toThrow("REDIRECT /auth/signin?callbackUrl=%2Fsuper-admin");
  });

  it("is closed to every role but super-admin (and so to a super-admin impersonating)", async () => {
    for (const role of ["admin", "content-editor", "member"]) {
      as(role);
      await expect(SuperAdminPage(), role).rejects.toThrow("REDIRECT /");
    }
  });

  it("opens for the super-admin", async () => {
    as("super-admin");
    await expect(SuperAdminPage()).resolves.toBeTruthy();
  });
});

describe("/admin no longer hosts Miembros", () => {
  const open = (tab?: string) => AdminPage({ searchParams: Promise.resolve(tab ? { tab } : {}) });

  it("sends the super-admin's old `?tab=members` link to the super-admin page", async () => {
    as("super-admin");
    await expect(open("members")).rejects.toThrow("REDIRECT /super-admin");
  });

  it("an admin's `?tab=members` just falls back to their first tab", async () => {
    as("admin");
    await expect(open("members")).resolves.toBeTruthy();
  });
});
