/** @vitest-environment jsdom */
// The library row's long press (R7 Task 4, spec §12.8): the row REPORTS the press
// through `onQuickActions` and opens no sheet of its own — `LibraryIndex` owns the
// one sheet for the page (`libraryIndex.test.tsx` covers what it opens). The tap
// itself is unchanged.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
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

const onQuickActions = vi.fn();

function mount() {
  return render(
    <MotionProvider>
      <LibraryRow post={post} onQuickActions={onQuickActions} />
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
  onQuickActions.mockClear();
  vi.useRealTimers();
});

describe("LibraryRow", () => {
  it("a tap still opens the song sheet and reports no long press", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Canción s1/ }));
    expect(openSheet).toHaveBeenCalledWith("s1");
    expect(onQuickActions).not.toHaveBeenCalled();
  });

  it("a long press reports the post and swallows the row's click — it opens no sheet itself", () => {
    vi.useFakeTimers();
    mount();
    const row = screen.getByRole("button", { name: /Canción s1/ });
    longPress(row);
    fireEvent.click(row);
    expect(onQuickActions).toHaveBeenCalledWith(post);
    expect(openSheet).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
