/** @vitest-environment jsdom */
// MonthGenerator with the fairness-history switch set to "derived" (R14, R15 of
// `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`; plan
// `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`, step 5).
//
// Production ships with the switch at "local", so every OTHER MonthGenerator
// suite exercises the per-browser path unchanged; this file is the only place
// the derived path runs, and it runs against the REAL grid (no PlannerGrid
// mock) because the Auto button lives there.
//
// The fetch mock routes by URL and only CAPTURES — no `expect()` inside it: the
// component wraps every fetch in try/catch, so an assertion thrown there would
// become an on-screen error toast instead of a failing test.
//
// Every name here is obviously fictitious (this repository is public).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../solverHistorySource", () => ({ SOLVER_HISTORY_SOURCE: "derived" }));

import MonthGenerator from "../MonthGenerator";
import { readyRules } from "./rulesHarness";
import type { SolverConfig, SolverHistoryEntry } from "../plannerModel";
import { historyWindow, type SolverHistoryDiagnostics } from "@/app/utils/solverHistory";

const HISTORY_KEY = "owt_solver_history_v2";
const AUTO_REFUSAL = "No se pudo leer el historial de equidad. Auto no corrió; reintenta.";
const DISPLAY_ERROR = "No se pudo leer el historial de equidad.";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ANA = { _id: "m-ana", member_name: "Ana Ficticia", memberType: ["voz", "sunday_lead"] };
const BETO = { _id: "m-beto", member_name: "Beto Ficticio", memberType: ["voz", "sunday_lead"] };
const MEMBERS = [ANA, BETO];

/** Both fictitious leads in the Sunday pool, no rules — so `buildSolveRequest` passes. */
const CONFIG: SolverConfig = {
  sundayLeads: [ANA._id, BETO._id],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [],
  presence: [],
};
/** Module-level and stable, so the planner's load-sync effect fires once. */
const RULES = readyRules(CONFIG);

type RoleCounts = Record<string, Record<string, number>>;

/**
 * A `200` body of `GET /api/admin/solver-history?month=…` for `year-month`: the
 * three window entries `historyWindow` names, oldest first, as the route sends
 * them.
 */
function payload(
  year: number,
  month: number,
  opts: { counts?: Record<string, RoleCounts>; emptyMonths?: string[]; diagnostics?: Partial<SolverHistoryDiagnostics> } = {},
) {
  const window = historyWindow({ year, month });
  const entries: SolverHistoryEntry[] = window.map((w) => {
    const role_counts = opts.counts?.[w.key] ?? {};
    const total_counts = Object.fromEntries(
      Object.entries(role_counts).map(([name, byRole]) => [name, Object.values(byRole).reduce((a, b) => a + b, 0)]),
    );
    return { key: w.key, year: w.year, month: w.month, total_counts, role_counts };
  });
  return {
    target: { year, month },
    entries,
    months: window.map((w) => ({ ...w, services: opts.emptyMonths?.includes(w.key) ? 0 : 5 })),
    diagnostics: {
      duplicateTargets: [],
      danglingSeats: [],
      unnamedMembers: [],
      duplicateNames: [],
      ...opts.diagnostics,
    },
  };
}

/** What `buildSolveRequest` puts on the wire for a set of entries. */
const onTheWire = (entries: SolverHistoryEntry[]) =>
  entries.map((e) => ({ total_counts: e.total_counts, role_counts: e.role_counts }));

// ─── fetch ───────────────────────────────────────────────────────────────────

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

const respond = (status: number, body: unknown): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const UNAVAILABLE = () => respond(500, { error: "history_unavailable", message: "No disponible." });

