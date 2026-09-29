/** @vitest-environment jsdom */
//
// Servicios is a board that scrolls VERTICALLY (ADR-0044, reversing R5 ruling 5).
//
// What this pins, and why each one is a fact rather than a preference:
//
//  1. The cards container is a GRID that wraps into 360px-minimum columns and
//     leaves the scroll to the page. It carries none of the old snap track's
//     classes and no card carries a fixed width or a snap stop — a track that
//     crept back would reintroduce the horizontal scroll Frank asked to remove.
//     The loading skeleton is laid out from the same two consts.
//  1b. The Participaciones chart is PINNED on the board: sticky at the admin
//     rail's own top (read from `AdminRail.tsx`, so the two cannot drift) and
//     capped to the viewport by that same offset, a flex column whose rows list
//     is the one scroller, so the header never scrolls away. The planner
//     renders the same component with the default placement, which must not
//     pick any of it up — and only `ServicesPanel` may ask for the board's.
//  2. The month filter stays MULTI-select and says so through `aria-pressed`.
//     The pills look like a one-of-N control and are not one: pressing a second
//     month must leave the first pressed. A `SegmentedControl`-shaped
//     "improvement" here silently deletes the ability to compare two months.
//  3. The card's one primary action is a house `Button` that still carries
//     `data-action-kind` / `-rule` / `-route` — the 15-rule ladder's only
//     debuggable trace in the DOM (`docs/SERVICE_READINESS_UI.md`).
//  4. Loading draws `Skeleton`s, not an `animate-pulse` block.
//
// jsdom applies no CSS, so these are class/attribute assertions by design: the
// breakpoint behaviour is Tailwind's, the contract is that the classes are there.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import ServicePrimaryAction from "../ServicePrimaryAction";
import { BOARD_STICKY, ParticipationSidebar } from "../ParticipationSidebar";
import ServicesPanel from "../ServicesPanel";
import { ToastProvider } from "../../ui/Toast";
import { CueDialogProvider } from "../../ui/CueDialogProvider";
import { SOURCE_ENDPOINTS } from "../serviceSourceState";
import type { PrimaryActionProps, ServiceRole } from "../serviceCardModel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Two months ahead of any plausible "today", so the default «Próximos» filter
// shows both and the month pills have something to multi-select.
const YEAR = new Date().getFullYear() + 1;
const MONTH_A = `${YEAR}-03`;
const MONTH_B = `${YEAR}-04`;

function role(id: string, date: string): ServiceRole {
  return {
    _id: id,
    _rev: `rev-${id}`,
    _type: "sunday_role",
    date,
    published: false,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    songs: [],
  };
}

const ROLES = [role("role-a", `${MONTH_A}-01`), role("role-b", `${MONTH_B}-05`)];

/** A 200 with the right SHAPE per source — an unusable body is a failed load. */
const PAYLOAD: Record<string, unknown> = {
  [SOURCE_ENDPOINTS.roles]: ROLES,
  [SOURCE_ENDPOINTS.members]: [],
  [SOURCE_ENDPOINTS.roleTargets]: { targets: [], recordIssues: [], lockIssues: [] },
  [SOURCE_ENDPOINTS.setlistTargets]: { targets: [], recordIssues: [] },
  [SOURCE_ENDPOINTS.proposals]: {
    records: [],
    serviceRefConflicts: [],
    targetKeyConflicts: [],
    recordIssues: [],
    draftIds: [],
  },
};

/** Never resolves — the panel stays in its loading view. */
function stubPendingFetch() {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => PAYLOAD[url] ?? {},
    })),
  );
}

function mount() {
  return render(
    <ToastProvider>
      <CueDialogProvider>
        <ServicesPanel />
      </CueDialogProvider>
    </ToastProvider>,
  );
}

const board = (container: HTMLElement) =>
  container.querySelector("[data-card-id]")?.parentElement as HTMLElement;

/**
 * Any class on the cards container that would turn it back into a horizontal
 * track, whatever variant it hides behind (`lg:`, `xl:`, `!`): a column flow,
 * implicit columns, or a container that scrolls itself.
 */
