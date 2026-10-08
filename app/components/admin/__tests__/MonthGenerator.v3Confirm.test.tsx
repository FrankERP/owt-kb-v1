/** @vitest-environment jsdom */
// Solver v3 C6 §5.11 (CRITICAL), wired: after a v3 Auto the confirm sends ONE PUT with the entries
// frozen at the solve (the revision read then, never re-read), then the drafts; without an Auto it
// reads the ledger fresh first; a refusal creates nothing and keeps the dialog open; a 2-month confirm
// has no publish; one history entry per month; leaving with gaps asks first, from either step.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { echoV3, renderV3, routeFetch, solveRoute } from "./v3PlannerHarness";
import { deselectAll, selectSundayLead } from "./plannerWiringHarness";
import { ALL_IN, MEMBERS, config, ledgerResponse, record } from "./v3Fixtures";
import { resolveMonthSources } from "../v3MonthSources";
import type { FairnessLedgerResponse, FairnessMonthsPut } from "@/app/utils/fairnessVocabulary";

const POOLS = config({ sundayLeads: ["m-ana", "m-bruno"], support: ["m-dani"] });
const historyRoute = (url: string) => (url.startsWith("/api/admin/solver-history?") ? { status: 500, body: {} } : undefined);

function ledgerRouteSwitchable(initial: (months: string[]) => FairnessLedgerResponse) {
  let answer = initial;
  const reads: string[] = [];
  return {
    reads,
    set: (next: typeof initial) => { answer = next; },
    route: (url: string) => {
      if (!url.startsWith("/api/admin/fairness?")) return undefined;
      reads.push(url);
      const q = new URLSearchParams(url.split("?")[1]);
      const months = q.get("horizon") === "2" ? [q.get("month")!, "2026-12"] : [q.get("month")!];
      return { status: 200, body: answer(months) };
    },
  };
}
function putRoute(respond: (body: FairnessMonthsPut, n: number) => { status: number; body: unknown }) {
  const bodies: string[] = [];
  return {
    bodies,
    route: (url: string, init?: RequestInit) => {
      if (url !== "/api/admin/fairness/months" || init?.method !== "PUT") return undefined;
      bodies.push(String(init.body));
      return respond(JSON.parse(String(init.body)) as FairnessMonthsPut, bodies.length);
    },
  };
}
function postRoute(respond: (body: { creationRequestId: string; date: string; published: boolean }, n: number) => { status: number; body: unknown } = () => ({ status: 201, body: {} })) {
  const bodies: Array<{ creationRequestId: string; date: string; published: boolean }> = [];
  return {
    bodies,
    route: (url: string, init?: RequestInit) => {
      if (url !== "/api/admin/roles" || init?.method !== "POST") return undefined;
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      return respond(body, bodies.length);
    },
  };
}
const outcomes = (months: string[], outcome = "created") => ({
  status: 200, body: { months: months.map((month) => ({ month, outcome, rev: "new", contentHash: "sha256:x", recordedAt: "t" })) },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:00:00.000Z"));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const onlySundays = (container: HTMLElement, keep: string[]) => {
  deselectAll(container, "saturday");
  for (const el of Array.from(container.querySelectorAll('[data-day-kind="sunday"]'))) {
    const date = el.getAttribute("data-date")!;
    if (!keep.includes(date) && el.getAttribute("data-selected") === "true") fireEvent.click(el);
  }
};
const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
const runAuto = () => {
  fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
};
const createDrafts = () => fireEvent.click(screen.getByRole("button", { name: /^Crear \d+ borrador/ }));

describe("after a v3 Auto (CF-1–CF-5)", () => {
  it("ONE PUT with the entries frozen at the solve — the revision read then, not a re-read — then the POSTs by date", async () => {
    const recNov = record("2026-11", [{ memberId: "m-ana", name: "Ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }], { rev: "rev-at-auto" });
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m, { horizon: [{ record: recNov, storedServices: 0, recordBinds: false }] }));
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month), "replaced"));
    const post = postRoute();
    const { calls } = routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08", "2026-11-01"]);
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied, not just sent
    // Someone replaces the record meanwhile: the confirm must still assert the rev it SOLVED with (WR-15).
    ledger.set((m) => ledgerResponse(m, { horizon: [{ record: { ...recNov, rev: "rev-later" }, storedServices: 0, recordBinds: false }] }));
    const readsBefore = ledger.reads.length;
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(post.bodies).toHaveLength(2));
    expect(ledger.reads.length).toBe(readsBefore);                                   // no re-read before the PUT
    expect(put.bodies).toHaveLength(1);
    const sent = JSON.parse(put.bodies[0]) as FairnessMonthsPut;
    expect(sent.months).toHaveLength(1);
    expect(sent.months[0]).toMatchObject({ month: "2026-11", source: "auto", expectedRev: "rev-at-auto" });
    const order = calls.map((c) => c.url).filter((u) => u === "/api/admin/fairness/months" || u === "/api/admin/roles");
    expect(order).toEqual(["/api/admin/fairness/months", "/api/admin/roles", "/api/admin/roles"]);
    expect(post.bodies.map((b) => b.date)).toEqual(["2026-11-01", "2026-11-08"]);
  });

  it("CF-2: pools edited after Auto — the record sent is the SOLVED one, never a re-resolution of the screen", async () => {
    const recNov = record("2026-11", [{ memberId: "m-ana", name: "Ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }], { rev: "rev-at-auto" });
    const ledgerBody = (m: string[]) => ledgerResponse(m, { horizon: [{ record: recNov, storedServices: 0, recordBinds: false }] });
    const ledger = ledgerRouteSwitchable(ledgerBody);
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month), "replaced"));
    const post = postRoute();
    routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied, not just sent
    // Back to the config step (the board has a seat, so the discard banner asks), drop Bruno from
    // «Líderes Domingo», preview again — the board is rebuilt, the frozen record is not.
    fireEvent.click(screen.getByRole("button", { name: "← Volver" }));
    fireEvent.click(screen.getByRole("button", { name: "Volver de todos modos" }));
    selectSundayLead(container, "Bruno");
    preview();
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(post.bodies).toHaveLength(1));
    const brunoSunLead = (cfg: typeof POOLS) => {
      const sources = resolveMonthSources({ months: ["2026-11"], ledger: ledgerBody(["2026-11"]), config: cfg, members: MEMBERS, exactLeadLabel: () => null });
      if (!sources.ok) throw new Error(sources.lines.join());
      return sources.sources[0].body.people.find((p) => p.memberId === "m-bruno")?.roles["Sun.Lead"];
    };
    const solved = brunoSunLead(POOLS);
    const edited = brunoSunLead(config({ sundayLeads: ["m-ana"], support: ["m-dani"] }));
    expect(solved).not.toEqual(edited);                                                // the fixture discriminates
    const sent = (JSON.parse(put.bodies[0]) as FairnessMonthsPut).months[0];
    expect(sent).toMatchObject({ month: "2026-11", source: "auto", expectedRev: "rev-at-auto" });
    expect(sent.people.find((p) => p.memberId === "m-bruno")?.roles["Sun.Lead"]).toEqual(solved);
  });

  it("a record refusal creates NO draft, keeps the dialog open with its line, and offers no «Reintentar»", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute(() => ({ status: 409, body: { error: "stale_revision", message: "x", conflict: true, details: { detail: "record_exists", months: [{ month: "2026-11", verdict: "record_exists" }] } } }));
    const post = postRoute();
    const onClose = vi.fn();
    routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS, onClose });
    onlySundays(container, ["2026-11-08"]);
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied, not just sent
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("Otro administrador registró o cambió la elegibilidad de noviembre mientras planeabas. No se creó nada; vuelve a correr Auto.")).toBeTruthy());
    expect(post.bodies).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Reintentar \(/ })).toBeNull();
  });

  it("«other failure» offers «Reintentar (n pendientes)», whose PUT body is byte-identical (CF-7)", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute((b, n) => (n === 1 ? { status: 500, body: null } : outcomes(b.months.map((x) => x.month))));
    const post = postRoute();
    routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied, not just sent
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("No se pudo registrar la elegibilidad. No se creó nada; pulsa «Reintentar».")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reintentar (1 pendientes)" })); });
    await waitFor(() => expect(post.bodies).toHaveLength(1));
    expect(put.bodies[1]).toBe(put.bodies[0]);
  });

  it("CF-1: across the month boundary the confirm writes nothing and offers no «Reintentar»", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute();
    routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    runAuto();
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied, not just sent
    vi.setSystemTime(new Date("2026-12-01T12:00:00.000Z"));
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("Noviembre ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto.")).toBeTruthy());
    expect(put.bodies).toHaveLength(0);
    expect(post.bodies).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Reintentar \(/ })).toBeNull();
  });

  it("the lock's other half (CF-2, CF-7): while a v3 Auto is pending both Crear buttons are disabled and no PUT goes out", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute();
    const { mock } = routeFetch(historyRoute, ledger.route, solve.route, put.route, post.route);
    // Hold the solve open so the run stays pending; every other call goes straight to the routes.
    let release!: () => void;
    const solveGate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/solve") await solveGate;
      return mock(url, init);
    });
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    runAuto();
    await waitFor(() => expect(screen.getByText("Calculando...")).toBeTruthy());
    expect((screen.getByRole("button", { name: /^Crear \d+ borrador/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Crear y publicar" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { createDrafts(); });                                      // a click on the disabled button does nothing
    expect(put.bodies).toHaveLength(0);
    expect(post.bodies).toHaveLength(0);
    await act(async () => { release(); });
    await waitFor(() => expect(screen.queryByText("Calculando...")).toBeNull());     // the run is applied
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(post.bodies).toHaveLength(1));
    expect(put.bodies).toHaveLength(1);
  });
});

