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

/**
 * Task 5 replaced the Domingos/Sábados checkboxes and the Saturday pill row
 * with `MonthCalendar`, so "turn Saturdays off" is now a tap per Saturday cell.
 * Only the INTERACTION moved — every assertion in this file is unchanged.
 *
 * Dates are collected first and each cell re-queried inside the loop, so a
 * React re-render between clicks can never leave this iterating stale nodes.
 */
function deselectAll(container: HTMLElement, kind: "sunday" | "saturday") {
  const dates = Array.from(container.querySelectorAll(`[data-day-kind="${kind}"]`)).map((el) =>
    el.getAttribute("data-date"),
  );
  for (const date of dates) {
    const cell = container.querySelector(`[data-date="${date}"]`);
    if (cell?.getAttribute("data-selected") === "true") fireEvent.click(cell);
  }
}

function goToPreview(container: HTMLElement, month: number, year: number) {
  setMonthYear(container, month, year);
  deselectAll(container, "saturday");
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
  // Widened with `ColumnType`: the `preflight` prop is function-typed, so under
  // `strict: true` a narrow parameter here is a contravariance error, and `tsc`
  // checks this file (`tsconfig.json` includes `**/*.tsx`, no test exclusion).
  return (type: "sunday_role" | "saturday_role" | "special_role", date: string): TargetPreflight => ({
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

  // ── Fairness-history persistence (2026-07-30 fix) ──────────────────────────
  //
  // History used to be written the instant a solve returned (`handleAuto`,
  // the OLD version of this describe block ran two Auto+Confirmar cycles and
  // checked localStorage without ever creating anything). That recorded
  // services that might never exist: closing the panel after a disliked Auto
  // run still penalised people next month, and a hand-edit after Auto (or a
  // month assigned entirely by hand) never changed — or even reached —
  // fairness history at all. Persistence now happens in `handleConfirm`,
  // derived from `result.createdLocalIds` (`historyEntryFromDrafts` in
  // `plannerModel.ts`), so every test below drives an actual create.

  it("Auto runs and is confirmed, but the panel is closed WITHOUT creating anything — no history entry is written", async () => {
    const members = [
      { _id: "lead-1", member_name: "Ana", memberType: ["voz", "sunday_lead"] },
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url !== "/api/admin/solve") throw new Error(`unexpected fetch to ${url}`);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          schedule: { "1": { Sunday: { Lead: ["Ana"], BGV: [], Choir: [] } } },
          total_counts: { Ana: 1 },
          role_counts: { Ana: { "Sun.Lead": 1 } },
          unfilled_seats: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Ana"));
    goToPreview(container, 2, 2026);

    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The abandoned-run case: a real solve happened, produced real counts,
    // but nothing was ever posted to /api/admin/roles. If the old
    // `saveHistoryEntry(...)` call in `handleAuto` were restored, this would
    // find a "2026-2" entry with `{ Ana: 1 }` here — that is the exact
    // mutation this test exists to catch.
    const history = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    expect(history.filter((h: { key: string }) => h.key === "2026-2")).toHaveLength(0);
  });

  it("creating after Auto writes a history entry matching the CREATED drafts, not the solver's raw response", async () => {
    const members = [
      { _id: "lead-1", member_name: "Ana", memberType: ["voz", "sunday_lead"] },
      { _id: "lead-2", member_name: "Beto", memberType: ["voz"] },
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/solve") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            schedule: { "1": { Sunday: { Lead: ["Ana"], BGV: [], Choir: [] } } },
            total_counts: { Ana: 1 },
            role_counts: { Ana: { "Sun.Lead": 1 } },
            unfilled_seats: [],
          }),
        };
      }
      if (url === "/api/admin/roles") return { ok: true, status: 200, json: async () => ({}) };
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Ana"));
    goToPreview(container, 2, 2026);

    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/solve", expect.anything()));

    // Hand-edit the exact cell Auto just filled: swap Ana for Beto before
    // creating — the fixture diverges deliberately so the test can tell
    // "what the solver proposed" from "what actually got created" apart.
    const leadCell = container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]');
    fireEvent.click(leadCell!);
    fireEvent.click(within(container.querySelector("ul")!).getByText("Ana")); // off
    fireEvent.click(within(container.querySelector("ul")!).getByText("Beto")); // on
    fireEvent.click(screen.getByText("Cerrar"));

    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/admin/roles")).toBe(true));

    const history = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entry = history.find((h: { key: string }) => h.key === "2026-2");
    expect(entry).toBeTruthy();
    // Beto, who was hand-assigned, is recorded — Ana, whom the solver
    // proposed but who was removed before create, is not.
    expect(entry.role_counts).toEqual({ Beto: { "Sun.Lead": 1 } });
    expect(entry.total_counts).toEqual({ Beto: 1 });
  });

  it("a month assigned entirely by hand, with no Auto run at all, still records a fairness-history entry after create", async () => {
    const members = [{ _id: "lead-1", member_name: "Ana", memberType: ["voz"] }];
    const { fetchMock } = stubRolesFetch(() => ({ ok: true }));
    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    const leadCell = container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]');
    fireEvent.click(leadCell!);
    fireEvent.click(within(container.querySelector("ul")!).getByText("Ana"));
    fireEvent.click(screen.getByText("Cerrar"));

    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const history = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entry = history.find((h: { key: string }) => h.key === "2026-2");
    expect(entry).toBeTruthy();
    expect(entry.total_counts).toEqual({ Ana: 1 });
    expect(entry.role_counts).toEqual({ Ana: { "Sun.Lead": 1 } });
  });

  it("never counts a service that existed BEFORE this session, even though Auto fills its column", async () => {
    // This is the test that separates the session-scoped union from `d.exists`.
    // Auto solves the WHOLE month (D9) and `columns` covers every date, so a
    // date that already had a service gets grid cells like any other. Its draft
    // is `skipped`, so it is never POSTed — but `d.exists` is true for it, and
    // a union keyed on `d.exists` would fold its occupants into the fairness
    // entry. This generator did not create that service; it must not take
    // credit for its seats.
    const members = [
      { _id: "lead-1", member_name: "Ana", memberType: ["voz"] },
      { _id: "lead-2", member_name: "Beto", memberType: ["voz"] },
    ];
    const preExisting = FEB_2026_SUNDAYS[0]; // 2026-02-01, already has a service
    const fresh = FEB_2026_SUNDAYS[1];       // 2026-02-08, this session creates it
    const { fetchMock } = stubRolesFetch(() => ({ ok: true }));

    const { container } = render(
      <MonthGenerator
        members={members}
        existingRoles={[{ _type: "sunday_role", date: preExisting }] as never}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    goToPreview(container, 2, 2026);

    // Beto lands in the pre-existing date's column; Ana in the one we create.
    for (const [date, name] of [[preExisting, "Beto"], [fresh, "Ana"]] as const) {
      const cell = container.querySelector(`[data-row-id="lead"][data-date="${date}"]`);
      fireEvent.click(cell!);
      fireEvent.click(within(container.querySelector("ul")!).getByText(name));
      fireEvent.click(screen.getByText("Cerrar"));
    }

    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const history = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entry = history.find((h: { key: string }) => h.key === "2026-2");
    expect(entry).toBeTruthy();
    // Ana only. Beto sits on a service this session did not create.
    expect(entry.total_counts).toEqual({ Ana: 1 });
    expect(entry.role_counts).toEqual({ Ana: { "Sun.Lead": 1 } });
  });

  it("a skipped date and a date that failed to create are both excluded from the history counts", async () => {
    const members = [{ _id: "lead-1", member_name: "Ana", memberType: ["voz"] }];
    const failingDate = FEB_2026_SUNDAYS[2]; // 2026-02-15
    const skippedDate = FEB_2026_SUNDAYS[1]; // 2026-02-08
    const { fetchMock } = stubRolesFetch((date) =>
      date === failingDate ? { ok: false, status: 500 } : { ok: true },
    );

    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    // Assign Ana as Lead on all four Sundays.
    for (const date of FEB_2026_SUNDAYS) {
      const cell = container.querySelector(`[data-row-id="lead"][data-date="${date}"]`);
      fireEvent.click(cell!);
      fireEvent.click(within(container.querySelector("ul")!).getByText("Ana"));
      fireEvent.click(screen.getByText("Cerrar"));
    }

    fireEvent.click(screen.getByLabelText(`Omitir ${skippedDate}`));

    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3)); // 4 - 1 skipped = 3 attempted

    const history = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entry = history.find((h: { key: string }) => h.key === "2026-2");
    expect(entry).toBeTruthy();
    // 4 dates assigned, 1 skipped (never posted) and 1 failed to create — only
    // the 2 that actually committed count.
    expect(entry.total_counts).toEqual({ Ana: 2 });
  });

  it("re-creating the same month replaces the fairness-history entry rather than appending", async () => {
    const members = [{ _id: "lead-1", member_name: "Ana", memberType: ["voz"] }];

    const first = stubRolesFetch(() => ({ ok: true }));
    const { container, unmount } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);
    const firstCell = container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]');
    fireEvent.click(firstCell!);
    fireEvent.click(within(container.querySelector("ul")!).getByText("Ana"));
    fireEvent.click(screen.getByText("Cerrar"));
    fireEvent.click(createButton());
    await waitFor(() => expect(first.fetchMock).toHaveBeenCalled());

    const afterFirst = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    expect(afterFirst.find((h: { key: string }) => h.key === "2026-2").total_counts).toEqual({ Ana: 1 });
    unmount();

    // The month is regenerated from scratch (e.g. the drafts were discarded
    // and the wizard re-run) — this time Ana is assigned on TWO Sundays.
    const second = stubRolesFetch(() => ({ ok: true }));
    const { container: container2 } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container2, 2, 2026);
    for (const date of [FEB_2026_SUNDAYS[0], FEB_2026_SUNDAYS[1]]) {
      const cell = container2.querySelector(`[data-row-id="lead"][data-date="${date}"]`);
      fireEvent.click(cell!);
      fireEvent.click(within(container2.querySelector("ul")!).getByText("Ana"));
      fireEvent.click(screen.getByText("Cerrar"));
    }
    fireEvent.click(createButton());
    await waitFor(() => expect(second.fetchMock).toHaveBeenCalled());

    const afterSecond = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entriesFor2026_2 = afterSecond.filter((h: { key: string }) => h.key === "2026-2");
    expect(entriesFor2026_2).toHaveLength(1); // replaced, not appended
    expect(entriesFor2026_2[0].total_counts).toEqual({ Ana: 2 });
  });

  it("a retried partial-failure batch — first confirm creates some dates and fails others, second confirm creates the rest — records a history entry covering BOTH batches (2026-07-30 retry fix)", async () => {
    // The defect: deriving the history entry from ONLY `result.createdLocalIds`
    // of THIS call means a second confirm that retries just the failed subset
    // recomputes an entry for that subset alone, and `saveHistoryEntry`
    // replaces by `${year}-${month}` — erasing the first call's counts. The
    // fix folds in every draft that `exists` (this batch's successes, plus
    // whatever an earlier confirm already flagged `exists: true`), so the
    // recompute is idempotent across however many partial retries it takes.
    const members = [{ _id: "lead-1", member_name: "Ana", memberType: ["voz"] }];
    const failingDates = new Set([FEB_2026_SUNDAYS[2], FEB_2026_SUNDAYS[3]]); // 02-15, 02-22
    const attempts = new Map<string, number>();
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      if (url !== "/api/admin/roles") throw new Error(`unexpected fetch to ${url}`);
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const date = body.date as string;
      const attempt = (attempts.get(date) ?? 0) + 1;
      attempts.set(date, attempt);
      // The two "failing" dates fail on their FIRST attempt (first confirm,
      // simulating a partial 500) and succeed on retry (second confirm);
      // the other two succeed immediately.
      const ok = !failingDates.has(date) || attempt > 1;
      return { ok, status: ok ? 200 : 500, json: async () => (ok ? {} : { error: "boom" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    for (const date of FEB_2026_SUNDAYS) {
      const cell = container.querySelector(`[data-row-id="lead"][data-date="${date}"]`);
      fireEvent.click(cell!);
      fireEvent.click(within(container.querySelector("ul")!).getByText("Ana"));
      fireEvent.click(screen.getByText("Cerrar"));
    }

    // First confirm: 2 of 4 dates succeed, 2 fail — dialog stays open.
    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    const afterFirst = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    expect(afterFirst.find((h: { key: string }) => h.key === "2026-2").total_counts).toEqual({ Ana: 2 });

    // Retry: only the 2 that failed are re-attempted (with their original
    // creationRequestId, per the standalone-retry contract above) — this time
    // they succeed.
    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));

    const afterSecond = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entriesFor2026_2 = afterSecond.filter((h: { key: string }) => h.key === "2026-2");
    expect(entriesFor2026_2).toHaveLength(1); // replaced, not appended
    // The union covers BOTH batches — all 4 dates now exist. A recompute
    // derived from only the SECOND call's `createdLocalIds` (the pre-fix
    // logic) would produce `{ Ana: 2 }` here, silently erasing the first
    // batch's 2 counts via replace-by-key.
    expect(entriesFor2026_2[0].total_counts).toEqual({ Ana: 4 });
  });

  it("a session-scoped confirm survives an existingRoles prop refresh mid-session — the critical regression this session's own creations must never be zeroed out by a stale `exists` derivation (2026-07-30 session-scoped-union fix)", async () => {
    // The defect this pins: `ServicesPanel` passes `existingRoles={roles}`, and
    // `onCreated()` → `loadSources()` → `setRoles(...)` means a partial
    // failure's dialog-stays-open window sees `existingRoles` refresh to
    // include the dates THIS session just created. Any subsequent grid
    // interaction re-runs `cellsToDrafts` with that refreshed prop, so those
    // dates become `isExisting` too — indistinguishable, on the resulting
    // `DraftCard`, from a date that existed before this session ever started.
    // Deriving the history union from `d.exists` (the pre-fix logic) cannot
    // tell them apart. Deriving it from a session-scoped ref of confirmed
    // `localId`s can, because that ref is never touched by the prop refresh.
    const members = [{ _id: "lead-1", member_name: "Ana", memberType: ["voz"] }];
    const failingDates = new Set([FEB_2026_SUNDAYS[2], FEB_2026_SUNDAYS[3]]); // 02-15, 02-22
    const attempts = new Map<string, number>();
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      if (url !== "/api/admin/roles") throw new Error(`unexpected fetch to ${url}`);
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const date = body.date as string;
      const attempt = (attempts.get(date) ?? 0) + 1;
      attempts.set(date, attempt);
      const ok = !failingDates.has(date) || attempt > 1;
      return { ok, status: ok ? 200 : 500, json: async () => (ok ? {} : { error: "boom" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, rerender } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    for (const date of FEB_2026_SUNDAYS) {
      const cell = container.querySelector(`[data-row-id="lead"][data-date="${date}"]`);
      fireEvent.click(cell!);
      fireEvent.click(within(container.querySelector("ul")!).getByText("Ana"));
      fireEvent.click(screen.getByText("Cerrar"));
    }

    // First confirm: 2 of 4 succeed (02-01, 02-08), 2 fail (02-15, 02-22) —
    // dialog stays open.
    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const afterFirst = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    expect(afterFirst.find((h: { key: string }) => h.key === "2026-2").total_counts).toEqual({ Ana: 2 });

    // The prop refresh `onCreated → loadSources → setRoles` would produce in
    // production: the two dates THIS session just created now come back as
    // `existingRoles` from the server.
    rerender(
      <MonthGenerator
        members={members}
        existingRoles={[
          { _id: "r1", _type: "sunday_role", date: FEB_2026_SUNDAYS[0] },
          { _id: "r2", _type: "sunday_role", date: FEB_2026_SUNDAYS[1] },
        ]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    // A grid interaction — re-runs cellsToDrafts with the refreshed prop.
    fireEvent.click(screen.getByLabelText(`Omitir ${FEB_2026_SUNDAYS[0]}`));

    // Retry: the 2 that failed are re-attempted and succeed this time.
    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));

    const afterSecond = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]");
    const entriesFor2026_2 = afterSecond.filter((h: { key: string }) => h.key === "2026-2");
    expect(entriesFor2026_2).toHaveLength(1);
    // Both batches must be covered: 4 dates total. A `d.exists`-keyed union
    // would see the first batch's 2 dates as `isExisting` after the refresh
    // and either drop them from the count entirely (if `cellsToDrafts` still
    // zeroed their seats) or, at minimum, could no longer distinguish them
    // from a pre-session service — this assertion is the one that catches it.
    expect(entriesFor2026_2[0].total_counts).toEqual({ Ana: 4 });
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
  //
  // IMPORTANT: the `/api/admin/solve` and `/api/admin/roles` mocks below only
  // CAPTURE — they never `expect()` inside the mock body. A mock is an async
  // function; a thrown assertion inside it rejects the promise `handleAuto`/
  // `handleConfirm` awaits, and both wrap their fetch in try/catch (per
  // CLAUDE.md's client-mutation invariant) — so the "failure" becomes a
  // `setAutoError`/`setPushError` toast, not a failing test. A run that can
  // never fail is worse than no test at all: it looks like coverage in the
  // diff and in CI, while actually proving nothing. Every assertion here runs
  // AFTER the interaction has settled (`await waitFor(...)`), against values
  // captured by the mock, so a regression actually fails the test.
  it("October 2026, only Oct 31 selected: no saturday_role draft for the deselected 2026-10-03, and nothing is POSTed for it", async () => {
    const members = [
      { _id: "lead-1", member_name: "Ana", memberType: ["voz", "sunday_lead"] },
    ];
    // A plain `let`, reassigned only from inside the mock closure, hits a
    // TS control-flow quirk that narrows it to `never` at the read site below
    // — an object property sidesteps it cleanly.
    const captured: { solveRequest: { weekends_with_saturday: number[] } | null } = { solveRequest: null };
    const fetchMock = vi.fn(async (url: string, init?: { body: string }) => {
      if (url === "/api/admin/solve") {
        // Capture only — see the note above for why no `expect()` belongs here.
        captured.solveRequest = JSON.parse(init!.body) as { weekends_with_saturday: number[] };
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
        return { ok: true, status: 200, json: async () => ({}) };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 10, 2026);
    // Deselect every October Saturday on the calendar, then re-select ONLY the 31st.
    deselectAll(container, "saturday");
    fireEvent.click(container.querySelector('[data-date="2026-10-31"]')!);

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

    // The fix, at the request level, asserted AFTER the solve call settled:
    // week 1's Saturday (Oct 3) is never addressed, because it isn't the
    // selected Oct 31. A mismatch here fails the test directly — nothing
    // catches or swallows it.
    expect(captured.solveRequest?.weekends_with_saturday).toEqual([]);

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

  // Task 5 restated the predicate as "no columns at all" (specials counted),
  // which is what this gate always meant; the interaction moved from two
  // checkboxes to per-date calendar cells. The assertion is unchanged.
  it("Previsualizar → stays disabled when the calendar has no date selected at all", () => {
    const { container } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    deselectAll(container, "sunday");
    deselectAll(container, "saturday");
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

  // ── Task 4 fix pass, Finding (Important) ────────────────────────────────────
  //
  // Escape-to-close (Finding 4 above) called `onClose()` unconditionally, so
  // one keystroke could silently discard a full month of hand-assigned cells
  // — exactly what "← Volver"'s confirmation exists to prevent. Escape must
  // route through the SAME `pendingDiscard` guard, sharing `assignmentCount`
  // with "← Volver" rather than growing a second, divergence-prone check.
  it("Escape with assignments present shows the discard confirmation and does not call onClose", () => {
    const members = [
      { _id: "drum-1", member_name: "Beto", memberType: ["instrumento"] },
    ];
    const onClose = vi.fn();
    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={onClose} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);
    const drumsCell = container.querySelector('[data-row-id="instrumento:Drums"][data-date="2026-02-01"]');
    fireEvent.click(drumsCell!);
    fireEvent.click(screen.getByText("Beto"));
    fireEvent.click(screen.getByText("Cerrar"));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByText(/1 asignaci/i)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("confirming the Escape discard prompt closes the generator", () => {
    const members = [
      { _id: "drum-1", member_name: "Beto", memberType: ["instrumento"] },
    ];
    const onClose = vi.fn();
    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={onClose} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);
    const drumsCell = container.querySelector('[data-row-id="instrumento:Drums"][data-date="2026-02-01"]');
    fireEvent.click(drumsCell!);
    fireEvent.click(screen.getByText("Beto"));
    fireEvent.click(screen.getByText("Cerrar"));

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Cerrar de todos modos/ }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape with an empty grid closes immediately, no confirmation", () => {
    const onClose = vi.fn();
    const { container } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={onClose} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/descarta/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Cerrar de todos modos/ })).toBeNull();
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

  // ── Task 4 fix pass, Finding 2 ──────────────────────────────────────────────
  //
  // D9: with Domingos unchecked, the solve still runs on the full Sunday list
  // (unconditionally, via `sundayDatesFull`), but no Sunday service may be
  // RENDERED or CREATED — only `sundays`/`columns` gate that. `plannerModel`'s
  // pure `buildColumns` already pins this; nothing exercised the component
  // wiring that actually creates services and queues assignment emails.
  it("D9: with Domingos unchecked, no Sunday column is rendered and no sunday_role is ever POSTed", async () => {
    const { fetchMock, calls } = stubRolesFetch(() => ({ ok: true }));
    const { container } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 2, 2026);
    deselectAll(container, "sunday"); // Saturdays stay selected
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    // No column for the first Sunday of the month anywhere in the grid.
    expect(container.querySelector(`[data-date="${FEB_2026_SUNDAYS[0]}"]`)).toBeNull();

    fireEvent.click(createButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.body._type !== "sunday_role")).toBe(true);
  });

  // ── Task 5 fix pass, Findings 1 & 2: the two UNPINNED E21 call sites ────────
  //
  // `MonthGenerator` feeds FOUR consumers the full month's Sunday spine
  // (`sundayDatesFull`), never the calendar's selection, because the solver's
  // week number is POSITIONAL over that spine. Two of the four were already
  // pinned above — `buildSolveRequest` (the Oct-31 `weekends_with_saturday`
  // test) and `applySolveResponse` (the same test's "no Oct 3 draft"). The
  // other two were not: swapping `sundayDatesFull` for `selectedSundays` at
  // either of them left the WHOLE suite green, because `plannerModel.test.ts`
  // pins the pure functions given correct arguments and nothing pinned that
  // the component supplies them.
  //
  // March 2026 is the fixture for both: it starts on a Sunday (1, 8, 15, 22,
  // 29) and ends on a Tuesday, so EVERY Saturday (7, 14, 21, 28) has its
  // adjacent Sunday inside the month and the unaddressable set is empty at
  // rest. February 2026 cannot serve here — it ends on Saturday the 28th,
  // whose Sunday is in March, so it is unaddressable before anything is
  // deselected and the signal would be indistinguishable from the bug.

  it("E21: deselecting a Sunday does not make its adjacent Saturday 'fuera del alcance de Auto'", () => {
    const { container, unmount } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 3, 2026);
    // Deselect ONLY the third Sunday. Its adjacent Saturday (2026-03-14) stays
    // selected and the solver will still staff it — week 3 exists in the
    // request either way, because the request is built from the full spine.
    fireEvent.click(container.querySelector('[data-date="2026-03-15"]')!);
    // Then drop a Saturday that is addressable on any reading (2026-03-28 sits
    // beside Sunday the 29th). This is ordinary month setup, and it is also
    // what makes the assertion below load-bearing: `unaddressableDatesList` is
    // a `useMemo` keyed on [sundayDatesFull, activeSatDates], so a regression
    // that swapped the ARGUMENT alone would sit behind a stale memo and never
    // recompute after a Sunday toggle. Touching a Saturday invalidates the
    // memo, so the wrong spine — however it got there — has to show itself.
    fireEvent.click(container.querySelector('[data-date="2026-03-28"]')!);
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    // The Saturday's column is rendered...
    expect(container.querySelector('[data-date="2026-03-14"]')).toBeTruthy();
    // ...and carries no scope warning, on the header badge...
    expect(screen.queryByText("Fuera del alcance de Auto")).toBeNull();
    // ...nor in the Auto confirmation banner, whose sentence only grows the
    // "N sábado(s) fuera del alcance" clause when the list is non-empty.
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    expect(screen.getByText(/Esto reemplazará toda asignación de voz/).textContent).not.toMatch(
      /fuera del alcance de Auto/,
    );
    unmount();

    // CONTROL — the badge and the clause are not simply unrenderable. February
    // 2026's Saturday the 28th is genuinely unaddressable (its Sunday, March 1,
    // is outside the month's spine), so both must appear with nothing
    // deselected at all. Without this half, a `unaddressableDates` that always
    // returned [] would pass the assertions above.
    const second = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(second.container, 2, 2026);
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    expect(screen.getByText("Fuera del alcance de Auto")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    expect(screen.getByText(/Esto reemplazará toda asignación de voz/).textContent).toMatch(
      /1 sábado\(s\) fuera del alcance de Auto/,
    );
  });

  it("E21: an unfilled seat for week 3 lands on the THIRD Sunday of the month, not the third SELECTED one", async () => {
    const members = [
      { _id: "lead-1", member_name: "Ana", memberType: ["voz", "sunday_lead"] },
    ];
    // Capture only — never `expect()` inside a mock body (see the note above
    // the Oct-31 test for why an assertion there cannot fail a run).
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/solve") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            // Empty schedule: this test is about WHERE the unfilled marker
            // lands, so no cell is filled and "Sin cubrir" is the only signal.
            schedule: {},
            total_counts: {},
            role_counts: {},
            unfilled_seats: ["W3 Sunday Sun.BGV #1"],
          }),
        };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 3, 2026);
    deselectAll(container, "saturday");
    // Drop the FIRST Sunday. The spine is still [01, 08, 15, 22, 29], so week 3
    // is March 15; the SELECTION is [08, 15, 22, 29], whose third entry is
    // March 22 — a different, still-rendered column, which is what makes this
    // discriminating rather than merely "somewhere sensible".
    fireEvent.click(container.querySelector('[data-date="2026-03-01"]')!);

    fireEvent.click(screen.getByLabelText("Ana"));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByText(/Lugares sin cubrir/)).toBeTruthy());

    expect(
      container.querySelector('[data-row-id="bgv"][data-date="2026-03-15"]')?.textContent,
    ).toContain("Sin cubrir");
    expect(
      container.querySelector('[data-row-id="bgv"][data-date="2026-03-22"]')?.textContent ?? "",
    ).not.toContain("Sin cubrir");
  });

  // ── Task 4 fix pass, Finding 3 ──────────────────────────────────────────────
  //
  // D17 removed the config step's nested scrollers (`MemberPool`'s `max-h-32`,
  // `PresenceForm`'s `max-h-28`) so the panel's own width/height would carry a
  // long list instead of keyholing it. Checked on BOTH axes, matching
  // `PlannerGrid.test.tsx`'s style — a selector matching only one axis passes
  // vacuously. Members carry every pool's `memberType` so all three
  // `MemberPool` lists AND the presence form's list are all long simultaneously.
  it("the config step has no nested scroll region, even with long member lists and the presence form open", () => {
    const manyVoz = Array.from({ length: 20 }, (_, i) => ({
      _id: `v${i}`,
      member_name: `Miembro ${i}`,
      memberType: ["voz", "sunday_lead", "saturday_lead", "support"],
    }));
    render(
      <MonthGenerator members={manyVoz} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    // Open the "≥1 Presencia" add-form — its member list is the other one
    // D17 de-keyholed, and it isn't in the DOM until "adding" it.
    fireEvent.click(screen.getByRole("button", { name: /Presencia/ }));
    const scrollers = document.querySelectorAll(".overflow-x-auto, .overflow-y-auto");
    expect(scrollers.length).toBe(0);
  });

  // ── Task 4 fix pass, Finding 4 (D10) ────────────────────────────────────────
  //
  // The generator moved out of `CueDialog` into a full-width panel, silently
  // dropping Escape-to-close along with the focus trap and `aria-modal`. D10
  // required this task to settle the dismissal semantics; restored here to
  // match `ServiceReadinessCard`'s kebab menu (a `keydown` listener for
  // Escape). A full focus trap is judged out of scope — see the fix-pass
  // report for the reasoning (this panel replaces the whole view rather than
  // overlaying content that must stay untouchable).
  it("Escape closes the generator, from both the config step and the grid step", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={onClose} onCreated={vi.fn()} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const onClose2 = vi.fn();
    const { container } = render(
      <MonthGenerator members={noMembers} existingRoles={[]} onClose={onClose2} onCreated={vi.fn()} />,
    );
    goToPreview(container, 2, 2026);
    fireEvent.keyDown(document, { key: "Enter" }); // a non-Escape key is a no-op
    expect(onClose2).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose2).toHaveBeenCalledTimes(1);
  });

  // ── Task 4 fix pass, Finding 5 ──────────────────────────────────────────────
  //
  // `handleColumnSwap` ignored column type: swapping a Sunday column with a
  // Saturday column moved Coro cells onto a Saturday, which `cellsToDrafts`
  // zeroes (`chorus: []`) on write (D11) — the assignment vanished under a
  // success toast with no warning. Now refused, with a Spanish reason.
  it("refuses to swap a Sunday column with a Saturday column, so a Coro assignment is never silently dropped", () => {
    const members = [{ _id: "m1", member_name: "Ana", memberType: ["voz"] }];
    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 2, 2026);
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    // Assign Ana to Coro on the first Sunday (2026-02-01).
    const coroCell = container.querySelector('[data-row-id="coro"][data-date="2026-02-01"]');
    fireEvent.click(coroCell!);
    fireEvent.click(within(container.querySelector("ul")!).getByText("Ana"));
    fireEvent.click(screen.getByText("Cerrar"));
    expect(
      container.querySelector('[data-row-id="coro"][data-date="2026-02-01"]')?.textContent,
    ).toContain("Ana");

    // Try to swap that Sunday with the first Saturday of the month (2026-02-07).
    fireEvent.click(container.querySelector('[data-swap-date="2026-02-01"]')!);
    fireEvent.click(container.querySelector('[data-swap-date="2026-02-07"]')!);

    expect(screen.getByText(/No se puede intercambiar un Domingo con un Sábado/)).toBeTruthy();
    // Refused: Ana is still on the Sunday Coro cell, never moved anywhere.
    expect(
      container.querySelector('[data-row-id="coro"][data-date="2026-02-01"]')?.textContent,
    ).toContain("Ana");
    expect(
      container.querySelector('[data-row-id="coro"][data-date="2026-02-07"]')?.textContent ?? "",
    ).not.toContain("Ana");
  });
});
