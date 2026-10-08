// scripts/lib/reconstructPreview.ts
//
// R11's balance preview and the per-month ledger runs (solver v3 C4), all through
// C2's ledger (IF2-10): C4 computes no share, seat count or balance itself (A17, A39).
//
// The ledger takes IF2-3 records. For a month planned «crear» or «reemplazar» the
// preview hands it the PLANNED body as an in-memory record — never stored-shaped and
// never written (R2). Its placeholders, stated so nobody reads them as data: `rev`
// and `recordedAt` are "planned"; `contentHash` is the body's IF2-19 hash; `source`
// and `engine` are what the executor would stamp ("reconstructed", "v2");
// `environment` is the run's REC-2 stamp; each person's `name` is her roster display
// name (the ledger uses names for display only).

import { computeFairnessLedger, type LedgerInput, type LedgerService } from "../../app/utils/fairnessLedger";
import { displayMemberName } from "../../app/utils/memberRuleNames";
import {
  ROLE_LINE,
  TAB_KEYS,
  shiftMonth,
  type FairnessLedgerResponse,
  type FairnessMonthBody,
  type LogicalRecord,
  type RecordEnvironment,
  type RoleKey,
  type TabKey,
} from "../../app/utils/fairnessVocabulary";
import type { Line, RosterRow } from "./reconstructTypes";

export type LedgerMembers = LedgerInput["members"];

/** IF2-10's `members` from IF2-27's rows: existing worship member documents (R13: anyone else is «miembro eliminado»). */
export function ledgerMembers(roster: readonly RosterRow[]): LedgerMembers {
  return roster.map((m) => ({
    id: m._id,
    name: displayMemberName({ member_name: m.member_name ?? undefined, alias: m.alias ?? undefined }),
    unavailableDates: (m.unavailableDates ?? []).filter((d): d is string => typeof d === "string"),
  }));
}

export function plannedLogicalRecord(
  body: FairnessMonthBody,
  bodyHash: string,
  environment: RecordEnvironment,
  names: ReadonlyMap<string, string>,
): LogicalRecord {
  return {
    month: body.month,
    rev: "planned",
    contentHash: bodyHash,
    source: "reconstructed",
    engine: "v2",
    environment,
    recordedAt: "planned",
    people: body.people.map((p) => ({ ...p, name: names.get(p.memberId) ?? "" })),
    presence: body.presence,
  };
}

/** The three calendar months before the run (C2 LG-12). */
export function previewWindow(run: string): string[] {
  return [shiftMonth(run, -3), shiftMonth(run, -2), shiftMonth(run, -1)];
}

/** One month alone: target = the next month, so the month is the window's last (its `held`, notes and `unknownMembers`). */
export function monthLedger(month: string, record: LogicalRecord | null, services: readonly LedgerService[], members: LedgerMembers) {
  return computeFairnessLedger({ target: shiftMonth(month, 1), records: record ? [record] : [], services: [...services], members: [...members] });
}

/** R11's «lugares» column: the ledger's integer `held` (IF2-8) summed per line — never derived from hundredths (A39). */
export function seatsPerLine(ledger: Pick<FairnessLedgerResponse, "people">, month: string): Map<string, Partial<Record<Line, number>>> {
  const out = new Map<string, Partial<Record<Line, number>>>();
  for (const person of ledger.people) {
    const held = person.months.find((m) => m.month === month)?.held ?? {};
    const lines: Partial<Record<Line, number>> = {};
    for (const [key, n] of Object.entries(held) as Array<[RoleKey, number]>) {
      const line = ROLE_LINE[key];
      lines[line] = (lines[line] ?? 0) + n;
    }
    out.set(person.memberId, lines);
  }
  return out;
}

/** R11's preview: one ledger run for the run month over the after-apply records; per member, per tab, hundredths (bound in the plan). */
export function previewFigures(input: { run: string; records: LogicalRecord[]; services: readonly LedgerService[]; members: LedgerMembers }) {
  const result = computeFairnessLedger({ target: input.run, records: input.records, services: [...input.services], members: [...input.members] });
  const figures: Record<string, Partial<Record<TabKey, { share: number; received: number; balance: number }>>> = {};
  for (const person of result.people) {
    const tabs: Partial<Record<TabKey, { share: number; received: number; balance: number }>> = {};
    for (const tab of TAB_KEYS) {
      const f = person.tabs.window[tab];
      if (f) tabs[tab] = { share: f.share, received: f.received, balance: f.balance };
    }
    figures[person.memberId] = tabs;
  }
  return { result, figures };
}
