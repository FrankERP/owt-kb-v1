// app/components/admin/v3Equidad.ts
//
// Solver v3 C6 EQ-3–EQ-5, EQ-7 — what the «Equidad» panel adds under v3, from the last v3 run of
// this horizon. Every figure is ONE named field taken as emitted: «En este plan» = the tab's
// integer `seats` (A39), the pins reason = the tab's `pinned_seats`, «Queda» = the tab's
// `tenths.after` through C2's `saldoWords` (A32). Folds are the emitters' (C5's `tabs.BGV` and
// `tabs.TOTAL`); nothing here sums, divides, rounds or formats a number itself.
// The cadence line (EQ-4, X1) on the DL tab is RQ-4's own state per month through C2's X1 copy.

import { saldoWords } from "@/app/utils/fairnessFormat";
import type { FairnessLedgerResponse, RoleKey, TabKey } from "@/app/utils/fairnessVocabulary";
import { x1LineText } from "./fairnessPreviewModel";
import { V3_LINES, V3_PANEL_REASON, type V3Names } from "./v3Copy";
import type { RunCadence } from "./v3People";
import { serviceLabel } from "./v3Services";
import type { V3FairnessPerson, V3SolveRequest, V3Success } from "./v3Wire";

export interface EquidadPlan {
  people: ReadonlyMap<string, V3FairnessPerson>;
  reason(memberId: string, tab: TabKey): string;
}

const TAB_KEYS: Record<Exclude<TabKey, "TOTAL">, readonly RoleKey[]> = {
  DL: ["Sun.Lead"], SL: ["Sat.Lead"], BGV: ["Sun.BGV", "Sat.BGV"], CORO: ["Sun.Choir", "Sat.Choir"],
};

export function planCells(plan: EquidadPlan | null | undefined, memberId: string, tab: TabKey): { enEstePlan: string; queda: string } {
  const figures = plan?.people.get(memberId)?.tabs[tab];
  if (!figures) return { enEstePlan: "—", queda: "—" };
  return { enEstePlan: String(figures.seats), queda: saldoWords(figures.tenths.after) };
}

export function buildEquidadPlan(input: {
  response: V3Success;
  request: V3SolveRequest;
  cadence: RunCadence;
  ledger: FairnessLedgerResponse | null;
  names: V3Names;
  members: ReadonlyArray<{ _id: string; unavailableDates?: string[] }>;
}): EquidadPlan {
  const people = new Map(input.response.fairness.people.map((p) => [p.person, p]));
  const months = new Set(input.request.months);
  const serviceDates = new Set(input.request.services.map((s) => s.date));
  const reason = (memberId: string, tab: TabKey): string => {
    const parts: string[] = [];
    const states = input.cadence.get(memberId) ?? [];
    if (tab === "DL") {
      const prior = input.ledger?.people.find((p) => p.memberId === memberId)?.countedSundayLeads ?? [];
      for (const s of states) {
        if (s.reason === "assumed_led_previous_month") parts.push(V3_PANEL_REASON.cadenceOff(s.month));
        else parts.push(x1LineText(s.month, s.reason, prior.length > 0 ? prior[prior.length - 1] : null));
      }
    } else if (tab === "TOTAL") {
      for (const s of states) parts.push(s.state === "on" ? V3_PANEL_REASON.cadenceOn(s.month) : V3_PANEL_REASON.cadenceOff(s.month));
    }
    if (tab === "SL" || tab === "TOTAL") {
      for (const c of input.response.cadence) {
        if (c.person === memberId && c.compensation === "given") parts.push(V3_PANEL_REASON.compensation(c.month));
      }
    }
    const away = (input.members.find((m) => m._id === memberId)?.unavailableDates ?? [])
      .map((d) => d.slice(0, 10)).filter((d) => months.has(d.slice(0, 7)) && serviceDates.has(d)).sort();
    if (away.length > 0) parts.push(V3_PANEL_REASON.unavailable(away));
    if (tab !== "TOTAL") {
      const fixed = input.request.rules.find((r) =>
        r.kind === "count" && r.op === "==" && r.person === memberId && r.roles.some((k) => TAB_KEYS[tab].includes(k)));
      if (fixed) parts.push(V3_PANEL_REASON.fixedRule(input.names.rule(fixed.id)));
    }
    const pinned = people.get(memberId)?.tabs[tab]?.pinned_seats ?? 0;
    if (pinned > 0) parts.push(V3_PANEL_REASON.pins(pinned));
    if (tab === "TOTAL" && input.request.people.find((p) => p.id === memberId)?.exempt) parts.push(V3_PANEL_REASON.exempt);
    return parts.join(" ");
  };
  return { people, reason };
}

/** EQ-7: the ledger's own diagnostics where v2 showed the derived history's. */
export function ledgerDiagnosticsLines(d: FairnessLedgerResponse["diagnostics"]): string[] {
  const out: string[] = [];
  if (d.duplicateTargets.length > 0) {
    out.push(V3_LINES.diagDuplicates(d.duplicateTargets
      .map((t) => serviceLabel(t.type === "sunday_role" ? "sunday" : t.type === "saturday_role" ? "saturday" : "special", t.date)).join(", ")));
  }
  if (d.notInRecordSeats > 0) out.push(V3_LINES.diagNotInRecord(d.notInRecordSeats));
  if (d.unknownMembers.length > 0) out.push(V3_LINES.diagUnknownMembers(d.unknownMembers.length));
  return out;
}