describe("without a v3 Auto (CF-2's fresh read)", () => {
  it("reads the ledger fresh at the first confirm and sends the screen's body as `manual`", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute();
    routeFetch(historyRoute, ledger.route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    const readsBefore = ledger.reads.length;
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(post.bodies).toHaveLength(1));
    expect(ledger.reads.length).toBe(readsBefore + 1);
    expect(JSON.parse(put.bodies[0]).months[0]).toMatchObject({ month: "2026-11", source: "manual", expectedRev: null });
  });

  it("a failed read creates nothing", async () => {
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute();
    routeFetch(historyRoute, (url) => (url.startsWith("/api/admin/fairness?") ? { status: 500, body: { error: "fairness_unavailable" } } : undefined), put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    onlySundays(container, ["2026-11-08"]);
    preview();
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("No se pudo leer el saldo de equidad. Auto no corrió; vuelve a intentar.")).toBeTruthy());
    expect(put.bodies).toHaveLength(0);
    expect(post.bodies).toHaveLength(0);
  });

  it("HZ-9: a month past the ceiling refuses with nothing read or written", async () => {
    const ledger = ledgerRouteSwitchable((m) => ledgerResponse(m));
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    routeFetch(historyRoute, ledger.route, put.route, postRoute().route);
    const { container } = renderV3({ config: POOLS, initialMonth: "2027-11" });
    onlySundays(container, ["2027-11-07"]);
    preview();
    const readsBefore = ledger.reads.length;
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("Auto no planea más de 12 meses adelante: Noviembre queda fuera. Elige un mes hasta octubre.")).toBeTruthy());
    expect(ledger.reads.length).toBe(readsBefore);
    expect(put.bodies).toHaveLength(0);
  });
});

