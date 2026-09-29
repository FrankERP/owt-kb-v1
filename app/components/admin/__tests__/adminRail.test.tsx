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

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminRail, { ADMIN_TAB_ICON, type IntegrityTone } from "../AdminRail";
import type { AdminTabId } from "../proposalHandoff";
import { visibleAdminTabs } from "../adminTabs";
import { buttonClass } from "../../ui/Button";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The rail's NAVIGATION items — the collapse toggle shares the nav but is not one. */
const railItems = (rail: HTMLElement) =>
  within(rail)
    .getAllByRole("button")
    .filter((b) => !b.hasAttribute("data-rail-toggle"));

const TABS = visibleAdminTabs("super-admin").map((t) => ({ ...t, icon: ADMIN_TAB_ICON[t.id] }));

function mount(
  overrides: Partial<{
    tone: IntegrityTone;
    count: number;
    onChange: (id: AdminTabId) => void;
    active: AdminTabId;
  }> = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  const utils = render(
    <AdminRail
      tabs={TABS}
      active={overrides.active ?? "services"}
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
    expect(railItems(rail)).toHaveLength(TABS.length);
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
    for (const item of railItems(rail)) {
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
    for (const item of railItems(rail)) {
      expect(item.getAttribute("aria-label")).toBeTruthy();
      expect(item.querySelector("[data-rail-label]")).not.toBeNull();
      // …and an icon, which is what is left when the label goes.
      expect(item.querySelector("svg")).not.toBeNull();
    }
  });
});

