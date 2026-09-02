/** @vitest-environment jsdom */
//
// Leaving an impersonated session, and what happens when leaving fails.
//
// The bug: `stopImpersonating` awaited `update()`, never looked at what came
// back, and let any rejection escape. A refused stop therefore navigated to
// /admin anyway — the admin arrived on the admin page still wearing a member's
// identity, with the banner as the only hint that the button had done nothing.
// The repo's rule for every client mutation handler is the opposite: check the
// result, keep the surface open on failure, say so.
//
// Also pins the root class the navbar's sticky offset depends on. Both the
// banner and the navbar are `sticky top-0` in different containers, so without
// it the banner sat on top of the navbar's upper third.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isImpersonating: true,
  update: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { isImpersonating: h.isImpersonating, name: "Ana", sanityId: "m1", realAdminName: "Frank" } },
    update: h.update,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh, replace: vi.fn() }),
}));

import ImpersonationBanner from "../ImpersonationBanner";

afterEach(() => {
  cleanup();
  h.isImpersonating = true;
  h.update.mockReset();
  h.push.mockReset();
  h.refresh.mockReset();
  document.documentElement.classList.remove("impersonating");
});

const salir = () => screen.getByRole("button", { name: /salir/i });

describe("ImpersonationBanner", () => {
  it("marks the root while impersonating, so the navbar stacks below it", () => {
    render(<ImpersonationBanner />);
    expect(document.documentElement.classList.contains("impersonating")).toBe(true);
  });

  it("clears that mark when the banner goes away", () => {
    const { unmount } = render(<ImpersonationBanner />);
    unmount();
    expect(document.documentElement.classList.contains("impersonating")).toBe(false);
  });

  it("returns to /admin when the session really did stop impersonating", async () => {
    h.update.mockResolvedValue({ user: { isImpersonating: false } });
    render(<ImpersonationBanner />);
    fireEvent.click(salir());
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/admin"));
  });

  it("stays put and says so when the session comes back still impersonating", async () => {
    h.update.mockResolvedValue({ user: { isImpersonating: true } });
    render(<ImpersonationBanner />);
    fireEvent.click(salir());

    await screen.findByText(/no se pudo salir/i);
    expect(h.push).not.toHaveBeenCalled();
    // Re-enabled: the admin's only way out must not be left spinning.
    expect(salir().hasAttribute("disabled")).toBe(false);
  });

  // The failure that actually happens. NextAuth v4's `fetchData` catches every
  // error — network, non-2xx, bad JSON — and returns `null`, and `update()`
  // returns `undefined` while the session is still loading. Neither rejects, so
  // a handler that only inspects `next.user.isImpersonating` navigates away on
  // every real-world failure, leaving the admin on /admin still impersonating.
  it("stays put when the update resolves null, which is how it really fails", async () => {
    h.update.mockResolvedValue(null);
    render(<ImpersonationBanner />);
    fireEvent.click(salir());

    await screen.findByText(/no se pudo salir/i);
    expect(h.push).not.toHaveBeenCalled();
    expect(salir().hasAttribute("disabled")).toBe(false);
  });

  it("stays put when the update rejects outright", async () => {
    h.update.mockRejectedValue(new Error("network"));
    render(<ImpersonationBanner />);
    fireEvent.click(salir());

    await screen.findByText(/no se pudo salir/i);
    expect(h.push).not.toHaveBeenCalled();
    expect(salir().hasAttribute("disabled")).toBe(false);
  });

  it("renders nothing at all when no one is being impersonated", () => {
    h.isImpersonating = false;
    render(<ImpersonationBanner />);
    expect(screen.queryByRole("button", { name: /salir/i })).toBeNull();
    expect(document.documentElement.classList.contains("impersonating")).toBe(false);
  });
});
