/** @vitest-environment jsdom */
// The /biblioteca client index (R1 Task 3): A–Z sections, the search console and
// the row's one contract (openSheet). The pure filtering/grouping lives in
// `app/utils/libraryIndex.ts` and is tested there — this file asserts the wiring.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { Post } from "@/app/utils/interface";

installMotionTestEnv();

vi.mock("next/navigation", () => ({
  usePathname: () => "/biblioteca",
}));

const openSheet = vi.fn();
vi.mock("@/app/context/PlayerContext", () => ({ usePlayer: () => ({ openSheet }) }));

import LibraryIndex from "../LibraryIndex";

const post = (id: string, title: string, extra: Partial<Post> = {}): Post =>
  ({ _id: id, title, author: "Oasis", slug: { current: id }, key: "G", bpm: "72", tags: [], ...extra }) as Post;

const POSTS = [post("a1", "Alabaré"), post("b1", "Bueno es Dios")];

function mount() {
  return render(
    <MotionProvider>
      <CueDialogProvider>
        <LibraryIndex posts={POSTS} tags={[]} authors={[]} initial={{ q: "", tags: [], author: "", key: "" }} />
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
