/** @vitest-environment jsdom */
// The song editor's fields accept typing.
//
// This file exists because of what the 2026-09-13 audit found: `EditSongButton`
// has the same shape as the two surfaces that were actually broken — it renders a
// `CueDialog` with an inline `onDismiss`, and the state being typed (`form`,
// `tagSearch`, `authorSearch`) is declared in the component that renders it. So
// every keystroke re-rendered the dialog's owner. Before the `CueDialog` fix, the
// caret left the field after one character; on a phone the keyboard closed with
// it.
//
// It was the ONE confirmed-by-structure surface with no test file at all, which
// is the reason it is a separate file rather than two lines added somewhere: the
// gap was the coverage, not the assertion.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CueDialogProvider } from "../ui/CueDialogProvider";
import { MotionProvider } from "../ui/MotionProvider";
import { ToastProvider } from "../ui/Toast";
import { installMotionTestEnv } from "../ui/__tests__/motionTestSetup";
import type { Post } from "@/app/utils/interface";
import EditSongButton from "../EditSongButton";

installMotionTestEnv();

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "admin" } }, status: "authenticated" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const POST: Post = {
  _id: "song-1",
  title: "Cuán grande es Él",
  author: "Hillsong",
  slug: { current: "cuan-grande-es-el" },
  publishDate: "2026-01-01",
  excerpt: "",
  timeSig: "4/4",
  bpm: "72",
  key: "G",
  body: [],
  tutorials2: [],
  lyricsURL: "",
  audioTracks: [],
  chordsPDF: [],
  tags: [],
};

function openEditor() {
  const utils = render(
    <MotionProvider>
      <ToastProvider>
        <CueDialogProvider>
          <EditSongButton post={POST} />
        </CueDialogProvider>
      </ToastProvider>
    </MotionProvider>,
  );
  act(() => { fireEvent.click(screen.getByRole("button", { name: /Editar canción/i })); });
  return utils;
}

describe("EditSongButton keeps the caret where the editor is typing", () => {
  beforeEach(() => {
    // The dialog loads tags and authors when it opens; neither is under test.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
  });

  it("types a whole word into Título without losing focus", () => {
    openEditor();
    const title = document.querySelector<HTMLInputElement>('input[id$="-title"]')!;
    act(() => title.focus());

    for (const char of ["S", "a", "n", "t", "o"]) {
      act(() => { fireEvent.change(title, { target: { value: title.value + char } }); });
      expect(
        document.activeElement,
        "focus left Título mid-word — on iOS that closes the keyboard",
      ).toBe(title);
    }
    expect(title.value).toBe("Cuán grande es ÉlSanto");
  });

  it("types into the artist search without losing focus", () => {
    openEditor();
    const search = document.querySelector<HTMLInputElement>('input[id$="-author-search"]')!;
    act(() => search.focus());

    for (const char of ["h", "i", "l", "l"]) {
      act(() => { fireEvent.change(search, { target: { value: search.value + char } }); });
      expect(document.activeElement).toBe(search);
    }
    expect(search.value).toBe("hill");
  });
});
describe("EditSongButton repeatable rows are keyed by identity, not position", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
  });

  it("keeps the caret on the SAME link when a row above it is deleted (issue #69)", () => {
    openEditor();
    const add = screen.getByRole("button", { name: "Agregar link de referencia" });
    act(() => { fireEvent.click(add); fireEvent.click(add); fireEvent.click(add); });

    const labelOf = (n: number) =>
      screen.getByLabelText(`Etiqueta del link de referencia ${n}`) as HTMLInputElement;
    act(() => { fireEvent.change(labelOf(1), { target: { value: "primero" } }); });
    act(() => { fireEvent.change(labelOf(2), { target: { value: "segundo" } }); });
    act(() => { fireEvent.change(labelOf(3), { target: { value: "tercero" } }); });

    // Put the caret in the THIRD row, then delete the SECOND.
    const third = labelOf(3);
    act(() => third.focus());
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Eliminar link de referencia 2" })); });

    // Keyed by position, React would have reused the second row's DOM node for
    // "tercero" and the focused node would now hold a different link. Keyed by
    // identity, the node the member was in is still theirs.
    expect(document.activeElement).toBe(third);
    expect((document.activeElement as HTMLInputElement).value).toBe("tercero");
    expect(labelOf(1).value).toBe("primero");
    expect(labelOf(2).value).toBe("tercero");
    expect(screen.queryByDisplayValue("segundo")).toBeNull();
  });

  it("does the same for tutorials", () => {
    openEditor();
    const add = screen.getByRole("button", { name: "Agregar tutorial" });
    act(() => { fireEvent.click(add); fireEvent.click(add); });
    const t1 = screen.getByLabelText("Título del tutorial 1") as HTMLInputElement;
    const t2 = screen.getByLabelText("Título del tutorial 2") as HTMLInputElement;
    act(() => { fireEvent.change(t1, { target: { value: "teclado" } }); });
    act(() => { fireEvent.change(t2, { target: { value: "bateria" } }); });

    act(() => t2.focus());
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Eliminar tutorial 1" })); });

    expect(document.activeElement).toBe(t2);
    expect((document.activeElement as HTMLInputElement).value).toBe("bateria");
  });
});
