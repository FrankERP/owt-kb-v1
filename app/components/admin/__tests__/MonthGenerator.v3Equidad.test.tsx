/** @vitest-environment jsdom */
// Solver v3 C6 EQ-1, EQ-2, EQ-4, EQ-6, ST-8, WN-1, WN-3 — what the planner shows about fairness and
// month states under each engine: the v2 history surfaces under v2 only, C2's banner under v2 only,
// the cadence line from the run's own states, the plan's values in a person's phone card, the four
// month-state banners and read-only pools, C3's warning naming the months it applies to, and the
// Saturday-pool note.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { echoV3, renderV3, routeFetch, solveRoute } from "./v3PlannerHarness";
import { deselectAll } from "./plannerWiringHarness";
import { ALL_IN, config, ledgerPerson, ledgerResponse, record, restriction } from "./v3Fixtures";
import { CADENCE_OUTSIDE_HEADING, CADENCE_OUTSIDE_SENTENCE } from "@/app/utils/sundayCadence";
import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:00:00.000Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const historyRoute = (url: string) => (url.startsWith("/api/admin/solver-history?") ? { status: 500, body: {} } : undefined);
const ledgerRoute = (byQuery: (q: URLSearchParams) => FairnessLedgerResponse) => (url: string) =>
  url.startsWith("/api/admin/fairness?") ? { status: 200, body: byQuery(new URLSearchParams(url.split("?")[1])) } : undefined;
const months = (q: URLSearchParams) => (q.get("horizon") === "2" ? [q.get("month")!, "2026-12"] : [q.get("month")!]);
const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
const openEquidad = () => fireEvent.click(screen.getAllByRole("button", { name: "Equidad · vista previa" })[0]);

describe("EQ-1 / EQ-2 — which surfaces each engine mounts", () => {
  it("v2: the history surfaces and C2's «Vista previa» banner; v3: neither", async () => {
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q))));
    renderV3({ engine: "v2", config: config() });
    expect(screen.getByText(/^Historial — derivado de los servicios guardados/)).toBeTruthy();
    openEquidad();
    await waitFor(() => expect(screen.getByText("Vista previa: Auto todavía no usa este saldo")).toBeTruthy());
    cleanup();
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q))));
    renderV3({ engine: "v3", config: config() });
    expect(screen.queryByText(/^Historial — derivado de los servicios guardados/)).toBeNull();
    openEquidad();
    await waitFor(() => expect(screen.getByText("Le tocaba")).toBeTruthy());
    expect(screen.queryByText("Vista previa: Auto todavía no usa este saldo")).toBeNull();
    expect(screen.getAllByText("En este plan").length).toBeGreaterThan(0);
  });
});

describe("ST-8 — the four month states, on screen", () => {
  const rec = (m: string) => record(m, [{ memberId: "m-ana", name: "Ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }], { recordedAt: `${m}-02T18:00:00.000Z` });

  it("bound: its banner; every month bound: the pools are read-only with the all-bound banner", async () => {
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q), { horizon: months(q).map((m) => ({ record: rec(m), storedServices: 2, recordBinds: true })) })));
    renderV3({ config: config({ sundayLeads: ["m-ana"] }) });
    await waitFor(() => expect(screen.getByText(/^Noviembre ya tienen servicios guardados y elegibilidad registrada: se planea con esas listas/)).toBeTruthy());
    for (const box of screen.getAllByRole("checkbox", { name: "Ana" })) expect((box as HTMLInputElement).disabled).toBe(true);
  });

  it("a mixed 2-month horizon: one bound banner, one recorded-unbound banner, and editable pools", async () => {
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q), {
      horizon: [{ record: rec("2026-11"), storedServices: 1, recordBinds: true }, { record: rec("2026-12"), storedServices: 0, recordBinds: false }].slice(0, months(q).length),
    })));
    renderV3({ config: config({ sundayLeads: ["m-ana"] }) });
    fireEvent.click(screen.getByRole("radio", { name: "2 meses" }));
    await waitFor(() => expect(screen.getByText(/^Noviembre ya tiene servicios guardados y elegibilidad registrada \(2 nov\)/)).toBeTruthy());
    expect(screen.getByText(/^Diciembre tiene elegibilidad registrada \(2 dic\) pero ningún servicio guardado/)).toBeTruthy();
    for (const box of screen.getAllByRole("checkbox", { name: "Ana" })) expect((box as HTMLInputElement).disabled).toBe(false);
  });

  it("an anchored, unrecorded month says its record will be created with the screen and then frozen", async () => {
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q), { horizon: [{ record: null, storedServices: 3, recordBinds: false }] })));
    renderV3({ config: config() });
    await waitFor(() => expect(screen.getByText(/^Noviembre ya tiene servicios guardados pero no tiene elegibilidad registrada/)).toBeTruthy());
  });
});

