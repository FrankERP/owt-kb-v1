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
