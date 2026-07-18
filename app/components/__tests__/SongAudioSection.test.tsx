/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SongAudioSection from "../SongAudioSection";

const playTrack = vi.fn();
const togglePlay = vi.fn();
let player = { track: null as null | { url: string }, isPlaying: false };

vi.mock("@/app/context/PlayerContext", () => ({
  usePlayer: () => ({ playTrack, togglePlay, player }),
}));

afterEach(() => {
  cleanup();
  playTrack.mockReset();
  togglePlay.mockReset();
  player = { track: null, isPlaying: false };
});

describe("SongAudioSection", () => {
  it("gives duplicate-titled tracks singular indexed play and download names", () => {
    const { getByRole } = render(
      <SongAudioSection
        songTitle="Sólo en Jesús"
        songSlug="solo-en-jesus"
        tracks={[
          { title: "Guía", tone: "D", audioFileURL: "https://cdn.test/one.mp3" },
          { title: "Guía", tone: "C", audioFileURL: "https://cdn.test/two.mp3" },
        ]}
      />,
    );

    expect(getByRole("button", { name: "Reproducir Guía 1" })).toBeTruthy();
    expect(getByRole("button", { name: "Reproducir Guía 2" })).toBeTruthy();
    expect(getByRole("link", { name: "Descargar Guía 1" })).toBeTruthy();
    expect(getByRole("link", { name: "Descargar Guía 2" })).toBeTruthy();
  });

  it("names the active track pause action with the same index", () => {
    player = { track: { url: "https://cdn.test/two.mp3" }, isPlaying: true };

    const { getByRole } = render(
      <SongAudioSection
        songTitle="Sólo en Jesús"
        songSlug="solo-en-jesus"
        tracks={[
          { title: "Guía", tone: "D", audioFileURL: "https://cdn.test/one.mp3" },
          { title: "Guía", tone: "C", audioFileURL: "https://cdn.test/two.mp3" },
        ]}
      />,
    );

    expect(getByRole("button", { name: "Pausar Guía 2" })).toBeTruthy();
  });
});