function trackClasses(el: HTMLElement): string[] {
  return el.className
    .split(/\s+/)
    .filter((cls) =>
      /^(?:grid-flow-col|auto-cols-|overflow-(?:x-)?(?:auto|scroll)$)/.test(
        cls.replace(/^(?:[a-z0-9-]+:)+/, "").replace(/^!/, ""),
      ),
    );
}

describe("the Servicios board", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFetch();
  });

  it("is a vertical grid, never a horizontal track: the page carries the scroll", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    const grid = board(container);
    const classes = grid.className.split(/\s+/);
    for (const cls of ["lg:flex", "lg:snap-x", "lg:snap-mandatory", "lg:overflow-x-auto", "lg:scroll-px-6"]) {
      expect(classes, cls).not.toContain(cls);
    }
    expect(grid.className).not.toMatch(/overflow-x-(auto|scroll)/);
    expect(trackClasses(grid)).toEqual([]);
    expect(classes).toContain("grid");
    expect(classes).toContain("lg:grid-cols-[repeat(auto-fill,minmax(360px,1fr))]");
    // A grid column must never be sized by its content.
    expect(classes).toContain("min-w-0");
  });

  it("lets the grid size every card: no fixed width, no snap stop", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    for (const card of container.querySelectorAll("[data-card-id]")) {
      expect(card.className).not.toContain("snap-start");
      expect(card.className).not.toContain("shrink-0");
      expect(card.className).not.toContain("w-[380px]");
      // Route reveal, capped stagger — the cards arrive, they do not pop.
      expect(card.getAttribute("data-reveal")).toBe("");
    }
  });

  it("pins the Participaciones chart under the navbar, capped to the viewport", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    const aside = container.querySelector("aside:has([data-rail-header])") as HTMLElement;
    expect(aside, "the Participaciones chart").toBeTruthy();
    const classes = aside.className.split(/\s+/);
    expect(classes).toContain("lg:sticky");
    expect(classes).toContain(`lg:${adminRailTop()}`);
    // The cap subtracts the SAME offset the sticky top adds, derived from the
    // rail's top rather than restated: a navbar-height change that moves the
    // top and forgets the cap would push the chart's bottom off-screen.
    const offset = adminRailTop().match(/^top-\[calc\((.+)\)\]$/);
    expect(offset, "the rail's sticky top is a calc()").toBeTruthy();
    const terms = offset![1].split("+").map((t) => t.trim());
    expect(terms.length, "the offset's terms").toBeGreaterThan(0);
    const cap = classes.find((c) => c.startsWith("lg:max-h-["));
    expect(cap, "the chart's viewport cap").toBeTruthy();
    expect(cap).toContain(`[calc(100dvh-${terms.join("-")}-`);
    // A flex column, still scrollable itself only as the fallback for a
    // viewport too short for the header and legend alone.
    expect(classes).toContain("lg:flex");
    expect(classes).toContain("lg:flex-col");
    expect(classes).toContain("lg:overflow-y-auto");
    // The planner's offset would park it under the lg:h-24 navbar.
    expect(classes).not.toContain("lg:top-4");

    // The rows list is the ONE scroller, a direct child filling what the header
    // and legend leave: it drops its own 60vh cap from `lg`, or two scrollers
    // nest and the header scrolls away inside the aside on a short viewport.
    const list = aside.lastElementChild as HTMLElement;
    const listClasses = list.className.split(/\s+/);
    expect(listClasses, "the rows list (it carries the scroller's pr-0.5)").toContain("pr-0.5");
    for (const cls of ["overflow-y-auto", "lg:min-h-0", "lg:flex-1", "lg:max-h-none"]) {
      expect(listClasses, cls).toContain(cls);
    }
    for (const child of [...aside.children].slice(0, -1)) {
      expect(child.className, "only the rows list scrolls inside the aside").not.toMatch(/overflow-/);
    }
  });

  it("keeps the month filter multi-select, and says so with aria-pressed", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    const monthLabel = (ym: string) =>
      new Date(ym + "-01T12:00:00").toLocaleDateString("es-MX", { month: "short", year: "2-digit" });

    const first = screen.getByRole("button", { name: monthLabel(MONTH_A) });
    const second = screen.getByRole("button", { name: monthLabel(MONTH_B) });
    expect(first.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(first);
    expect(first.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(second);
    // BOTH stay pressed: this is not a one-of-N control.
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll("[data-card-id]").length).toBe(2);
  });

  // `Button` carries `disabled:pointer-events-none`, so a `title` on a disabled
  // control can never be summoned: the tooltip the admin needs most was the one
  // the markup guaranteed they would never see. The reason is a LINE now.
  it("says why the toolbar is closed, in the layout rather than in a title", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === SOURCE_ENDPOINTS.members
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, json: async () => PAYLOAD[url] ?? {} },
      ),
    );
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    const closed = screen.getByRole("button", { name: /Editar mes/ }) as HTMLButtonElement;
    expect(closed.disabled).toBe(true);
    expect(closed.getAttribute("title")).toBeNull();
    // Exactly one line, the first closed gate's reason.
    const reasons = [...container.querySelectorAll("p.text-ink-dim")].map((p) => p.textContent ?? "");
    expect(reasons).toHaveLength(1);
    expect(reasons[0].length).toBeGreaterThan(0);
    // No chart from partial membership — and the fallback sits where the chart
    // would, pinned the same way, so its «Reintentar carga» stays in reach.
    const fallback = container.querySelector("aside") as HTMLElement;
    expect(fallback.querySelector("[data-rail-header]")).toBeNull();
    for (const cls of BOARD_STICKY.split(/\s+/)) expect(fallback.className.split(/\s+/), cls).toContain(cls);
  });

  it("draws skeletons while the sources load, never a bare pulsing block", () => {
    vi.unstubAllGlobals();
    stubPendingFetch();
    const { container } = mount();

    const group = screen.getByRole("status", { name: "Cargando servicios" });
    // Seven: the chart's column plus six cards — the loaded board's shape, laid
    // out by the same consts, so nothing jumps when the data lands.
    expect(group.querySelectorAll(".brand-skeleton").length).toBe(7);
    expect(group.className).toContain("lg:grid-cols-[320px_1fr]");
    const cards = group.children[1] as HTMLElement;
    expect(cards.className).toContain("lg:grid-cols-[repeat(auto-fill,minmax(360px,1fr))]");
    expect(trackClasses(cards)).toEqual([]);
    expect(cards.querySelectorAll(".brand-skeleton").length).toBe(6);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(0);
  });
});

