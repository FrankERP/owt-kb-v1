/** @vitest-environment jsdom */
//
// The ONE integrity load (R5 ruling 4).
//
// The three domain fetches, the derivation and the retry used to live inside
// `IntegrityQueuePanel`; they now live in `useIntegrityQueue` because the rail's
// dot and the panel must read the SAME state. This is where the fetch mocks live
// now — the panel is a pure renderer and has none.
//
// The load rules are the reason the hook exists, and they are what this file
// pins: three INDEPENDENT domains, and a domain that failed or is still in
// flight reads `unknown`, never `clean`. A clean-looking zero over an unproven
// inventory is the one output this control must never produce.

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTEGRITY_DOMAIN_ROUTE, useIntegrityQueue } from "../useIntegrityQueue";
import { buildRoleTargets } from "@/app/utils/serviceReadSummary";
import { buildIntegrityQueue } from "../serviceIntegrityQueue";
import IntegrityQueuePanel from "../IntegrityQueuePanel";

const EMPTY_ROLES = buildRoleTargets([], [], new Map(), []);
const EMPTY_SETLISTS = { targets: [], recordIssues: [] };
const EMPTY_PROPOSALS = {
  records: [],
  serviceRefConflicts: [],
  targetKeyConflicts: [],
  recordIssues: [],
  draftIds: [],
};

/** A draft-only role: one global-queue entry, owned by no card. */
const DRAFT_ONLY_ROLES = buildRoleTargets(
  [],
  [{ _id: "drafts.role-z", _type: "sunday_role" }],
  new Map(),
  [],
);

type Bodies = { roles?: unknown; setlists?: unknown; proposals?: unknown };

