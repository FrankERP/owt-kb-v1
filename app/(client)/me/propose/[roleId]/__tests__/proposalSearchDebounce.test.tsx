/** @vitest-environment jsdom */
//
// The song search's debounce timer, and what happens to it on unmount.
//
// The bug this pins: the editor arms a 300 ms search timer on mount and never
// cleared it. Unmounting left it pending, so it fired against a component that
// was gone — and, in CI, against a jsdom that was gone too. When a test file
// finished inside those 300 ms, the timer's `setSearching(true)` reached React's
// `resolveUpdatePriority`, which reads `window.event`, and threw
// `ReferenceError: window is not defined` after teardown. Vitest reports that as
// an unhandled rejection and fails the run with every test green (CI run
// 36194107119), so the flake landed on whichever file happened to be last.
//
// The first test is the control: it proves the timer is real and fires the
// search, so the second one's "nothing was fetched" is not vacuous.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import ProposalEditor from "../ProposalEditor";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { ToastProvider } from "@/app/components/ui/Toast";

// Fake timers BEFORE render, or the mount-time timer is a real one.
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const roleDoc = {
  _id: "role-1",
  _type: "sunday_role",
  week: "2026-08-16",
  service_type: "sunday" as const,
  service_date: "2026-08-16",
};

function renderEditor() {
  return render(
    <ToastProvider>
      <CueDialogProvider>
        <ProposalEditor roleDoc={roleDoc} proposal={null} currentUserId="member-1" />
      </CueDialogProvider>
    </ToastProvider>,
  );
}

const mockFetch = () =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
  );

describe("proposal editor — song search debounce", () => {
  it("fires the search once the debounce elapses while mounted", async () => {
    const fetchSpy = mockFetch();
    renderEditor();

    await act(async () => { vi.advanceTimersByTime(300); });

    const searches = fetchSpy.mock.calls.filter(([input]) => String(input).startsWith("/api/me/songs"));
    expect(searches).toHaveLength(1);
  });

  it("cancels the pending search on unmount, so no timer outlives the editor", async () => {
    const fetchSpy = mockFetch();
    const { unmount } = renderEditor();

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
