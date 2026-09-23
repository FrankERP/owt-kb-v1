/** @vitest-environment jsdom */
//
// The song sheet now gets its head from `CueDialog` itself (a real `title`
// prop) instead of drawing its own "Canción" eyebrow + <h2> + close button.
// This pins that there is exactly one heading, that CueDialog's own head
// (`[data-cue-head]`) carries it, and that the dialog's accessible name
// resolves to it.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import SongSheet from "../SongSheet";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";

const closeSheet = vi.fn();
const openSheet = vi.fn();
const closePlayer = vi.fn();
const playTrack = vi.fn();
const togglePlay = vi.fn();
const seek = vi.fn();
const getAudio = vi.fn(() => null);

type Sheet = {
  _id: string;
  title: string;
  author?: string;
  slug: string;
  key?: string;
  bpm?: string;
  timeSig?: string;
};

const BASE: Sheet = {
  _id: "song-1",
  title: "Canción de Prueba",
  author: "Autor de Prueba",
  slug: "cancion-de-prueba",
  key: "G",
};

// Mutable, because the mocked `usePlayer` reads it at render: each test sets the
// sheet it needs (and `null` is the CLOSED sheet, which is how the sheet shuts).
let sheet: Sheet | null = BASE;

// jsdom ships no Web Audio API and the meta row now holds a real `TempoPill`.
// Same fake as `tempoPill.test.tsx` — the smallest context the scheduler touches.
const contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  constructor() {
    contexts.push(this);
  }
  currentTime = 0;
  state = "suspended";
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  suspend = vi.fn(() => Promise.resolve());
  createOscillator() {
    return {
      type: "sine",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createGain() {
    return {
      gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
  }
}

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

beforeEach(() => {
  sheet = BASE;
  contexts.length = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
    expect(headings[0].textContent).toBe(BASE.title);

    const head = document.querySelector("[data-cue-head]");
    expect(head).toBeTruthy();
    expect(head!.textContent).toContain(BASE.title);
  });
});

describe("SongSheet tempo", () => {
  it("clicks the tempo from the meta row, with the sheet's own chrome", () => {
    sheet = { ...BASE, bpm: "120", timeSig: "4/4" };
    render(
      <CueDialogProvider>
        <SongSheet />
      </CueDialogProvider>,
    );

    const pill = screen.getByRole("button", { name: "Marcar tempo con clic, 120 BPM" });
    expect(pill.className).toContain("brand-tempo-pill");
    expect(pill.className).toContain("rounded-full");
    expect(pill.style.getPropertyValue("--tempo-period")).toBe("500ms");

    fireEvent.click(pill);
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    expect(pill.getAttribute("aria-label")).toBe("Detener el clic, 120 BPM");
  });

  it("keeps the static span for a tempo nobody can beat", () => {
    sheet = { ...BASE, bpm: "libre" };
    render(
      <CueDialogProvider>
        <SongSheet />
      </CueDialogProvider>,
    );

    expect(screen.queryByRole("button", { name: /tempo/i })).toBeNull();
    const span = screen.getByText("libre BPM");
    expect(span.className).toContain("min-h-[44px]");
  });

  it("stops the click when the sheet closes", () => {
    vi.useFakeTimers();
    sheet = { ...BASE, bpm: "120", timeSig: "4/4" };
    const { rerender } = render(
      <CueDialogProvider>
        <SongSheet />
      </CueDialogProvider>,
    );

    // The open dialog keeps timers of its own (its reveal), so what is pinned is
    // the DELTA: the click adds a loop, and closing the sheet must give it back.
    const baseline = vi.getTimerCount();
    fireEvent.click(screen.getByRole("button", { name: "Marcar tempo con clic, 120 BPM" }));
    expect(vi.getTimerCount()).toBe(baseline + 1);

    // The sheet shuts: `usePlayer` hands back no song at all.
    sheet = null;
    rerender(
      <CueDialogProvider>
        <SongSheet />
      </CueDialogProvider>,
    );

    expect(screen.queryByRole("button", { name: /BPM/ })).toBeNull();
    expect(vi.getTimerCount()).toBe(baseline);
    // And the sound stopped with the loop, not just the scheduling.
    expect(contexts).toHaveLength(1);
    expect(contexts[0].suspend).toHaveBeenCalledTimes(1);
  });
});
