/** @vitest-environment jsdom */
//
// The remaining Control Room panels adopt the primitives (R5 Task 5).
//
// Four of these are the same fact stated per panel — a loading surface draws
// `Skeleton`, never a hand-rolled `animate-pulse` block — and they are written
// per panel rather than as one scan because each panel reaches its loading state
// differently, and a scan would pass on a panel that never renders at all.
//
// The two that are NOT restatements:
//
//  - `ContentPanel`'s row actions. `opacity-0 group-hover:opacity-100` is not a
//    subtle affordance on a phone, it is a missing one: there is no hover state
//    to enter, so Editar and Eliminar were permanently invisible to every touch
//    admin, and unreachable by keyboard at any width. The assertion is that no
//    `opacity-0` survives WITHOUT an `sm:` prefix — the shape, not the spelling,
//    because `opacity-0 sm:group-hover:…` would read as fixed and is not.
//  - `AvailabilityPanel`'s sticky first column. The shadow is driven by a 1px
//    sentinel observed against the scroll box, so the test drives a mocked
//    `IntersectionObserver` and asserts the attribute the CSS hangs off.
//
// jsdom applies no CSS and implements no IntersectionObserver, so these are
// class/attribute assertions by design.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActivityPanel from "../ActivityPanel";
import AvailabilityPanel from "../AvailabilityPanel";
import ContentPanel from "../ContentPanel";
import ProposalsPanel from "../ProposalsPanel";
import IntegrityQueuePanel from "../IntegrityQueuePanel";
import { buildIntegrityQueue } from "../serviceIntegrityQueue";
import { buildRoleTargets } from "@/app/utils/serviceReadSummary";
import { ToastProvider } from "../../ui/Toast";
import { CueDialogProvider } from "../../ui/CueDialogProvider";
import { MotionProvider } from "../../ui/MotionProvider";
import { installMotionTestEnv } from "../../ui/__tests__/motionTestSetup";

installMotionTestEnv();

/** Never resolves — the panel stays in its loading view. */
const stubPendingFetch = () => vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The one assertion every loading surface owes. */
function expectSkeletons(container: HTMLElement, label: string, count: number) {
  const group = screen.getByRole("status", { name: label });
  expect(group.querySelectorAll(".brand-skeleton").length).toBe(count);
  expect(container.querySelectorAll(".animate-pulse").length).toBe(0);
}

describe("Actividad", () => {
  it("draws skeletons while the load is in flight, never a bare pulsing block", () => {
    stubPendingFetch();
    const { container } = render(<ActivityPanel />);
    expectSkeletons(container, "Cargando actividad", 4);
  });

  it("rolls each summary stat in place instead of swapping the digits", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([
      { _id: "m1", member_name: "Ana", lastActive: new Date().toISOString(), lastLogin: null, lastSeen: null, loginCount: 0, providers: [], events: [] },
    ])));
    const { container } = render(<ActivityPanel />);
    await waitFor(() => expect(screen.getByText("Ana")).not.toBeNull());
    // NumberRoll's host: one positioned, clipped grid cell per value.
    expect(container.querySelectorAll("span.inline-grid.overflow-hidden").length).toBe(3);
  });

  it("offers a retry on failure, and the retry calls the SAME loader", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => { throw new Error("offline"); })
      .mockImplementation(async () => ok([]));
    vi.stubGlobal("fetch", fetchMock);
    render(<ActivityPanel />);

    await waitFor(() => expect(screen.getByText(/Error al cargar actividad/i)).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.queryByText(/Error al cargar actividad/i)).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("Disponibilidad", () => {
  it("draws skeletons while the two loads are in flight", () => {
    stubPendingFetch();
    const { container } = render(<AvailabilityPanel />);
    expectSkeletons(container, "Cargando disponibilidad", 3);
  });

  it("marks the matrix scrolled when the left-edge sentinel stops intersecting", async () => {
    // jsdom has no IntersectionObserver at all, so the panel would otherwise skip
    // the effect entirely; this mock is both the stub and the driver.
    const observers: Array<{
      cb: IntersectionObserverCallback;
      root: Element | null;
      observed: Element[];
      disconnected: boolean;
    }> = [];
    class MockIO {
      cb: IntersectionObserverCallback;
      entry: (typeof observers)[number];
      constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
        this.cb = cb;
        this.entry = {
          cb,
          root: (init?.root as Element) ?? null,
          observed: [],
          disconnected: false,
        };
        observers.push(this.entry);
      }
      observe(el: Element) { this.entry.observed.push(el); }
      unobserve() {}
      disconnect() { this.entry.disconnected = true; }
      takeRecords() { return []; }
    }
    vi.stubGlobal("IntersectionObserver", MockIO);

    const FUTURE = `${new Date().getFullYear() + 1}-03-01`;
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/members")
        ? ok([{ _id: "m1", member_name: "Ana", unavailableDates: [FUTURE] }])
        : ok([{
            _id: "r1", _type: "sunday_role", date: FUTURE,
            leads: [{ _id: "m1" }], bgvs: [], chorus: [], instruments: [], foh: [],
          }]),
    ));

    const { container, unmount } = render(<AvailabilityPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Matriz" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Matriz" }));

    const box = container.querySelector(".availability-matrix") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.hasAttribute("data-scrolled")).toBe(false);

    // Rooted on the SCROLL BOX, not the page — that is what makes it honest.
    await waitFor(() => expect(observers).toHaveLength(1));
    expect(observers[0].root).toBe(box);
    expect(observers[0].observed[0]?.getAttribute("aria-hidden")).toBe("true");

    observers[0].cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    await waitFor(() => expect(box.hasAttribute("data-scrolled")).toBe(true));

    observers[0].cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await waitFor(() => expect(box.hasAttribute("data-scrolled")).toBe(false));

    unmount();
    expect(observers[0].disconnected).toBe(true);
  });
});

