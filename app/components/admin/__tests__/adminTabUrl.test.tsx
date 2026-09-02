/** @vitest-environment jsdom */
//
// The admin tab survives a reload.
//
// It used to live only in the reducer, seeded from the first tab the role can
// see. So an admin deep in Servicios who refreshed — or who left /admin and
// came back — was dropped on Miembros mid-task, with no way to link a colleague
// to the tab they were talking about.
//
// The half that is not merely convenience is the role filter. `?tab=members` is
// a URL an ordinary admin can be handed, or can keep in their own history from
// a super-admin's screen share, and Miembros is super-admin only. Resolution
// falls back to a tab they may see rather than honouring it.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TAB_CATALOG, resolveAdminTab, visibleAdminTabs } from "../adminTabs";

vi.mock("next-auth/react", () => ({ useSession: () => ({ update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../ServicesPanel", () => ({ default: () => null }));
vi.mock("../ActivityPanel", () => ({ default: () => null }));
vi.mock("../ContentPanel", () => ({ default: () => null }));
vi.mock("../AvailabilityPanel", () => ({ default: () => null }));
vi.mock("../ProposalsPanel", () => ({ default: () => null }));
vi.mock("../IntegrityQueuePanel", () => ({ default: () => null }));

import AdminPanel from "../AdminPanel";

// ─── Resolution (pure) ────────────────────────────────────────────────────────

describe("resolveAdminTab", () => {
  it("falls back to the role's first tab when there is no param", () => {
    expect(resolveAdminTab(undefined, "super-admin")).toBe("members");
    expect(resolveAdminTab(undefined, "admin")).toBe("services");
    expect(resolveAdminTab(undefined, "content-editor")).toBe("content");
  });

  it("honours a tab the role may open", () => {
    expect(resolveAdminTab("activity", "admin")).toBe("activity");
    expect(resolveAdminTab("content", "content-editor")).toBe("content");
  });

  it("refuses a tab the role may NOT open, rather than honouring the URL", () => {
    // Miembros is super-admin only. An admin handed this link gets their own
    // first tab, not the member roster.
    expect(resolveAdminTab("members", "admin")).toBe("services");
    expect(resolveAdminTab("services", "content-editor")).toBe("content");
    expect(resolveAdminTab("members", "content-editor")).toBe("content");
  });

  it("ignores junk and repeated params instead of guessing", () => {
    expect(resolveAdminTab("../etc/passwd", "super-admin")).toBe("members");
    expect(resolveAdminTab("", "admin")).toBe("services");
    // `?tab=activity&tab=content` — which one was meant is a guess.
    expect(resolveAdminTab(["activity", "content"], "admin")).toBe("services");
  });

  it("resolves every tab in the catalog for a super-admin", () => {
    // Catches a tab added to the bar but unreachable by URL, and vice versa.
    for (const { id } of TAB_CATALOG) {
      expect(resolveAdminTab(id, "super-admin")).toBe(id);
    }
    expect(visibleAdminTabs("super-admin").map((t) => t.id)).toEqual(TAB_CATALOG.map((t) => t.id));
  });
});

// ─── The panel ────────────────────────────────────────────────────────────────

describe("AdminPanel — the tab in the URL", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    window.history.replaceState({}, "", "/admin");
  });
  afterEach(cleanup);

  const currentTab = () =>
    screen.getAllByRole("button").find((b) => b.getAttribute("aria-current") === "page")?.textContent;
  const tabParam = () => new URL(window.location.href).searchParams.get("tab");

  it("opens on the tab the server resolved, not on the role's first one", () => {
    render(<AdminPanel role="super-admin" initialTab="activity" />);
    expect(currentTab()).toBe("Actividad");
  });

  it("still opens on the first tab when nothing was resolved", () => {
    render(<AdminPanel role="admin" />);
    expect(currentTab()).toBe("Servicios");
  });

  it("writes the tab into the URL, so a reload comes back to it", async () => {
    render(<AdminPanel role="super-admin" initialTab="members" />);
    await waitFor(() => expect(tabParam()).toBe("members"));

    fireEvent.click(screen.getByRole("button", { name: "Disponibilidad" }));
    await waitFor(() => expect(tabParam()).toBe("availability"));
    expect(currentTab()).toBe("Disponibilidad");
  });

  it("rewrites the current history entry instead of pushing a new one", async () => {
    const before = window.history.length;
    render(<AdminPanel role="super-admin" initialTab="members" />);
    fireEvent.click(screen.getByRole("button", { name: "Actividad" }));
    await waitFor(() => expect(tabParam()).toBe("activity"));
    // Pushing would make leaving /admin cost one Back press per tab visited.
    expect(window.history.length).toBe(before);
  });

  it("follows a soft navigation back to bare /admin instead of desyncing", async () => {
    // Tapping "Admin" in the nav while already on /admin?tab=activity
    // re-renders this panel in place with a new initialTab; useReducer's
    // initial value is read once, so without a render-time adjustment the URL
    // said /admin while the panel still showed Actividad.
    const { rerender } = render(<AdminPanel role="super-admin" initialTab="activity" />);
    expect(currentTab()).toBe("Actividad");

    rerender(<AdminPanel role="super-admin" initialTab="members" />);
    expect(currentTab()).toBe("Miembros");
    await waitFor(() => expect(tabParam()).toBe("members"));
  });

  it("re-asserts the param when something else wipes it from the URL", async () => {
    // The router owns the address bar. Because this panel's replaceState is
    // skipped by Next (see the effect comment), `canonicalUrl` stays plain
    // `/admin`, and any router commit while the admin stays here rewrites the
    // URL back to it. Keyed on [tab] the effect would not re-run, and the
    // param would be gone until the next tab press — so a reload would land on
    // Miembros, which is the whole bug. Simulate that wipe and re-render.
    const { rerender } = render(<AdminPanel role="super-admin" initialTab="members" />);
    fireEvent.click(screen.getByRole("button", { name: "Actividad" }));
    await waitFor(() => expect(tabParam()).toBe("activity"));

    window.history.replaceState(window.history.state, "", "/admin");
    expect(tabParam()).toBeNull();

    rerender(<AdminPanel role="super-admin" initialTab="members" />);
    await waitFor(() => expect(tabParam()).toBe("activity"));
    expect(currentTab()).toBe("Actividad");
  });

  it("leaves a manually chosen tab alone while the resolved one is unchanged", async () => {
    const { rerender } = render(<AdminPanel role="super-admin" initialTab="members" />);
    fireEvent.click(screen.getByRole("button", { name: "Actividad" }));
    expect(currentTab()).toBe("Actividad");

    // An unrelated re-render must not yank the admin back to the server's tab.
    rerender(<AdminPanel role="super-admin" initialTab="members" />);
    expect(currentTab()).toBe("Actividad");
  });

  it("passes the router's own history state back, not null", async () => {
    // NOT because `null` would strip Next's internals — it would not,
    // `copyNextJsInternalHistoryState` copies `__NA` and the internals tree
    // back off the current entry. The reason is the opposite: state carrying
    // `__NA` makes Next's patched replaceState early-return, which is what
    // avoids ACTION_RESTORE and its server round-trip on every tab press. See
    // the effect's comment. This pins the choice so it is not flipped silently.
    window.history.replaceState({ __NA: true, marker: "router-state" }, "", "/admin");
    render(<AdminPanel role="super-admin" initialTab="members" />);
    fireEvent.click(screen.getByRole("button", { name: "Actividad" }));
    await waitFor(() => expect(tabParam()).toBe("activity"));
    expect(window.history.state).toMatchObject({ __NA: true, marker: "router-state" });
  });

  it("round-trips: the param it writes is the tab it reopens on", async () => {
    const { unmount } = render(<AdminPanel role="admin" initialTab="services" />);
    fireEvent.click(screen.getByRole("button", { name: "Propuestas" }));
    await waitFor(() => expect(tabParam()).toBe("proposals"));
    unmount();

    // What the server would do with that URL on the reload.
    render(<AdminPanel role="admin" initialTab={resolveAdminTab(tabParam() ?? undefined, "admin")} />);
    expect(currentTab()).toBe("Propuestas");
  });
});
