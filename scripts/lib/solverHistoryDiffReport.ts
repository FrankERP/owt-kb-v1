// scripts/lib/solverHistoryDiffReport.ts
//
// The R11 report: the classified differences, the evidence that admitted each
// one, the totals by class, the fingerprint control rate, and the solve runs
// with `objective_skipped` for every run. Pure — it renders a model the CLI
// (`scripts/solver-history-diff.ts`) assembles; it reads and writes nothing.
//
// The markdown and the JSON hold member names, so they are written only to the
// private `--out` folder. `stdoutLines` is the one part that reaches a terminal
// (or an agent transcript): totals, rates and paths, never a name.

import {
  CLASS_ARM,
  CLASS_LABEL,
  CLASS_VERDICT,
  DIFF_CLASSES,
  TOTAL_KEY,
  type ClassTotals,
  type DiffClass,
  type DiffTotals,
  type HistoryDiffResult,
  type Verdict,
} from "./solverHistoryDiff";

// ─── Solve runs ──────────────────────────────────────────────────────────────

/** What R11 records per run (plan step 6). Null where the solver's answer lacks the field. */
export interface RunSummary {
  ok: boolean;
  error: string | null;
  objective_skipped: boolean | null;
  history_runs_used: number | null;
  fairness_relaxed: boolean | null;
  sun_lead_fairness_relaxed: boolean | null;
  sun_bgv_fairness_relaxed: boolean | null;
  unfilled: number;
  /** Per-person seat totals this month. */
  totals: Record<string, number>;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export function summarizeRun(response: unknown): RunSummary {
  if (!isObj(response)) {
    return {
      ok: false,
      error: "the solver answered no JSON object",
      objective_skipped: null,
      history_runs_used: null,
      fairness_relaxed: null,
      sun_lead_fairness_relaxed: null,
      sun_bgv_fairness_relaxed: null,
      unfilled: 0,
      totals: {},
    };
  }
  const totals = isObj(response.total_counts)
    ? Object.fromEntries(Object.entries(response.total_counts).filter(([, n]) => typeof n === "number")) as Record<string, number>
    : {};
  return {
    ok: response.ok === true,
    error: typeof response.error === "string" ? response.error : null,
    objective_skipped: bool(response.objective_skipped),
    history_runs_used: typeof response.history_runs_used === "number" ? response.history_runs_used : null,
    fairness_relaxed: bool(response.fairness_relaxed),
    sun_lead_fairness_relaxed: bool(response.sun_lead_fairness_relaxed),
    sun_bgv_fairness_relaxed: bool(response.sun_bgv_fairness_relaxed),
    unfilled: Array.isArray(response.unfilled_seats) ? response.unfilled_seats.length : 0,
    totals,
  };
}

/** How far two runs' per-person totals are apart: the sum of |Δ| and how many people moved. */
export function totalsDelta(a: Record<string, number>, b: Record<string, number>): { sumAbs: number; changed: number } {
  let sumAbs = 0;
  let changed = 0;
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = Math.abs((Object.hasOwn(a, name) ? a[name] : 0) - (Object.hasOwn(b, name) ? b[name] : 0));
    sumAbs += d;
    if (d > 0) changed += 1;
  }
  return { sumAbs, changed };
}

export interface SolveSide {
  label: string;
  runs: RunSummary[];
}

export interface ConsistencyCheck {
  label: string;
  /** This export came from the profile that captured the request (the first bundle's). */
  capture: boolean;
  matches: boolean;
}

export interface SolveSection {
  /** `YYYY-MM`. */
  month: string;
  monthSource: string;
  seed: number;
  runsPerSide: number;
  ortools: string | null;
  python: string | null;
  warnings: string[];
  consistency: ConsistencyCheck[];
  derived: SolveSide;
  locals: SolveSide[];
  /** The exact bodies, for the production-route fallback. */
  requests: { derived: unknown; locals: { label: string; body: unknown }[] };
}

// ─── The model ───────────────────────────────────────────────────────────────

