/** @vitest-environment jsdom */
// The library row's quick actions (R7 Task 4, spec §12.8): a long press opens a
// sheet titled with the song; the tap itself is unchanged.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { ToastProvider } from "@/app/components/ui/Toast";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { Post } from "@/app/utils/interface";

installMotionTestEnv();

const openSheet = vi.fn();
vi.mock("@/app/context/PlayerContext", () => ({ usePlayer: () => ({ openSheet }) }));

import LibraryRow from "../LibraryRow";

beforeAll(async () => {
  await import("@/app/components/ui/motionFeatures");
});

const post = {
  _id: "s1",
  title: "Canción s1",
  author: "Oasis",
  slug: { current: "cancion-s1" },
  key: "G",
  bpm: "72",
  tags: [],
} as unknown as Post;

function mount() {
  return render(
    <MotionProvider>
      <CueDialogProvider>
        <ToastProvider>
          <LibraryRow post={post} />
        </ToastProvider>
      </CueDialogProvider>
    </MotionProvider>,
  );
}

function longPress(el: Element) {
  fireEvent.pointerDown(el, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
  act(() => { vi.advanceTimersByTime(450); });
  fireEvent.pointerUp(el, { isPrimary: true });
}

afterEach(() => {
  cleanup();
  openSheet.mockClear();
  vi.useRealTimers();
});

describe("LibraryRow quick actions", () => {
  it("a tap still opens the song sheet and no quick-actions sheet", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Canción s1/ }));
    expect(openSheet).toHaveBeenCalledWith("s1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a long press opens a sheet titled with the song, and swallows the row's click", () => {
    vi.useFakeTimers();
    mount();
    const row = screen.getByRole("button", { name: /Canción s1/ });
    longPress(row);
    fireEvent.click(row);
    expect(openSheet).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Canción s1");
    expect(dialog.textContent).toContain("Oasis");
    expect(screen.getByRole("button", { name: "Abrir" })).toBeTruthy();
  });

  it("«Abrir» opens the song sheet", () => {
    vi.useFakeTimers();
    mount();
    longPress(screen.getByRole("button", { name: /Canción s1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(openSheet).toHaveBeenCalledWith("s1");
  });

  it("«Copiar enlace» writes the song URL and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.useFakeTimers();
    mount();
    longPress(screen.getByRole("button", { name: /Canción s1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/posts/cancion-s1`);
    vi.useRealTimers();
    await waitFor(() => expect(screen.getAllByText("Enlace copiado").length).toBeGreaterThan(0));
  });

  it("a clipboard failure says so instead of claiming success", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.useFakeTimers();
    mount();
    longPress(screen.getByRole("button", { name: /Canción s1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
    vi.useRealTimers();
    await waitFor(() => expect(screen.getAllByText("No se pudo copiar").length).toBeGreaterThan(0));
  });
});
