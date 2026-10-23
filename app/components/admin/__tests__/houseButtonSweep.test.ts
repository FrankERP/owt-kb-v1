// Diseño para admins, bloque 7 (2026-10-23): the footers, composer, swap strip,
// «Limpiar mes», the stored save bar, the planner's dialogs and the Generar mes
// calendar all moved from hand-rolled <button>s to the house `Button` (same
// behaviour, same labels; the existing tests cover them). What is still a bare
// <button> is deliberate, and this ratchet keeps the count from growing back:
//
// MonthGenerator (26): the rules builder — its forms' footers are coloured per
//   rule type (restricción / conflicto / presencia), its pattern pills, «+ Semana»
//   / «+ Tope», the ✎ / × of a saved rule, «Quitar del pool», the history ×,
//   «Recargar reglas» / «Guardar reglas» / «Reintentar» (accent-outlined, with
//   the save's four-way title) — a later block, one rule panel at a time.
// PlannerGrid (8): the warning-toned confirmations («Mover / Copiar / Asignar de
//   todos modos», the stranded «Quitar») — the house Button has no warning tone;
//   a cell's invisible activation overlay; the candidate rows' «Marcar para
//   mover» (its picked class is asserted by PlannerGrid.test); the row's
//   «Eliminar» text link; «Copiar a todo el mes» inside a cell.
// MonthCalendar (1): the day cells — a grid of toggles, not buttons in the
//   design's sense.
//
// Equality, not `<=`: a block that pays a site down lowers its number here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BASELINE: Record<string, number> = {
  "MonthGenerator.tsx": 26,
  "PlannerGrid.tsx": 8,
  "MonthCalendar.tsx": 1,
};

function handRolledButtons(file: string): number {
  const src = readFileSync(path.join(__dirname, "..", file), "utf8");
  // Comments mention `<button>` when they explain why a cell is NOT one.
  const code = src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  return (code.match(/<button(?=[\s>])/g) ?? []).length;
}

describe("Generar / Editar mes use the house Button (bloque 7)", () => {
  for (const [file, expected] of Object.entries(BASELINE)) {
    it(`${file} keeps exactly ${expected} deliberate hand-rolled <button>s`, () => {
      expect(handRolledButtons(file)).toBe(expected);
    });
  }
});