describe("WN-1 / WN-3 — C3's warning names its months; the Saturday-pool note", () => {
  // Ana carries «Mes por medio» and the Sunday Tipo but is not ticked in «Líderes Domingo» → `not_ticked`.
  const cadenceOut = config({ restrictions: [restriction("r-ana", "Ana", { sundayCadence: "alternate" })] });

  it("no read yet: open, naming the horizon; under v2: closed", () => {
    routeFetch(historyRoute, () => undefined, (url) => (url.startsWith("/api/admin/fairness?") ? { status: 500, body: {} } : undefined));
    renderV3({ config: cadenceOut });
    expect(screen.getByText(`${CADENCE_OUTSIDE_HEADING} — Noviembre`)).toBeTruthy();
    expect(screen.getByText(CADENCE_OUTSIDE_SENTENCE.not_ticked("Ana"))).toBeTruthy();
    cleanup();
    routeFetch(historyRoute, (url) => (url.startsWith("/api/admin/fairness?") ? { status: 500, body: {} } : undefined));
    renderV3({ engine: "v2", config: cadenceOut });
    expect(screen.queryByText(new RegExp(CADENCE_OUTSIDE_HEADING))).toBeNull();
  });

  it("a 2-month horizon with one bound month names only the unbound one; every month bound closes it", async () => {
    const bound = record("2026-11", []);
    routeFetch(historyRoute, ledgerRoute((q) => ledgerResponse(months(q), {
      horizon: [{ record: bound, storedServices: 1, recordBinds: true }, { record: null, storedServices: 0, recordBinds: false }].slice(0, months(q).length),
    })));
    renderV3({ config: cadenceOut });
    fireEvent.click(screen.getByRole("radio", { name: "2 meses" }));
    await waitFor(() => expect(screen.getByText(`${CADENCE_OUTSIDE_HEADING} — Diciembre`)).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: "1 mes" }));
    await waitFor(() => expect(screen.queryByText(new RegExp(CADENCE_OUTSIDE_HEADING))).toBeNull());
  });

  it("WN-3: a non-empty «Líderes Sábado» gets the note under v3 only", () => {
    routeFetch(historyRoute, (url) => (url.startsWith("/api/admin/fairness?") ? { status: 500, body: {} } : undefined));
    renderV3({ config: config({ saturdayLeads: ["m-carla"] }) });
    expect(screen.getByText("Con el nuevo solver, «Líderes Sábado» ya no aparta un líder para cada sábado: quien esté solo ahí dirige únicamente sábados.")).toBeTruthy();
    cleanup();
    routeFetch(historyRoute, (url) => (url.startsWith("/api/admin/fairness?") ? { status: 500, body: {} } : undefined));
    renderV3({ engine: "v2", config: config({ saturdayLeads: ["m-carla"] }) });
    expect(screen.queryByText(/ya no aparta un líder/)).toBeNull();
  });
});

