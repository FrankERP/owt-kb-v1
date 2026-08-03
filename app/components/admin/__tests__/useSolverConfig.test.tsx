/** @vitest-environment jsdom */
// `useSolverConfig` — the ONE fetcher and the ONE writer of the shared rule set.
//
// The pure mapping is pinned in `solverConfigSource.test.ts`; this file pins the
// wiring around it: that a thrown fetch is a failed READ and not an absent
// document, that a save posts the observed `_rev` to the admin-gated route, and
// that a failed save leaves the state alone so the admin's edits survive.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { SAVE_STALE_MESSAGE, SOLVER_CONFIG_ENDPOINT } from "../solverConfigSource";
import { useSolverConfig } from "../useSolverConfig";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => impl(url, init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("useSolverConfig — reading", () => {
  it("fetches once on mount and lands on `ready` with the rev", async () => {
    const fetchMock = stubFetch(() =>
      ok({ present: true, rev: "rev-1", config: DEFAULT_SOLVER_CONFIG }),
    );
    const { result } = renderHook(() => useSolverConfig());
    expect(result.current.source.status).toBe("loading");
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(SOLVER_CONFIG_ENDPOINT);
  });

  it("a THROWN fetch is `error`, never `absent` — the states must not merge", async () => {
    // The whole cutover in one assertion: a transient network fault that read as
    // "the document does not exist" would offer the shipped samples as this
    // team's rules, and one Guardar would make it so.
    stubFetch(() => {
      throw new Error("offline");
    });
    const { result } = renderHook(() => useSolverConfig());
    await waitFor(() => expect(result.current.source.status).toBe("error"));
    expect(result.current.source).not.toHaveProperty("config");
  });

  it("`reload` re-reads, which is the answer to both a failed read and a lost race", async () => {
    let present = false;
    const fetchMock = stubFetch(() =>
      ok(
        present
          ? { present: true, rev: "rev-2", config: DEFAULT_SOLVER_CONFIG }
          : { present: false, rev: null, config: null },
      ),
    );
    const { result } = renderHook(() => useSolverConfig());
    await waitFor(() => expect(result.current.source.status).toBe("absent"));
    present = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("useSolverConfig — saving", () => {
  async function readyHook(post: (init?: RequestInit) => unknown) {
    const fetchMock = stubFetch((url, init) =>
      init?.method === "POST"
        ? post(init)
        : ok({ present: true, rev: "rev-1", config: DEFAULT_SOLVER_CONFIG }),
    );
    const { result } = renderHook(() => useSolverConfig());
    await waitFor(() => expect(result.current.source.status).toBe("ready"));
    return { result, fetchMock };
  }

  it("POSTs `{ rev, config }` and adopts the rev the server hands back", async () => {
    const edited = { ...DEFAULT_SOLVER_CONFIG, sundayLeads: ["frank"] };
    const { result, fetchMock } = await readyHook(() =>
      ok({ present: true, rev: "rev-2", config: edited }),
    );
    await act(async () => {
      expect(await result.current.save(edited, "rev-1")).toEqual({ ok: true });
    });
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ rev: "rev-1", config: edited });
    // Adopting the new rev is what lets a SECOND save succeed without a reload.
    expect(result.current.source).toMatchObject({ status: "ready", rev: "rev-2" });
  });

  it("a stale `_rev` comes back as a lost race, and the state is left alone", async () => {
    // Left alone on purpose: the admin's edits live in the panel, and blanking
    // the source here would discard them to report a conflict.
    const { result } = await readyHook(() => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "stale_revision", conflict: true }),
    }));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.save(DEFAULT_SOLVER_CONFIG, "rev-old");
    });
    expect(outcome).toEqual({ ok: false, message: SAVE_STALE_MESSAGE, stale: true });
    expect(result.current.source).toMatchObject({ status: "ready", rev: "rev-1" });
  });

  it("a thrown POST is a failure, not a silent success", async () => {
    const { result } = await readyHook(() => {
      throw new Error("offline");
    });
    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.save(DEFAULT_SOLVER_CONFIG, "rev-1");
    });
    expect(outcome?.ok).toBe(false);
  });

  it("re-reads rather than parking an unusable state when the echo is malformed", async () => {
    // The write LANDED. Reporting it as failed would invite a retry against a
    // rev that is now genuinely stale; keeping a rev-less state would make the
    // next save impossible. So: succeed, and refetch.
    const { result, fetchMock } = await readyHook(() => ok({ present: true, rev: null }));
    await act(async () => {
      expect(await result.current.save(DEFAULT_SOLVER_CONFIG, "rev-1")).toEqual({ ok: true });
    });
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => !c[1]).length).toBe(2));
    expect(result.current.source).toMatchObject({ status: "ready", rev: "rev-1" });
  });
});