describe("Contenido", () => {
  const mountContent = () =>
    render(
      <ToastProvider>
        <CueDialogProvider>
          <ContentPanel canDelete />
        </CueDialogProvider>
      </ToastProvider>,
    );

  it("draws skeletons while the three loads are in flight", () => {
    stubPendingFetch();
    const { container } = mountContent();
    expectSkeletons(container, "Cargando canciones", 5);
  });

  it("shows the row actions on touch: no opacity-0 without an sm: prefix", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/posts")
        ? ok([{ _id: "s1", title: "Santo", author: "X", slug: { current: "santo" } }])
        : ok([]),
    ));
    const { container } = mountContent();
    await waitFor(() => expect(screen.getByText("Santo")).not.toBeNull());

    const actions = screen.getByRole("button", { name: "Editar" }).parentElement as HTMLElement;
    for (const cls of actions.className.split(/\s+/)) {
      // `opacity-0` unprefixed is the phone-invisible spelling; `sm:opacity-0` is
      // the pointer-only fade the redesign asked for.
      expect(cls, actions.className).not.toBe("opacity-0");
    }
    expect(actions.className).toContain("sm:opacity-0");
    expect(actions.className).toContain("sm:group-hover:opacity-100");
    // The keyboard was excluded by the hover-only spelling at every width.
    expect(actions.className).toContain("sm:focus-within:opacity-100");
    // A ≥44px target, now that a finger can reach them.
    expect(screen.getByRole("button", { name: "Eliminar" }).className).toContain("min-h-[44px]");
  });
});

describe("Propuestas", () => {
  it("draws skeletons while the list loads", () => {
    stubPendingFetch();
    const { container } = render(
      <ToastProvider><ProposalsPanel viewerId="admin-1" /></ToastProvider>,
    );
    expectSkeletons(container, "Cargando propuestas", 2);
  });
});

describe("Integridad de datos", () => {
  const SOURCES = { roleTargets: "ready", setlistTargets: "ready", proposals: "ready" } as const;
  const EMPTY_SETLISTS = { targets: [], recordIssues: [] };
  const EMPTY_PROPOSALS = {
    records: [], serviceRefConflicts: [], targetKeyConflicts: [], recordIssues: [], draftIds: [],
  };
  const queueFor = (draftIds: string[]) =>
    buildIntegrityQueue({
      sources: SOURCES,
      cards: [],
      roles: buildRoleTargets([], draftIds.map((_id) => ({ _id, _type: "sunday_role" as const })), new Map(), []),
      setlists: EMPTY_SETLISTS,
      proposals: EMPTY_PROPOSALS,
    });

  it("lets a resolved entry EXIT instead of blinking out of the list", async () => {
    const both = queueFor(["drafts.role-y", "drafts.role-z"]);
    const one = queueFor(["drafts.role-y"]);
    expect(both.count).toBe(2);

    const panel = (queue: typeof both) => (
      <MotionProvider>
        <IntegrityQueuePanel queue={queue} tone="issues" sources={SOURCES} reload={vi.fn()} />
      </MotionProvider>
    );

    const { rerender } = render(panel(both));
    expect(screen.getByText("drafts.role-z")).not.toBeNull();

    // The host is still a real list, and each entry is still exactly one item in
    // it — `AnimatedList` owns the `<li>` (it has to, to pop a leaver out of
    // flow), so the entry itself is now the DIV inside it, and that div is still
    // the focus target the explicit-id reveal scrolls to.
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const host = items[0].parentElement as HTMLElement;
    expect(host.tagName).toBe("UL");
    // `relative`, because a popped item positions against the host.
    expect(host.className).toContain("relative");
    const entry = items[0].firstElementChild as HTMLElement;
    expect(entry.tagName).toBe("DIV");
    expect(entry.getAttribute("tabindex")).toBe("-1");

    // The queue derivation is untouched — the panel is handed a shorter one.
    rerender(panel(one));
    await waitFor(() => expect(screen.queryByText("drafts.role-z")).toBeNull());
    expect(screen.getByText("drafts.role-y")).not.toBeNull();
  });
});
