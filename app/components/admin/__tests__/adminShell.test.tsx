/** @vitest-environment jsdom */
//
// The Control Room is the page (R5 Task 1, ADR-0037).
//
// `/admin` used to render a bordered `.brand-admin-shell` card, and each tab
// rendered its OWN tab bar plus its own `brand-surface` panel box inside it —
// three nested frames around content that is already made of cards. The shell
// was also `overflow: hidden` on both axes, which is how the workspace could
// scroll itself 128px sideways and stay there with nothing on screen to say so
// (spec walk finding 4).
//
// What this pins: one section nav for every tab, one body wrapper that remounts
// (so the incoming panel fades in rather than the outgoing one lingering), no
// re-introduced box between the two, and `.brand-admin-shell` gone from
// `app/brand.css` — a class nobody renders is a class someone re-renders.
//
// Since R5 Task 2 that nav is `AdminRail`, which renders BOTH of its layouts and
// lets CSS pick one: exactly one rail (`nav[aria-label="Secciones"]`) and exactly
// one strip (`[data-admin-tabs]`), which is why every query here says which one
// it means. `adminRail.test.tsx` owns the nav's own behaviour.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ useSession: () => ({ update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../ServicesPanel", () => ({ default: () => <div data-panel="services" /> }));
vi.mock("../ActivityPanel", () => ({ default: () => <div data-panel="activity" /> }));
vi.mock("../ContentPanel", () => ({ default: () => <div data-panel="content" /> }));
vi.mock("../AvailabilityPanel", () => ({ default: () => <div data-panel="availability" /> }));
vi.mock("../ProposalsPanel", () => ({ default: () => <div data-panel="proposals" /> }));
vi.mock("../IntegrityQueuePanel", () => ({ default: () => <div data-panel="integrity" /> }));

import AdminPanel from "../AdminPanel";
import { ToastProvider } from "../../ui/Toast";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** Queries scoped to the rail — the strip holds a second button per tab. */
const rail = (container: HTMLElement) =>
  within(container.querySelector("nav[aria-label='Secciones']") as HTMLElement);

function mount(initialTab: "members" | "services" | "activity" = "services") {
  return render(
    <ToastProvider>
      <AdminPanel role="super-admin" initialTab={initialTab} />
    </ToastProvider>,
  );
}

describe("the admin page is the workspace", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    window.history.replaceState({}, "", "/admin");
  });
  afterEach(cleanup);

  it("renders exactly one rail and one strip, on every tab", () => {
    const { container } = mount("services");
    const counts = () => [
      container.querySelectorAll("nav[aria-label='Secciones']").length,
      container.querySelectorAll("[data-admin-tabs]").length,
    ];
    expect(counts()).toEqual([1, 1]);

    fireEvent.click(rail(container).getByRole("button", { name: "Miembros" }));
    expect(counts()).toEqual([1, 1]);
  });

  it("puts no box between the tab bar and the panel", () => {
    const { container } = mount("services");
    // The shell, the tab bar's bordered pill and the per-tab panel card: all
    // three retired. The cards INSIDE a panel are the only boxes now.
    for (const cls of ["brand-admin-shell", "brand-admin-tabs", "brand-surface"]) {
      expect(container.querySelectorAll(`.${cls}`), `${cls} is back`).toHaveLength(0);
    }
    const nav = container.querySelector("nav[aria-label='Secciones']")!;
    const bar = container.querySelector("[data-admin-tabs]")!;
    const body = container.querySelector(".brand-admin-workspace")!;
    // Siblings under one parent — not nested, and nothing wrapped around either.
    // Both nav layouts are direct children of the grid: the rail IS the first
    // column at `lg`, and a wrapper around it would be the box we just removed.
    expect(nav.parentElement).toBe(body.parentElement);
    expect(body.parentElement).toBe(bar.parentElement);
    expect(body.contains(bar)).toBe(false);
    expect(body.contains(nav)).toBe(false);
  });

  it("fades the incoming body in by remounting it on a tab change", () => {
    const { container } = mount("services");
    const body = container.querySelector(".brand-admin-workspace") as HTMLElement;
    expect(body.className.split(/\s+/)).toContain("animate-fade-in");

    fireEvent.click(rail(container).getByRole("button", { name: "Actividad" }));
    // `key={tab}` — the old node is gone rather than re-used, so the new panel
    // plays its enter instead of swapping content inside a live element.
    expect(body.isConnected).toBe(false);
    const next = container.querySelector(".brand-admin-workspace") as HTMLElement;
    expect(next).not.toBe(body);
    expect(next.querySelector('[data-panel="activity"]')).not.toBeNull();
  });

  it("leaves no .brand-admin-shell in brand.css for anyone to re-render", () => {
    const css = read("app/brand.css");
    // As a RULE, not as a word — the planner-wide comment still names the class
    // it is explaining the absence of, which is the point of keeping it.
    expect(css).not.toMatch(/^\s*\.brand-admin-shell/m);
    expect(css).not.toMatch(/^\s*\.brand-admin-tabs/m);
    // The frame survives: `:has(.planner-wide)` hangs off it.
    expect(css).toContain(".brand-admin-frame:has(.planner-wide)");
    // Same on the page: the class is named in a comment that explains its
    // absence, never in a className.
    expect(read("app/(client)/admin/page.tsx")).not.toMatch(/className="[^"]*brand-admin-shell/);
  });
});
