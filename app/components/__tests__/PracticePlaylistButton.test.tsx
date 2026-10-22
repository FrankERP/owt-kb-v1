/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "../ui/__tests__/motionTestSetup";
import { MotionProvider } from "../ui/MotionProvider";
import { ToastProvider } from "../ui/Toast";
import PracticePlaylistButton from "../PracticePlaylistButton";
import type { QueueSong } from "@/app/utils/rehearsalQueue";

installMotionTestEnv();

const playQueue = vi.fn();
vi.mock("@/app/context/PlayerContext", () => ({ usePlayer: () => ({ playQueue }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  playQueue.mockReset();
});

const song = (id: string, title = id, play_key = "D"): QueueSong => ({ _id: id, title, slug: { current: id }, play_key });

function renderButton({ songIds, ...props }: { songIds: string[]; accentVar: string; variant?: "inline" | "hero"; mySeat?: string | null }) {
  return render(
    <MotionProvider>
      <ToastProvider>
        <PracticePlaylistButton songs={songIds.map((id) => song(id))} {...props} />
      </ToastProvider>
    </MotionProvider>,
  );
}

/** Routes the component's two reads: the mixes (opened menus prefetch them) and the YouTube playlist. */
function routedFetch(handlers: { mixes?: () => Promise<unknown>; playlist?: () => Promise<unknown> }) {
  return vi.fn((url: string) => {
    if (url === "/api/rehearsal-queue") return handlers.mixes ? handlers.mixes() : new Promise(() => {});
    if (url === "/api/practice-playlist") return handlers.playlist ? handlers.playlist() : new Promise(() => {});
    throw new Error(`unexpected ${url}`);
  });
}

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakePopup() {
  return {
    opener: {},
    location: { href: "about:blank" },
    close: vi.fn(),
  } as unknown as Window;
}

describe("PracticePlaylistButton", () => {
  it("uses menu semantics and closes on Escape without reaching outer handlers", async () => {
    const outerEscape = vi.fn();
    window.addEventListener("keydown", outerEscape);

    const { getByRole, queryByText } = renderButton({ songIds: ["song-1"], accentVar: "--accent-rgb" });
    // Flush MotionProvider's async feature chunk (ADR-0031) before the exit under
    // test starts — see Menu.test.tsx.
    await act(async () => {});

    const trigger = getByRole("button", { name: /Practicar/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(getByRole("menuitem", { name: /Banda completa/i })).toBeTruthy();

    fireEvent.keyDown(getByRole("menuitem", { name: /Banda completa/i }), { key: "Escape" });
    await waitFor(() => expect(queryByText("multitracks en orden")).toBeNull());
    expect(outerEscape).not.toHaveBeenCalled();

    window.removeEventListener("keydown", outerEscape);
  });

  it("reserves a popup before fetch resolves, posts the exact body, and navigates on success", async () => {
    const popup = fakePopup();
    const open = vi.fn(() => popup);
    const pendingFetch = deferred<{ ok: boolean; json: () => Promise<{ url: string }> }>();
    const fetch = routedFetch({ playlist: () => pendingFetch.promise });
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", fetch);

    const { getByRole } = renderButton({ songIds: ["song-1", "song-2"], accentVar: "--accent-rgb" });
    await act(async () => {});

    fireEvent.click(getByRole("button", { name: /Practicar/i }));
    fireEvent.click(getByRole("menuitem", { name: /Referencia/i }));

    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(fetch).toHaveBeenCalledWith("/api/practice-playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["song-1", "song-2"], mode: "musica" }),
    });
    expect((popup as any).opener).toBeNull();
    expect((popup as any).location.href).toBe("about:blank");

    await act(async () => {
      pendingFetch.resolve({
        ok: true,
        json: async () => ({ url: "https://youtube.com/watch_videos?video_ids=abc" }),
      });
      await pendingFetch.promise;
    });

    expect((popup as any).location.href).toBe("https://youtube.com/watch_videos?video_ids=abc");
  });

  it("restores focus to the trigger once the fetch resolves, even though Menu clones its own ref onto it", async () => {
    const popup = fakePopup();
    vi.stubGlobal("open", vi.fn(() => popup));
    const pendingFetch = deferred<{ ok: boolean; json: () => Promise<{ url: string }> }>();
    vi.stubGlobal("fetch", routedFetch({ playlist: () => pendingFetch.promise }));

    const { getByRole } = renderButton({ songIds: ["song-1"], accentVar: "--accent-rgb" });
    await act(async () => {});

    const trigger = getByRole("button", { name: /Practicar/i });
    fireEvent.click(trigger);
    fireEvent.click(getByRole("menuitem", { name: /Referencia/i }));

    await act(async () => {
      pendingFetch.resolve({ ok: true, json: async () => ({ url: "https://youtube.com/watch_videos?video_ids=abc" }) });
      await pendingFetch.promise;
    });

    await waitFor(() => expect(document.activeElement).toBe(getByRole("button", { name: /Practicar/i })));
  });

  it("restores focus to the trigger when the popup is blocked", async () => {
    vi.stubGlobal("open", vi.fn(() => null));
    vi.stubGlobal("fetch", routedFetch({}));

    const { getByRole } = renderButton({ songIds: ["song-1"], accentVar: "--accent-rgb" });
    await act(async () => {});

    const trigger = getByRole("button", { name: /Practicar/i });
    fireEvent.click(trigger);
    fireEvent.click(getByRole("menuitem", { name: /Referencia/i }));

    await waitFor(() => expect(document.activeElement).toBe(getByRole("button", { name: /Permitir popup/i })));
  });

  it("keeps the pending trigger focusable and blocks duplicate click, Enter, and Space activations", async () => {
    const popup = fakePopup();
    const open = vi.fn(() => popup);
    const pendingFetch = deferred<{ ok: boolean; json: () => Promise<{ url: string }> }>();
    const fetch = routedFetch({ playlist: () => pendingFetch.promise });
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", fetch);

    const { getByRole } = renderButton({ songIds: ["song-1"], accentVar: "--accent-rgb" });
    await act(async () => {});

    const trigger = getByRole("button", { name: /Practicar/i });
    fireEvent.click(trigger);
    fireEvent.click(getByRole("menuitem", { name: /Video con letra/i }));

    expect(getByRole("button", { name: /Abriendo/i }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(getByRole("button", { name: /Abriendo/i }));
    fireEvent.keyDown(getByRole("button", { name: /Abriendo/i }), { key: "Enter" });
    fireEvent.keyDown(getByRole("button", { name: /Abriendo/i }), { key: " " });

    expect(open).toHaveBeenCalledTimes(1);
    // One playlist read; the other call is the mixes prefetch the opened menu started.
    expect(fetch.mock.calls.filter(([url]) => url === "/api/practice-playlist")).toHaveLength(1);
  });

  it("closes the reserved popup and reports a retryable local error on failure", async () => {
    const popup = fakePopup();
    vi.stubGlobal("open", vi.fn(() => popup));
    vi.stubGlobal("fetch", routedFetch({ playlist: async () => ({ ok: false, json: async () => ({}) }) }));

    const { getByRole, findByText } = renderButton({ songIds: ["song-1"], accentVar: "--accent-rgb" });
    await act(async () => {});

    fireEvent.click(getByRole("button", { name: /Practicar/i }));
    fireEvent.click(getByRole("menuitem", { name: /Referencia/i }));

    expect(await findByText(/No se pudo crear la playlist/)).toBeTruthy();
    expect((popup as any).close).toHaveBeenCalled();
  });

  it("as the hero, is the screen's one filled CTA labelled Ensayar and opens the same menu", async () => {
    vi.stubGlobal("fetch", routedFetch({}));
    const { getByRole } = renderButton({ songIds: ["song-1"], accentVar: "--accent-rgb", variant: "hero" });
    await act(async () => {});

    const trigger = getByRole("button", { name: /Ensayar/i });
    // The `cta` button, full width (the Inicio redesign, 2026-10-21), not the
    // accent pill: the variant is chrome only, so the menu behind it must be the
    // same one.
    expect(trigger.className).toContain("bg-accent");
    expect(trigger.className).toContain("w-full");
    expect(trigger.textContent).toContain("Ensayar el setlist");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");

    fireEvent.click(trigger);
    expect(getByRole("menuitem", { name: /Banda completa/i })).toBeTruthy();
    expect(getByRole("menuitem", { name: /Video con letra/i })).toBeTruthy();
    expect(getByRole("menuitem", { name: /Referencia/i })).toBeTruthy();
  });

  describe("multitracks", () => {
    const MIXES = {
      a: [
        { _key: "a-full-d", kind: "full", tone: "D" },
        { _key: "a-eg-d", kind: "up", family: "electric", track: "EG 1", tone: "D" },
      ],
      b: [],
      c: [{ _key: "c-full-eb", kind: "full", tone: "Eb" }],
    };

    function renderSet(mySeat?: string) {
      return render(
        <MotionProvider>
          <ToastProvider>
            <PracticePlaylistButton
              songs={[song("a", "Nadie"), song("b", "Lavado"), song("c", "En Aquella Cruz")]}
              mySeat={mySeat}
              accentVar="--accent-rgb"
              variant="hero"
            />
          </ToastProvider>
        </MotionProvider>,
      );
    }

    it("plays the set's full-band mixes in order through the player and names the song it skips", async () => {
      const fetch = routedFetch({ mixes: () => okJson({ mixes: MIXES }) });
      vi.stubGlobal("fetch", fetch);
      const { getByRole, findByText } = renderSet();
      await act(async () => {});

      fireEvent.click(getByRole("button", { name: /Ensayar/i }));
      expect(fetch).toHaveBeenCalledWith("/api/rehearsal-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["a", "b", "c"] }),
      });
      fireEvent.click(getByRole("menuitem", { name: /Banda completa/i }));

      await waitFor(() => expect(playQueue).toHaveBeenCalledTimes(1));
      const tracks = playQueue.mock.calls[0][0] as { url: string; songTitle: string; title: string }[];
      expect(tracks.map((t) => t.url)).toEqual(["/api/audio/a/a-full-d", "/api/audio/c/c-full-eb"]);
      expect(tracks.map((t) => t.songTitle)).toEqual(["Nadie", "En Aquella Cruz"]);
      expect(tracks.every((t) => !t.url.includes("cdn.sanity.io"))).toBe(true);
      expect(await findByText(/se salta: Lavado/)).toBeTruthy();
    });

    it("starts the run inside the tap once the menu's prefetch has landed (iOS needs the gesture)", async () => {
      vi.stubGlobal("fetch", routedFetch({ mixes: () => okJson({ mixes: MIXES }) }));
      const { getByRole } = renderSet();
      await act(async () => {});

      fireEvent.click(getByRole("button", { name: /Ensayar/i }));
      await act(async () => {});
      fireEvent.click(getByRole("menuitem", { name: /Banda completa/i }));
      // Synchronously — no await between the tap and the play.
      expect(playQueue).toHaveBeenCalledTimes(1);
    });

    it("offers the viewer's seat «al frente» and falls back to the full band where it has no mix", async () => {
      vi.stubGlobal("fetch", routedFetch({ mixes: () => okJson({ mixes: MIXES }) }));
      const { getByRole } = renderSet("EG");
      await act(async () => {});

      fireEvent.click(getByRole("button", { name: /Ensayar/i }));
      fireEvent.click(getByRole("menuitem", { name: /Guitarra eléctrica/i }));

      await waitFor(() => expect(playQueue).toHaveBeenCalledTimes(1));
      const tracks = playQueue.mock.calls[0][0] as { url: string }[];
      expect(tracks.map((t) => t.url)).toEqual(["/api/audio/a/a-eg-d", "/api/audio/c/c-full-eb"]);
    });

    it("has no instrument choice for a viewer with no instrument seat", async () => {
      vi.stubGlobal("fetch", routedFetch({}));
      const { getByRole, queryAllByRole } = renderSet("Lead");
      await act(async () => {});
      fireEvent.click(getByRole("button", { name: /Ensayar/i }));
      expect(queryAllByRole("menuitem").map((el) => el.textContent)).toHaveLength(3);
    });

    it("says so when no song of the set has a mix", async () => {
      vi.stubGlobal("fetch", routedFetch({ mixes: () => okJson({ mixes: { a: [], b: [], c: [] } }) }));
      const { getByRole, findByText } = renderSet();
      await act(async () => {});
      fireEvent.click(getByRole("button", { name: /Ensayar/i }));
      fireEvent.click(getByRole("menuitem", { name: /Banda completa/i }));
      expect(await findByText(/Ninguna canción del set tiene multitrack/)).toBeTruthy();
      expect(playQueue).not.toHaveBeenCalled();
    });

    it("reports a failed read as retryable and reads again on the next press", async () => {
      let calls = 0;
      const fetch = routedFetch({
        mixes: () => (++calls === 1 ? Promise.resolve({ ok: false, json: async () => ({}) }) : okJson({ mixes: MIXES })),
      });
      vi.stubGlobal("fetch", fetch);
      const { getByRole, findByText } = renderSet();
      await act(async () => {});

      fireEvent.click(getByRole("button", { name: /Ensayar/i }));
      fireEvent.click(getByRole("menuitem", { name: /Banda completa/i }));
      expect(await findByText(/No se pudieron cargar los multitracks/)).toBeTruthy();
      expect(playQueue).not.toHaveBeenCalled();

      fireEvent.click(getByRole("button", { name: /Reintentar/i }));
      fireEvent.click(getByRole("menuitem", { name: /Banda completa/i }));
      await waitFor(() => expect(playQueue).toHaveBeenCalledTimes(1));
    });
  });
});
