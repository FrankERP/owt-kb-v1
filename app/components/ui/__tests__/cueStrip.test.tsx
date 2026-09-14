/** @vitest-environment jsdom */
// The navbar cue strip. Four properties, each one a way the strip could quietly
// become wrong rather than broken:
//
//   • it paints the label the API's cue produces (the one piece of state a
//     member always wants, on every route);
//   • it paints NOTHING on `/` and `/me`, which already carry the countdown —
//     and it does not even ask the API there;
//   • a non-ok response (a kids-only member on a worship-only day, a 401 from an
//     expired session) is silence, never an error on screen;
//   • the 60 s sessionStorage cache short-circuits the fetch, so navigating does
//     not re-ask once per page.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";

installMotionTestEnv();

let pathname = "/biblioteca";
let session: { user: Record<string, unknown> } | null = { user: { name: "Ana", sanityId: "member-1" } };
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: session, status: session ? "authenticated" : "unauthenticated" }),
}));

import CueStrip, { CUE_KEY } from "../CueStrip";

const TODAY = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
/** A date the countdown always reports as "EN 3 DÍAS", whatever day the suite runs. */
function inThreeDays(): string {
  const [y, m, d] = TODAY.split("-").map(Number);
  const target = new Date(y, m - 1, d + 3, 12, 0, 0, 0);
  return target.toLocaleDateString("sv");
}

const fetchMock = vi.fn();

function mount() {
  return render(
    <MotionProvider>
      <CueStrip />
    </MotionProvider>,
  );
}

beforeEach(() => {
  pathname = "/biblioteca";
  session = { user: { name: "Ana", sanityId: "member-1" } };
  sessionStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ cue: { dateKey: inThreeDays(), kind: "worship" } }),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("CueStrip", () => {
  it("paints the cue label from the API", async () => {
    mount();
    await waitFor(() => expect(screen.getByText(/EN 3 DÍAS/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/cue");
  });

  it("renders nothing on `/` and `/me`, and asks for nothing", async () => {
    for (const route of ["/", "/me"]) {
      pathname = route;
      mount();
      await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
      expect(screen.queryByText(/EN 3 DÍAS/)).toBeNull();
      cleanup();
    }
  });

  it("renders nothing when the response is not ok, even if the body carries a real cue", async () => {
    // A weak version of this test lets `json: async () => ({})` pass for the
    // wrong reason (no cue in the body at all). Here the body is a VALID,
    // populated cue payload — proving the strip branches on `ok`, not on
    // whatever happens to be in the JSON.
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ cue: { dateKey: inThreeDays(), kind: "worship" } }) });
    mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/EN 3 DÍAS/)).toBeNull();
  });

  it("renders nothing, and asks nothing, when signed out", async () => {
    session = null;
    mount();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    expect(screen.queryByText(/EN 3 DÍAS/)).toBeNull();
  });

  it("short-circuits the fetch on a fresh sessionStorage cache for the same member", async () => {
    sessionStorage.setItem(
      CUE_KEY,
      JSON.stringify({ c: { dateKey: inThreeDays(), kind: "worship" }, t: Date.now(), id: "member-1" }),
    );
    mount();
    await waitFor(() => expect(screen.getByText(/EN 3 DÍAS/)).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-asks once the cached entry is older than its TTL", async () => {
    sessionStorage.setItem(CUE_KEY, JSON.stringify({ c: null, t: Date.now() - 61_000, id: "member-1" }));
    mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("treats a cache entry written for another member as a miss", async () => {
    sessionStorage.setItem(
      CUE_KEY,
      JSON.stringify({ c: { dateKey: inThreeDays(), kind: "worship" }, t: Date.now(), id: "someone-else" }),
    );
    mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("reserves the strip's line before the fetch resolves, so the block never jumps", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const { container } = mount();
    const wrapper = container.querySelector(".min-h-\\[15px\\]");
    expect(wrapper).toBeTruthy();
    expect(screen.queryByText(/EN 3 DÍAS/)).toBeNull();
    resolveFetch({ ok: true, json: async () => ({ cue: { dateKey: inThreeDays(), kind: "worship" } }) });
    await waitFor(() => expect(screen.getByText(/EN 3 DÍAS/)).toBeTruthy());
  });
});
