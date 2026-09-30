// app/components/admin/__tests__/plannerWiringHarness.tsx
//
// Shared by the «Solo llenar vacíos» and «Borrar» wiring suites — NOT a test file. `Gen`,
// fixtures and DOM helpers as `instrumentFill.wiring.test.tsx` defines them, plus the switch.
import { fireEvent, screen, within } from "@testing-library/react";

import MonthGenerator from "../MonthGenerator";
import type { SolverConfigController } from "../solverConfigSource";
import { AdminProviders } from "./providersHarness";
import { readyRules } from "./rulesHarness";

const DEFAULT_RULES = readyRules();

export function Gen({
  rules = DEFAULT_RULES,
  ...props
}: Omit<React.ComponentProps<typeof MonthGenerator>, "rules"> & { rules?: SolverConfigController }) {
  return (
    <AdminProviders>
      <MonthGenerator {...props} rules={rules} />
    </AdminProviders>
  );
}

const m = (id: string, member_name: string, alias: string, memberType = ["voz"]) => ({ _id: id, member_name, alias, memberType });
export const ANA = m("ana", "Ana Karen Villalobos", "Ana", ["voz", "sunday_lead"]);
export const LUCIA = m("lucia", "María Lucía Estrada", "Lucía");
export const BETO = m("beto", "Alberto Ruiz Cano", "Beto");
export const SUNDAYS = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"];
export const RODRI = { ...m("rodri", "Rodrigo Lara Peña", "Rodri", ["instrumento"]), instruments: ["Drums"] };
export const PACO = { ...m("paco", "Francisco Ibarra", "Paco", ["instrumento"]), instruments: ["Drums"] };

export function setMonthYear(container: HTMLElement, month: number, year: number) {
  fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: String(month) } });
  fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: String(year) } });
}

export function deselectAll(container: HTMLElement, kind: "sunday" | "saturday") {
  const dates = Array.from(container.querySelectorAll(`[data-day-kind="${kind}"]`)).map((el) => el.getAttribute("data-date"));
  for (const date of dates) {
    const cell = container.querySelector(`[data-date="${date}"]`);
    if (cell?.getAttribute("data-selected") === "true") fireEvent.click(cell);
  }
}

export function selectSundayLead(container: HTMLElement, displayName: string) {
  const heading = Array.from(container.querySelectorAll("p")).find((p) => p.textContent === "Líderes Domingo")!;
  const pool = heading.closest("div")!.parentElement as HTMLElement;
  const label = within(pool).getByText(displayName).closest("label") as HTMLElement;
  fireEvent.click(within(label).getByRole("checkbox"));
}

export const preview = () => fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

export function runAuto() {
  fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
}

export const fillEmptySwitch = () => screen.getByRole("switch", { name: "Solo llenar vacíos" });

export const cellAt = (container: HTMLElement, rowId: string, date: string) =>
  container.querySelector(`[data-row-id="${rowId}"][data-date="${date}"]`) as HTMLElement;
