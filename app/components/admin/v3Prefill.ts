// app/components/admin/v3Prefill.ts
//
// Solver v3 C6 SP-1, SP-2, SP-6, SP-7 — under v3 every PLANNED COUNTED special is filled before the
// request is built, Lead and BGV only (Coro on a special stays manual), append-only, and then reaches
// the solver only as a fixed service (SP-3). Uncounted specials keep today's filler (SP-4, CTL-2).
//
// Hard blocks: everything today's filler blocks — `rankCandidates`' `eligible` verdict (Tipo, a seat
// already held in the same category at that service, availability, person exclusions and pairwise
// conflicts) and the in-cell exclusion — AND RQ-2's eligibility for that role at that service, so
// the pre-fill never pins someone the request calls ineligible.
//
// Order (SP-2, F12): for a LEAD, a candidate whose placement would by itself produce a protection
// miss the solver can only report with cause `pins` — judged against the seats fixed before the
// solve, `prior`, and this pass's earlier placements, over counted services only — is SECOND tier:
//   (a) a DL-mapped Lead for a cadence member whose state that month is `off`;
//   (b) a DL-mapped Lead for someone already holding one that month, unless `Sun.Lead` is exact;
//   (c) an SL-mapped Lead for someone already holding one that month, unless `Sat.Lead` is exact;
//   (d) a DL-mapped Lead on Sunday d for someone holding one on d − 7 or d + 7.
// First tier: those `in` for the seat's role key AND on its line, most owed first by the carried
// balance (each placement here counting as one received seat), then everyone else in today's load
// order. The second tier is used only when the first is empty, least important miss first
// (no_consecutive < saturday_cap < sunday_cap < cadence), and each such placement gets SP-7's notice.
// A cadence member has no DL line and is never ranked by a DL balance. BGV has no protection tiers.

import { civilDayOfWeek } from "@/app/utils/fairnessLedger";
import { ROLE_LINE, type FairnessLedgerResponse, type RoleKey } from "@/app/utils/fairnessVocabulary";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { rankCandidates, type RankMember, type RankedCandidate } from "./candidateRanking";
import { AUTO_FILL_ROW_IDS, withAutoCell } from "./localFill";
import {
  assignedForColumn, cellsToParticipantRoles, hasTarget, seatDefForRow,
  type GridCell, type GridColumn, type GridRow, type SolverConfig,
} from "./plannerModel";
import type { MonthSource } from "./v3MonthSources";
import type { RunCadence } from "./v3People";
import { V3_LINES } from "./v3Copy";
import type { V3Role } from "./v3Wire";

export type Protection = "no_consecutive" | "saturday_cap" | "sunday_cap" | "cadence";
const IMPORTANCE: Record<Protection, number> = { no_consecutive: 0, saturday_cap: 1, sunday_cap: 2, cadence: 3 };

export interface FixedLead { date: string; memberId: string; dl: boolean }
export interface PrefillTarget { columnId: string; date: string; month: string; label: string }

function addDaysIso(iso: string, days: number): string {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days);
  return new Date(t).toISOString().slice(0, 10);
}

function motivo(miss: Protection, month: string): string {
  if (miss === "cadence") return V3_LINES.motivoCadence;
  if (miss === "sunday_cap") return V3_LINES.motivoSundayCap(month);
  if (miss === "saturday_cap") return V3_LINES.motivoSaturdayCap(month);
  return V3_LINES.motivoConsecutive;
}