describe("the user can collapse the rail", () => {
  // The planner forces the icons-only rail at ≥ 1280 in pure CSS; this is the
  // OTHER way in — a toggle at the foot of the rail, remembered per browser.
  const KEY = "owt_admin_rail_collapsed";

  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const toggleOf = (rail: HTMLElement) =>
    rail.querySelector("[data-rail-toggle]") as HTMLButtonElement;

  it("puts the toggle in the rail only, never in the phone strip", () => {
    const { rail, strip, container } = mount();
    expect(toggleOf(rail)).not.toBeNull();
    expect(strip.querySelector("[data-rail-toggle]")).toBeNull();
    expect(container.querySelectorAll("[data-rail-toggle]")).toHaveLength(1);
  });

  it("is the house Button, icon variant, not a raw nav-item button", () => {
    // Items are the documented raw-`<button>` exception because they NAVIGATE;
    // the toggle is an action, and `buttonClass` is the one spelling of one.
    const toggle = toggleOf(mount().rail);
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.className.startsWith(buttonClass("icon", "lg"))).toBe(true);
    expect(toggle.hasAttribute("aria-current")).toBe(false);
    expect(toggle.querySelector("svg")).not.toBeNull();
  });

  it("starts expanded, and a click flips aria-expanded, the label and the nav's mark", () => {
    const { rail } = mount();
    const toggle = toggleOf(rail);
    expect(rail.hasAttribute("data-collapsed")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Contraer menú");

    fireEvent.click(toggle);
    expect(rail.hasAttribute("data-collapsed")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Expandir menú");

    fireEvent.click(toggle);
    expect(rail.hasAttribute("data-collapsed")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("remembers the choice in localStorage and restores it on a fresh mount", () => {
    const first = mount();
    fireEvent.click(toggleOf(first.rail));
    expect(window.localStorage.getItem(KEY)).toBe("1");
    first.unmount();

    const second = mount();
    expect(second.rail.hasAttribute("data-collapsed")).toBe(true);
    expect(toggleOf(second.rail).getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggleOf(second.rail));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    second.unmount();
    expect(mount().rail.hasAttribute("data-collapsed")).toBe(false);
  });

  it("still toggles in memory when storage throws on read and on write", () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);

    const { rail } = mount();
    const toggle = toggleOf(rail);
    expect(rail.hasAttribute("data-collapsed")).toBe(false);
    fireEvent.click(toggle);
    expect(rail.hasAttribute("data-collapsed")).toBe(true);
    fireEvent.click(toggle);
    expect(rail.hasAttribute("data-collapsed")).toBe(false);
  });

  it("still toggles when only the WRITE fails (a readable, full storage)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { rail } = mount();
    fireEvent.click(toggleOf(rail));
    expect(rail.hasAttribute("data-collapsed")).toBe(true);
  });

  it("gives collapsed items a native title, and expanded ones none", () => {
    const { rail } = mount();
    for (const item of railItems(rail)) expect(item.hasAttribute("title")).toBe(false);
    fireEvent.click(toggleOf(rail));
    const items = railItems(rail);
    expect(items.map((i) => i.getAttribute("title"))).toEqual(TABS.map((t) => t.label));
  });
});

/**
 * The stylesheet half of the toggle. jsdom applies no media queries and no
 * `:has()`, so the behaviour is pinned as TEXT: which block a selector lives in
 * and which declarations it can reach.
 */
describe("brand.css keys the user's collapse without touching the planner's frame", () => {
  // Comments stripped first: their prose names these selectors and braces.
  const css = readFileSync(path.join(REPO_ROOT, "app/brand.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const USER = ".brand-admin-frame:has([data-admin-rail][data-collapsed])";

  /** Every top-level `@media … { … }` block, body included, by brace matching. */
  const mediaBlocks = (() => {
    const out: { query: string; body: string }[] = [];
    const re = /@media\s*([^{]+)\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      let depth = 1;
      let i = re.lastIndex;
      for (; i < css.length && depth > 0; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}") depth--;
      }
      out.push({ query: m[1].trim(), body: css.slice(re.lastIndex, i - 1) });
      re.lastIndex = i;
    }
    return out;
  })();

  /** `selector { declarations }` pairs inside a block body (no nesting there). */
  const rulesIn = (body: string) =>
    [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((r) => ({
      selector: r[1].trim(),
      decls: r[2],
    }));

  const allRules = [
    ...rulesIn(css.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")),
    ...mediaBlocks.flatMap((b) => rulesIn(b.body).map((r) => ({ ...r, query: b.query }))),
  ] as { selector: string; decls: string; query?: string }[];

  it("lives only under (min-width: 1024px), where the rail exists", () => {
    const userRules = allRules.filter((r) => r.selector.includes("[data-collapsed]"));
    // Frame variable, rail width, hidden labels, badge dot.
    expect(userRules.length).toBeGreaterThanOrEqual(4);
    for (const r of userRules) expect(r.query).toBe("(min-width: 1024px)");
    expect(userRules.some((r) => r.selector === USER && /--admin-rail-w:\s*56px/.test(r.decls))).toBe(true);
    expect(
      userRules.some(
        (r) => r.selector === `${USER} .brand-admin-rail` && /width:\s*var\(--admin-rail-w\)/.test(r.decls),
      ),
    ).toBe(true);
    expect(
      userRules.some(
        (r) => r.selector === `${USER} .brand-admin-rail [data-rail-label]` && /display:\s*none/.test(r.decls),
      ),
    ).toBe(true);
    expect(
      userRules.some(
        (r) => r.selector === `${USER} .brand-admin-rail [data-integrity]` && /position:\s*absolute/.test(r.decls),
      ),
    ).toBe(true);
  });

  it("never widens the frame or changes its padding — that is the planner's alone", () => {
    for (const r of allRules.filter((r) => r.selector.includes("[data-collapsed]"))) {
      expect(r.decls, r.selector).not.toMatch(/max-width/);
      expect(r.decls, r.selector).not.toMatch(/padding/);
    }
    // …and every rule that DOES lift a cap or re-pad the frame is scoped to the
    // planner, at ≥ 1280, exactly as before the toggle existed.
    const wideners = allRules.filter(
      (r) =>
        /max-width:\s*none/.test(r.decls) &&
        (r.selector.includes("brand-admin-frame") || r.selector.includes("data-route-main")),
    );
    expect(wideners.length).toBe(2);
    for (const r of wideners) {
      expect(r.selector).toMatch(/:has\(\.planner-wide\)$/);
      expect(r.query).toBe("(min-width: 1280px)");
    }
  });

  it("hides the toggle while the planner forces the collapse", () => {
    const hide = allRules.find(
      (r) =>
        r.selector === ".brand-admin-frame:has(.planner-wide) .brand-admin-rail [data-rail-toggle]" &&
        /display:\s*none/.test(r.decls),
    );
    expect(hide, "no rule hides [data-rail-toggle] under :has(.planner-wide)").toBeTruthy();
    expect(hide!.query).toBe("(min-width: 1280px)");
  });
});

describe("the phone strip scrolls its active tab into view", () => {
  // `/admin?tab=x` seeds the panel's tab from the URL, so the active item is
  // already active at the strip's FIRST render and never flips. Before F1 the
  // shared `useActiveIntoView` refused to scroll on mount (SectionNav's rule),
  // and a 390px phone opened `?tab=content` with «Contenido» — and its
  // underline — off-screen to the right.
  let original: typeof HTMLElement.prototype.scrollIntoView;
  let spy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    original = HTMLElement.prototype.scrollIntoView;
    spy = vi.fn();
    HTMLElement.prototype.scrollIntoView = spy as unknown as typeof original;
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = original;
  });

  it("centres the last tab on MOUNT, on the strip's item", () => {
    const last = TABS[TABS.length - 1];
    const { strip } = mount({ active: last.id });
    const item = within(strip).getByRole("button", { name: last.label });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0]).toBe(item);
    expect(spy.mock.calls[0][0]).toMatchObject({ inline: "center", block: "nearest" });
  });

  it("centres the newly active item on a tab change too", () => {
    const { strip, rerender } = mount({ active: "services" });
    spy.mockClear();
    rerender(
      <AdminRail tabs={TABS} active="content" onChange={vi.fn()} integrityTone="clean" integrityCount={0} />,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0]).toBe(within(strip).getByRole("button", { name: "Contenido" }));
  });
});