const SOLVED = () =>
  respond(200, {
    ok: true,
    schedule: { "1": { Sunday: { Lead: ["Ana Ficticia"], BGV: [], Choir: [] } } },
    total_counts: { "Ana Ficticia": 1 },
    role_counts: { "Ana Ficticia": { "Sun.Lead": 1 } },
    unfilled_seats: [],
    history_runs_used: 3,
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Routes `fetch` by URL. `history` answers `/api/admin/solver-history` for the
 * `month` query (`YYYY-MM`) it was asked for; the solve and create endpoints
 * record their bodies. Anything else throws.
 */
function stubFetch(routes: {
  history: (month: string) => FakeResponse | Promise<FakeResponse>;
  solve?: () => FakeResponse;
}) {
  const historyCalls: string[] = [];
  const historyInits: Array<RequestInit | undefined> = [];
  const solveBodies: Array<{ history: unknown }> = [];
  const rolesBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/admin/solver-history?")) {
      const month = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("month") ?? "";
      historyCalls.push(month);
      historyInits.push(init);
      return routes.history(month);
    }
    if (url === "/api/admin/solve") {
      solveBodies.push(JSON.parse(String(init?.body)));
      return (routes.solve ?? SOLVED)();
    }
    if (url === "/api/admin/roles") {
      rolesBodies.push(JSON.parse(String(init?.body)));
      return respond(200, {});
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, historyCalls, historyInits, solveBodies, rolesBodies };
}

// ─── Rendering and DOM helpers ───────────────────────────────────────────────

function renderCreate(initialMonth: string, props: Partial<ComponentProps<typeof MonthGenerator>> = {}) {
  return render(
    <MonthGenerator
      members={MEMBERS}
      existingRoles={[]}
      onClose={vi.fn()}
      onCreated={vi.fn()}
      rules={RULES}
      initialMonth={initialMonth}
      {...props}
    />,
  );
}

/** Stored mode with no services: the grid's lead-pool mount is all there is to see. */
function renderStored(initialMonth: string) {
  return render(
    <MonthGenerator
      mode="stored"
      members={MEMBERS}
      existingRoles={[]}
      allRoles={[]}
      initialMonth={initialMonth}
      storedSource={{
        roles: [],
        integrity: { targets: [], recordIssues: [], lockIssues: [] },
        rolesStatus: "ready",
        integrityStatus: "ready",
        rolesGeneration: 1,
        integrityGeneration: 1,
        reload: vi.fn(async () => true),
      }}
      rules={RULES}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
}

function deselectAll(container: HTMLElement, kind: "sunday" | "saturday") {
  const dates = Array.from(container.querySelectorAll(`[data-day-kind="${kind}"]`)).map((el) =>
    el.getAttribute("data-date"),
  );
  for (const date of dates) {
    const cell = container.querySelector(`[data-date="${date}"]`);
    if (cell?.getAttribute("data-selected") === "true") fireEvent.click(cell);
  }
}

function addSpecial(container: HTMLElement, date: string, name: string) {
  fireEvent.click(container.querySelector(`[data-date="${date}"]`)!);
  fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
}

const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

/** Auto sits behind a confirmation step. */
function runAuto() {
  fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
}

const cellAt = (container: HTMLElement, rowId: string, date: string) =>
  container.querySelector(`[data-row-id="${rowId}"][data-date="${date}"]`) as HTMLElement;

/** One `LeadPoolHistoryPanel` column, by its own header. */
const leadColumn = (service: "Domingo" | "Sábado", priorMonth: string) =>
  screen.getByText(`${service} — sin Lead en ${priorMonth}`).parentElement as HTMLElement;

const createButton = () => screen.getByRole("button", { name: /^Crear \d+ borrador/ });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

// ─── 1–2: R14, the solve's history is its own month's, read at solve time ────

describe("derived history — the solve reads its OWN month's history at solve time (R14)", () => {
  it("1. a month switch while the display read is pending: Auto sends November's entries, and October's late answer never reaches the display", async () => {
    const october = deferred<FakeResponse>();
    const november = payload(2026, 11, { counts: { "2026-10": { "Ana Ficticia": { "Sun.Lead": 2 } } } });
    const { historyCalls, historyInits, solveBodies } = stubFetch({
      history: (month) => (month === "2026-10" ? october.promise : month === "2026-11" ? respond(200, november) : UNAVAILABLE()),
    });

    const { container } = renderCreate("2026-10");
    expect(historyCalls).toEqual(["2026-10"]);
    expect(historyInits[0]).toMatchObject({ cache: "no-store" });

    // Switch to November while October's display read is still in flight.
    fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: "11" } });
    await waitFor(() =>
      expect(within(leadColumn("Domingo", "Octubre 2026")).getByText("Beto Ficticio")).toBeTruthy(),
    );
    expect(within(leadColumn("Domingo", "Octubre 2026")).queryByText("Ana Ficticia")).toBeNull();

    deselectAll(container, "saturday");
    preview();
    runAuto();
    await waitFor(() => expect(solveBodies).toHaveLength(1));

    // The solve's history is November's window, and it was READ AGAIN for the
    // solve — never the display's copy.
    expect(solveBodies[0].history).toEqual(onTheWire(november.entries));
    expect(historyCalls).toEqual(["2026-10", "2026-11", "2026-11"]);

    // October answers late, AFTER November settled. A last-write-wins display
    // would now show October's window (no 2026-10 entry → everyone "sin Lead").
    await act(async () => {
      october.resolve(respond(200, payload(2026, 10, { counts: { "2026-9": { "Beto Ficticio": { "Sun.Lead": 1 } } } })));
      await october.promise;
    });
    const column = leadColumn("Domingo", "Octubre 2026");
    expect(within(column).getByText("Beto Ficticio")).toBeTruthy();
    expect(within(column).queryByText("Ana Ficticia")).toBeNull();
  });

  it("2. fresh at solve time: the display loaded X, the server now answers Y, and Auto sends Y", async () => {
    const x = payload(2026, 11, { counts: { "2026-10": { "Ana Ficticia": { "Sun.Lead": 1 } } } });
    const y = payload(2026, 11, {
      counts: { "2026-10": { "Beto Ficticio": { "Sun.Lead": 3 } } },
      emptyMonths: ["2026-8"],
    });
    const server = { current: x };
    const { solveBodies } = stubFetch({ history: () => respond(200, server.current) });

    const { container } = renderCreate("2026-11");
    await waitFor(() =>
      expect(within(leadColumn("Domingo", "Octubre 2026")).getByText("Beto Ficticio")).toBeTruthy(),
    );

    deselectAll(container, "saturday");
    preview();
    server.current = y; // someone saved an October service meanwhile
    runAuto();
    await waitFor(() => expect(solveBodies).toHaveLength(1));

    expect(solveBodies[0].history).toEqual(onTheWire(y.entries));
    // The grid names the months the solve used, from ITS read — and never the
    // always-3 run count (R4).
    expect(screen.getByText("Historial: ago (sin servicios) · sep · oct")).toBeTruthy();
    expect(screen.queryByText(/Historial usado/)).toBeNull();
  });
});

