/** @vitest-environment jsdom */
// Regression harness for the ONE create path in MonthGenerator that can make a
// month member-visible and queue assignment emails to the whole team
// (app/api/admin/roles/route.ts:264-286 on `published: true`). Nothing tested
// this before this file. It pins:
//  - only `creatable` targets are posted, never `blocked` ones (:1411-1414)
//  - a candidate that stops being creatable between preview and confirm aborts
//    the WHOLE batch and posts nothing (:1416-1431)
//  - each posted draft carries its own creationRequestId, and a retry in
//    standalone mode (no `preflight`) replays only the failed draft with the
//    SAME id, never re-posting a confirmed success (monthDraftCreate.ts)
//  - `Crear N borrador(es)` posts published:false, `Crear y publicar` posts
//    published:true, for every draft in the batch
//  - `gateBlocked` disables both footer buttons and posts nothing, observable
//    only via disabled state + rendered message + zero fetch calls (:1228,
//    :1686-1688, :1698, :1701) since a click on a disabled button dispatches
//    nothing
// Two tests here pin behaviour that Task 4 moves (D13: solve trigger goes from
// `Previsualizar →` to Auto) and are expected to be REWRITTEN there, not
// deleted — the Sunday-leads refusal and the fairness-history replace-not-append.
//
// Buttons are matched by their REAL computed labels (`Crear ${n} borrador(es)`
// pluralised, and the literal "Crear y publicar"): a bare /Crear/ matches both.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import type { TargetPreflight, TargetPreflightState } from "../serviceReadiness";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// February 2026 has exactly four Sundays and no ambiguity about week folding;
// tests disable Saturdays so only these four targets exist.
const FEB_2026_SUNDAYS = ["2026-02-01", "2026-02-08", "2026-02-15", "2026-02-22"];

const noMembers: never[] = [];

// ─── DOM helpers ──────────────────────────────────────────────────────────────
// The Mes <select> and Año <input> have no htmlFor/id linking their <label>, so
// getByLabelText can't reach them (a pre-existing a11y gap, out of scope here).

function setMonthYear(container: HTMLElement, month: number, year: number) {
  const monthSelect = container.querySelector("select") as HTMLSelectElement;
  fireEvent.change(monthSelect, { target: { value: String(month) } });
  const yearInput = container.querySelector('input[type="number"]') as HTMLInputElement;
  fireEvent.change(yearInput, { target: { value: String(year) } });
}

function disableSaturdays() {
  const cb = screen.getByLabelText("Sábados") as HTMLInputElement;
  if (cb.checked) fireEvent.click(cb);
}

function goToPreview(container: HTMLElement, month: number, year: number) {
  setMonthYear(container, month, year);
  disableSaturdays();
  fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
}

const createButton = () => screen.getByRole("button", { name: /^Crear \d+ borrador/ });
const publishButton = () => screen.getByRole("button", { name: "Crear y publicar" });

// ─── fetch mocks ──────────────────────────────────────────────────────────────

interface RolesCall { date: string; body: Record<string, unknown> }

