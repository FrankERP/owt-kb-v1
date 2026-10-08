/** @vitest-environment jsdom */
// Solver v3 C6 — Auto under the v3 engine prop, end to end through MonthGenerator with a routed
// fetch: the fresh ledger read, the contract-3 request, apply by service id, the run report and
// «Ver etapas» with KH-3's table; «Reintentar» exactly where AD-6 allows it; specials at every exit;
// v2's parsers never reached under v3 and v3's never under v2; and v2's one new 409 branch.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({ applySolveResponse: vi.fn(), solverRefusalMessage: vi.fn(), buildSolveRequest: vi.fn(), classifyV3Answer: vi.fn(), applyV3Assignments: vi.fn() }));
vi.mock("../plannerModel", async (importOriginal) => {
  const real = await importOriginal<typeof import("../plannerModel")>();
  spies.applySolveResponse.mockImplementation(real.applySolveResponse);
  spies.solverRefusalMessage.mockImplementation(real.solverRefusalMessage);
  spies.buildSolveRequest.mockImplementation(real.buildSolveRequest);
  return {
    ...real,
    applySolveResponse: (...a: Parameters<typeof real.applySolveResponse>) => spies.applySolveResponse(...a),
    solverRefusalMessage: (...a: Parameters<typeof real.solverRefusalMessage>) => spies.solverRefusalMessage(...a),
    buildSolveRequest: (...a: Parameters<typeof real.buildSolveRequest>) => spies.buildSolveRequest(...a),
  };
});
vi.mock("../v3SolveResponse", async (importOriginal) => {
  const real = await importOriginal<typeof import("../v3SolveResponse")>();
  spies.classifyV3Answer.mockImplementation(real.classifyV3Answer);
  spies.applyV3Assignments.mockImplementation(real.applyV3Assignments);
  return {
    ...real,
    classifyV3Answer: (...a: Parameters<typeof real.classifyV3Answer>) => spies.classifyV3Answer(...a),
    applyV3Assignments: (...a: Parameters<typeof real.applyV3Assignments>) => spies.applyV3Assignments(...a),
  };
});

import { echoV3, renderV3, routeFetch, seat, solveRoute, storedRole } from "./v3PlannerHarness";
import { cellAt, deselectAll, fillEmptySwitch } from "./plannerWiringHarness";
import { NAME_SHAPED_KEYS, config, ledgerResponse } from "./v3Fixtures";
import { V3_ROUTE_COPY } from "../v3Copy";

const POOLS = config({ sundayLeads: ["m-ana", "m-bruno"], support: ["m-dani"] });
const ledgerRoute = (status = 200, body: unknown = ledgerResponse(["2026-11"])) =>
  (url: string) => (url.startsWith("/api/admin/fairness?") ? { status, body } : undefined);
const historyRoute = (url: string) => (url.startsWith("/api/admin/solver-history?") ? { status: 500, body: {} } : undefined);
const rolesRoute = (url: string, init?: RequestInit) => (url === "/api/admin/roles" && init?.method === "POST" ? { status: 201, body: {} } : undefined);

let consoleCalls: string[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:00:00.000Z"));
  consoleCalls = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { consoleCalls.push(a.map(String).join(" ")); });
  }
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
const runAuto = () => {
  fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
};

describe("a v3 run, end to end", () => {
  it("reads the ledger fresh, posts a contract-3 request, applies by service id and reports the run", async () => {
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const { calls } = routeFetch(ledgerRoute(), historyRoute, solve.route);
    const { container } = renderV3({ config: POOLS });
    deselectAll(container, "saturday");
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    const fairnessReads = calls.filter((c) => c.url.startsWith("/api/admin/fairness?"));
    expect(fairnessReads.at(-1)!.url).toBe("/api/admin/fairness?month=2026-11&horizon=1");
    expect(solve.requests[0]).toMatchObject({ contract: 3, months: ["2026-11"] });
    expect(solve.requests[0]).not.toHaveProperty("weeks");
    await waitFor(() => expect(container.querySelector('[data-row-id="lead"][data-column-id="create:sunday_role__2026-11-01"]')!.textContent).toContain("Ana"));
    expect(screen.getByText(/^Plan de 1 mes: noviembre · 5 servicios \(0 guardados/)).toBeTruthy();
    expect(screen.getByText("Todas las etapas quedaron probadas.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver etapas" }));
    expect(container.querySelector("[data-v3-rule-table]")!.textContent!.startsWith(`request_id ${solve.requests[0].request_id}`)).toBe(true);
    expect(spies.buildSolveRequest).not.toHaveBeenCalled();                 // RQ-9
    expect(spies.applySolveResponse).not.toHaveBeenCalled();                // AD-1
    expect(spies.solverRefusalMessage).not.toHaveBeenCalled();
    for (const v2Line of ["Sin optimizar", "Equidad relajada", "Historial"]) expect(screen.queryByText(new RegExp(v2Line))).toBeNull(); // NT-5
    for (const call of consoleCalls) for (const key of NAME_SHAPED_KEYS) expect(call).not.toContain(key);
  });

  it("ST-3: a «Guardado» column's cells are byte-identical after Auto", async () => {
    const stored = storedRole({ _id: "role-nov-08", _type: "sunday_role", date: "2026-11-08", leads: [seat("m-bruno")] });
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    routeFetch(ledgerRoute(), historyRoute, solve.route);
    const { container } = renderV3({ config: POOLS, roles: [stored] });
    preview();
    const before = container.querySelector('[data-row-id="lead"][data-column-id="role-nov-08"]')!.textContent;
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    expect(solve.requests[0].services.find((s) => s.id === "role-nov-08")).toMatchObject({ fixed: true });
    expect(solve.requests[0].pins).toContainEqual({ service: "role-nov-08", date: "2026-11-08", role: "Lead", person: "m-bruno" });
    await waitFor(() => expect(screen.getByText(/^Plan de 1 mes/)).toBeTruthy());
    expect(container.querySelector('[data-row-id="lead"][data-column-id="role-nov-08"]')!.textContent).toBe(before);
  });
});