// ─── 3: a failed read at Auto is a pre-flight refusal ────────────────────────

describe("derived history — a failed read at Auto never solves (spec, Failure)", () => {
  /** November with its Sundays, no Saturdays, and a Wednesday special. */
  async function toGridWithSpecial(history: (call: number) => FakeResponse | Promise<FakeResponse>) {
    let call = 0;
    const stub = stubFetch({ history: () => history(++call) });
    const view = renderCreate("2026-11");
    await waitFor(() => expect(screen.getByText("Domingo — sin Lead en Octubre 2026")).toBeTruthy());
    deselectAll(view.container, "saturday");
    addSpecial(view.container, "2026-11-18", "Vigilia Ficticia");
    preview();
    return { ...view, ...stub };
  }

  it("3. the read fails: no /api/admin/solve call, the refusal shows, and the special still fills", async () => {
    const { container, fetchMock, solveBodies } = await toGridWithSpecial((call) =>
      call === 1 ? respond(200, payload(2026, 11)) : UNAVAILABLE(),
    );

    runAuto();
    await waitFor(() => expect(screen.getByText(AUTO_REFUSAL)).toBeTruthy());

    expect(solveBodies).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/solve")).toBe(false);
    // E5: the special never needed the solver.
    expect(cellAt(container, "lead", "2026-11-18").textContent).toMatch(/Ana Ficticia|Beto Ficticio/);
    // And the weekend was NOT solved on an empty history.
    expect(cellAt(container, "lead", "2026-11-01").textContent).not.toMatch(/Ana Ficticia|Beto Ficticio/);
    expect(screen.getByRole("button", { name: /Auto-asignar con Solver/ })).toBeTruthy();
  });

  it("3b. a read that hangs is cut off at 20 s and takes the same refusal — Auto is not left pending", async () => {
    const { container, solveBodies } = await toGridWithSpecial((call) =>
      call === 1 ? respond(200, payload(2026, 11)) : new Promise<FakeResponse>(() => {}),
    );

    // Hold the 20 s timer instead of waiting for it; every other timer runs.
    const realSetTimeout = globalThis.setTimeout;
    const twentySeconds: Array<() => void> = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, timeout?: number, ...args: unknown[]) => {
      if (timeout === 20_000) {
        twentySeconds.push(handler);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout);

    runAuto();
    await waitFor(() => expect(twentySeconds).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Calculando..." })).toBeTruthy();

    await act(async () => {
      twentySeconds[0]();
    });
    await waitFor(() => expect(screen.getByText(AUTO_REFUSAL)).toBeTruthy());
    expect(solveBodies).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Calculando..." })).toBeNull();
    expect(cellAt(container, "lead", "2026-11-18").textContent).toMatch(/Ana Ficticia|Beto Ficticio/);
  });
});

// ─── The solve path reads the LATEST render, not the press ───────────────────

describe("derived history — what happens on the grid while Auto's read is in flight", () => {
  it("an edit made during the read survives: the refusal fills from the CURRENT cells, not the ones captured at the press", async () => {
    // Create mode does not lock the grid while Auto is pending (`mutationLocked`
    // is stored-mode only), so a seat can be typed while the read is out. A
    // path that filled from the press-time closure would write that snapshot
    // back and drop the seat.
    const autoRead = deferred<FakeResponse>();
    let call = 0;
    stubFetch({ history: () => (++call === 1 ? respond(200, payload(2026, 11)) : autoRead.promise) });
    const { container } = renderCreate("2026-11");
    await waitFor(() => expect(screen.getByText("Domingo — sin Lead en Octubre 2026")).toBeTruthy());
    deselectAll(container, "saturday");
    preview();

    runAuto();
    await waitFor(() => expect(screen.getByRole("button", { name: "Calculando..." })).toBeTruthy());
    fireEvent.click(cellAt(container, "lead", "2026-11-08"));
    fireEvent.click(within(container.querySelector("[data-candidate-picker]") as HTMLElement).getByText("Beto Ficticio"));
    fireEvent.click(screen.getByText("Cerrar"));
    expect(cellAt(container, "lead", "2026-11-08").textContent).toContain("Beto Ficticio");

    await act(async () => {
      autoRead.resolve(UNAVAILABLE());
      await autoRead.promise;
    });
    await waitFor(() => expect(screen.getByText(AUTO_REFUSAL)).toBeTruthy());
    expect(cellAt(container, "lead", "2026-11-08").textContent).toContain("Beto Ficticio");
  });

  it("a month changed during the read is not solved with the previous month's history (R14)", async () => {
    const autoRead = deferred<FakeResponse>();
    let novemberCalls = 0;
    const { solveBodies } = stubFetch({
      history: (month) =>
        month === "2026-11" && ++novemberCalls === 2 ? autoRead.promise : respond(200, payload(Number(month.slice(0, 4)), Number(month.slice(5)))),
    });
    const { container } = renderCreate("2026-11");
    await waitFor(() => expect(screen.getByText("Domingo — sin Lead en Octubre 2026")).toBeTruthy());
    deselectAll(container, "saturday");
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByRole("button", { name: "Calculando..." })).toBeTruthy());

    // Back to the setup step (nothing assigned, so no discard prompt) and on to December.
    fireEvent.click(screen.getByRole("button", { name: "← Volver" }));
    fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: "12" } });

    await act(async () => {
      autoRead.resolve(respond(200, payload(2026, 11)));
      await autoRead.promise;
    });
    // The pending flag clears, and nothing was solved for December on November's window.
    await waitFor(() => expect(screen.getByText("Domingo — sin Lead en Noviembre 2026")).toBeTruthy());
    expect(solveBodies).toHaveLength(0);
  });
});