describe("CF-8, CF-9, CF-10", () => {
  it("a 2-month confirm has no «Crear y publicar» and says each month's count; a 1-month one keeps it", () => {
    routeFetch(historyRoute, ledgerRouteSwitchable((m) => ledgerResponse(m)).route);
    const { container } = renderV3({ config: POOLS });
    fireEvent.click(screen.getByRole("radio", { name: "2 meses" }));
    onlySundays(container, ["2026-11-08", "2026-12-06"]);
    preview();
    expect(screen.queryByRole("button", { name: "Crear y publicar" })).toBeNull();
    expect(screen.getByText("Noviembre: 1 · Diciembre: 1. Se crean como borradores; publícalos después.")).toBeTruthy();
    cleanup();
    routeFetch(historyRoute, ledgerRouteSwitchable((m) => ledgerResponse(m)).route);
    renderV3({ config: POOLS });
    preview();
    expect(screen.getByRole("button", { name: "Crear y publicar" })).toBeTruthy();
  });

  it("one history entry per month with a weekend draft created (two for a 2-month confirm)", async () => {
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute();
    routeFetch(historyRoute, ledgerRouteSwitchable((m) => ledgerResponse(m)).route, put.route, post.route);
    const { container } = renderV3({ config: POOLS });
    fireEvent.click(screen.getByRole("radio", { name: "2 meses" }));
    onlySundays(container, ["2026-11-08", "2026-12-06"]);
    preview();
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(post.bodies).toHaveLength(2));
    const entries = JSON.parse(localStorage.getItem("owt_solver_history_v2") ?? "[]") as Array<{ year: number; month: number }>;
    expect(entries.map((e) => [e.year, e.month]).sort()).toEqual([[2026, 11], [2026, 12]]);
  });

  async function partialFailure(onClose = vi.fn()) {
    const put = putRoute((b) => outcomes(b.months.map((x) => x.month)));
    const post = postRoute((_b, n) => (n === 1 ? { status: 201, body: {} } : { status: 500, body: { error: "x" } }));
    routeFetch(historyRoute, ledgerRouteSwitchable((m) => ledgerResponse(m)).route, put.route, post.route);
    const { container } = renderV3({ config: POOLS, onClose });
    onlySundays(container, ["2026-11-01", "2026-11-08"]);
    preview();
    await act(async () => { createDrafts(); });
    await waitFor(() => expect(screen.getByText("Noviembre: 1 de 2 creados; 1 fallaron.")).toBeTruthy());
    return { onClose, container };
  }
  const incomplete = () => screen.queryByRole("dialog", { name: "El plan quedó incompleto" });

  it("«Cancelar» after a partial failure asks «El plan quedó incompleto»; «Seguir aquí» stays, «Salir así» leaves", async () => {
    const { onClose } = await partialFailure();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(incomplete()).toBeTruthy();
    expect(screen.getByText(/Noviembre: faltan 1 servicios\. Si sales, se quedan así; puedes completarlos en «Editar mes»\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));
    await waitFor(() => expect(incomplete()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });                                   // Escape asks too
    expect(incomplete()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salir así" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the CONFIG step asks too: «← Volver» then «Cancelar», and Escape there, open the dialog — never an unprompted exit", async () => {
    const { onClose } = await partialFailure();
    fireEvent.click(screen.getByRole("button", { name: "← Volver" }));               // no seat on the board: no discard banner
    expect(screen.getByRole("button", { name: /Previsualizar/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(incomplete()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));
    await waitFor(() => expect(incomplete()).toBeNull());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(incomplete()).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));
    await waitFor(() => expect(incomplete()).toBeNull());
    // The provider lifts the app root's aria-hidden one frame after the last layer leaves; wait for it.
    await waitFor(() => expect(screen.getByRole("button", { name: /Previsualizar/ })).toBeTruthy());
    // Back on the grid the dialog is closed (no stale open state) and the gap is still there to ask about.
    preview();
    expect(incomplete()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(incomplete()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salir así" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
