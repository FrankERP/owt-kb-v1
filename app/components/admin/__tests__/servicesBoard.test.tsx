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

import ServicePrimaryAction, { ServiceReviewFlag } from "../ServicePrimaryAction";
import { formatMonthTab } from "../monthPills";
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
/** The board's own «today», for the month tabs' labels (the year shows only when it differs). */
const currentYM = () => new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" }).slice(0, 7);
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
    // ONE column since 2026-10-22: the compact card spends the width on its own
    // «Equipo» | «Setlist» columns, so the board no longer wraps cards into
    // `minmax(360px,1fr)` columns (ADR-0044, amended).
    expect(classes).toContain("grid-cols-1");
    expect(classes.filter((c) => /grid-cols-/.test(c))).toEqual(["grid-cols-1"]);
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

  it("on a phone: one toolbar menu beside «+ Nuevo», and the chart folded after the cards", async () => {
    // Measured at 390px before this: four toolbar buttons in three rows, two
    // rows of month pills and the whole chart before the first card — ~1 300px
    // of scroll to reach a service. jsdom applies no CSS, so this pins the
    // classes that make the phone layout and the controls that drive it.
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    // The once-a-month actions are desktop buttons, hidden below `sm`…
    for (const name of [/Generar mes/, "Editar mes"]) {
      const btn = screen.getByRole("button", { name });
      expect(btn.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "sm:inline-flex"]));
    }
    // …and ONE menu, shown only below `sm`, carries them (plus full screen).
    const menuTrigger = screen.getByRole("button", { name: "Más acciones de servicios" });
    expect(menuTrigger.parentElement?.className.split(/\s+/)).toContain("sm:hidden");
    fireEvent.click(menuTrigger);
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent?.trim());
    expect(items).toEqual(expect.arrayContaining(["Generar mes", "Editar mes", "Pantalla completa"]));
    // `Menu` listens for Escape on its panel and trigger, not on `document`.
    fireEvent.keyDown(screen.getAllByRole("menuitem")[0], { key: "Escape" });
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    // «+ Nuevo» stays a real button at every width.
    expect(screen.getByRole("button", { name: /Nuevo/ }).className).not.toMatch(/\bhidden\b/);

    // The chart: last below `lg`, the grid's own column from `lg` (`lg:contents`
    // dissolves the wrapper so the aside's sticky still applies to a grid item).
    const wrap = container.querySelector("[data-board-chart]") as HTMLElement;
    expect(wrap.className.split(/\s+/)).toEqual(expect.arrayContaining(["order-last", "lg:order-none", "lg:contents"]));
    expect(wrap.querySelector("aside:has([data-rail-header])")).not.toBeNull();
    // Folded by default on a phone, opened by its own toggle, never on desktop.
    const toggle = screen.getByRole("button", { name: /Participaciones/ });
    expect(toggle.className.split(/\s+/)).toContain("lg:hidden");
    const fold = document.getElementById(toggle.getAttribute("aria-controls")!) as HTMLElement;
    expect(fold.className.split(/\s+/)).toContain("max-lg:hidden");
    expect(fold.className.split(/\s+/)).toContain("lg:contents");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(fold.className.split(/\s+/)).not.toContain("max-lg:hidden");
  });

  it("keeps the month filter multi-select, and says so with aria-pressed", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    const monthLabel = (ym: string) => formatMonthTab(ym, currentYM());

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
  it("keeps the publish button on the toolbar when nothing can be published: disabled, with its reason", async () => {
    // 2026-10-22 hid it at zero; on 10-27 Frank read the missing button as a
    // bug. Both fixture drafts have NO team, which not even «Publicar todos»
    // may acknowledge, so the button stays and the line says why.
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    const publish = screen.getByRole("button", { name: "Publicar listos (0)" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(publish.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "sm:inline-flex"]));
    const reasons = [...container.querySelectorAll("p.text-right.text-ink-dim")].map((p) => p.textContent ?? "");
    expect(reasons).toEqual([expect.stringMatching(/^Publicar: ningún borrador .*2 necesitan revisión/)]);
    // The phone menu carries the same item, disabled the same way.
    fireEvent.click(screen.getByRole("button", { name: "Más acciones de servicios" }));
    const item = screen.getByRole("menuitem", { name: "Publicar listos (0)" });
    expect(item.getAttribute("aria-disabled") ?? String((item as HTMLButtonElement).disabled)).toBe("true");
  });

  it("offers «Publicar todos (M)» when teams are assigned and only the setlists are missing", async () => {
    // The month-start state the override exists for (Frank, 2026-10-27: «no
    // puedo esperar a tener las canciones para publicar los equipos»). Nothing
    // is READY, so the button is named after the commit the plan will offer.
    vi.unstubAllGlobals();
    const ana = { _id: "m1", member_name: "Ana", _key: "k1" };
    const staffed = ROLES.map((r) => ({ ...r, leads: [ana] }));
    // A proven single canonical target per role: without its integrity record a
    // draft is «Revisar datos», a HARD blocker no override may acknowledge.
    const targets = staffed.map((r) => ({
      targetKey: `${r._type}:${r.date}`,
      type: r._type,
      canonicalCount: 1,
      canonicalIds: [r._id],
      canonicalState: "single",
      publicState: "single",
      memberVisibleCount: 0,
      draftIds: [],
      records: [{
        id: r._id, rev: r._rev, type: r._type, serviceDate: r.date, published: false,
        assignedRefs: ["m1"], members: [], danglingRefs: [],
      }],
      expectsLock: true,
      lock: { id: `roleTarget.${r._type}.${r.date}`, rev: `lock-${r._id}`, state: "claimed", roleId: r._id, generation: 1 },
      lockIssues: [],
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url === SOURCE_ENDPOINTS.roles ? staffed
          : url === SOURCE_ENDPOINTS.members ? [ana]
          : url === SOURCE_ENDPOINTS.roleTargets ? { targets, recordIssues: [], lockIssues: [] }
          : (PAYLOAD[url] ?? {}),
      })),
    );
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    const publish = screen.getByRole("button", { name: "Publicar todos (2)" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    expect(container.querySelector("p.text-right.text-ink-dim")).toBeNull();
    fireEvent.click(publish);
    // The plan: nothing ready, both drafts only through the override.
    expect(await screen.findByText("Solo con «Publicar todos» (2)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publicar todos (2)", hidden: false })).toBeTruthy();
  });

  it("never offers a bulk publish for a past month, however publishable its drafts look", async () => {
    // Review finding on the 2026-10-27 fix: a staffed, setlist-less draft of a
    // month that has gone would otherwise count for «Publicar todos» and email
    // people about a date that is over.
    vi.unstubAllGlobals();
    const ana = { _id: "m1", member_name: "Ana", _key: "k1" };
    const pastDate = `${new Date().getFullYear() - 1}-03-01`;
    const past = { ...role("role-past", pastDate), leads: [ana] };
    const target = {
      targetKey: `${past._type}:${past.date}`, type: past._type, canonicalCount: 1, canonicalIds: [past._id],
      canonicalState: "single", publicState: "single", memberVisibleCount: 0, draftIds: [],
      records: [{ id: past._id, rev: past._rev, type: past._type, serviceDate: past.date, published: false, assignedRefs: ["m1"], members: [], danglingRefs: [] }],
      expectsLock: true,
      lock: { id: `roleTarget.${past._type}.${past.date}`, rev: "lock-past", state: "claimed", roleId: past._id, generation: 1 },
      lockIssues: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url === SOURCE_ENDPOINTS.roles ? [past]
          : url === SOURCE_ENDPOINTS.members ? [ana]
          : url === SOURCE_ENDPOINTS.roleTargets ? { targets: [target], recordIssues: [], lockIssues: [] }
          : (PAYLOAD[url] ?? {}),
      })),
    );
    mount();
    // Only a past role: «Próximos» is empty, so open the past months and pick it.
    fireEvent.click(await screen.findByRole("button", { name: /Roles previos/ }));
    // The pill wears the panel's own label («mar 25»), beside the upcoming months'.
    const pastLabel = formatMonthTab(pastDate.slice(0, 7), currentYM());
    fireEvent.click(screen.getByRole("button", { name: pastLabel, pressed: false }));
    await waitFor(() => expect(document.querySelectorAll("[data-card-id]").length).toBe(1));

    const publish = screen.getByRole("button", { name: "Publicar listos (0)" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Publicar todos/ })).toBeNull();
    // And no «needs review» line either: a past draft is not waiting on anything.
    expect(document.querySelector("p.text-right.text-ink-dim")).toBeNull();
  });

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
    const reasons = [...container.querySelectorAll("p.text-right.text-ink-dim")].map((p) => p.textContent ?? "");
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
    expect(cards.className).toContain("grid-cols-1");
    expect(cards.className).not.toContain("auto-fill");
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