export interface BundleMeta {
  label: string;
  origin: string;
  takenAt: string;
  exportEntries: number;
  next: string | null;
  targets: { key: string; usable: boolean; reason?: string }[];
}

export interface PrimaryReport {
  label: string;
  entries: number;
  targets: string[];
  results: HistoryDiffResult[];
}

export type GateStatus = "BLOCKED" | "NEEDS_ACCEPTANCE" | "CLEAN";

export interface ReportModel {
  generatedAt: string;
  sessionGapMinutes: number;
  bundles: BundleMeta[];
  exports: { label: string; entries: number }[];
  primaries: PrimaryReport[];
  totals: DiffTotals;
  gate: GateStatus;
  solve: SolveSection | null;
}

export function aggregateTotals(results: readonly HistoryDiffResult[]): DiffTotals {
  const cells: Record<Verdict, number> = { explained: 0, unverified: 0, bug: 0 };
  const byClass = new Map<DiffClass, ClassTotals>();
  let blockers = 0;
  for (const r of results) {
    for (const v of Object.keys(cells) as Verdict[]) cells[v] += r.totals.cells[v];
    for (const c of DIFF_CLASSES) {
      const t = r.totals.byClass[c];
      if (!t) continue;
      const sum = byClass.get(c) ?? { cells: 0, units: 0 };
      sum.cells += t.cells;
      sum.units += t.units;
      byClass.set(c, sum);
    }
    blockers += r.totals.blockers;
  }
  return {
    cells,
    byClass: Object.fromEntries(DIFF_CLASSES.flatMap((c) => (byClass.has(c) ? [[c, byClass.get(c)!] as const] : []))),
    blockers,
  };
}

/** R11: any bug blocks; the unverified total blocks unless Frank accepts it, by class. */
export function gateOf(totals: DiffTotals): GateStatus {
  if (totals.cells.bug > 0 || totals.blockers > 0) return "BLOCKED";
  if (totals.cells.unverified > 0) return "NEEDS_ACCEPTANCE";
  return "CLEAN";
}

const GATE_TEXT: Record<GateStatus, string> = {
  BLOCKED: "BLOCKED — at least one bug (or a duplicate target). Any bug blocks the cutover.",
  NEEDS_ACCEPTANCE: "NEEDS FRANK'S ACCEPTANCE — no bug, but an unverified total. It blocks unless accepted explicitly, by class.",
  CLEAN: "CLEAN — every difference is explained.",
};

function controlRate(c: { withReceipt: number; unchanged: number }): string {
  if (c.withReceipt === 0) return "0 / 0 (no document with a receipt)";
  return `${c.unchanged} / ${c.withReceipt} (${((100 * c.unchanged) / c.withReceipt).toFixed(1)}%)`;
}

function stopOnControl(c: { withReceipt: number; unchanged: number }): boolean {
  return c.withReceipt > 0 && c.unchanged === 0;
}

// ─── Markdown ────────────────────────────────────────────────────────────────