// ─── 4–5: R15, localStorage is written as the rollback target, never read ────

const SEEDED_LOCAL: SolverHistoryEntry[] = [
  { key: "2026-6", year: 2026, month: 6, total_counts: { "Zoe Ficticia": 1 }, role_counts: { "Zoe Ficticia": { "Sun.Lead": 1 } } },
  { key: "2026-9", year: 2026, month: 9, total_counts: { "Zoe Ficticia": 2 }, role_counts: { "Zoe Ficticia": { "Sun.BGV": 2 } } },
];

describe("derived history — localStorage stays the rollback target (R15)", () => {
  it("4. dual-write: a confirm merges the new entry into localStorage's OWN contents, and no derived entry lands there", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(SEEDED_LOCAL));
    // D disagrees with L on 2026-9, so a write built from D would be visible.
    const derived = payload(2026, 11, {
      counts: {
        "2026-8": { "Ana Ficticia": { "Sun.BGV": 1 } },
        "2026-9": { "Ana Ficticia": { "Sun.Lead": 4 } },
        "2026-10": { "Ana Ficticia": { "Sun.Lead": 2 } },
      },
    });
    const { rolesBodies } = stubFetch({ history: () => respond(200, derived) });
    const onClose = vi.fn();
    const { container } = renderCreate("2026-11", { onClose });
    await waitFor(() => expect(screen.getByText("Domingo — sin Lead en Octubre 2026")).toBeTruthy());

    deselectAll(container, "saturday");
    preview();
    fireEvent.click(cellAt(container, "lead", "2026-11-01"));
    fireEvent.click(within(container.querySelector("[data-candidate-picker]") as HTMLElement).getByText("Beto Ficticio"));
    fireEvent.click(screen.getByText("Cerrar"));
    fireEvent.click(createButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(rolesBodies.length).toBeGreaterThan(0);

    expect(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "null")).toEqual([
      ...SEEDED_LOCAL,
      {
        key: "2026-11",
        year: 2026,
        month: 11,
        total_counts: { "Beto Ficticio": 1 },
        role_counts: { "Beto Ficticio": { "Sun.Lead": 1 } },
      },
    ]);
  });

  it("5. no history source is read from localStorage on the way to a solve", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(SEEDED_LOCAL));
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const derived = payload(2026, 11, { counts: { "2026-10": { "Ana Ficticia": { "Sun.Lead": 1 } } } });
    const { solveBodies } = stubFetch({ history: () => respond(200, derived) });

    const { container } = renderCreate("2026-11");
    await waitFor(() => expect(screen.getByText("Domingo — sin Lead en Octubre 2026")).toBeTruthy());
    deselectAll(container, "saturday");
    preview();
    runAuto();
    await waitFor(() => expect(solveBodies).toHaveLength(1));

    expect(getItem.mock.calls.filter(([key]) => key === HISTORY_KEY)).toEqual([]);
    expect(solveBodies[0].history).toEqual(onTheWire(derived.entries));
  });
});