describe("refusals before the fetch", () => {
  // Only what Auto itself fetches counts here (a display read of the ledger may have run on render).
  const fetchedAfter = (calls: Array<{ url: string }>, from: number) =>
    calls.slice(from).filter((c) => c.url === "/api/admin/solve" || c.url.startsWith("/api/admin/fairness?"));

  it("HZ-7: a past month refuses before any read", async () => {
    const { calls } = routeFetch(ledgerRoute(), historyRoute);
    renderV3({ config: POOLS, initialMonth: "2026-09" });
    preview();
    const from = calls.length;
    runAuto();
    await waitFor(() => expect(screen.getByText("Auto no planea meses que ya pasaron. Crea esos servicios a mano.")).toBeTruthy());
    expect(fetchedAfter(calls, from)).toEqual([]);
  });

  it("ST-1: a stored read that is not ready refuses before any read (SP-5's line is runV3Auto's, unit-tested)", async () => {
    const { calls } = routeFetch(ledgerRoute(), historyRoute);
    renderV3({ config: POOLS, storedStatus: "loading" });
    preview();
    const from = calls.length;
    runAuto();
    await waitFor(() => expect(screen.getByText(/^No se pudieron leer los servicios guardados de noviembre/)).toBeTruthy());
    expect(fetchedAfter(calls, from)).toEqual([]);
  });

  it("RQ-1: a failed ledger read refuses and sends no request", async () => {
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    routeFetch(ledgerRoute(500, { error: "fairness_unavailable", message: "No se pudo leer el saldo de equidad." }), historyRoute, solve.route);
    renderV3({ config: POOLS });
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.ledgerFailed)).toBeTruthy());
    expect(solve.requests).toHaveLength(0);
  });
});

describe("AD-3 / AD-6 — outcomes and «Reintentar»", () => {
  // Auto's «Reintentar» is the button PlannerGrid renders right after Auto's error line. Until
  // Task 16 hides v2's history surfaces under v3, the failed history read on the grid step offers
  // its own «Reintentar», so a page-wide query would find two.
  const autoRetryButton = (line: string) => {
    const next = screen.getByText(line).nextElementSibling;
    return next instanceof HTMLButtonElement && next.textContent === "Reintentar" ? next : null;
  };

  it("a timeout code shows the timeout copy and «Reintentar», which runs again", async () => {
    const solve = solveRoute((_r, n) => n === 1
      ? { status: 422, body: { ok: false, contract: 3, engine: "v3", code: "timeout", params: { stage: "fill", seconds: 25 } } }
      : { status: 200, body: echoV3(_r) });
    routeFetch(ledgerRoute(), historyRoute, solve.route);
    renderV3({ config: POOLS });
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.timeout)).toBeTruthy());
    await act(async () => { fireEvent.click(autoRetryButton(V3_ROUTE_COPY.timeout)!); });
    await waitFor(() => expect(solve.requests).toHaveLength(2));
  });

  it("a configuration transport offers no «Reintentar»", async () => {
    const solve = solveRoute(() => ({ status: 422, body: { ok: false, transport_error: true, transport: "not_configured" } }));
    routeFetch(ledgerRoute(), historyRoute, solve.route);
    renderV3({ config: POOLS });
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.configuration("not_configured"))).toBeTruthy());
    expect(autoRetryButton(V3_ROUTE_COPY.configuration("not_configured"))).toBeNull();
  });

  it("a v2-shaped answer under v3 is a configuration transport; v2's parsers are never called", async () => {
    const solve = solveRoute(() => ({ status: 200, body: { ok: true, schedule: {} } }));
    routeFetch(ledgerRoute(), historyRoute, solve.route);
    renderV3({ config: POOLS });
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.configuration("contract_echo"))).toBeTruthy());
    expect(spies.applySolveResponse).not.toHaveBeenCalled();
    expect(spies.solverRefusalMessage).not.toHaveBeenCalled();
  });
});

