/** @vitest-environment jsdom */
// Solver v3 C6 HZ-1–HZ-6, ST-1–ST-3 — the create planner under the v3 engine prop: the horizon
// control, one calendar per month, the month band inside the grid's own scroller, the sidebar's
// scope, and read-only «Guardado» columns from the stored editor's own coherent read. Under v2 none
// of it exists.
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderV3, routeFetch, seat, storedRole } from "./v3PlannerHarness";
import { deselectAll } from "./plannerWiringHarness";
import { ledgerResponse } from "./v3Fixtures";
import { ruleContextForTarget } from "../serviceRuleContext";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:00:00.000Z"));
  routeFetch((url) => (url.startsWith("/api/admin/fairness?") ? { status: 200, body: ledgerResponse(["2026-11", "2026-12"]) } : undefined),
    (url) => (url.startsWith("/api/admin/solver-history?") ? { status: 500, body: {} } : undefined));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const planear = () => screen.queryByRole("radiogroup", { name: "Planear" });
const twoMonths = () => fireEvent.click(within(planear()!).getByRole("radio", { name: "2 meses" }));
const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

describe("HZ-1 — «Planear: 1 mes · 2 meses»", () => {
  it("exists under v3 (default «1 mes») and is absent under v2", () => {
    renderV3();
    expect(within(planear()!).getByRole("radio", { name: "1 mes" }).getAttribute("aria-checked")).toBe("true");
    cleanup();
    renderV3({ engine: "v2" });
    expect(planear()).toBeNull();
  });
});

describe("HZ-4 / HZ-3 / HZ-2 — one calendar per month; dates belong to their own month; selections follow the horizon", () => {
  it("2 meses stacks November and December; 1 mes shows November only", () => {
    const { container } = renderV3();
    expect(container.querySelector('[data-date="2026-12-06"]')).toBeNull();
    twoMonths();
    expect(container.querySelector('[data-date="2026-11-01"]')).not.toBeNull();
    expect(container.querySelector('[data-date="2026-12-06"]')).not.toBeNull();
  });

  it("October + November offers Saturday 31 Oct once, under October", () => {
    const { container } = renderV3({ initialMonth: "2026-10" });
    twoMonths();
    expect(container.querySelectorAll('[data-date="2026-10-31"]')).toHaveLength(1);
  });

  it("a deselected December Sunday is forgotten when December leaves the horizon", () => {
    const { container } = renderV3();
    twoMonths();
    fireEvent.click(container.querySelector('[data-date="2026-12-06"]')!);
    expect(container.querySelector('[data-date="2026-12-06"]')!.getAttribute("data-selected")).toBe("false");
    fireEvent.click(within(planear()!).getByRole("radio", { name: "1 mes" }));
    twoMonths();
    expect(container.querySelector('[data-date="2026-12-06"]')!.getAttribute("data-selected")).toBe("true");
  });
});

describe("HZ-5 / HZ-6 — the grid spans the horizon", () => {
  it("one grid with a band per month inside its own horizontal scroller", () => {
    const { container } = renderV3();
    twoMonths();
    preview();
    const scroller = container.querySelector("[data-planner-scroller]")!;
    expect([...scroller.querySelectorAll("[data-month-band]")].map((b) => b.textContent)).toEqual(["Noviembre", "Diciembre"]);
    expect(container.querySelector('[data-grid-column-id="create:sunday_role__2026-12-06"]')).not.toBeNull();
  });

  it("the sidebar says which months it counts and offers «Noviembre · Diciembre · Ambos» (default «Ambos»)", () => {
    renderV3();
    twoMonths();
    preview();
    const scope = screen.getByRole("radiogroup", { name: "Cuenta" });
    expect(within(scope).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Noviembre", "Diciembre", "Ambos"]);
    expect(within(scope).getByRole("radio", { name: "Ambos" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Noviembre y diciembre · guardados + borradores")).toBeTruthy();
  });
});

describe("HZ-8 — grid-side rules keep using each column's own month spine", () => {
  it("a December column's rule context is December's Sundays inside a November + December horizon", () => {
    expect(ruleContextForTarget("sunday_role", "2026-12-13")?.sundayDates).toEqual(["2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27"]);
    expect(ruleContextForTarget("sunday_role", "2026-11-08")?.sundayDates[0]).toBe("2026-11-01");
  });
});

describe("ST-1 / ST-2 / ST-3 — «Guardado» columns", () => {
  const sunday = storedRole({ _id: "role-nov-01", _type: "sunday_role", date: "2026-11-01", leads: [seat("m-ana")] });

  it("a stored service of the horizon appears read-only as «Guardado», and no planned column is built for its target", () => {
    const { container } = renderV3({ roles: [sunday] });
    preview();
    const header = container.querySelector('[data-grid-column-id="role-nov-01"]')!;
    expect(within(header as HTMLElement).getByText("Guardado")).toBeTruthy();
    expect(container.querySelector('[data-grid-column-id="create:sunday_role__2026-11-01"]')).toBeNull();
  });

  it("ST-2: a stored special and a planned Sunday on one date render two columns with separate cells, and the confirm posts only the Sunday", () => {
    const special = storedRole({ _id: "role-sp-08", _type: "special_role", date: "2026-11-08", service_name: "Vigilia", countsForFairness: true, leads: [seat("m-bruno")] });
    const { container } = renderV3({ roles: [special] });
    deselectAll(container, "saturday");
    fireEvent.click(container.querySelector('[data-date="2026-11-01"]')!);
    fireEvent.click(container.querySelector('[data-date="2026-11-15"]')!);
    fireEvent.click(container.querySelector('[data-date="2026-11-22"]')!);
    fireEvent.click(container.querySelector('[data-date="2026-11-29"]')!);
    preview();
    expect(container.querySelector('[data-grid-column-id="role-sp-08"]')).not.toBeNull();
    expect(container.querySelector('[data-grid-column-id="create:sunday_role__2026-11-08"]')).not.toBeNull();
    const lead = (col: string) => container.querySelector(`[data-row-id="lead"][data-column-id="${col}"]`)!;
    expect(lead("role-sp-08").textContent).toContain("Bruno");
    expect(lead("create:sunday_role__2026-11-08").textContent).not.toContain("Bruno");
    expect(screen.getByRole("button", { name: /^Crear 1 borrador/ })).toBeTruthy();
  });

  it("ST-3: a «Guardado» cell opens no picker", () => {
    const { container } = renderV3({ roles: [sunday] });
    preview();
    fireEvent.click(container.querySelector('[data-row-id="lead"][data-column-id="role-nov-01"]')!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("under v2 the create grid shows no stored column", () => {
    const { container } = renderV3({ roles: [sunday], engine: "v2" });
    preview();
    expect(container.querySelector('[data-grid-column-id="role-nov-01"]')).toBeNull();
  });
});