// ─── 6: the derived display ──────────────────────────────────────────────────

describe("derived history — the display", () => {
  it("6. read-only chips, the derived header, the diagnostics, and the lead pool's empty-month copy", async () => {
    stubFetch({
      history: () =>
        respond(
          200,
          payload(2026, 11, {
            emptyMonths: ["2026-10"],
            diagnostics: {
              danglingSeats: [{ roleId: "role-ficticio", day: "2026-09-06", path: "Lead", memberId: "m-borrado" }],
              duplicateNames: [{ name: "Ana Ficticia", memberIds: ["m-ana", "m-ana-bis"] }],
              duplicateTargets: [{ type: "sunday_role", day: "2026-08-02", roleIds: ["role-a", "role-b"] }],
            },
          }),
        ),
    });
    renderCreate("2026-11");

    await waitFor(() =>
      expect(screen.getByText("Historial de equidad — derivado de los servicios guardados")).toBeTruthy(),
    );
    expect(screen.getByText("Ago 2026")).toBeTruthy();
    expect(screen.getByText("Sep 2026")).toBeTruthy();
    expect(screen.getByText("Oct 2026 · sin servicios")).toBeTruthy();
    // Read-only: a derived month cannot be deleted.
    expect(screen.queryByTitle("Eliminar del historial")).toBeNull();
    expect(screen.queryByRole("button", { name: "×" })).toBeNull();

    // R7: always shown beside the history, never on request.
    expect(screen.getByText(/no cuentan/)).toBeTruthy();
    expect(screen.getByText(/el solver los confunde/)).toBeTruthy();
    expect(screen.getByText(/no cuenta ninguno/)).toBeTruthy();

    // The lead pool names the empty month instead of «Sin historial guardado…».
    expect(screen.getAllByText("Sin servicios de fin de semana en Octubre 2026.")).toHaveLength(2);
    expect(screen.queryByText(/Sin historial guardado/)).toBeNull();
    // Nobody led in a month with no services, so the whole pool is listed.
    expect(within(leadColumn("Domingo", "Octubre 2026")).getByText("Ana Ficticia")).toBeTruthy();
    expect(within(leadColumn("Domingo", "Octubre 2026")).getByText("Beto Ficticio")).toBeTruthy();
  });
});

// ─── 7: no leader list until the history is `ready` ──────────────────────────

