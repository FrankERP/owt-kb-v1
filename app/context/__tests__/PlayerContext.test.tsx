/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerProvider, usePlayer } from "../PlayerContext";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

class MockAudio extends EventTarget {
  src = "";
  duration = 0;
  currentTime = 0;
  pause = vi.fn();
  play = vi.fn(async () => {});
}

beforeEach(() => {
  vi.stubGlobal("Audio", MockAudio);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness() {
  const { openSheet, closeSheet, sheet, sheetLoading, sheetError } = usePlayer();
  return (
    <div>
      <button onClick={() => openSheet("song-a")}>open a</button>
      <button onClick={() => openSheet("song-b")}>open b</button>
      <button onClick={closeSheet}>close</button>
      <span data-testid="state">
        {sheetLoading ? "loading" : sheetError ? "error" : sheet?.title ?? "none"}
      </span>
    </div>
  );
}

function renderHarness() {
  return render(
    <PlayerProvider>
      <Harness />
    </PlayerProvider>,
  );
}

describe("PlayerContext sheet requests", () => {
  it("ignores stale out-of-order sheet responses", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole, getByTestId } = renderHarness();

    fireEvent.click(getByRole("button", { name: "open a" }));
    fireEvent.click(getByRole("button", { name: "open b" }));

    await act(async () => {
      second.resolve({ ok: true, json: async () => ({ _id: "song-b", title: "Song B" }) } as Response);
      await second.promise;
    });
    expect(getByTestId("state").textContent).toBe("Song B");

    await act(async () => {
      first.resolve({ ok: true, json: async () => ({ _id: "song-a", title: "Song A" }) } as Response);
      await first.promise;
    });
    expect(getByTestId("state").textContent).toBe("Song B");
  });

  it("does not reopen the sheet after closing during load", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));

    const { getByRole, getByTestId } = renderHarness();

    fireEvent.click(getByRole("button", { name: "open a" }));
    expect(getByTestId("state").textContent).toBe("loading");
    fireEvent.click(getByRole("button", { name: "close" }));

    await act(async () => {
      pending.resolve({ ok: true, json: async () => ({ _id: "song-a", title: "Song A" }) } as Response);
      await pending.promise;
    });

    expect(getByTestId("state").textContent).toBe("none");
  });
});

describe("PlayerContext runs («Ensayar el setlist»)", () => {
  const track = (n: number) => ({ url: `/api/audio/s${n}/k${n}`, title: "Banda completa", songTitle: `Song ${n}`, songSlug: `s${n}` });
  let audio: MockAudio | null = null;

  beforeEach(() => {
    vi.stubGlobal("Audio", class extends MockAudio {
      constructor() {
        super();
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test holds the provider's one element
        audio = this;
      }
    });
  });

  function RunHarness() {
    const { playQueue, playTrack, skip, closePlayer, queue, player } = usePlayer();
    return (
      <div>
        <button onClick={() => playQueue([track(1), track(2), track(3)])}>run</button>
        <button onClick={() => playTrack(track(9))}>single</button>
        <button onClick={() => skip(1)}>next</button>
        <button onClick={() => skip(-1)}>prev</button>
        <button onClick={() => closePlayer()}>close</button>
        <span data-testid="state">
          {player.track?.songTitle ?? "none"}|{queue ? `${queue.index + 1}/${queue.tracks.length}` : "single"}|{player.isPlaying ? "playing" : "paused"}
        </span>
      </div>
    );
  }

  function renderRun() {
    return render(<PlayerProvider><RunHarness /></PlayerProvider>);
  }

  it("advances by itself on `ended` through the SAME audio element, and stops after the last", async () => {
    const { getByRole, getByTestId } = renderRun();
    fireEvent.click(getByRole("button", { name: "run" }));
    const el = audio!;
    expect(getByTestId("state").textContent).toBe("Song 1|1/3|playing");
    expect(el.src).toBe("/api/audio/s1/k1");

    act(() => { el.dispatchEvent(new Event("ended")); });
    expect(getByTestId("state").textContent).toBe("Song 2|2/3|playing");
    expect(audio).toBe(el);
    expect(el.src).toBe("/api/audio/s2/k2");

    act(() => { el.dispatchEvent(new Event("ended")); });
    act(() => { el.dispatchEvent(new Event("ended")); });
    expect(getByTestId("state").textContent).toBe("Song 3|3/3|paused");
  });

  it("moves on when a mix fails to load mid-run, and closing never advances", () => {
    const { getByRole, getByTestId } = renderRun();
    fireEvent.click(getByRole("button", { name: "run" }));
    act(() => { audio!.dispatchEvent(new Event("error")); });
    expect(getByTestId("state").textContent).toBe("Song 2|2/3|playing");

    fireEvent.click(getByRole("button", { name: "close" }));
    act(() => { audio!.dispatchEvent(new Event("error")); });
    expect(getByTestId("state").textContent).toBe("none|single|paused");
  });

  it("skips forward and back; back restarts a track that has played more than 3 s", () => {
    const { getByRole, getByTestId } = renderRun();
    fireEvent.click(getByRole("button", { name: "run" }));
    fireEvent.click(getByRole("button", { name: "next" }));
    expect(getByTestId("state").textContent).toBe("Song 2|2/3|playing");

    audio!.currentTime = 42;
    fireEvent.click(getByRole("button", { name: "prev" }));
    expect(audio!.currentTime).toBe(0);
    expect(getByTestId("state").textContent).toBe("Song 2|2/3|playing");

    fireEvent.click(getByRole("button", { name: "prev" }));
    expect(getByTestId("state").textContent).toBe("Song 1|1/3|playing");
    fireEvent.click(getByRole("button", { name: "prev" }));
    expect(getByTestId("state").textContent).toBe("Song 1|1/3|playing");
  });

  it("a single track from a song's own list ends the run, and so does closing", () => {
    const { getByRole, getByTestId } = renderRun();
    fireEvent.click(getByRole("button", { name: "run" }));
    fireEvent.click(getByRole("button", { name: "single" }));
    expect(getByTestId("state").textContent).toBe("Song 9|single|playing");
    act(() => { audio!.dispatchEvent(new Event("ended")); });
    expect(getByTestId("state").textContent).toBe("Song 9|single|paused");

    fireEvent.click(getByRole("button", { name: "run" }));
    fireEvent.click(getByRole("button", { name: "close" }));
    expect(getByTestId("state").textContent).toBe("none|single|paused");
  });

  it("shows ▶, not ‖, when the browser refuses to start the audio", async () => {
    const { getByRole, getByTestId } = renderRun();
    audio!.play.mockImplementationOnce(() => Promise.reject(new Error("NotAllowedError")));
    await act(async () => { fireEvent.click(getByRole("button", { name: "run" })); });
    expect(getByTestId("state").textContent).toBe("Song 1|1/3|paused");
  });
});
