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
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  // ── REWRITTEN for Task 4 (D13 moves the solve trigger from
  // `Previsualizar →` to Auto, inside `PlannerGrid`). Both pin the SAME
  // behaviour the Task 1 versions did; only the trigger changed. ────────────

  it('"Debes seleccionar al menos un líder de domingo" refuses before any /api/admin/solve call', async () => {
    const fetchMock = stubUnreachableFetch();
    const { container } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026); // "Previsualizar →" now only builds an empty grid.

    // No sunday leads selected — the pool default is empty. Auto requires a
    // confirmation step (D2) before it calls `onAuto`.
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(
      screen.getByText("Debes seleccionar al menos un líder de domingo."),
    ).toBeTruthy();
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
    // Pools live on step 1 (config); Auto lives on step 2 (grid) — select the
    // Sunday lead BEFORE building the grid (D17's layout, not a test artifact).
    fireEvent.click(screen.getByLabelText("Ana"));
    goToPreview(container, 2, 2026);

    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const historyAfterFirst = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entriesFor2026_2 = historyAfterFirst.filter((h: { key: string }) => h.key === "2026-2");
    expect(entriesFor2026_2).toHaveLength(1);
    expect(entriesFor2026_2[0].total_counts).toEqual({ Ana: 1 });

    // Run Auto again for the SAME month — the entry must be REPLACED, not
    // appended, so the fairness window doesn't double-count this month.
    // (D13 decouples Auto from the step transition, so there is no "Volver /
    // Previsualizar" round trip needed to re-run it — a second Auto click on
    // the same grid is enough.)
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const historyAfterSecond = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entriesAfterSecond = historyAfterSecond.filter((h: { key: string }) => h.key === "2026-2");
    expect(entriesAfterSecond).toHaveLength(1);
    expect(entriesAfterSecond[0].total_counts).toEqual({ Ana: 2 });
  });

  // ── Task 4: the live production bug ────────────────────────────────────────
  //
  // Today's `MonthGenerator.tsx:1249-1251` assigns Saturday week indexes
  // POSITIONALLY when no selected Saturday is adjacent to any Sunday. On
  // October 2026 with only Oct 31 selected, that creates a `saturday_role` for
  // 2026-10-03 — a Saturday the admin explicitly DESELECTED — and
  // `Crear y publicar` emails the whole team about it. Verified by temporarily
  // running this exact scenario (in the new Auto-driven shape) against the
  // pre-Task-4 component: it reproduced a stray "Sábado" draft for day 3.
  // `weekendWeekIndexes` (D16, plannerModel) drops the positional fallback, so
  // the request never even asks the solver to staff that week — this test
  // proves the create path honours that all the way through to the POST.
  it("October 2026, only Oct 31 selected: no saturday_role draft for the deselected 2026-10-03, and nothing is POSTed for it", async () => {
    const members = [
      { _id: "lead-1", member_name: "Ana", memberType: ["voz", "sunday_lead"] },
    ];
    const fetchMock = vi.fn(async (url: string, init?: { body: string }) => {
      if (url === "/api/admin/solve") {
        const body = JSON.parse(init!.body) as { weekends_with_saturday: number[] };
        // The fix, at the request level: week 1's Saturday (Oct 3) is never
        // addressed, because it isn't the selected Oct 31.
        expect(body.weekends_with_saturday).toEqual([]);
        return {
          ok: true,
          json: async () => ({
            ok: true,
            // Even a (hypothetically buggy, or simply a solver that ignores
            // an empty `weekends_with_saturday`) response carrying Saturday
            // data for week 1 must never reach a draft: `applySolveResponse`
            // only ever writes cells for columns actually in the column set,
            // and week 1's Saturday (Oct 3) never is.
            schedule: {
              "1": { Sunday: { Lead: ["Ana"], BGV: [], Choir: [] }, Saturday: { Lead: ["Ana"], BGV: [] } },
            },
            total_counts: { Ana: 1 },
            role_counts: { Ana: { "Sun.Lead": 1 } },
            unfilled_seats: [],
          }),
        };
      }
      if (url === "/api/admin/roles") {
        const body = JSON.parse(init!.body) as { date: string };
        // The live-bug assertion: nothing is ever POSTed for the deselected
        // Saturday, however the create batch is triggered.
        expect(body.date).not.toBe("2026-10-03");
        return { ok: true, status: 200, json: async () => ({}) };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 10, 2026);
    // Deselect every October Saturday, then re-select ONLY the 31st.
    const satPillLabels = Array.from(container.querySelectorAll("label")).filter((l) =>
      /de oct/i.test(l.textContent ?? ""),
    );
    for (const label of satPillLabels) {
      fireEvent.click(label.querySelector("input")!);
    }
    const oct31 = satPillLabels.find((l) => /31 de oct/i.test(l.textContent ?? ""));
    fireEvent.click(oct31!.querySelector("input")!);

    // Pools live on step 1; select Ana before building the grid.
    fireEvent.click(screen.getByLabelText("Ana"));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    // No stray "Sábado" card for day 3 anywhere in the grid — the deselected
    // Saturday was never part of the explicit column set (D9/D18) to begin with.
    const dayEls = Array.from(container.querySelectorAll("p.font-display, span.font-display"));
    const oct3Card = dayEls
      .find((el) => el.textContent === "3")
      ?.closest("div");
    expect(oct3Card?.textContent ?? "").not.toContain("Sábado");

    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/solve", expect.anything()));

    // Even with the (hypothetically buggy) solver having been asked about
    // week 1's Saturday, publish and confirm nothing is ever posted for it.
    fireEvent.click(screen.getByRole("button", { name: "Crear y publicar" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => u === "/api/admin/roles")).toBe(true),
    );
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/admin/roles")).not.toHaveLength(0);
    expect(
      fetchMock.mock.calls
        .filter(([u]) => u === "/api/admin/roles")
        .map(([, init]) => JSON.parse((init as { body: string }).body).date),
    ).not.toContain("2026-10-03");
  });

  // ── Task 4: two items Task 3 could not implement — they live on the wizard
  // shell (`MonthGenerator`'s own step, not `PlannerGridProps`). ─────────────

  it("Previsualizar → stays disabled when both Domingos and Sábados are unchecked", () => {
    render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Domingos"));
    fireEvent.click(screen.getByLabelText("Sábados"));
    expect(
      (screen.getByRole("button", { name: /Previsualizar/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("← Volver confirms before discarding, naming how many assignments would be lost", async () => {
    const members = [
      { _id: "drum-1", member_name: "Beto", memberType: ["instrumento"] },
    ];
    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    // No confirmation needed when nothing would be lost.
    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    expect(screen.getByRole("button", { name: /Previsualizar/ })).toBeTruthy();

    // Assign a Drums cell, then try to go back again.
    goToPreview(container, 2, 2026);
    const drumsCell = container.querySelector('[data-row-id="instrumento:Drums"][data-date="2026-02-01"]');
    fireEvent.click(drumsCell!);
    fireEvent.click(screen.getByText("Beto"));
    fireEvent.click(screen.getByText("Cerrar"));
    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));

    expect(screen.getByText(/1 asignaci/i)).toBeTruthy();
    // Still on the grid step until the discard is confirmed.
    expect(screen.queryByRole("button", { name: /Previsualizar/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Volver de todos modos/ }));
    expect(screen.getByRole("button", { name: /Previsualizar/ })).toBeTruthy();
  });

  // ── Task 4: the seam nothing else covers — cell edit → cellsToDrafts
  // (previous) → POST. Proven the same way Task 1 proves retry-id stability:
  // the first POST for a date fails (so it stays retryable, `exists` never
  // flips), a cell is edited in between, and the retry still carries the
  // SAME creationRequestId together with the newly assigned member. ────────

  it("assigning a member to a cell and confirming posts that member in the right seat array, preserving the draft's creationRequestId across the edit", async () => {
    const members = [
      { _id: "lead-1", member_name: "Ana", memberType: ["voz"] },
    ];
    let failFirstSunday = true;
    const { fetchMock, calls } = stubRolesFetch((date) => {
      if (date === FEB_2026_SUNDAYS[0] && failFirstSunday) return { ok: false, status: 500 };
      return { ok: true };
    });

    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    // The candidate picker (the only "Ana" match once she's assigned and the
    // cell chip ALSO reads "Ana") is scoped to its own `<ul>`.
    const pickAna = () => fireEvent.click(within(container.querySelector("ul")!).getByText("Ana"));

    // Open the Lead cell on the first Sunday and assign Ana.
    const leadCell = container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]');
    fireEvent.click(leadCell!);
    pickAna();
    fireEvent.click(screen.getByText("Cerrar"));

    fireEvent.click(createButton());
    await waitFor(() => expect(calls.some((c) => c.date === FEB_2026_SUNDAYS[0])).toBe(true));
    const firstAttempt = calls.find((c) => c.date === FEB_2026_SUNDAYS[0])!;
    expect(firstAttempt.body.leads).toEqual(["lead-1"]);
    const originalId = firstAttempt.body.creationRequestId;

    // Edit the SAME cell again (toggle Ana off and back on) before retrying —
    // this is the seam: `cellsToDrafts` must thread `previous` through the
    // edit so the retry still carries the original id.
    fireEvent.click(leadCell!);
    pickAna(); // off
    pickAna(); // on again
    fireEvent.click(screen.getByText("Cerrar"));

    failFirstSunday = false;
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(calls.filter((c) => c.date === FEB_2026_SUNDAYS[0])).toHaveLength(2),
    );
    const retryAttempt = calls.filter((c) => c.date === FEB_2026_SUNDAYS[0])[1];
    expect(retryAttempt.body.leads).toEqual(["lead-1"]);
    expect(retryAttempt.body.creationRequestId).toBe(originalId);
    // 4 Sundays posted on the first attempt, then only the failed one retried.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