describe("EQ-4 — the cadence line after a run is RQ-4's own value", () => {
  it("a Sunday the planner skipped is not a request service, so the run says «no dirige domingo» where the preview said «le toca»", async () => {
    const cfg = config({ sundayLeads: ["m-ana", "m-bruno"], restrictions: [restriction("r-ana", "Ana", { sundayCadence: "alternate" })] });
    const people = [ledgerPerson("m-ana", "Ana", { tabs: { window: { DL: { share: 0, received: 0, balance: 0, seats: 0, tenths: { share: 0, balance: 0 } } }, cumulative: {} } })];
    const solve = solveRoute((r) => ({ status: 200, body: echoV3(r) }));
    routeFetch(historyRoute, solve.route, ledgerRoute((q) => ledgerResponse(months(q), { people })));
    const anaAway = { _id: "m-ana", member_name: "Ana Ruiz", alias: "Ana", memberType: ["voz", "sunday_lead"], unavailableDates: ["2026-11-08"] };
    const { container } = renderV3({ config: cfg, members: [anaAway, { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "sunday_lead"] }] as never });
    deselectAll(container, "saturday");
    for (const d of ["2026-11-01", "2026-11-15", "2026-11-22", "2026-11-29"]) fireEvent.click(container.querySelector(`[data-date="${d}"]`)!);
    preview();
    openEquidad();
    await waitFor(() => expect(screen.getAllByText(/En nov le toca domingo \(previsto\)\./).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    // Ana is eligible nowhere in this request (her one planned Sunday is a day off), so she is not
    // sent; RQ-4's state is computed for her anyway and is what the panel shows.
    await waitFor(() => expect(screen.getAllByText(/En nov no dirige domingo: ningún domingo disponible\./).length).toBeGreaterThan(0));
    expect(screen.queryAllByText(/En nov le toca domingo/)).toHaveLength(0);
  });
});
describe("EQ-6 — at phone width: one card per person, and the plan's values inside it", () => {
  // jsdom lays nothing out and the panel asks `matchMedia` nothing, so a 390 px viewport (stubbed
  // the way `participationAlongside.test.tsx` stubs a narrow one) renders the same DOM: what is
  // asserted is the split by class — the cards `md:hidden`, the table `hidden md:block` inside its
  // OWN `overflow-x-auto` box (no page-level horizontal scroll, ADR-0035) — and what Ana's card
  // SAYS, scoped to `[data-fairness-cards]`. The real phone look stays C7's.
  it("after a v3 run, Ana's card reads «En este plan 2 · Queda le deben 0.3»", async () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }));
    const dl = { carried: 0, share: 0, received: 200, pinned: 0, seats: 2, pinned_seats: 0, after: 0, tenths: { share: 0, after: 3 } };
    const solve = solveRoute((r) => ({
      status: 200,
      body: { ...echoV3(r), fairness: { scale: 100, tolerance: 35, lines: [], people: [{ person: "m-ana", floor: [], lines: {}, tabs: { DL: dl } }] } },
    }));
    const people = [ledgerPerson("m-ana", "Ana", { tabs: { window: { DL: { share: 0, received: 0, balance: 0, seats: 0, tenths: { share: 0, balance: 0 } } }, cumulative: {} } })];
    routeFetch(historyRoute, solve.route, ledgerRoute((q) => ledgerResponse(months(q), { people })));
    renderV3({ config: config({ sundayLeads: ["m-ana"] }) });
    preview();
    openEquidad();
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(solve.requests).toHaveLength(1));
    const anaCards = () =>
      Array.from(document.querySelectorAll("[data-fairness-cards] > li")).filter((li) => li.querySelector("p")?.textContent === "Ana") as HTMLElement[];
    await waitFor(() => expect(anaCards().length).toBeGreaterThan(0));
    for (const card of anaCards()) expect(within(card).getByText("En este plan 2 · Queda le deben 0.3")).toBeTruthy();
    for (const list of Array.from(document.querySelectorAll("[data-fairness-cards]"))) expect(list.classList.contains("md:hidden")).toBe(true);
    for (const table of Array.from(document.querySelectorAll("[data-fairness-table]"))) {
      expect(["hidden", "md:block", "overflow-x-auto"].every((c) => table.classList.contains(c))).toBe(true);
    }
  });
});
