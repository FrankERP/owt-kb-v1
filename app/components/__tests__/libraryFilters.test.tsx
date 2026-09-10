/** @vitest-environment jsdom */
// The /biblioteca filter drawer (R1 Task 4): Tipo tiles, theme chips, Artista
// and Tonalidad selects, and the trigger's own count badge.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { Author, Tag } from "@/app/utils/interface";
import type { LibraryFilters as F } from "@/app/utils/libraryIndex";
import LibraryFilters from "../LibraryFilters";

installMotionTestEnv();
afterEach(cleanup);

const tag = (slug: string, name: string, postCount = 1): Tag => ({
  _id: slug,
  name,
  slug: { current: slug },
  postCount,
});
const author = (slug: string, name: string): Author => ({ _id: slug, name, slug: { current: slug } });

const TAGS: Tag[] = [
  tag("up-beat", "Up beat", 8),
  tag("down-beat", "Down beat", 4),
  tag("transition", "Transición", 2),
  tag("alabanza", "Alabanza", 10),
  tag("adoracion", "Adoración", 3),
];
const AUTHORS: Author[] = [author("hillsong", "Hillsong"), author("elevation", "Elevation")];
const KEYS = ["C", "D", "G"];

const EMPTY: F = { q: "", tags: [], author: "", key: "" };

function mount(filters: F = EMPTY, onChange = vi.fn()) {
  render(
    <MotionProvider>
      <CueDialogProvider>
        <LibraryFilters filters={filters} onChange={onChange} tags={TAGS} authors={AUTHORS} keys={KEYS} />
      </CueDialogProvider>
    </MotionProvider>,
  );
  return onChange;
}

function openDrawer() {
  fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
}

describe("LibraryFilters", () => {
  it("opening the drawer shows the three Tipo options and the theme chips", () => {
    mount();
    openDrawer();

    const tipoGroup = screen.getByRole("radiogroup", { name: "Tipo de canción" });
    expect(within(tipoGroup).getAllByRole("radio")).toHaveLength(4); // Todos + three Tipos

    expect(screen.getByRole("button", { name: /Alabanza/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Adoración/ })).toBeDefined();
  });

  it("choosing a Tipo calls onChange with that slug added and a previous Tipo removed", () => {
    const onChange = mount({ ...EMPTY, tags: ["down-beat"] });
    openDrawer();

    const tipoGroup = screen.getByRole("radiogroup", { name: "Tipo de canción" });
    const upBeat = within(tipoGroup)
      .getAllByRole("radio")
      .find((el) => el.textContent?.includes("Up beat"));
    expect(upBeat).toBeDefined();
    fireEvent.click(upBeat!);

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, tags: ["up-beat"] });
  });

  it("«Todos» clears the Tipo and leaves the theme tags alone", () => {
    const onChange = mount({ ...EMPTY, tags: ["down-beat", "alabanza"] });
    openDrawer();

    const tipoGroup = screen.getByRole("radiogroup", { name: "Tipo de canción" });
    const todos = within(tipoGroup).getAllByRole("radio").find((el) => el.textContent?.includes("Todos"));
    fireEvent.click(todos!);

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, tags: ["alabanza"] });
  });

  it("the Artista select lists authors", () => {
    mount();
    openDrawer();

    const select = screen.getByLabelText("Artista") as HTMLSelectElement;
    const labels = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels).toEqual(["Todos", "Hillsong", "Elevation"]);
  });

  it("the count badge on the trigger reads Filtros · 2 for two active filters", () => {
    mount({ ...EMPTY, tags: ["alabanza"], author: "hillsong" });
    expect(screen.getByRole("button", { name: "Filtros · 2" })).toBeDefined();
  });
});