function md(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function yesNo(v: boolean | null): string {
  return v === null ? "—" : v ? "yes" : "no";
}

function totalsTable(totals: DiffTotals): string[] {
  const lines = ["| Verdict | Rule | Class | Cells | Seats |", "|---|---|---|---:|---:|"];
  for (const verdict of ["explained", "unverified", "bug"] as Verdict[]) {
    for (const c of DIFF_CLASSES) {
      if (CLASS_VERDICT[c] !== verdict) continue;
      const t = totals.byClass[c];
      if (!t) continue;
      lines.push(`| ${verdict} | ${CLASS_ARM[c]} | ${md(CLASS_LABEL[c])} | ${t.cells} | ${t.units} |`);
    }
  }
  lines.push(
    "",
    `**Cells: explained ${totals.cells.explained} · unverified ${totals.cells.unverified} · bug ${totals.cells.bug}.** ` +
      `Duplicate weekend targets (rule 1, each a bug by itself): ${totals.blockers}.`,
    "",
    "A cell's verdict is the worst of its parts; «Seats» counts every part, so an arm that explained part of a " +
      "cell another arm decided still shows its hits. The 4a «no receipt» line stands apart on purpose: planner " +
      "documents from before the guarded create route (2026-07-24) have no receipt either, so that arm's evidence is weaker.",
  );
  return lines;
}

function solveLines(solve: SolveSection): string[] {
  const lines: string[] = ["## Solve runs (R11)", ""];
  lines.push(
    `- Month: **${solve.month}** (${solve.monthSource}); seed **${solve.seed}**; **${solve.runsPerSide}** run(s) per side, one after another.`,
    `- Solver: \`gcf/owt_solver_v2.py --json-mode\` with ${solve.python ? `\`${md(solve.python)}\`` : "—"}; ortools ${solve.ortools ?? "— (not checked: no run)"}.`,
  );
  for (const w of solve.warnings) lines.push(`- ⚠ ${md(w)}`);
  lines.push("");
  lines.push("**Consistency check** (the captured request's own `history` against `historyForRequest(export, y, m)`):", "");
  for (const c of solve.consistency) {
    if (c.matches) {
      lines.push(`- ${md(c.label)}: the captured request's history equals the recomputed local side.`);
    } else if (c.capture) {
      lines.push(
        `- ⚠ ${md(c.label)}: the captured request's history does NOT equal the recomputed local side. ` +
          "Likely cause: planning between the capture and the export (or the request came from another profile).",
      );
    } else {
      lines.push(`- ${md(c.label)}: differs from the captured request's history — expected if this export is another profile's.`);
    }
  }
  lines.push("");
  if (solve.runsPerSide === 0) {
    lines.push(
      "No solve was run (`--runs 0`). The exact request bodies are in the JSON report under `solve.requests`, for the fallback: " +
        "run each through `/api/admin/solve` from DevTools, twice, and keep the responses in the private folder.",
      "",
    );
    return lines;
  }

  lines.push("| Side | Run | ok | objective_skipped | history_runs_used | fairness_relaxed | sun_lead_fairness_relaxed | sun_bgv_fairness_relaxed | Unfilled seats |");
  lines.push("|---|---:|---|---|---:|---|---|---|---:|");
  for (const side of [solve.derived, ...solve.locals]) {
    side.runs.forEach((r, i) => {
      lines.push(
        `| ${md(side.label)} | ${i + 1} | ${r.ok ? "yes" : `no${r.error ? ` (${md(r.error)})` : ""}`} | ${yesNo(r.objective_skipped)} | ` +
          `${r.history_runs_used ?? "—"} | ${yesNo(r.fairness_relaxed)} | ${yesNo(r.sun_lead_fairness_relaxed)} | ` +
          `${yesNo(r.sun_bgv_fairness_relaxed)} | ${r.unfilled} |`,
      );
    });
  }
  lines.push("", "**Within each side — the noise baseline** (per-person totals, run k against run k+1):", "");
  for (const side of [solve.derived, ...solve.locals]) {
    for (let i = 1; i < side.runs.length; i += 1) {
      const d = totalsDelta(side.runs[i - 1].totals, side.runs[i].totals);
      lines.push(`- ${md(side.label)}, run ${i} vs ${i + 1}: Σ|Δ| = ${d.sumAbs}, people moved = ${d.changed}`);
    }
  }
  lines.push("", "**Across the sides** (local run k against derived run k):", "");
  for (const local of solve.locals) {
    local.runs.forEach((r, i) => {
      const other = solve.derived.runs[i];
      if (!other) return;
      const d = totalsDelta(r.totals, other.totals);
      lines.push(`- ${md(local.label)} vs derived, run ${i + 1}: Σ|Δ| = ${d.sumAbs}, people moved = ${d.changed}`);
    });
  }
  const all = [solve.derived, ...solve.locals].flatMap((s) => s.runs);
  const bothSkip =
    solve.derived.runs.length > 0 &&
    solve.locals.length > 0 &&
    solve.locals.every((s) => s.runs.length > 0) &&
    all.every((r) => r.objective_skipped === true);
  lines.push("");
  if (bothSkip) {
    lines.push(
      "**Both sides skipped the objective in every run, so any difference between them is not fairness-driven:** " +
        "the history enters the solver only through the objective (ADR-0038), and that objective did not run.",
      "",
    );
  }
  lines.push(
    `**This is a single data point.** One captured month, run ${solve.runsPerSide} time(s) per side, is one data point, ` +
      "not a measure of how often the objective is skipped. That frequency is issue #94's to measure.",
    "",
    "Per-person totals of every run are in the JSON report (`solve.derived.runs[].totals`, `solve.locals[].runs[].totals`).",
    "",
  );
  return lines;
}

