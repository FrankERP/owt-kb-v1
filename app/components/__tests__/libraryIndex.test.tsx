/** @vitest-environment jsdom */
// The /biblioteca client index (R1 Task 3): A–Z sections, the search console and
// the row's one contract (openSheet). The pure filtering/grouping lives in
// `app/utils/libraryIndex.ts` and is tested there — this file asserts the wiring.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { ToastProvider } from "@/app/components/ui/Toast";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { Post } from "@/app/utils/interface";

installMotionTestEnv();

vi.mock("next/navigation", () => ({
  usePathname: () => "/biblioteca",
}));

const openSheet = vi.fn();
vi.mock("@/app/context/PlayerContext", () => ({ usePlayer: () => ({ openSheet }) }));

import LibraryIndex from "../LibraryIndex";

beforeAll(async () => {
  await import("@/app/components/ui/motionFeatures");
});

const post = (id: string, title: string, extra: Partial<Post> = {}): Post =>
  ({ _id: id, title, author: "Oasis", slug: { current: id }, key: "G", bpm: "72", tags: [], ...extra }) as Post;

const POSTS = [post("a1", "Alabaré"), post("b1", "Bueno es Dios")];

function mount() {
  return render(
    <MotionProvider>
      <CueDialogProvider>
        {/* R7: the page's «Copiar enlace» quick action reports itself through the
            global toast stack, which `Provider` mounts in the app. */}
        <ToastProvider>
          <LibraryIndex posts={POSTS} tags={[]} authors={[]} initial={{ q: "", tags: [], author: "", key: "" }} />
        </ToastProvider>
      </CueDialogProvider>
    </MotionProvider>,
  );
}

afterEach(() => {
  cleanup();
  openSheet.mockReset();
});

describe("LibraryIndex", () => {
  it("groups the catalogue under its letter headings", () => {
    mount();
    expect(screen.getByRole("heading", { name: "A" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "B" })).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("carries the ONE count of the surface in the search placeholder", () => {
    mount();
    expect(screen.getByPlaceholderText("Buscar entre 2 canciones")).toBeDefined();
  });

  it("narrows to the matching row on a query, and offers Limpiar", () => {
    mount();
    fireEvent.change(screen.getByLabelText(/Buscar canciones/), { target: { value: "ala" } });
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Alabaré");
    expect(screen.getByText("1 resultado")).toBeDefined();
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeDefined();
    // A query orders by relevance, so the letter sections give way to one list.
    expect(screen.queryByRole("heading", { name: "A" })).toBeNull();
  });

  it("Limpiar restores the whole catalogue", () => {
    mount();
    fireEvent.change(screen.getByLabelText(/Buscar canciones/), { target: { value: "ala" } });
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Limpiar" })).toBeNull();
  });

  it("a row opens the song sheet with its id — the row's whole contract", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Alabaré/ }));
    expect(openSheet).toHaveBeenCalledWith("a1");
  });

  it("hands the rail the letter whose section the observer reports in view (F3)", () => {
    // jsdom has no IntersectionObserver and no layout, so the observer is stubbed
    // down to its one contract: it hands the index a set of entries. The rail's
    // own scrub/tap behaviour is `libraryLetterRail.test.tsx`.
    let fire: ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | null = null;
    const observed: Element[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (e: Array<{ target: Element; isIntersecting: boolean }>) => void) {
          fire = cb;
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect() {}
      },
    );
    mount();
    // Both headings are observed, and nothing is current until one is in view.
    expect(observed.map((el) => el.id)).toEqual(["letra-A", "letra-B"]);
    expect(screen.getAllByRole("button", { name: /^Ir a la letra/ }).map((b) => b.getAttribute("aria-current")))
      .toEqual([null, null]);

    act(() => fire!([{ target: observed[1], isIntersecting: true }]));
    expect(screen.getByRole("button", { name: "Ir a la letra B" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Ir a la letra A" }).getAttribute("aria-current")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("mirrors the query into the URL with history.replaceState — no server round-trip, no history growth", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    mount();
    expect(replaceState).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Buscar canciones/), { target: { value: "ala" } });
    expect(replaceState).toHaveBeenCalledWith(window.history.state, "", "/biblioteca?q=ala");
    replaceState.mockRestore();
  });
});

// The quick-actions sheet moved here from `libraryRow.test.tsx` in the R7 fix wave:
// the page owns ONE sheet, because a mounted `QuickActions` subscribes to the
// CueDialog layer context and ~140 of them re-rendered every row on any dialog
// open or close. The row's own half of the contract is `libraryRow.test.tsx`.
describe("LibraryIndex quick actions", () => {
  function longPress(el: Element) {
    fireEvent.pointerDown(el, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(450); });
    fireEvent.pointerUp(el, { isPrimary: true });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a long press on a row opens the ONE sheet, titled with that song", () => {
    vi.useFakeTimers();
    mount();
    const row = screen.getByRole("button", { name: /Alabaré/ });
    longPress(row);
    fireEvent.click(row);
    expect(openSheet).not.toHaveBeenCalled();
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].textContent).toContain("Alabaré");
    expect(dialogs[0].textContent).toContain("Oasis");
  });

  it("«Abrir» opens the song sheet for the pressed row", () => {
    vi.useFakeTimers();
    mount();
    longPress(screen.getByRole("button", { name: /Bueno es Dios/ }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(openSheet).toHaveBeenCalledWith("b1");
  });

  it("«Copiar enlace» writes the song URL and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.useFakeTimers();
    mount();
    longPress(screen.getByRole("button", { name: /Alabaré/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/posts/a1`);
    vi.useRealTimers();
    await waitFor(() => expect(screen.getAllByText("Enlace copiado").length).toBeGreaterThan(0));
  });

  it("a clipboard failure says so instead of claiming success", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.useFakeTimers();
    mount();
    longPress(screen.getByRole("button", { name: /Alabaré/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
    vi.useRealTimers();
    await waitFor(() => expect(screen.getAllByText("No se pudo copiar").length).toBeGreaterThan(0));
  });
});
