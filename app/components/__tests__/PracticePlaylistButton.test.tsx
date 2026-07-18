/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PracticePlaylistButton from "../PracticePlaylistButton";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  it("uses disclosure semantics and closes on Escape without reaching outer handlers", () => {
    const outerEscape = vi.fn();
    window.addEventListener("keydown", outerEscape);

    const { getByRole, queryByText } = render(
      <PracticePlaylistButton songIds={["song-1"]} accent="#12C8F4" />,
    );

    const trigger = getByRole("button", { name: /Practicar/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(getByRole("button", { name: /Música/i })).toBeTruthy();

    fireEvent.keyDown(getByRole("button", { name: /Música/i }), { key: "Escape" });
    expect(queryByText("referencia musical")).toBeNull();
    expect(outerEscape).not.toHaveBeenCalled();

    window.removeEventListener("keydown", outerEscape);
  });

  it("reserves a popup before fetch resolves, posts the exact body, and navigates on success", async () => {
    const popup = fakePopup();
    const open = vi.fn(() => popup);
    const pendingFetch = deferred<{ ok: boolean; json: () => Promise<{ url: string }> }>();
    const fetch = vi.fn(() => pendingFetch.promise);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", fetch);

    const { getByRole } = render(
      <PracticePlaylistButton songIds={["song-1", "song-2"]} accent="#12C8F4" />,
    );

    fireEvent.click(getByRole("button", { name: /Practicar/i }));
    fireEvent.click(getByRole("button", { name: /Música/i }));

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

  it("keeps the pending trigger focusable and blocks duplicate click, Enter, and Space activations", () => {
    const popup = fakePopup();
    const open = vi.fn(() => popup);
    const pendingFetch = deferred<{ ok: boolean; json: () => Promise<{ url: string }> }>();
    const fetch = vi.fn(() => pendingFetch.promise);
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", fetch);

    const { getByRole } = render(
      <PracticePlaylistButton songIds={["song-1"]} accent="#12C8F4" />,
    );

    const trigger = getByRole("button", { name: /Practicar/i });
    fireEvent.click(trigger);
    fireEvent.click(getByRole("button", { name: /Letras/i }));

    expect(getByRole("button", { name: /Abriendo/i }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(getByRole("button", { name: /Abriendo/i }));
    fireEvent.keyDown(getByRole("button", { name: /Abriendo/i }), { key: "Enter" });
    fireEvent.keyDown(getByRole("button", { name: /Abriendo/i }), { key: " " });

    expect(open).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("closes the reserved popup and reports a retryable local error on failure", async () => {
    const popup = fakePopup();
    vi.stubGlobal("open", vi.fn(() => popup));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    const { getByRole, findByRole } = render(
      <PracticePlaylistButton songIds={["song-1"]} accent="#12C8F4" />,
    );

    fireEvent.click(getByRole("button", { name: /Practicar/i }));
    fireEvent.click(getByRole("button", { name: /Música/i }));

    expect((await findByRole("status")).textContent).toContain("No se pudo crear la playlist");
    expect((popup as any).close).toHaveBeenCalled();
  });
});