describe("the «Integridad de datos» slot (bloque 4)", () => {
  // AdminPanel hands the board its integrity panel as a slot; the board shows it under its
  // heading and NOT over «Editar mes» (the editor's own admission reads the same inventory and
  // refuses in its own words) nor over «Generar mes» (a composer with nothing to clean up). The
  // check itself keeps running either way — only where it is written changes.
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFetch();
  });
  afterEach(() => cleanup());

  const renderWithSlot = () =>
    render(
      <ToastProvider>
        <CueDialogProvider>
          <ServicesPanel integritySlot={<div data-testid="integrity-slot">integridad</div>} />
        </CueDialogProvider>
      </ToastProvider>,
    );

  it("renders the slot under the board's heading, after the h1", async () => {
    const { container } = renderWithSlot();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));
    const slot = screen.getByTestId("integrity-slot");
    const h1 = screen.getByRole("heading", { level: 1, name: "Servicios" });
    expect(h1.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const firstCard = container.querySelector("[data-card-id]") as HTMLElement;
    expect(slot.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("drops the slot while «Editar mes» is open", async () => {
    const { container } = renderWithSlot();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));
    const open = screen.getAllByRole("button", { name: /Editar mes/ })[0] as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    fireEvent.click(open);
    await waitFor(() => expect(screen.queryByTestId("integrity-slot")).toBeNull());
  });

  it("drops the slot while «Generar mes» is open", async () => {
    const { container } = renderWithSlot();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));
    const open = screen.getAllByRole("button", { name: /Generar mes/ })[0] as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    fireEvent.click(open);
    await waitFor(() => expect(screen.queryByTestId("integrity-slot")).toBeNull());
    // The editor owns its page head (ADR-0070's Admin pass), so the h1 arrives with the
    // dynamically imported `MonthGenerator` — awaited, not read synchronously.
    expect(await screen.findByRole("heading", { level: 1, name: "Generar mes" })).toBeTruthy();
  });
});

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
    expect(classes).toContain("self-start");
    // The planner's COLUMN sticks (`PlannerGrid`), never the aside inside it: an aside
    // sticky in a column exactly its own height has nowhere to travel.
    expect(classes.some((c) => c.endsWith("sticky"))).toBe(false);
    expect(classes.some((c) => c.startsWith("lg:"))).toBe(false);
    // From `xl` (where the column sits beside the grid) the aside is a capped flex column…
    for (const cls of ["xl:flex", "xl:flex-col", "xl:overflow-y-auto"]) expect(classes).toContain(cls);
    const cap = classes.find((c) => c.startsWith("xl:max-h-["));
    expect(cap, "the chart's viewport cap").toBeTruthy();
    // …capped against the same offset the column's sticky top adds, which is the rail's.
    const offset = adminRailTop().match(/^top-\[calc\((.+)\)\]$/)![1].split("+").map((t) => t.trim());
    expect(cap).toContain(`[calc(100dvh-${offset.join("-")}-`);
    const gridSrc = readFileSync(join(process.cwd(), "app/components/admin/PlannerGrid.tsx"), "utf8");
    expect(gridSrc).toContain(`xl:sticky xl:${adminRailTop()}`);
    // …whose rows list is the one scroller; below `xl` it has no cap, so a phone scrolls the
    // PAGE instead of a box inside it. `participationAlongside.test.tsx` derives the planner
    // column's width floor from its `pr-0.5`.
    const list = (aside.lastElementChild as HTMLElement).className;
    expect(list).toBe("space-y-0 pr-0.5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto");
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
  it("wears the danger tone for a review/conflict kind, as the corner flag", () => {
    // Since phase 5 of the «millones» pass a blocker is `ServiceReviewFlag`: an
    // icon control named by the label, with the danger tone in the DOM and the
    // reason (or the label) on its title — never the cyan «go» beside it.
    const onAction = vi.fn();
    const { rerender } = render(
      <ServiceReviewFlag
        action={{ ...ACTION, kind: "review_data", label: "Revisar datos" }}
        onAction={onAction}
      />,
    );
    const flag = screen.getByRole("button", { name: "Revisar datos" });
    expect(flag.getAttribute("data-tone")).toBe("danger");
    expect(flag.getAttribute("data-action-rule")).toBe("9");
    expect(flag.getAttribute("title")).toBe("Revisar datos");
    fireEvent.click(flag);
    expect(onAction).toHaveBeenCalledTimes(1);

    const reason = "Faltan los miembros. Usa «Reintentar carga».";
    rerender(
      <ServiceReviewFlag
        action={{ ...ACTION, kind: "resolve_conflict", label: "Resolver conflicto", disabled: true, reason }}
        onAction={onAction}
      />,
    );
    const disabled = screen.getByRole("button", { name: "Resolver conflicto" }) as HTMLButtonElement;
    expect(disabled.getAttribute("data-tone")).toBe("danger");
    expect(disabled.disabled).toBe(true);
    expect(disabled.getAttribute("title")).toBe(reason);
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
