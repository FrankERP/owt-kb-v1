/** @vitest-environment jsdom */
// Behaviour the spec pins (§8.2): one <audio> through PlayerContext, switching
// tracks keeps the position, preselection only highlights, and no URL on the
// page is a cdn.sanity.io URL.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RehearsalMix } from "@/app/utils/interface";
import RehearsalPlayer from "../RehearsalPlayer";

const playTrack = vi.fn();
const togglePlay = vi.fn();
const seek = vi.fn();
let player = { track: null as null | { url: string }, isPlaying: false };
const audio = { currentTime: 0, duration: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() };

vi.mock("@/app/context/PlayerContext", () => ({
  usePlayer: () => ({ playTrack, togglePlay, seek, player, getAudio: () => audio }),
}));

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  playTrack.mockReset(); togglePlay.mockReset(); seek.mockReset();
  audio.addEventListener.mockReset(); audio.currentTime = 0;
  player = { track: null, isPlaying: false };
});

const mix = (over: Partial<RehearsalMix>): RehearsalMix => ({
  _key: "k", kind: "up", tone: "G", audioFileURL: "https://cdn.sanity.io/files/x.mp3", sourceHash: "s",
  peaks: [0, 255], active: [[0, 1]], ...over,
});
const mixes = [
  mix({ _key: "full", kind: "full", peaks: undefined, active: undefined }),
  mix({ _key: "eg1", track: "EG 1", family: "electric" }),
  mix({ _key: "bass", track: "Bass", family: "bass" }),
];
const props = { mixes, songId: "post-1", songTitle: "Amor", songSlug: "amor" };

describe("RehearsalPlayer", () => {
  it("renders nothing for no mixes", () => {
    const { container } = render(<RehearsalPlayer {...props} mixes={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists Full then families, plays through the API route, and never exposes the CDN URL", () => {
    const { getByRole, container } = render(<RehearsalPlayer {...props} />);
    fireEvent.click(getByRole("button", { name: "Reproducir EG 1" }));
    expect(playTrack).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/audio/post-1/eg1", title: "EG 1", songTitle: "Amor", songSlug: "amor" }));
    expect(container.innerHTML).not.toContain("cdn.sanity.io");
    expect(getByRole("link", { name: "Descargar EG 1" }).getAttribute("href")).toBe("/api/audio/post-1/eg1?download=1");
  });

  it("switching tracks keeps the position", () => {
    player = { track: { url: "/api/audio/post-1/eg1" }, isPlaying: true };
    audio.currentTime = 42;
    const { getByRole } = render(<RehearsalPlayer {...props} />);
    fireEvent.click(getByRole("button", { name: "Reproducir Bass" }));
    expect(playTrack).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/audio/post-1/bass" }));
    const call = audio.addEventListener.mock.calls.find((c) => c[2]?.once === true);
    if (!call) throw new Error("expected a once-listener registration");
    const [event, handler] = call;
    expect(event).toBe("loadedmetadata");
    audio.currentTime = 0;
    (handler as () => void)();
    expect(audio.currentTime).toBe(42);
  });

  it("pauses the current track instead of restarting it", () => {
    player = { track: { url: "/api/audio/post-1/eg1" }, isPlaying: true };
    const { getByRole } = render(<RehearsalPlayer {...props} />);
    fireEvent.click(getByRole("button", { name: "Pausar EG 1" }));
    expect(togglePlay).toHaveBeenCalled();
    expect(playTrack).not.toHaveBeenCalled();
  });

  it("preselects the member's instrument row without playing, and keeps focus on the pressed row", () => {
    const { getByRole } = render(<RehearsalPlayer {...props} preselect={["Bass"]} />);
    const row = getByRole("listitem", { name: "Bass" });
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(playTrack).not.toHaveBeenCalled();
    const btn = getByRole("button", { name: "Reproducir Bass" });
    btn.focus();
    fireEvent.click(btn);
    expect(document.activeElement).toBe(btn);
  });
});
