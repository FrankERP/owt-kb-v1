// @vitest-environment jsdom
//
// BEHAVIOURAL tests for ThemeBootstrap and ThemeControl.
//
// Every other guard in Children E and F matches SOURCE TEXT. Those are good at
// what they do — a dropped mount, a missed default copy, a missing sign-out clear
// all fail loudly — but they are structurally blind to control flow, and a code
// review found three real bugs living exactly there:
//
//   1. `setTheme` was an effect dependency. next-themes defines it as
//      useCallback(..., [theme]), so its identity changes on every theme change:
//      picking a theme cancelled the in-flight GET /api/me, and the one-shot
//      guard then refused to re-issue it.
//   2. A failed fetch set the guard and never released it, so one transient 500
//      left an explicit-Light member on the default for the whole session.
//   3. `setPref` did not set `loaded`, so a SUCCESSFUL save could leave every
//      button unselected.
//
// These tests exist so those three cannot come back quietly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  setTheme: vi.fn(),
  themeState: "system" as string,
  status: "authenticated" as string,
  isImpersonating: false,
  fetchThemePref: vi.fn(),
  clearThemeMirror: vi.fn(),
  hasThemeMirror: vi.fn(() => false),
}));

// next-themes' real setTheme identity CHANGES with the theme state. Reproduced
// here on purpose: a stable mock would hide the very bug this file guards.
vi.mock("next-themes", () => ({
  useTheme: () => ({
    setTheme: (t: string) => { h.themeState = t; h.setTheme(t); },
    resolvedTheme: h.themeState === "system" ? "dark" : h.themeState,
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: h.status,
    data: { user: { isImpersonating: h.isImpersonating } },
  }),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/me" }));

vi.mock("@/app/utils/themePref", async (orig) => {
  const actual = await orig<typeof import("../themePref")>();
  return {
    ...actual,
    fetchThemePref: () => h.fetchThemePref(),
    clearThemeMirror: () => h.clearThemeMirror(),
    hasThemeMirror: () => h.hasThemeMirror(),
  };
});

const { ThemeBootstrap, useThemePref } = await import("@/app/components/ThemeBootstrap");

function Probe() {
  const { pref, loaded } = useThemePref();
  return <span data-testid="probe">{`${loaded}:${pref ?? "unset"}`}</span>;
}

beforeEach(() => {
  h.setTheme.mockClear();
  h.fetchThemePref.mockReset();
  h.clearThemeMirror.mockClear();
  h.hasThemeMirror.mockReset().mockReturnValue(false);
  h.themeState = "system";
  h.status = "authenticated";
  h.isImpersonating = false;
});

// Vitest is not configured with globals, so RTL does not auto-clean between
// tests — without this, every render stacks in the same document.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ThemeBootstrap — applying a stored preference", () => {
  it("applies the literal themePref and reports loaded", async () => {
    h.fetchThemePref.mockResolvedValue({ ok: true, pref: "light" });
    render(<ThemeBootstrap><Probe /></ThemeBootstrap>);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("true:light"));
    expect(h.setTheme).toHaveBeenCalledWith("light");
  });

  it("does NOTHING for an unset member with no mirror", async () => {
    h.fetchThemePref.mockResolvedValue({ ok: true, pref: undefined });
    render(<ThemeBootstrap><Probe /></ThemeBootstrap>);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("true:unset"));
    expect(h.setTheme, "an unset member must never be overridden").not.toHaveBeenCalled();
    expect(h.clearThemeMirror).not.toHaveBeenCalled();
  });

  it("repairs unset-WITH-a-mirror as setTheme(default) THEN clear", async () => {
    h.fetchThemePref.mockResolvedValue({ ok: true, pref: undefined });
    h.hasThemeMirror.mockReturnValue(true);
    render(<ThemeBootstrap><Probe /></ThemeBootstrap>);
    await waitFor(() => expect(h.clearThemeMirror).toHaveBeenCalled());
    // The order is the property: setTheme makes next-themes' state truthful and
    // paints, the clear then removes the key it just wrote.
    expect(h.setTheme).toHaveBeenCalledWith("system");
    expect(h.setTheme.mock.invocationCallOrder[0])
      .toBeLessThan(h.clearThemeMirror.mock.invocationCallOrder[0]);
  });
});

