// scripts/lib/solverConfigSummary.ts
//
// What `scripts/seed-solver-config.ts` prints for a rule set — its dry-run
// summary and both halves of its REFUSING diff. Pure, so it is tested directly
// (`scripts/__tests__/solverConfigSummary.test.ts`).
//
// **Rules by kind and ordinal, never by key or name** (solver v3 parent A41).
// `solverConfig`'s seed-era ids embed members' first names, and a script's
// stdout is an output that can leave a private file; the 1-based ordinal is
// the order the rule panel lists each kind in, which is what a reviewer matches
// against. Clauses and «Mes por medio» are printed (C3 §6.9), so a difference
// in either is visible in the diff a human reads.
import type { SolverConfig } from "../../app/components/admin/plannerModel";

export function solverConfigSummaryLines(label: string, c: SolverConfig): string[] {
  const lines = [label, `  pools: ${c.sundayLeads.length} dom · ${c.saturdayLeads.length} sáb · ${c.support.length} apoyo`];
  c.restrictions.forEach((r, i) => {
    const bits = [
      r.excludedPatterns.length ? `!in ${r.excludedPatterns.join(",")}` : "",
      r.weekExclusions.map((w) => `!in week ${w.week} ${w.pattern}`).join(" "),
      r.caps.map((cap) => `${cap.pattern} ${cap.op} ${cap.value}${cap.relative ? ` (rel ${cap.relOffset})` : ""}`).join(" "),
      r.fairness !== "none" ? `fairness:${r.fairness}` : "",
      r.sundayCadence === "alternate" ? "Mes por medio" : "",
    ].filter(Boolean);
    lines.push(`  restricción ${i + 1} · ${bits.join(" · ") || "(sin cláusulas)"}`);
  });
  c.conflicts.forEach((x, i) => lines.push(`  conflicto ${i + 1} · !with on ${x.pattern}`));
  c.presence.forEach((p, i) => lines.push(`  presencia ${i + 1} · any_of(${p.persons.length} personas) on ${p.pattern}`));
  return lines;
}