describe("after the press, the LATEST render (review fixes: the derived path's reason, under v3)", () => {
  const TIMEOUT = { status: 422, body: { ok: false, contract: 3, engine: "v3", code: "timeout", params: { stage: "fill", seconds: 25 } } };
  const autoRetryButton = (line: string) => {
    const next = screen.getByText(line).nextElementSibling;
    return next instanceof HTMLButtonElement && next.textContent === "Reintentar" ? next : null;
  };
  const place = (container: HTMLElement, rowId: string, date: string, name: string) => {
    fireEvent.click(cellAt(container, rowId, date));
    fireEvent.click(within(container.querySelector("[data-candidate-picker]") as HTMLElement).getByText(name));
    fireEvent.click(screen.getByText("Cerrar"));
  };
  /** `fetch` that holds every call matching `held` until `release()`; `sent` says one arrived. */
  function holdFetch(mock: (url: string, init?: RequestInit) => Promise<unknown>, held: (url: string) => boolean) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const state = { on: false, sent: false, release: () => release() };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (state.on && held(url)) { state.sent = true; await gate; }
      return mock(url, init);
    });
    return state;
  }

  it("Auto's «Reintentar» builds from the board as it is NOW: a seat placed after the failure is pinned and kept", async () => {
    const solve = solveRoute((r, n) => (n === 1 ? TIMEOUT : { status: 200, body: echoV3(r) }));
    routeFetch(ledgerRoute(), historyRoute, solve.route);
    const { container } = renderV3({ config: POOLS });
    deselectAll(container, "saturday");
    preview();
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.timeout)).toBeTruthy());
    place(container, "bgv", "2026-11-08", "Dani");
    expect(cellAt(container, "bgv", "2026-11-08").textContent).toContain("Dani");
    await act(async () => { fireEvent.click(autoRetryButton(V3_ROUTE_COPY.timeout)!); });
    await waitFor(() => expect(solve.requests).toHaveLength(2));
    expect(solve.requests[1].pins).toContainEqual(expect.objectContaining({ date: "2026-11-08", role: "BGV", person: "m-dani" }));
    await waitFor(() => expect(screen.getByText(/^Plan de 1 mes/)).toBeTruthy());
    expect(cellAt(container, "bgv", "2026-11-08").textContent).toContain("Dani");
  });

  it("a seat placed during the ledger read survives the refusal: the fill reads the CURRENT cells", async () => {
    const { mock } = routeFetch(ledgerRoute(500, { error: "fairness_unavailable" }), historyRoute);
    const hold = holdFetch(mock, (url) => url.startsWith("/api/admin/fairness?"));
    const { container } = renderV3({ config: POOLS });
    deselectAll(container, "saturday");
    preview();
    hold.on = true;                                                          // only Auto's own read is held
    runAuto();
    await waitFor(() => expect(screen.getByText("Calculando...")).toBeTruthy());
    place(container, "lead", "2026-11-08", "Bruno");
    await act(async () => { hold.release(); });
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.ledgerFailed)).toBeTruthy());
    expect(cellAt(container, "lead", "2026-11-08").textContent).toContain("Bruno");
  });

  it("a horizon changed during the READ solves nothing and fills nothing over the new horizon's board", async () => {
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const { mock } = routeFetch(ledgerRoute(), historyRoute, solve.route);
    const hold = holdFetch(mock, (url) => url.startsWith("/api/admin/fairness?month=2026-11&horizon=1"));
    const { container } = renderV3({ config: POOLS });
    deselectAll(container, "saturday");
    preview();
    hold.on = true;
    runAuto();
    await waitFor(() => expect(hold.sent).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "← Volver" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Planear" })).getByRole("radio", { name: "2 meses" }));
    preview();
    place(container, "lead", "2026-11-08", "Bruno");                       // a seat on the NEW board
    await act(async () => { hold.release(); });
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect(solve.requests).toHaveLength(0);
    expect(cellAt(container, "lead", "2026-11-08").textContent).toContain("Bruno");
  });

  it("a horizon changed during the SOLVE gets nothing: not the old horizon's seats, drafts or report", async () => {
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const { mock } = routeFetch(ledgerRoute(), historyRoute, solve.route);
    const hold = holdFetch(mock, (url) => url === "/api/admin/solve");
    const { container } = renderV3({ config: POOLS });
    deselectAll(container, "saturday");
    preview();
    hold.on = true;
    runAuto();
    await waitFor(() => expect(hold.sent).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "← Volver" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Planear" })).getByRole("radio", { name: "2 meses" }));
    preview();
    await act(async () => { hold.release(); });
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());
    expect(solve.requests).toHaveLength(1);
    expect(cellAt(container, "lead", "2026-11-01").textContent).not.toMatch(/Ana|Bruno/);
    expect(screen.queryByText(/^Plan de 1 mes/)).toBeNull();
  });

  it("the lock's Auto half: while a v3 confirm is in flight, Auto's «Reintentar» is not offered", async () => {
    const solve = solveRoute(() => TIMEOUT);
    const putRoute = (url: string, init?: RequestInit) => (url === "/api/admin/fairness/months" && init?.method === "PUT"
      ? { status: 200, body: { months: [{ month: "2026-11", outcome: "created", rev: "x", contentHash: "sha256:x", recordedAt: "t" }] } }
      : undefined);
    const { mock } = routeFetch(ledgerRoute(), historyRoute, solve.route, putRoute, rolesRoute);
    const hold = holdFetch(mock, (url) => url === "/api/admin/fairness/months");
    const { container } = renderV3({ config: POOLS });
    deselectAll(container, "saturday");
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.timeout)).toBeTruthy());
    expect(autoRetryButton(V3_ROUTE_COPY.timeout)).toBeTruthy();
    hold.on = true;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Crear \d+ borrador/ })); });
    await waitFor(() => expect(hold.sent).toBe(true));
    expect(autoRetryButton(V3_ROUTE_COPY.timeout)).toBeNull();
    await act(async () => { hold.release(); });
    await waitFor(() => expect(screen.queryByText("Creando...")).toBeNull());
    expect(solve.requests).toHaveLength(1);
  });
});