describe("ThemeBootstrap — the session gates", () => {
  it("issues no read while the session is loading", async () => {
    h.status = "loading";
    h.fetchThemePref.mockResolvedValue({ ok: true, pref: "light" });
    render(<ThemeBootstrap><Probe /></ThemeBootstrap>);
    await act(async () => {});
    expect(
      h.fetchThemePref,
      "isImpersonating is unreadable while loading; a read here bypasses the isolation",
    ).not.toHaveBeenCalled();
  });

  it("issues no read while impersonating — that record is someone else's", async () => {
    h.isImpersonating = true;
    h.fetchThemePref.mockResolvedValue({ ok: true, pref: "light" });
    render(<ThemeBootstrap><Probe /></ThemeBootstrap>);
    await act(async () => {});
    expect(h.fetchThemePref).not.toHaveBeenCalled();
    expect(h.setTheme).not.toHaveBeenCalled();
  });
});

describe("ThemeBootstrap — a failed fetch", () => {
  it("clears nobody's mirror and applies nothing", async () => {
    h.fetchThemePref.mockResolvedValue({ ok: false, pref: undefined });
    h.hasThemeMirror.mockReturnValue(true);
    render(<ThemeBootstrap><Probe /></ThemeBootstrap>);
    await act(async () => {});
    expect(
      h.clearThemeMirror,
      "a network blip must not be read as 'this member has no preference'",
    ).not.toHaveBeenCalled();
    expect(h.setTheme).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe").textContent).toBe("false:unset");
  });

  it("is NOT terminal — the read is retried when a session gate changes", async () => {
    // Finding 2: `applied` was set before the request and never released, so one
    // transient failure stranded the member for the whole page life.
    h.fetchThemePref.mockResolvedValueOnce({ ok: false, pref: undefined });
    const { rerender } = render(<ThemeBootstrap><Probe /></ThemeBootstrap>);
    await act(async () => {});
    expect(h.fetchThemePref).toHaveBeenCalledTimes(1);

    h.fetchThemePref.mockResolvedValue({ ok: true, pref: "light" });
    h.isImpersonating = true;                       // gate change...
    rerender(<ThemeBootstrap><Probe /></ThemeBootstrap>);
    await act(async () => {});
    h.isImpersonating = false;                      // ...and back
    rerender(<ThemeBootstrap><Probe /></ThemeBootstrap>);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("true:light"));
    expect(h.fetchThemePref.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("ThemeBootstrap — setTheme's unstable identity must not cancel the read", () => {
  it("keeps the in-flight read alive when the theme changes mid-flight", async () => {
    // Finding 1, the sharpest of the three. next-themes' setTheme is
    // useCallback(..., [theme]); with it in the dep array, this sequence
    // cancelled the fetch and the one-shot guard refused to re-issue it.
    let resolveFetch: (v: unknown) => void = () => {};
    h.fetchThemePref.mockReturnValue(new Promise((r) => { resolveFetch = r; }));

    const { rerender } = render(<ThemeBootstrap><Probe /></ThemeBootstrap>);
    await act(async () => {});

    // A theme change lands while /api/me is still in flight.
    act(() => { h.themeState = "light"; });
    rerender(<ThemeBootstrap><Probe /></ThemeBootstrap>);

    await act(async () => { resolveFetch({ ok: true, pref: "dark" }); });

    await waitFor(() =>
      expect(
        screen.getByTestId("probe").textContent,
        "the read must survive a mid-flight theme change, or `loaded` never becomes " +
          "true and the /me control shows nothing selected for the page's life",
      ).toBe("true:dark"),
    );
    expect(h.fetchThemePref).toHaveBeenCalledTimes(1);
  });
});

describe("the context's setPref marks the state loaded", () => {
  it("a successful save leaves the control able to show a selection", async () => {
    // Finding 3: setPref was the raw state setter, so `loaded` could still be
    // false after a save that landed — every button unselected, looking to the
    // member like the tap did not register.
    h.fetchThemePref.mockResolvedValue({ ok: false, pref: undefined });

    function Saver() {
      const { pref, loaded, setPref } = useThemePref();
      return (
        <>
          <span data-testid="probe">{`${loaded}:${pref ?? "unset"}`}</span>
          <button onClick={() => setPref("light")}>save</button>
        </>
      );
    }

    render(<ThemeBootstrap><Saver /></ThemeBootstrap>);
    await act(async () => {});
    expect(screen.getByTestId("probe").textContent).toBe("false:unset");

    act(() => { screen.getByText("save").click(); });
    expect(screen.getByTestId("probe").textContent).toBe("true:light");
  });
});