describe("derived history — no leader list until the read is ready, in both lead-pool mounts", () => {
  const mounts = [
    { name: "create mode (the config step's panel)", renderIt: () => renderCreate("2026-11") },
    { name: "stored mode (the grid's panel)", renderIt: () => renderStored("2026-11") },
  ];

  for (const { name, renderIt } of mounts) {
    it(`7. ${name}: a failed read shows the error and «Reintentar», never a list; a retry that succeeds renders the list`, async () => {
      const server = { fail: true };
      const { historyCalls } = stubFetch({
        history: () => (server.fail ? UNAVAILABLE() : respond(200, payload(2026, 11))),
      });
      renderIt();

      await waitFor(() => expect(screen.getAllByText(DISPLAY_ERROR).length).toBeGreaterThan(0));
      expect(screen.queryByText(/sin Lead/)).toBeNull();
      expect(screen.queryByText(/Sin historial guardado/)).toBeNull();
      expect(screen.queryByText(/Sin servicios de fin de semana/)).toBeNull();

      server.fail = false;
      fireEvent.click(screen.getAllByRole("button", { name: "Reintentar" })[0]);
      await waitFor(() => expect(screen.getByText("Domingo — sin Lead en Octubre 2026")).toBeTruthy());
      expect(historyCalls).toEqual(["2026-11", "2026-11"]);
      expect(within(leadColumn("Domingo", "Octubre 2026")).getByText("Ana Ficticia")).toBeTruthy();
      expect(screen.queryByText(DISPLAY_ERROR)).toBeNull();
    });

    it(`7. ${name}: while the read is pending there is a skeleton and no list`, async () => {
      stubFetch({ history: () => new Promise<FakeResponse>(() => {}) });
      renderIt();

      expect(screen.getAllByRole("status", { name: "Cargando el historial de equidad…" }).length).toBeGreaterThan(0);
      expect(screen.queryByText(/sin Lead/)).toBeNull();
      expect(screen.queryByText(/Sin historial guardado/)).toBeNull();
      expect(screen.queryByText(DISPLAY_ERROR)).toBeNull();
    });
  }
});

// ─── 8: I-4 — the local writers stay gated behind the switch ────────────────
//
// `saveHistoryEntry`/`removeHistoryEntry` (module-private to `MonthGenerator.tsx`)
// now both open with `if (SOLVER_HISTORY_SOURCE !== "local") return;`. Neither is
// reachable from this file's derived-mode renders: `handleConfirm` already
// branches on the switch before calling either writer (`appendLocalHistoryEntry`
// runs instead), and the delete chip that calls `removeHistoryEntry` only renders
// when `history.length > 0` on the LOCAL `solverHistory` React state — which the
// load effect never hydrates in derived mode, so it stays `[]` and the chip never
// mounts. There is therefore no UI seam that calls either guarded function while
// derived — that absence is the point of the guard, not a gap in this test.
//
// What IS testable without exporting either function or restructuring the
// component: the outcome the guard exists to prevent. If either writer ever ran
// with derived mode's always-empty `solverHistory` state, its `next` would be `[]`
// or a strict subset of what's stored, and it would stamp that over
// `owt_solver_history_v2` — destroying R15's rollback target that
// `appendLocalHistoryEntry` maintains separately. This test seeds that key, spies
// on every write to it across a full create-confirm round trip, and asserts none
// of them ever shrinks it.
describe("derived history — the local writers stay gated behind the switch (I-4)", () => {
  it("8. a full create-confirm round trip never shrinks the seeded localStorage entry", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(SEEDED_LOCAL));
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const derived = payload(2026, 11);
    stubFetch({ history: () => respond(200, derived) });
    const onClose = vi.fn();
    const { container } = renderCreate("2026-11", { onClose });
    await waitFor(() => expect(screen.getByText("Domingo — sin Lead en Octubre 2026")).toBeTruthy());

    deselectAll(container, "saturday");
    preview();
    fireEvent.click(cellAt(container, "lead", "2026-11-01"));
    fireEvent.click(within(container.querySelector("[data-candidate-picker]") as HTMLElement).getByText("Beto Ficticio"));
    fireEvent.click(screen.getByText("Cerrar"));
    fireEvent.click(createButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const historyWrites = setItemSpy.mock.calls.filter(([key]) => key === HISTORY_KEY);
    expect(historyWrites.length).toBeGreaterThan(0);
    for (const [, value] of historyWrites) {
      const parsed = JSON.parse(value as string) as unknown[];
      expect(parsed.length).toBeGreaterThanOrEqual(SEEDED_LOCAL.length);
    }
    // The final value is still exactly the additive dual-write R15 promises —
    // never a writer's own truncated rebuild from an empty React state.
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "null")).toEqual([
      ...SEEDED_LOCAL,
      {
        key: "2026-11",
        year: 2026,
        month: 11,
        total_counts: { "Beto Ficticio": 1 },
        role_counts: { "Beto Ficticio": { "Sun.Lead": 1 } },
      },
    ]);
  });
});
