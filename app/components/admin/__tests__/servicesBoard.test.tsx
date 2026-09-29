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
//     capped to the viewport with its own scroll. The planner renders the same
//     component with the default placement, which must not pick any of it up.
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
    expect(classes).toContain("lg:max-h-[calc(100dvh-6rem-env(safe-area-inset-top)-1.5rem)]");
    expect(classes).toContain("lg:overflow-y-auto");
    // The planner's offset would park it under the lg:h-24 navbar.
    expect(classes).not.toContain("lg:top-4");
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
    const classes = (container.querySelector("aside") as HTMLElement).className.split(/\s+/);
    expect(classes).toContain("lg:sticky");
    expect(classes).toContain("lg:top-4");
    expect(classes).toContain("self-start");
    expect(classes).not.toContain(`lg:${adminRailTop()}`);
    expect(classes).not.toContain("lg:overflow-y-auto");
    expect(classes.some((c) => c.startsWith("lg:max-h-"))).toBe(false);
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