function resultLines(primary: PrimaryReport, r: HistoryDiffResult): string[] {
  const lines: string[] = [];
  lines.push(`### ${md(primary.label)} → target ${r.target.key} (window ${r.window.map((w) => w.key).join(", ")})`, "");
  lines.push(
    `- Fingerprint control rate: ${controlRate(r.control)}${stopOnControl(r.control) ? " — ⚠ **STOP**: 0% while documents with a receipt are present. Investigate the rebuild before accepting any unverified." : ""}`,
    `- Cells: explained ${r.totals.cells.explained} · unverified ${r.totals.cells.unverified} · bug ${r.totals.cells.bug}; duplicate targets ${r.totals.blockers}.`,
  );
  for (const n of r.notes) lines.push(`- Note: ${md(n)}`);
  lines.push("");
  if (r.blockers.length) {
    lines.push("**Rule 1 — duplicate weekend targets (each a bug; resolving one is a production write, Frank's to make through /admin):**", "");
    for (const b of r.blockers) lines.push(`- ${b.type} on ${b.day}: ${b.roleIds.join(", ")}`);
    lines.push("");
  }
  lines.push(`**Sessions (rule 4b; a new session after a gap of more than the pinned minutes):**`, "");
  for (const s of r.sessions) {
    lines.push(`- ${s.month}: latest session **${s.latest}** — ${md(s.reason)}`);
    s.groups.forEach((g, i) => {
      lines.push(
        `  - session ${i + 1}: ${g.start} → ${g.end}: ` +
          g.receipts.map((x) => `${x.roleId ?? "?"} (receipt ${x.receiptId}${x.source === "out_of_window" ? ", no longer in the window" : ""})`).join(", "),
      );
    });
  }
  lines.push("");
  if (r.renames.length) {
    lines.push("**Rule 3b — export keys read under current names:**", "");
    for (const x of r.renames) lines.push(`- ${x.month}: «${md(x.exportKey)}» → «${md(x.name)}» (${x.arm === "raw_id" ? "the key is the member's _id" : "the one current name with exactly its counts"})`);
    lines.push("");
  }
  if (r.cells.length === 0) {
    lines.push("No differences.", "");
    return lines;
  }
  lines.push("| Month | Member | Role key | Derived | Export | Δ | Verdict | Rule | Class | Attribution |", "|---|---|---|---:|---:|---:|---|---|---|---|");
  for (const c of r.cells) {
    const member = c.mappedTo ? `${md(c.member)} → ${md(c.mappedTo)}` : md(c.member);
    const role = c.roleKey === TOTAL_KEY ? "total_counts (total − Σ roles)" : c.roleKey;
    const attribution = c.parts
      .map((p) => `${CLASS_ARM[p.class]} ×${p.amount}${p.evidence.length ? `: ${p.evidence.join(", ")}` : ""}`)
      .join("; ");
    lines.push(
      `| ${c.month.key} | ${member} | ${role} | ${c.derived} | ${c.exported} | ${c.delta > 0 ? "+" : ""}${c.delta} | ${c.verdict} | ` +
        `${CLASS_ARM[c.class]} | ${md(CLASS_LABEL[c.class])} | ${md(attribution)} |`,
    );
  }
  lines.push("");
  return lines;
}

