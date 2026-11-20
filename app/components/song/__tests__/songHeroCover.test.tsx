/** @vitest-environment jsdom */
// The song page's cover (ADR-0088): the picture, and the one thing that makes it a client
// component — the equalizer it wears only while one of THIS song's tracks is playing.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let player: { isPlaying: boolean; track: { songSlug: string } | null } = { isPlaying: false, track: null };
vi.mock("@/app/context/PlayerContext", () => ({ usePlayer: () => ({ player }) }));

import SongHeroCover from "../SongHeroCover";

const SRC = "https://cdn.sanity.io/images/p/d/abc-600x600.jpg?w=640&h=640&fit=crop&fm=jpg";

afterEach(() => {
  cleanup();
  player = { isPlaying: false, track: null };
});

describe("SongHeroCover", () => {
  it("draws the URL it is handed, untouched, as decoration", () => {
    const { container } = render(<SongHeroCover src={SRC} songSlug="nadie" />);
    const img = container.querySelector("img");
    // `unoptimized`: the JPEG `songCoverUrl` sized, never a Next loader URL (the WKWebView rule).
    expect(img?.getAttribute("src")).toBe(SRC);
    expect(img?.getAttribute("alt")).toBe("");
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    // Nothing is playing: no equalizer badge.
    expect(container.querySelector(".absolute.bottom-2")).toBeNull();
  });

  it("wears the equalizer only while one of this song's tracks plays", () => {
    const badge = (c: HTMLElement) => c.querySelector(".absolute.bottom-2");

    player = { isPlaying: true, track: { songSlug: "nadie" } };
    const playing = render(<SongHeroCover src={SRC} songSlug="nadie" />);
    expect(badge(playing.container)).not.toBeNull();
    playing.unmount();

    // Paused on this song: the page is not making a sound.
    player = { isPlaying: false, track: { songSlug: "nadie" } };
    const paused = render(<SongHeroCover src={SRC} songSlug="nadie" />);
    expect(badge(paused.container)).toBeNull();
    paused.unmount();

    // Another song is playing while this page is open.
    player = { isPlaying: true, track: { songSlug: "otra" } };
    const other = render(<SongHeroCover src={SRC} songSlug="nadie" />);
    expect(badge(other.container)).toBeNull();
  });

  it("a cover that fails to load leaves nothing behind — the hero falls back to its text", () => {
    const { container } = render(<SongHeroCover src={SRC} songSlug="nadie" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.firstChild).toBeNull();
  });
});
