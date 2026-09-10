/** @vitest-environment jsdom */
//
// The song sheet now gets its head from `CueDialog` itself (a real `title`
// prop) instead of drawing its own "Canción" eyebrow + <h2> + close button.
// This pins that there is exactly one heading, that CueDialog's own head
// (`[data-cue-head]`) carries it, and that the dialog's accessible name
// resolves to it.
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import SongSheet from "../SongSheet";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";

const closeSheet = vi.fn();
const openSheet = vi.fn();
const closePlayer = vi.fn();
const playTrack = vi.fn();
const togglePlay = vi.fn();
const seek = vi.fn();
const getAudio = vi.fn(() => null);

const sheet = {
  _id: "song-1",
  title: "Canción de Prueba",
  author: "Autor de Prueba",
  slug: "cancion-de-prueba",
  key: "G",
};

vi.mock("@/app/context/PlayerContext", () => ({
  usePlayer: () => ({
    sheet,
    sheetLoading: false,
    sheetError: false,
    sheetPlayKey: null,
    closeSheet,
    openSheet,
    playTrack,
    togglePlay,
    closePlayer,
    seek,
    getAudio,
    audioReady: false,
    player: { track: null, isPlaying: false },
  }),
}));

afterEach(() => cleanup());

describe("SongSheet head", () => {
  it("is a dialog named after the song, with one heading drawn by CueDialog's own head", () => {
    render(
      <CueDialogProvider>
        <SongSheet />
      </CueDialogProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: /Canción/ });
    expect(dialog).toBeTruthy();

    const headings = document.querySelectorAll("h2");
    expect(headings.length).toBe(1);
    expect(headings[0].textContent).toBe(sheet.title);

    const head = document.querySelector("[data-cue-head]");
    expect(head).toBeTruthy();
    expect(head!.textContent).toContain(sheet.title);
  });
});
