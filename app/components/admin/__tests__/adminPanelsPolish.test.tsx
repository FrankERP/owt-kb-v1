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
//  - `ContentPanel`'s row actions. `opacity-0 group-hover:opacity-100` was not a
//    subtle affordance on a phone, it was a missing one: there is no hover state
//    to enter, so Editar and Eliminar were permanently invisible to every touch
//    admin, and unreachable by keyboard at any width. Since the Admin pass the
//    row carries ONE menu (as Miembros does), so the assertion is that both
//    actions are reachable through it and nothing on the row fades behind hover.
//  - `AvailabilityPanel`'s sticky first column. The shadow is driven by a 1px
//    sentinel observed against the scroll box, so the test drives a mocked
//    `IntersectionObserver` and asserts the attribute the CSS hangs off.
//
// jsdom applies no CSS and implements no IntersectionObserver, so these are
// class/attribute assertions by design.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    await waitFor(() => expect(screen.getByRole("radio", { name: "Matriz" })).not.toBeNull());
    fireEvent.click(screen.getByRole("radio", { name: "Matriz" }));

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

  it("reaches Editar and Eliminar through the row's one menu, with nothing hidden behind hover", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/posts")
        ? ok([{ _id: "s1", title: "Santo", author: "X", slug: { current: "santo" }, key: "Bb" }])
        : ok([]),
    ));
    const { container } = mountContent();
    await waitFor(() => expect(screen.getByText("Santo")).not.toBeNull());

    const row = container.querySelector("[data-song-row]") as HTMLElement;
    expect(row.className).not.toMatch(/opacity-0/);
    // The key keeps its accidental as a symbol: «B♭», never «BB» (ADR-0071 colour).
    expect(screen.getByLabelText("Tono B♭").className).toContain("text-key-fg");

    const trigger = screen.getByRole("button", { name: "Acciones de Santo" });
    // A ≥44px target, since a finger is what opens it.
    expect(trigger.className).toContain("min-h-[44px]");
    fireEvent.click(trigger);
    const menu = within(screen.getByRole("menu", { name: "Acciones de Santo" }));
    expect(menu.getByRole("menuitem", { name: "Editar" })).not.toBeNull();
    expect(menu.getByRole("menuitem", { name: "Eliminar" })).not.toBeNull();
  });

  it("files the rows alphabetically within a letter, accents folded, and survives a deleted author", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/posts")
        ? ok([
            // The API's `order(title asc)` is code-point order: «Él» lands after «eterno».
            { _id: "s1", title: "Eres todo", author: "", slug: { current: "a" }, authors: [null] },
            { _id: "s2", title: "eterno", author: "X", slug: { current: "b" } },
            { _id: "s3", title: "Él es fiel", author: "Y", slug: { current: "c" } },
          ])
        : ok([]),
    ));
    const { container } = mountContent();
    await waitFor(() => expect(screen.getByText("Él es fiel")).not.toBeNull());
    const titles = Array.from(container.querySelectorAll("[data-song-row] p:first-child")).map((p) => p.textContent);
    expect(titles).toEqual(["Él es fiel", "Eres todo", "eterno"]);
    expect(screen.getByRole("heading", { level: 2, name: "E" })).not.toBeNull();
  });

  // The song search sits beside the song form's artist picker, which ignores
  // accents; the two must agree: «un corazon» finds that artist's songs.
  it("searches titles and artists ignoring accents, case and a trailing space", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/posts")
        ? ok([
            { _id: "s1", title: "Cuán grande es Él", author: "Hillsong", slug: { current: "cuan" } },
            { _id: "s2", title: "Santo", author: "Un Corazón", slug: { current: "santo" } },
          ])
        : ok([]),
    ));
    mountContent();
    await waitFor(() => expect(screen.getByText("Santo")).not.toBeNull());
    const search = screen.getByPlaceholderText("Buscar canción o artista…");

    fireEvent.change(search, { target: { value: "un corazon" } });
    expect(screen.getByText("Santo")).not.toBeNull();
    expect(screen.queryByText("Cuán grande es Él")).toBeNull();

    fireEvent.change(search, { target: { value: "CUAN GRANDE " } });
    expect(screen.getByText("Cuán grande es Él")).not.toBeNull();
    expect(screen.queryByText("Santo")).toBeNull();

    // The trailing space must fall where the match ENDS, or an untrimmed query
    // still matches («cuan grande » is inside «cuan grande es el»).
    fireEvent.change(search, { target: { value: "sánto " } });
    expect(screen.getByText("Santo")).not.toBeNull();
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

  it("a clean inventory is ONE line (bloque 4): the title, the summary and «Recargar», no section", () => {
    const reload = vi.fn();
    const { container } = render(
      <MotionProvider>
        <IntegrityQueuePanel queue={queueFor([])} tone="clean" sources={SOURCES} reload={reload} />
      </MotionProvider>,
    );
    const line = container.querySelector('[data-integrity-compact="clean"]') as HTMLElement;
    expect(line).not.toBeNull();
    // The title is for the screen reader (`sr-only`); the sentence is the line.
    expect(line.textContent).toContain("Integridad de datos");
    expect(line.textContent).toContain("Sin problemas de integridad");
    expect(container.querySelector("section")).toBeNull();
    expect(screen.queryByRole("button", { name: /expanded|▸/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recargar" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the first load is «comprobando», never a flash of the full panel with «?»", () => {
    const loadingSources = { roleTargets: "loading", setlistTargets: "loading", proposals: "loading" } as const;
    const queue = buildIntegrityQueue({ sources: loadingSources, cards: [], roles: null, setlists: null, proposals: null });
    const { container } = render(
      <MotionProvider>
        <IntegrityQueuePanel queue={queue} tone="unknown" loading firstLoad sources={loadingSources} reload={vi.fn()} />
      </MotionProvider>,
    );
    const line = container.querySelector('[data-integrity-compact="checking"]') as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent).toContain("Comprobando los datos");
    expect(container.querySelector("section")).toBeNull();
    expect(screen.queryByText("?")).toBeNull();
    // Nothing to reload while everything is already in flight.
    expect(screen.queryByRole("button", { name: "Recargar" })).toBeNull();
  });

  it("a reload of a clean reading keeps the ✓ line and only makes «Recargar» busy", () => {
    // Entering Servicios reloads on every visit: the hook HOLDS the clean tone,
    // and the line must not read the live (now incomplete) queue beside a ✓.
    const loadingSources = { roleTargets: "loading", setlistTargets: "loading", proposals: "loading" } as const;
    const queue = buildIntegrityQueue({ sources: loadingSources, cards: [], roles: null, setlists: null, proposals: null });
    const { container } = render(
      <MotionProvider>
        <IntegrityQueuePanel queue={queue} tone="clean" loading sources={loadingSources} reload={vi.fn()} />
      </MotionProvider>,
    );
    const line = container.querySelector('[data-integrity-compact="clean"]') as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent).toContain("Sin problemas de integridad");
    expect(line.textContent).not.toContain("incompleto");
    expect(line.textContent).not.toContain("Comprobando");
    const reload = screen.getByRole("button", { name: "Recargando…" });
    expect(reload.getAttribute("aria-busy")).toBe("true");
    expect((reload as HTMLButtonElement).disabled).toBe(true);
  });

  it("a reload of an UNPROVEN reading keeps the full section — only the first load is «comprobando»", () => {
    const loadingSources = { roleTargets: "loading", setlistTargets: "loading", proposals: "loading" } as const;
    const queue = buildIntegrityQueue({ sources: loadingSources, cards: [], roles: null, setlists: null, proposals: null });
    const { container } = render(
      <MotionProvider>
        <IntegrityQueuePanel queue={queue} tone="unknown" loading firstLoad={false} sources={loadingSources} reload={vi.fn()} />
      </MotionProvider>,
    );
    expect(container.querySelector("section")).not.toBeNull();
    expect(container.querySelector("[data-integrity-compact]")).toBeNull();
  });

  it("the clean line's live region is the summary alone — the title and «Recargar» are siblings", () => {
    const { container } = render(
      <MotionProvider>
        <IntegrityQueuePanel queue={queueFor([])} tone="clean" sources={SOURCES} reload={vi.fn()} />
      </MotionProvider>,
    );
    const status = container.querySelector('[data-integrity-compact="clean"] [role="status"]') as HTMLElement;
    expect(status.textContent).toBe("Sin problemas de integridad");
    expect(status.querySelector("button")).toBeNull();
    expect(container.querySelector("#integrity-queue-title")).toBeNull();
  });

  it("an inventory that settled unproven keeps the full section", () => {
    const failed = { roleTargets: "error", setlistTargets: "ready", proposals: "ready" } as const;
    const queue = buildIntegrityQueue({ sources: failed, cards: [], roles: null, setlists: EMPTY_SETLISTS, proposals: EMPTY_PROPOSALS });
    const { container } = render(
      <MotionProvider>
        <IntegrityQueuePanel queue={queue} tone="unknown" loading={false} sources={failed} reload={vi.fn()} />
      </MotionProvider>,
    );
    expect(container.querySelector("section")).not.toBeNull();
    expect(container.querySelector("[data-integrity-compact]")).toBeNull();
    expect(screen.getByText("?")).toBeTruthy();
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