/** Stubs `fetch` for the roles-create endpoint only; anything else throws. */
function stubRolesFetch(outcomeFor: (date: string) => { ok: boolean; status?: number; error?: string }) {
  const calls: RolesCall[] = [];
  const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    if (url !== "/api/admin/roles") throw new Error(`unexpected fetch to ${url}`);
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ date: body.date as string, body });
    const outcome = outcomeFor(body.date as string);
    return {
      ok: outcome.ok,
      status: outcome.status,
      json: async () => (outcome.error ? { error: outcome.error } : {}),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

/** A stub that must never be called; proves a guard short-circuits before fetch. */
function stubUnreachableFetch() {
  const fetchMock = vi.fn(() => {
    throw new Error("fetch must not be called");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makePreflight(stateFor: (date: string) => TargetPreflightState) {
  return (type: "sunday_role" | "saturday_role", date: string): TargetPreflight => ({
    targetKey: `${type}__${date}`,
    state: stateFor(date),
    reasons: [],
    ids: [],
    blockedBy: [],
  });
}

describe("MonthGenerator — create path", () => {
  it("posts only creatable targets; a blocked one is never posted", async () => {
    const blockedDate = "2026-02-08";
    const preflight = makePreflight((date) => (date === blockedDate ? "blocked" : "creatable"));
    const { fetchMock, calls } = stubRolesFetch(() => ({ ok: true }));

    const { container } = render(
      <MonthGenerator
        members={noMembers}
        existingRoles={[]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        preflight={preflight}
      />,
    );
    goToPreview(container, 2, 2026);

    // 3 of the 4 Sundays are creatable.
    expect(createButton().textContent).toMatch(/^Crear 3 borrador/);

    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(calls.map((c) => c.date).sort()).toEqual(
      FEB_2026_SUNDAYS.filter((d) => d !== blockedDate).sort(),
    );
    expect(calls.some((c) => c.date === blockedDate)).toBe(false);
  });

  it("aborts the whole batch and posts nothing when a candidate stops being creatable before confirm", async () => {
    // The preflight function's identity never changes across renders (no
    // rerender happens here) — only the external state it reads does, between
    // the preview-time observation (captured in the `preflights` memo) and the
    // confirm-time re-observation (:1420, a fresh call per candidate).
    let blockedDate: string | null = null;
    const preflight = makePreflight((date) => (date === blockedDate ? "blocked" : "creatable"));
    const fetchMock = stubUnreachableFetch();

    const { container } = render(
      <MonthGenerator
        members={noMembers}
        existingRoles={[]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        preflight={preflight}
      />,
    );
    goToPreview(container, 2, 2026);
    expect(createButton().textContent).toMatch(/^Crear 4 borrador/);

    // Simulate the target going stale WHILE the dialog is open, without
    // triggering a React re-render (the preview-time `preflights` memo is now
    // stale, but the confirm handler re-observes fresh).
    blockedDate = "2026-02-08";

    fireEvent.click(createButton());

    await waitFor(() =>
      expect(
        screen.getByText(/1 fecha\(s\) dejaron de estar disponibles para crear/),
      ).toBeTruthy(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives each posted draft its own, distinct creationRequestId", async () => {
    const { fetchMock, calls } = stubRolesFetch(() => ({ ok: true }));
    const { container } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    const ids = calls.map((c) => c.body.creationRequestId as string);
    for (const id of ids) expect(typeof id === "string" && id.length > 0).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("standalone retry re-posts only the failed draft, with its original id, and never re-posts the succeeded one", async () => {
    // Standalone mode: `preflight` is undefined, so the component's own rule
    // (`!d.exists`) decides what's postable — this is the ONLY mode where that
    // rule is exercised rather than a mock's.
    const failingDate = "2026-02-08";
    let failingShouldSucceed = false;
    const { fetchMock, calls } = stubRolesFetch((date) => {
      if (date === failingDate && !failingShouldSucceed) return { ok: false, status: 500 };
      return { ok: true };
    });

    const onClose = vi.fn();
    const { container } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={onClose} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(screen.getByText(/No se pudieron crear 1 de 4 servicios/)).toBeTruthy(),
    );

    const firstAttemptId = calls.find((c) => c.date === failingDate)!.body.creationRequestId;
    const succeededDate = FEB_2026_SUNDAYS.find((d) => d !== failingDate)!;
    const succeededId = calls.find((c) => c.date === succeededDate)!.body.creationRequestId;

    // Only the failed draft remains creatable in standalone mode — the three
    // successes were marked `exists` and drop out of `toCreate`.
    expect(createButton().textContent).toMatch(/^Crear 1 borrador/);

    failingShouldSucceed = true;
    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));

    const retryCall = calls[calls.length - 1];
    expect(retryCall.date).toBe(failingDate);
    // Same request id — a lost/retried response replays idempotently rather
    // than minting a second create for the same logical draft.
    expect(retryCall.body.creationRequestId).toBe(firstAttemptId);

    // The already-succeeded draft was never posted again.
    expect(calls.filter((c) => c.date === succeededDate)).toHaveLength(1);
    expect(calls.filter((c) => c.date === succeededDate)[0].body.creationRequestId).toBe(succeededId);

    // All 4 drafts now confirmed created -> dialog closes.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('"Crear N borrador(es)" posts published:false for every draft in the batch', async () => {
    const { fetchMock, calls } = stubRolesFetch(() => ({ ok: true }));
    const { container } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(calls.every((c) => c.body.published === false)).toBe(true);
  });

  it('"Crear y publicar" posts published:true for every draft in the batch', async () => {
    const { fetchMock, calls } = stubRolesFetch(() => ({ ok: true }));
    const { container } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    fireEvent.click(publishButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(calls.every((c) => c.body.published === true)).toBe(true);
  });

  it("gateBlocked disables both footer buttons, shows the reason, and posts nothing", async () => {
    // `gateBlocked` also short-circuits handlePreview (:1228), so the ONLY way
    // to observe the confirm-time guard is to reach preview first while the
    // capability is enabled, then revoke it via rerender (same fiber, state
    // preserved) — a click on a disabled button dispatches nothing, so
    // asserting "the guard fired" directly is not observable.
    const fetchMock = stubUnreachableFetch();
    const onClose = vi.fn();
    const { container, rerender } = render(
      <MonthGenerator
        members={noMembers}
        existingRoles={[]}
        onClose={onClose}
        onCreated={vi.fn()}
        capability={{ enabled: true, reason: null }}
      />,
    );
    goToPreview(container, 2, 2026);
    expect(createButton()).toBeTruthy();

    rerender(
      <MonthGenerator
        members={noMembers}
        existingRoles={[]}
        onClose={onClose}
        onCreated={vi.fn()}
        capability={{ enabled: false, reason: "Fuente de disponibilidad caída." }}
      />,
    );

    expect(screen.getByText("Fuente de disponibilidad caída.")).toBeTruthy();
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);
    expect((publishButton() as HTMLButtonElement).disabled).toBe(true);

    // Disabled buttons dispatch nothing — clicking them is a no-op, and this
    // is the only directly observable proof that nothing was posted.
    fireEvent.click(createButton());
    fireEvent.click(publishButton());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── Written now, expected to be REWRITTEN in Task 4 (D13 moves the solve
  // trigger from `Previsualizar →` to Auto) — kept here because they pin
  // behaviour that must survive that move. ──────────────────────────────────

  it('"Debes seleccionar al menos un líder de domingo" refuses before any /api/admin/solve call', () => {
    const fetchMock = stubUnreachableFetch();
    render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    fireEvent.click(screen.getByLabelText(/Auto-asignar con Solver/));
    // No sunday leads selected — the pool default is empty.
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    expect(
      screen.getByText("Debes seleccionar al menos un líder de domingo."),
    ).toBeTruthy();
    // Still on the config step: the solve-trigger button is unchanged.
    expect(screen.getByRole("button", { name: /Previsualizar/ })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a successful solve writes one fairness-history entry under `${year}-${month}`, replacing rather than appending", async () => {
    const members = [
      { _id: "lead-1", member_name: "Ana", memberType: ["voz", "sunday_lead"] },
    ];
    let solveCallCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url !== "/api/admin/solve") throw new Error(`unexpected fetch to ${url}`);
      solveCallCount += 1;
      const anaCount = solveCallCount; // 1st call -> 1, 2nd call -> 2
      return {
        ok: true,
        json: async () => ({
          ok: true,
          schedule: { "1": { Sunday: { Lead: ["Ana"], BGV: [], Choir: [] } } },
          total_counts: { Ana: anaCount },
          role_counts: { Ana: { "Sun.Lead": anaCount } },
          unfilled_seats: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 2, 2026);
    disableSaturdays();
    fireEvent.click(screen.getByLabelText(/Auto-asignar con Solver/));
    fireEvent.click(screen.getByLabelText("Ana"));

    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Volver/ })).toBeTruthy());

    const historyAfterFirst = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entriesFor2026_2 = historyAfterFirst.filter((h: { key: string }) => h.key === "2026-2");
    expect(entriesFor2026_2).toHaveLength(1);
    expect(entriesFor2026_2[0].total_counts).toEqual({ Ana: 1 });

    // Run the same month/year solve again — the entry must be REPLACED, not
    // appended, so the fairness window doesn't double-count this month.
    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Volver/ })).toBeTruthy());

    const historyAfterSecond = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entriesAfterSecond = historyAfterSecond.filter((h: { key: string }) => h.key === "2026-2");
    expect(entriesAfterSecond).toHaveLength(1);
    expect(entriesAfterSecond[0].total_counts).toEqual({ Ana: 2 });
  });
});