/**
 * The sticky top of the admin rail's `lg` nav, read from its source. The chart
 * and the rail sit side by side under the same navbar; if one moved and the
 * other did not, they would stop lining up — or one would slide under the bar.
 */
function adminRailTop(): string {
  const src = readFileSync(join(process.cwd(), "app/components/admin/AdminRail.tsx"), "utf8");
  const at = src.indexOf("data-admin-rail=");
  expect(at, "AdminRail's nav carries data-admin-rail").toBeGreaterThan(-1);
  const tag = src.slice(at, src.indexOf(">", at));
  const cls = tag.match(/className="([^"]*)"/);
  expect(cls, "the rail nav's className").toBeTruthy();
  const top = cls![1].split(/\s+/).find((c) => /^top-\[[^\]]+\]$/.test(c));
  expect(top, "the rail nav's sticky top").toBeTruthy();
  return top!;
}

describe("the Participaciones chart's placement", () => {
  it("shares the admin rail's sticky top, byte for byte", () => {
    // Non-vacuity: an arbitrary-value top was found, whatever it says.
    expect(adminRailTop()).toMatch(/^top-\[.+\]$/);
    expect(BOARD_STICKY.split(/\s+/)).toContain(`lg:${adminRailTop()}`);
  });

  it("keeps the planner's placement when no placement is asked for", () => {
    const { container } = render(<ParticipationSidebar roles={[]} monthLabel="Marzo" />);
    const aside = container.querySelector("aside") as HTMLElement;
    const classes = aside.className.split(/\s+/);
    expect(classes).toContain("lg:sticky");
    expect(classes).toContain("lg:top-4");
    expect(classes).toContain("self-start");
    expect(classes).not.toContain(`lg:${adminRailTop()}`);
    expect(classes).not.toContain("lg:overflow-y-auto");
    expect(classes).not.toContain("lg:flex");
    expect(classes).not.toContain("lg:flex-col");
    expect(classes.some((c) => c.startsWith("lg:max-h-"))).toBe(false);
    // The planner's rows list, byte for byte: `participationAlongside.test.tsx`
    // derives the planner column's width floor from its `pr-0.5`.
    expect((aside.lastElementChild as HTMLElement).className).toBe("space-y-0 max-h-[60vh] overflow-y-auto pr-0.5");
  });

  it("is asked for by ServicesPanel alone: the planner's charts pass no placement", () => {
    const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
    // Whole JSX elements only — MonthGenerator's prose mentions a retired
    // `placement="panel"`, which a whole-file search would trip over.
    const elements = (src: string) => [...src.matchAll(/<ParticipationSidebar\b[\s\S]*?\/>/g)].map((m) => m[0]);

    const planner = elements(read("app/components/admin/MonthGenerator.tsx"));
    expect(planner.length, "MonthGenerator renders the chart").toBeGreaterThan(0);
    for (const el of planner) expect(el).not.toMatch(/\bplacement\s*=/);

    const panelSrc = read("app/components/admin/ServicesPanel.tsx");
    const board = elements(panelSrc);
    expect(board, "ServicesPanel renders the chart once").toHaveLength(1);
    expect(panelSrc.match(/placement="board"/g) ?? []).toHaveLength(1);
    expect(board[0]).toContain('placement="board"');
  });
});