export function prefillCountedSpecials(input: {
  targets: readonly PrefillTarget[];
  columns: readonly GridColumn[];
  rows: readonly GridRow[];
  cells: readonly GridCell[];
  members: readonly RankMember[];
  savedWindow: readonly ParticipantRole[];
  config: SolverConfig;
  eligibility: ReadonlyMap<string, Record<string, V3Role[]>>;
  sources: ReadonlyMap<string, MonthSource>;
  cadence: RunCadence;
  ledger: FairnessLedgerResponse;
  fixedLeads: readonly FixedLead[];
  nameOf: (id: string) => string;
}): { cells: GridCell[]; placed: number; notices: string[] } {
  let working: GridCell[] = [...input.cells];
  const leads: FixedLead[] = [...input.fixedLeads];
  const received = new Map<string, number>();
  const notices: string[] = [];
  let placed = 0;
  const members = [...input.members];
  const columns = [...input.columns];
  const rows = [...input.rows];

  for (const target of input.targets) {
    const column = columns.find((c) => c.columnId === target.columnId);
    if (!column || column.type !== "special_role") continue;
    const dl = civilDayOfWeek(target.date) === 0;
    const source = input.sources.get(target.month);
    const listed = (id: string) => source?.body.people.find((p) => p.memberId === id);
    for (const row of rows) {
      if (!AUTO_FILL_ROW_IDS.includes(row.id) || !hasTarget(row, column)) continue;
      const role: V3Role = row.id === "lead" ? "Lead" : "BGV";
      const key = `${dl ? "Sun" : "Sat"}.${role}` as RoleKey;
      const line = ROLE_LINE[key];
      const seat = seatDefForRow(row);
      for (;;) {
        const current = working.find((c) => c.columnId === column.columnId && c.rowId === row.id)?.occupants.map((o) => o.memberId) ?? [];
        if (current.length >= (row.target ?? 0)) break;
        const ranked = rankCandidates({
          seat, date: column.date, members,
          windowRoles: [...input.savedWindow, ...cellsToParticipantRoles(working, columns, members)],
          assigned: assignedForColumn(working, rows, column.columnId),
          column, config: input.config,
        });
        const inCell = new Set(current);
        const admitted = ranked.filter((c) =>
          c.eligible && !inCell.has(c.id) && (input.eligibility.get(c.id)?.[column.columnId] ?? []).includes(role));
        if (admitted.length === 0) break;

        const onLine = (id: string) => listed(id)?.roles[key] === "in" && !(line === "DL" && listed(id)?.sundayCadence === "alternate");
        const balance = (id: string) =>
          (input.ledger.people.find((p) => p.memberId === id)?.window[line]?.balance ?? 0) - 100 * (received.get(`${id}|${line}`) ?? 0);
        const firstTierOrder = (xs: RankedCandidate[]) => [
          ...xs.filter((c) => onLine(c.id)).sort((a, b) => balance(b.id) - balance(a.id)),
          ...xs.filter((c) => !onLine(c.id)),
        ];

        let pick: RankedCandidate;
        let miss: Protection | null = null;
        if (role === "Lead") {
          const missesOf = (id: string): Protection[] => {
            const out: Protection[] = [];
            const exact = (k: RoleKey) => listed(id)?.roles[k] === "exact";
            const sameMonth = (l: FixedLead) => l.memberId === id && l.date.slice(0, 7) === target.month;
            if (dl && input.cadence.get(id)?.find((e) => e.month === target.month)?.wire === "off") out.push("cadence");
            if (dl && !exact("Sun.Lead") && leads.some((l) => l.dl && sameMonth(l))) out.push("sunday_cap");
            if (!dl && !exact("Sat.Lead") && leads.some((l) => !l.dl && sameMonth(l))) out.push("saturday_cap");
            const near = [addDaysIso(target.date, -7), addDaysIso(target.date, 7)];
            if (dl && leads.some((l) => l.dl && l.memberId === id && near.includes(l.date))) out.push("no_consecutive");
            return out;
          };
          const misses = new Map(admitted.map((c) => [c.id, missesOf(c.id)]));
          const worst = (c: RankedCandidate) => Math.max(-1, ...misses.get(c.id)!.map((m) => IMPORTANCE[m]));
          const first = admitted.filter((c) => misses.get(c.id)!.length === 0);
          if (first.length > 0) {
            pick = firstTierOrder(first)[0];
          } else {
            pick = firstTierOrder(admitted).sort((a, b) => worst(a) - worst(b))[0];
            miss = misses.get(pick.id)!.reduce((top, m) => (IMPORTANCE[m] > IMPORTANCE[top] ? m : top));
          }
        } else {
          pick = firstTierOrder(admitted)[0];
        }

        working = withAutoCell(working, column.columnId, row.id, [...current, pick.id]);
        received.set(`${pick.id}|${line}`, (received.get(`${pick.id}|${line}`) ?? 0) + 1);
        if (role === "Lead") leads.push({ date: target.date, memberId: pick.id, dl });
        placed += 1;
        if (miss) notices.push(V3_LINES.secondTier(input.nameOf(pick.id), target.label, motivo(miss, target.month)));
      }
    }
  }
  if (placed > 0) notices.unshift(V3_LINES.prefillDone);
  return { cells: working, placed, notices };
}