/** Answers each of the three routes from its own body; `null` = HTTP 500. */
function mockRoutes(bodies: Bodies = {}) {
  const resolved = {
    roles: "roles" in bodies ? bodies.roles : EMPTY_ROLES,
    setlists: "setlists" in bodies ? bodies.setlists : EMPTY_SETLISTS,
    proposals: "proposals" in bodies ? bodies.proposals : EMPTY_PROPOSALS,
  };
  const fetchMock = vi.fn(async (url: string) => {
    const domain = (Object.keys(INTEGRITY_DOMAIN_ROUTE) as Array<keyof typeof resolved>).find(
      (d) => INTEGRITY_DOMAIN_ROUTE[d] === url,
    );
    const body = domain ? resolved[domain] : undefined;
    if (body === null) return { ok: false, status: 500, json: async () => ({}) };
    if (body === undefined) throw new Error(`unmocked ${url}`);
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("useIntegrityQueue loads the three inventories", () => {
  it("asks each domain route exactly once on mount", async () => {
    const fetchMock = mockRoutes();
    const { result } = renderHook(() => useIntegrityQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(
      Object.values(INTEGRITY_DOMAIN_ROUTE).sort(),
    );
  });

  it("is `unknown` while loading and `clean` only once all three are proven", async () => {
    mockRoutes();
    const { result } = renderHook(() => useIntegrityQueue());
    // Before anything has landed: loading, and NOT clean.
    expect(result.current.loading).toBe(true);
    expect(result.current.tone).toBe("unknown");

    await waitFor(() => expect(result.current.tone).toBe("clean"));
    expect(result.current.loading).toBe(false);
    expect(result.current.queue.count).toBe(0);
    expect(result.current.queue.incomplete).toBe(false);
  });

  it("reads `unknown`, never clean, when one domain returns 500", async () => {
    mockRoutes({ setlists: null });
    const { result } = renderHook(() => useIntegrityQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tone).toBe("unknown");
    expect(result.current.queue.count).toBe(0);
    expect(result.current.queue.incomplete).toBe(true);
    expect(result.current.queue.unproven.map((u) => u.source)).toContain("setlistTargets");
    expect(result.current.sources.setlistTargets).toBe("error");
    // The other two still landed — the domains are independent.
    expect(result.current.sources.roleTargets).toBe("ready");
    expect(result.current.sources.proposals).toBe("ready");
  });

  it("reads `unknown` when the network throws, too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    const { result } = renderHook(() => useIntegrityQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tone).toBe("unknown");
    expect(result.current.queue.incomplete).toBe(true);
  });

  it("derives the same queue the panel used to derive itself", async () => {
    mockRoutes({ roles: DRAFT_ONLY_ROLES });
    const { result } = renderHook(() => useIntegrityQueue());
    await waitFor(() => expect(result.current.tone).toBe("issues"));
    expect(result.current.queue.count).toBe(1);
    expect(result.current.queue.entries[0]).toMatchObject({
      domain: "roles",
      kind: "role_target_draft_conflict",
      ids: ["drafts.role-z"],
      cardId: null,
    });
    expect(result.current.queue.incomplete).toBe(false);
  });

  it("reads `issues` — not `unknown` — when something was found AND a domain failed", async () => {
    // `integrityQueueTone`'s `issues_incomplete` collapses to `issues` for
    // display: there is definitely something to fix, and the incomplete note in
    // the panel is what says the list may be short.
    mockRoutes({ roles: DRAFT_ONLY_ROLES, proposals: null });
    const { result } = renderHook(() => useIntegrityQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tone).toBe("issues");
    expect(result.current.queue.incomplete).toBe(true);
  });

  it("asks for nothing at all when it is disabled", async () => {
    const fetchMock = mockRoutes();
    const { result } = renderHook(() => useIntegrityQueue({ enabled: false }));
    // Nothing in flight, nothing proven: `unknown`, never a clean zero.
    expect(result.current.loading).toBe(false);
    expect(result.current.tone).toBe("unknown");
    // `reload` is a no-op too — a disabled caller cannot be talked into the
    // three requests by a button it should not be rendering either.
    await act(async () => {
      result.current.reload();
    });
    await waitFor(() => expect(result.current.tone).toBe("unknown"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.sources).toEqual({
      roleTargets: "loading",
      setlistTargets: "loading",
      proposals: "loading",
    });
  });

  it("re-runs all three domains on reload", async () => {
    const fetchMock = mockRoutes();
    const { result } = renderHook(() => useIntegrityQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      result.current.reload();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe("resolve is the caller's handler, with a stable identity", () => {
  it("forwards the outcome and never changes between renders", async () => {
    mockRoutes();
    const first = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useIntegrityQueue({ onResolved: cb }), {
      initialProps: { cb: first },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const resolve = result.current.resolve;
    result.current.resolve("focus");
    expect(first).toHaveBeenCalledWith("focus");

    // A fresh inline handler on the next render must be the one that is called,
    // while `resolve` itself keeps its identity — the panel's focus effect lists
    // it as a dependency, so a new identity would re-run that effect every time.
    const second = vi.fn();
    rerender({ cb: second });
    expect(result.current.resolve).toBe(resolve);
    result.current.resolve("not_found");
    expect(second).toHaveBeenCalledWith("not_found");
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("is safe with no handler at all", async () => {
    mockRoutes();
    const { result } = renderHook(() => useIntegrityQueue());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(() => result.current.resolve("focus")).not.toThrow();
  });
});

// ── The other end of the lifted state ────────────────────────────────────────
//
// `IntegrityQueuePanel` fetches nothing now: it renders the queue it is handed
// and its disclosure follows the tone (ruling 4 — "expands only when it has
// something to say"). These cases live beside the hook's on purpose: the panel
// has no state of its own left to test apart from what the hook gives it.

describe("IntegrityQueuePanel renders the queue it is handed", () => {
  const CLEAN = buildIntegrityQueue({
    sources: { roleTargets: "ready", setlistTargets: "ready", proposals: "ready" },
    cards: [],
    roles: EMPTY_ROLES,
    setlists: EMPTY_SETLISTS,
    proposals: EMPTY_PROPOSALS,
  });
  const ISSUES = buildIntegrityQueue({
    sources: { roleTargets: "ready", setlistTargets: "ready", proposals: "ready" },
    cards: [],
    roles: DRAFT_ONLY_ROLES,
    setlists: EMPTY_SETLISTS,
    proposals: EMPTY_PROPOSALS,
  });

  const panel = (tone: "clean" | "unknown" | "issues", queue = CLEAN) =>
    render(
      <IntegrityQueuePanel
        queue={queue}
        tone={tone}
        sources={{ roleTargets: "ready", setlistTargets: "ready", proposals: "ready" }}
        reload={vi.fn()}
      />,
    );

  afterEach(cleanup);

  it("fetches nothing of its own", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    panel("issues", ISSUES);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts collapsed when the queue is proven clean", () => {
    panel("clean");
    expect(screen.getByRole("button", { name: /Integridad de datos/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("starts open when there is something to say, and stays togglable", () => {
    panel("issues", ISSUES);
    const toggle = screen.getByRole("button", { name: /Integridad de datos/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("drafts.role-z")).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("starts open on an unproven inventory — an unknown queue is not a clean one", () => {
    panel("unknown");
    expect(screen.getByRole("button", { name: /Integridad de datos/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("hands the reload button straight back to the hook", () => {
    const reload = vi.fn();
    render(
      <IntegrityQueuePanel
        queue={CLEAN}
        tone="clean"
        sources={{ roleTargets: "ready", setlistTargets: "ready", proposals: "ready" }}
        reload={reload}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Recargar" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
