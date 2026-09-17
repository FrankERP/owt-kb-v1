/** @vitest-environment jsdom */
//
// The Control Room's section nav (R5 ruling 3).
//
// Two layouts of ONE control: the rail (≥ lg) and the underline strip (< lg) are
// both in the DOM at all times and CSS picks one, so every assertion here has to
// say WHICH it is looking at — a query that finds "the Servicios button" finds
// two. That is the deliberate cost of not choosing the layout in JS, where the
// first server-rendered paint would pick wrong.
//
// What it pins: one item per visible tab in each layout, `aria-current` on the
// active one only, a click that reports the id, and the integrity dot's THREE
// states. The third state is the point: `unknown` (a failed or still-loading
// inventory) must never look like `clean`, in the dot or in the accessible name.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AdminRail, { ADMIN_TAB_ICON, type IntegrityTone } from "../AdminRail";
import type { AdminTabId } from "../proposalHandoff";
import { visibleAdminTabs } from "../adminTabs";

const TABS = visibleAdminTabs("super-admin").map((t) => ({ ...t, icon: ADMIN_TAB_ICON[t.id] }));

function mount(
  overrides: Partial<{ tone: IntegrityTone; count: number; onChange: (id: AdminTabId) => void }> = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  const utils = render(
    <AdminRail
      tabs={TABS}
      active="services"
      onChange={onChange}
      integrityTone={overrides.tone ?? "clean"}
      integrityCount={overrides.count ?? 0}
    />,
  );
  const rail = utils.container.querySelector("nav[aria-label='Secciones']") as HTMLElement;
  const strip = utils.container.querySelector("[data-admin-tabs]") as HTMLElement;
  return { ...utils, rail, strip, onChange };
}

afterEach(cleanup);

describe("AdminRail renders both layouts of one control", () => {
  it("gives every visible tab an item in the rail and in the strip", () => {
    const { rail, strip } = mount();
    expect(within(rail).getAllByRole("button")).toHaveLength(TABS.length);
    expect(within(strip).getAllByRole("button")).toHaveLength(TABS.length);
    // One nav, one strip — never two navs fighting over the same landmark name.
    expect(screen.getAllByRole("navigation", { name: "Secciones" })).toHaveLength(1);
  });

  it("marks only the active item, in both layouts", () => {
    const { rail, strip } = mount();
    for (const host of [rail, strip]) {
      const current = within(host)
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-current") === "page");
      expect(current).toHaveLength(1);
      expect(current[0].getAttribute("aria-label")).toBe("Servicios");
    }
  });

  it("reports the tab id that was clicked", () => {
    const onChange = vi.fn();
    const { rail, strip } = mount({ onChange });
    fireEvent.click(within(rail).getByRole("button", { name: "Actividad" }));
    expect(onChange).toHaveBeenCalledWith("activity");
    fireEvent.click(within(strip).getByRole("button", { name: "Contenido" }));
    expect(onChange).toHaveBeenLastCalledWith("content");
  });

  it("keeps the two sliding indicators on separate layout ids", () => {
    // One shared id across both layouts would make the pill and the underline
    // the same projected element, and it would fly across the page at the
    // breakpoint. Two markers, one per layout, is what the DOM must show.
    const { container } = mount();
    expect(container.querySelectorAll("[data-sliding-indicator]")).toHaveLength(2);
  });
});

describe("the Servicios item carries the integrity state", () => {
  it("shows nothing at all when the inventory is proven clean", () => {
    const { container, rail } = mount({ tone: "clean", count: 0 });
    expect(container.querySelectorAll("[data-integrity]")).toHaveLength(0);
    expect(within(rail).getByRole("button", { name: "Servicios" })).toBeTruthy();
  });

  it("shows a dim ? when a domain failed or is still loading", () => {
    const { container, rail } = mount({ tone: "unknown", count: 0 });
    const dots = container.querySelectorAll("[data-integrity='unknown']");
    // One per layout, and only on Servicios.
    expect(dots).toHaveLength(2);
    expect(dots[0].textContent).toBe("?");
    expect(dots[0].className).toContain("text-ink-dim");
    // The name says it too: colour is never the only channel.
    expect(
      within(rail).getByRole("button", { name: "Servicios, integridad desconocida" }),
    ).toBeTruthy();
  });

  it("shows the count when there are real issues", () => {
    const { container, rail } = mount({ tone: "issues", count: 3 });
    const dots = container.querySelectorAll("[data-integrity='issues']");
    expect(dots).toHaveLength(2);
    expect(dots[0].textContent).toBe("3");
    expect(dots[0].className).toContain("text-negative-fg");
    expect(
      within(rail).getByRole("button", { name: "Servicios, 3 problemas de integridad" }),
    ).toBeTruthy();
  });

  it("names one problem in the singular", () => {
    const { rail } = mount({ tone: "issues", count: 1 });
    expect(
      within(rail).getByRole("button", { name: "Servicios, 1 problema de integridad" }),
    ).toBeTruthy();
  });

  it("puts the dot on Servicios and nowhere else", () => {
    const { rail } = mount({ tone: "issues", count: 2 });
    for (const item of within(rail).getAllByRole("button")) {
      const hasDot = item.querySelector("[data-integrity]") !== null;
      expect(hasDot).toBe(item.getAttribute("aria-label")?.startsWith("Servicios"));
    }
  });
});

describe("the collapsed rail stays named", () => {
  it("labels every item explicitly, because brand.css hides the label text", () => {
    // `.brand-admin-frame:has(.planner-wide) .brand-admin-rail [data-rail-label]
    // { display: none }` — a hidden label is out of the accessibility tree, so
    // the item's own `aria-label` is the only name left while the planner is
    // open. The two halves are pinned against each other here.
    const { rail } = mount();
    for (const item of within(rail).getAllByRole("button")) {
      expect(item.getAttribute("aria-label")).toBeTruthy();
      expect(item.querySelector("[data-rail-label]")).not.toBeNull();
      // …and an icon, which is what is left when the label goes.
      expect(item.querySelector("svg")).not.toBeNull();
    }
  });
});