/** The private report. It holds member names: it is written only to `--out`, outside the repository. */
export function renderMarkdown(model: ReportModel): string {
  const lines: string[] = [
    "# Solver history diff (R11)",
    "",
    "> **Private.** This report holds member names. It stays in the private folder, never in the repository; " +
      "only the totals leave it.",
    "",
    `Generated ${model.generatedAt}.`,
    "",
    "## Header",
    "",
    `- **Gate:** ${GATE_TEXT[model.gate]}`,
    `- \`SESSION_GAP_MINUTES\` = ${model.sessionGapMinutes}`,
    "",
    "**Bundles** (Gate B snippet, one per profile):",
    "",
  ];
  for (const b of model.bundles) {
    lines.push(
      `- ${md(b.label)}: origin ${md(b.origin)}, takenAt ${b.takenAt}, export entries ${b.exportEntries}, NEXT ${b.next ?? "—"}; targets ` +
        b.targets.map((t) => (t.usable ? t.key : `${t.key} (unusable: ${md(t.reason ?? "?")})`)).join(", "),
    );
    if (b.origin !== "https://owt-backstage.vercel.app") {
      lines.push(`  - ⚠ not the production origin: this is another store than the production history (R13).`);
    }
  }
  lines.push("", "**Exports compared as primary** (each runs once as primary; the others are «another export» evidence):", "");
  for (const e of model.exports) lines.push(`- ${md(e.label)}: ${e.entries} ${e.entries === 1 ? "entry" : "entries"}`);
  lines.push("", "**Targets:**", "");
  for (const p of model.primaries) lines.push(`- ${md(p.label)}: ${p.targets.join(", ") || "—"}`);
  lines.push("", "**Fingerprint control rate** (`unchanged / withReceipt`, per target):", "");
  const seen = new Set<string>();
  for (const p of model.primaries) {
    for (const r of p.results) {
      if (seen.has(r.target.key)) continue;
      seen.add(r.target.key);
      lines.push(`- ${r.target.key}: ${controlRate(r.control)}${stopOnControl(r.control) ? " — ⚠ STOP (0% with receipts present)" : ""}`);
    }
  }
  lines.push("", "**Totals** (every primary × target; overlapping windows are counted in each):", "", ...totalsTable(model.totals), "");
  lines.push(
    "The `unverified` total blocks the cutover unless Frank accepts it explicitly, by class (R11's stated narrowing of H3). " +
      "Any `bug` blocks it outright.",
    "",
  );
  if (model.solve) lines.push(...solveLines(model.solve));
  else lines.push("## Solve runs (R11)", "", "Not run: no `--solve-request` was given.", "");
  lines.push("## Differences, per export and target", "");
  for (const p of model.primaries) for (const r of p.results) lines.push(...resultLines(p, r));
  return `${lines.join("\n")}\n`;
}

/** What the CLI prints: paths, the gate and the totals. Never a member name. */
export function stdoutLines(model: ReportModel, paths: { md: string; json: string }): string[] {
  const lines = [
    "solver-history-diff: report written (it holds member names — keep it in the private folder):",
    `  ${paths.md}`,
    `  ${paths.json}`,
    `  gate: ${model.gate}`,
    `  cells: explained ${model.totals.cells.explained} · unverified ${model.totals.cells.unverified} · bug ${model.totals.cells.bug}; duplicate targets ${model.totals.blockers}`,
  ];
  const seen = new Set<string>();
  for (const p of model.primaries) {
    for (const r of p.results) {
      if (seen.has(r.target.key)) continue;
      seen.add(r.target.key);
      lines.push(`  control ${r.target.key}: ${controlRate(r.control)}${stopOnControl(r.control) ? " STOP" : ""}`);
    }
  }
  if (model.solve && model.solve.runsPerSide > 0) {
    const skipped = (s: SolveSide) => `${s.runs.filter((r) => r.objective_skipped === true).length}/${s.runs.length}`;
    lines.push(
      `  objective_skipped: derived ${skipped(model.solve.derived)}; ` + model.solve.locals.map((s, i) => `local #${i + 1} ${skipped(s)}`).join("; "),
    );
  }
  return lines;
}
