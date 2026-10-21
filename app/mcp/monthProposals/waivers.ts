// The editor's whole-board rule invariant (plan T2.2, A4): what a check shows and a save stores
// about the per-seat rules — role and week exclusions and pairs, the only rules anyone forces.
// Pure; its inputs are boards and finding keys, never names.
//
// Over the WHOLE board, on every check and every save (never only the edited columns, so a
// waiver can never vanish from a breach that is still there), every finding must be one of:
//   · in `baseline` — the SOLVE's own breach (a solver warning, forever);
//   · already on the BASE board judged fresh now — a breach no edit made (a rename since the
//     solve): «apareció sin que editaras», a warning, never a refusal, so a lineage never sticks;
//   · a kept waiver — confirmed in an earlier revision;
//   · confirmed in THIS call.
// What this call must confirm is the DIFF: the findings in none of the first three. `confirms`
// (the keys the check showed Frank) must equal it exactly, or the save is `stale_check` and
// answers the new diff; with no `confirms`, the diff must be empty.
//
// Waivers stored = the kept ones + the diff + (A4) every rule a forced edit's gate named that is
// still on the board, EVEN when its breach was already explained (a re-force of a solver
// warning), so everything Frank forces reaches apply's permission prompt. A waiver is dropped only
// when its SEAT no longer holds it: per seat, its (service, row, member) is no longer seated; for a
// pair, the two no longer sit together in that service. One whose seat holds but whose finding
// went dormant (a rename made its rule resolve to nobody) is KEPT («sin efecto por ahora»), so a
// breach that comes back is still covered.

import type { EditVerdict } from "./revise";
import { findingIsRule, type EditorBoard, type Finding } from "./editorBoard";
import { findingKeyText, type FindingKey, type Waiver } from "./proposalDocument";

export interface BoardJudgement {
  findings: Finding[];
  baseline: FindingKey[];
  /** What a save stores: kept, then confirmed now, in board order. */
  waivers: Waiver[];
  /** Kept waivers whose finding is not on the board now («sin efecto por ahora»). */
  dormant: Waiver[];
  /** Inherited waivers whose seat no longer holds them, with why. */
  dropped: Waiver[];
  /** The findings this call created: what `force`/`confirms` must confirm. */
  diff: Finding[];
  /** Findings that were the solver's (`baseline`). */
  solver: Finding[];
  /** Findings on the base board no edit made, outside `baseline` and the waivers. */
  appeared: Finding[];
}

export type ConfirmVerdict =
  /** Nothing to confirm, or `confirms` is exactly the diff. */
  | { kind: "ok" }
  /** A diff with no `confirms`: the check offers it, the save refuses. */
  | { kind: "unconfirmed"; diff: Finding[] }
  /** `confirms` differs from the diff recomputed now (`stale_check`). */
  | { kind: "stale"; diff: Finding[] };

const has = (set: ReadonlySet<string>, k: FindingKey) => set.has(findingKeyText(k));

function seatHolds(board: EditorBoard, w: FindingKey): boolean {
  const columnId = board.columnIdOf.get(w.service);
  if (!columnId) return false;
  const inColumn = (member: string, row?: string) =>
    board.cells.some((c) => c.columnId === columnId && (row === undefined || c.rowId === row) && c.occupants.some((o) => o.memberId === member));
  return w.kind === "pair" ? w.members.every((m) => inColumn(m)) : inColumn(w.members[0], w.row ?? undefined);
}

/**
 * The invariant's verdict on `board`. `baseline` is the base payload's (v2), or `null` when the base
 * is the solve's own record: then it is the base board's findings, computed here once.
 */
export function judgeBoard(input: {
  board: EditorBoard;
  findings: Finding[];
  baseFindings: Finding[];
  baseline: FindingKey[] | null;
  inherited: readonly Waiver[];
  forced: EditVerdict["forced"];
}): BoardJudgement {
  const { board, findings, baseFindings } = input;
  const baseline = input.baseline ?? baseFindings.map((f) => f.key);
  const baselineSet = new Set(baseline.map(findingKeyText));
  const baseSet = new Set(baseFindings.map((f) => findingKeyText(f.key)));
  const nowSet = new Set(findings.map((f) => findingKeyText(f.key)));

  const kept: Waiver[] = [];
  const dropped: Waiver[] = [];
  for (const w of input.inherited) (seatHolds(board, w.key) ? kept : dropped).push(w);
  const keptSet = new Set(kept.map((w) => findingKeyText(w.key)));

  const diff = findings.filter((f) => !has(baselineSet, f.key) && !has(keptSet, f.key) && !has(baseSet, f.key));
  const solver = findings.filter((f) => has(baselineSet, f.key) && !has(keptSet, f.key));
  const appeared = findings.filter((f) => !has(baselineSet, f.key) && !has(keptSet, f.key) && has(baseSet, f.key));

  // A4: every forced rule still on the board, whatever explained it before.
  const forcedFindings = findings.filter((f) => input.forced.some(({ seat, rules }) => rules.some((r) => findingIsRule(f.key, seat, r))));
  const stored = new Map<string, Waiver>(kept.map((w) => [findingKeyText(w.key), w]));
  for (const f of [...diff, ...forcedFindings]) {
    const k = findingKeyText(f.key);
    if (!stored.has(k)) stored.set(k, { key: f.key, sentence: f.sentence });
  }
  const dormant = kept.filter((w) => !nowSet.has(findingKeyText(w.key)));
  return { findings, baseline, waivers: [...stored.values()], dormant, dropped, diff, solver, appeared };
}

/** `confirms` against the diff, as sets of keys. */
export function confirmVerdict(diff: readonly Finding[], confirms: readonly FindingKey[] | null): ConfirmVerdict {
  if (confirms === null) return diff.length === 0 ? { kind: "ok" } : { kind: "unconfirmed", diff: [...diff] };
  const want = new Set(diff.map((f) => findingKeyText(f.key)));
  const got = new Set(confirms.map(findingKeyText));
  const same = want.size === got.size && [...want].every((k) => got.has(k));
  return same ? { kind: "ok" } : { kind: "stale", diff: [...diff] };
}

/**
 * The safety net (T2.3): with the waivers a save would store, is every finding explained? It is
 * true by construction of `judgeBoard`; it runs anyway, independently of the gates, so a future
 * change that breaks the construction refuses the save instead of storing an unwaived breach.
 */
export function everyFindingExplained(j: BoardJudgement, baseFindings: readonly Finding[]): boolean {
  const ok = new Set([...j.baseline.map(findingKeyText), ...j.waivers.map((w) => findingKeyText(w.key)), ...baseFindings.map((f) => findingKeyText(f.key))]);
  return j.findings.every((f) => ok.has(findingKeyText(f.key)));
}
