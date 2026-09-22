/** @vitest-environment jsdom */
// Behaviour the spec pins (§8.2): one <audio> through PlayerContext, switching
// tracks keeps the position, preselection only highlights, and no URL on the
// page is a cdn.sanity.io URL.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RehearsalMix } from "@/app/utils/interface";
import RehearsalPlayer from "../RehearsalPlayer";
import { TransposeProvider, useTransposeOptional } from "../TransposeProvider";

function Dial({ to }: { to: number }) {
  const t = useTransposeOptional();
  return <button type="button" onClick={() => t?.setSemitones(to)}>dial {to}</button>;
}

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
  _key: "k", kind: "up", tone: "G", sourceHash: "s",
  peaks: [0, 255], active: [{ _key: "a0", s: 0, e: 1 }], ...over,
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

  it("cancels a pending position restore before registering the next one", () => {
    // A -> B -> C before B's loadedmetadata ever fires: the restore queued for
    // A's position must be cancelled, or it would fire (stale) alongside C's
    // restore on C's loadedmetadata.
    player = { track: { url: "/api/audio/post-1/eg1" }, isPlaying: true };
    audio.currentTime = 42;
    const { getByRole } = render(<RehearsalPlayer {...props} />);

    fireEvent.click(getByRole("button", { name: "Reproducir Bass" }));
    const onceCallsAfterFirst = audio.addEventListener.mock.calls.filter((c) => c[2]?.once === true);
    expect(onceCallsAfterFirst).toHaveLength(1);
    const [, firstHandler] = onceCallsAfterFirst[0];

    audio.currentTime = 3;
    fireEvent.click(getByRole("button", { name: "Reproducir Banda completa" }));

    expect(audio.removeEventListener).toHaveBeenCalledWith("loadedmetadata", firstHandler);

    const onceCallsAfterSecond = audio.addEventListener.mock.calls.filter((c) => c[2]?.once === true);
    expect(onceCallsAfterSecond).toHaveLength(2);
    const [, secondHandler] = onceCallsAfterSecond[1];

    audio.currentTime = 0;
    (secondHandler as () => void)();
    expect(audio.currentTime).toBe(3);
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

  describe("the hero dial picks the key", () => {
    const twoKeys = [
      ...mixes,
      mix({ _key: "full-ab", kind: "full", tone: "Ab", peaks: undefined, active: undefined }),
      mix({ _key: "eg1-ab", track: "EG 1", family: "electric", tone: "Ab" }),
    ];
    const inKey = (semis: number) => render(
      <TransposeProvider nativeKey="G">
        <Dial to={semis} />
        <RehearsalPlayer {...props} mixes={twoKeys} preselect={["EG"]} />
      </TransposeProvider>,
    );

    it("shows the sounding key's rows only, says which keys exist, and preselects inside them", () => {
      const { getByRole, queryByRole, getByText } = inKey(1);
      expect(getByRole("listitem", { name: "EG 1" }).getAttribute("aria-current")).toBe("true");
      expect(queryByRole("listitem", { name: "Bass" })).toBeTruthy();
      expect(getByText(/Tono G · hay mixes en G, Ab/)).toBeTruthy();
      fireEvent.click(getByRole("button", { name: "dial 1" }));
      expect(queryByRole("listitem", { name: "Bass" })).toBeNull();
      expect(getByRole("listitem", { name: "EG 1" }).getAttribute("aria-current")).toBe("true");
      fireEvent.click(getByRole("button", { name: "Reproducir EG 1" }));
      expect(playTrack).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/audio/post-1/eg1-ab", tone: "Ab" }));
    });

    it("falls back to the nearest key and says so", () => {
      const { getByRole, getByText } = inKey(4);
      fireEvent.click(getByRole("button", { name: "dial 4" }));
      expect(getByText(/No hay mix en B — se muestra Ab/)).toBeTruthy();
      expect(getByRole("listitem", { name: "EG 1" })).toBeTruthy();
    });

    it("carries the PLAYING track into the new key at the same position, and leaves a paused one alone", () => {
      player = { track: { url: "/api/audio/post-1/eg1" }, isPlaying: true };
      audio.currentTime = 30;
      const { getByRole } = inKey(1);
      fireEvent.click(getByRole("button", { name: "dial 1" }));
      expect(playTrack).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/audio/post-1/eg1-ab" }));
      const call = audio.addEventListener.mock.calls.find((c) => c[2]?.once === true);
      expect(call?.[0]).toBe("loadedmetadata");
      cleanup(); playTrack.mockReset();
      player = { track: { url: "/api/audio/post-1/bass" }, isPlaying: false };
      const paused = inKey(1);
      fireEvent.click(paused.getByRole("button", { name: "dial 1" }));
      expect(playTrack).not.toHaveBeenCalled();
    });

    it("shows every key's rows outside a provider (the gallery fixture)", () => {
      const { getAllByRole } = render(<RehearsalPlayer {...props} mixes={twoKeys} />);
      expect(getAllByRole("listitem", { name: "EG 1" })).toHaveLength(2);
    });
  });
});