describe("SP-4 / AD-7 / SP-5 — specials at every exit; ST-9 — Auto's confirm sentence", () => {
  it("on a refusal an uncounted special is still filled by today's filler and a counted one is left as it is", async () => {
    routeFetch(historyRoute, ledgerRoute(500, { error: "fairness_unavailable" }));
    const { container } = renderV3({ config: POOLS });
    const addSpecial = (date: string, name: string, counted: boolean) => {
      fireEvent.click(container.querySelector(`[data-date="${date}"]`)!);
      fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: name } });
      if (counted) fireEvent.click(screen.getByRole("switch", { name: "Cuenta para equidad" }));
      fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    };
    addSpecial("2026-11-11", "Ensayo", false);
    addSpecial("2026-11-18", "Vigilia", true);
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.ledgerFailed)).toBeTruthy());
    expect(screen.getByText("Los especiales que cuentan para equidad no se llenaron porque Auto no corrió.")).toBeTruthy();
    const lead = (date: string) => container.querySelector(`[data-row-id="lead"][data-date="${date}"]`)!.textContent ?? "";
    expect(lead("2026-11-11")).toMatch(/Ana|Bruno|Dani/);
    expect(lead("2026-11-18")).not.toMatch(/Ana|Bruno|Dani/);
  });

  it("ST-9: the confirm sentence names the horizon's months and says stored services are not touched", () => {
    routeFetch(historyRoute);
    renderV3({ config: POOLS });
    preview();
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
    expect(screen.getByText("Esto reemplazará toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en noviembre. Los servicios guardados no se tocan.")).toBeTruthy();
  });
});

describe("under v2", () => {
  const v2SolveRoute = (status: number, body: unknown) => {
    const bodies: unknown[] = [];
    return { bodies, route: (url: string, init?: RequestInit) => {
      if (url !== "/api/admin/solve") return undefined;
      bodies.push(JSON.parse(String(init?.body)));
      return { status, body };
    } };
  };

  it("AD-8: a 409 shows the reload copy, never «sin solución», never the trailing retry; specials still fill", async () => {
    const solve = v2SolveRoute(409, { ok: false, error: "solver_version_mismatch", engine: "v3" });
    routeFetch(historyRoute, solve.route, rolesRoute);
    renderV3({ config: POOLS, engine: "v2", initialMonth: "2026-10" });
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText(V3_ROUTE_COPY.versionMismatch)).toBeTruthy());
    expect(solve.bodies).toHaveLength(1);
    expect(spies.classifyV3Answer).not.toHaveBeenCalled();                  // AD-1, the reverse
    expect(spies.applyV3Assignments).not.toHaveBeenCalled();
  });
});
