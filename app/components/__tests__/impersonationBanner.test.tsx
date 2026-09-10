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
import { installMotionTestEnv } from "../ui/__tests__/motionTestSetup";
import { MotionProvider } from "../ui/MotionProvider";

installMotionTestEnv();

const h = vi.hoisted(() => ({
  isImpersonating: true,
  update: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { isImpersonating: h.isImpersonating, name: "Ana", sanityId: "m1", realAdminName: "Frank" } },
    update: h.update,
  })),
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

// `Presence` (motion/react-m) needs `MotionProvider`'s feature chunk to ever
// resolve an animation — bare outside it, an `m.*` element sticks at its
// `initial` values forever, so `onEntered` never fires (see MotionProvider.tsx).
const renderBanner = () => render(<ImpersonationBanner />, { wrapper: MotionProvider });

describe("ImpersonationBanner", () => {
  it("marks the root while impersonating, so the navbar stacks below it", () => {
    renderBanner();
    expect(document.documentElement.classList.contains("impersonating")).toBe(true);
  });

  it("clears that mark when the banner goes away", () => {
    const { unmount } = renderBanner();
    unmount();
    expect(document.documentElement.classList.contains("impersonating")).toBe(false);
  });

  it("publishes the measured height once the drop-in lands, not before — impersonation started in this session", async () => {
    h.isImpersonating = false;
    const { rerender } = renderBanner();
    expect(document.documentElement.classList.contains("impersonating")).toBe(false);

    h.isImpersonating = true;
    rerender(<ImpersonationBanner />);
    const bar = document.querySelector(".impersonation-bar") as HTMLElement;
    Object.defineProperty(bar, "offsetHeight", { configurable: true, value: 56 });
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--impersonation-h")).toMatch(/px$/)
    );
    expect(document.documentElement.style.getPropertyValue("--impersonation-h")).toBe("56px");
  });

  // The mount that already IS active — an admin hard-refreshing while
  // impersonating. Without `appear` there is no enter animation, so the bar
  // must be visible and measured synchronously, feature chunk or not (the
  // finding this fix addresses: with `appear` unconditional, this mount sat
  // at the drop variant's `initial` — opacity: 0 — until the async motion
  // chunk resolved, or forever if it never did).
  it("renders at rest and measures synchronously when the mount is already active", () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 56 });
    try {
      renderBanner();
      expect(document.documentElement.style.getPropertyValue("--impersonation-h")).toBe("56px");
      const host = document.querySelector(".impersonation-bar")?.parentElement as HTMLElement;
      expect(["", "1"]).toContain(host.style.opacity);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
      else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
  });

  it("returns to /admin when the session really did stop impersonating", async () => {
    h.update.mockResolvedValue({ user: { isImpersonating: false } });
    renderBanner();
    fireEvent.click(salir());
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/admin"));
  });

  it("stays put and says so when the session comes back still impersonating", async () => {
    h.update.mockResolvedValue({ user: { isImpersonating: true } });
    renderBanner();
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
    renderBanner();
    fireEvent.click(salir());

    await screen.findByText(/no se pudo salir/i);
    expect(h.push).not.toHaveBeenCalled();
    expect(salir().hasAttribute("disabled")).toBe(false);
  });

  it("stays put when the update rejects outright", async () => {
    h.update.mockRejectedValue(new Error("network"));
    renderBanner();
    fireEvent.click(salir());

    await screen.findByText(/no se pudo salir/i);
    expect(h.push).not.toHaveBeenCalled();
    expect(salir().hasAttribute("disabled")).toBe(false);
  });

  it("renders nothing at all when no one is being impersonated", () => {
    h.isImpersonating = false;
    renderBanner();
    expect(screen.queryByRole("button", { name: /salir/i })).toBeNull();
    expect(document.documentElement.classList.contains("impersonating")).toBe(false);
  });
});