describe("the card's one primary action", () => {
  const ACTION: PrimaryActionProps = {
    kind: "edit_team",
    label: "Editar equipo",
    disabled: false,
    rule: 9,
    route: "service_modal",
    reason: null,
  };

  it("is a house Button that still carries the ladder's trace", () => {
    render(<ServicePrimaryAction action={ACTION} onAction={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Editar equipo" });

    expect(button.getAttribute("data-action-kind")).toBe("edit_team");
    expect(button.getAttribute("data-action-rule")).toBe("9");
    expect(button.getAttribute("data-action-route")).toBe("service_modal");
    // The house button's base, and the ≥44px full-width target it keeps.
    expect(button.className).toContain("ease-out-brand");
    expect(button.className).toContain("min-h-[44px]");
    expect(button.className).toContain("w-full");
  });

  // The tone is the whole point of the variant swap: an integrity/conflict
  // blocker must not look like the cyan "go" control beside it. `data-tone`
  // exists so this is readable in the DOM rather than by matching a class string
  // against `Button`'s private VARIANT table.
  it("wears the danger tone for a review/conflict kind", () => {
    const { rerender } = render(
      <ServicePrimaryAction
        action={{ ...ACTION, kind: "review_data", label: "Revisar datos" }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Revisar datos" }).getAttribute("data-tone")).toBe("danger");

    rerender(
      <ServicePrimaryAction
        action={{ ...ACTION, kind: "resolve_conflict", label: "Resolver conflicto" }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Resolver conflicto" }).getAttribute("data-tone")).toBe("danger");
  });

  it("wears the primary tone for a publish kind", () => {
    render(
      <ServicePrimaryAction
        action={{ ...ACTION, kind: "publish", label: "Publicar" }}
        onAction={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Publicar" });
    expect(button.getAttribute("data-tone")).toBe("primary");
    // And it is the primary variant's own spelling, not a colour override.
    expect(button.className).toContain("brand-btn-sheen");
  });

  it("stays disabled with its reason when a source is missing", () => {
    const reason = "Faltan los miembros. Usa «Reintentar carga».";
    render(<ServicePrimaryAction action={{ ...ACTION, disabled: true, reason }} onAction={vi.fn()} />);

    expect((screen.getByRole("button", { name: "Editar equipo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
  });
});
