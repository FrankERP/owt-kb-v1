// app/components/admin/v3People.ts
//
// Solver v3 C6 RQ-4 — the request's people.
//   · cadence states are computed ONCE per run, after the ledger read and before the specials
//     pre-fill (which reads them), from C2's `cadenceStates` (IF2-12) with:
//       ledCountedSundayPreviousMonth = an IF2-8 `countedSundayLeads` entry in `prior.month`;
//       eligible = `Sun.Lead` is `in` in that month's source;
//       availableCountedSundays = the request's counted Sunday-dated services of that month on which
//       she is eligible for Lead by RQ-2 (a rule-excluded Sunday is not one, A14);
//     and mapped to the wire: reason `not_eligible` → "out", otherwise the state (A14, C5-5). The SAME
//     values go on the wire and into the «Equidad» panel (EQ-4).
//   · carried = IF2-8 `people[].window[line].balance`, copied without rounding, every `P:<ruleKey>`
//     rewritten to `P:` + that ruleKey's minted id (RQ-5 (a)) — a carried-only key included.
//   · exempt and the cadence setting come from each month's source; a person in one month's source
//     only takes its flags (her cadence state in the other month is "out"); two months disagreeing
//     on «Exenta» or «Mes por medio» for one person refuse Auto (C5 declined a per-month form, S-3).
//   · dl_since and prev_dl_leads per A15.

import { cadenceStates, type CadenceReason } from "@/app/utils/fairnessLedger";
import { compareCodepoint, monthIndex, type FairnessLedgerResponse, type LineKey } from "@/app/utils/fairnessVocabulary";
import { dayClass, type MonthSource } from "./v3MonthSources";
import { V3_LINES } from "./v3Copy";
import type { V3Person, V3Role, V3Service } from "./v3Wire";

export interface RunCadenceEntry {
  month: string;
  state: "on" | "off";
  reason: CadenceReason;
  wire: "on" | "off" | "out";
}
export type RunCadence = Map<string, RunCadenceEntry[]>;

const listedIn = (source: MonthSource, id: string) => source.body.people.find((p) => p.memberId === id);

export function computeRunCadence(input: {
  months: readonly string[];
  sources: readonly MonthSource[];
  ledger: FairnessLedgerResponse;
  services: readonly V3Service[];
  eligibility: ReadonlyMap<string, Record<string, V3Role[]>>;
  priorMonth: string;
}): RunCadence {
  const ids = new Set(input.sources.flatMap((s) => s.body.people.filter((p) => p.sundayCadence === "alternate").map((p) => p.memberId)));
  const run: RunCadence = new Map();
  for (const id of [...ids].sort(compareCodepoint)) {
    const ledgerPerson = input.ledger.people.find((p) => p.memberId === id);
    const led = (ledgerPerson?.countedSundayLeads ?? []).some((d) => d.slice(0, 7) === input.priorMonth);
    const elig = input.eligibility.get(id) ?? {};
    const months = input.months.map((month) => {
      const source = input.sources.find((s) => s.month === month);
      const person = source ? listedIn(source, id) : undefined;
      return {
        month,
        eligible: person?.roles["Sun.Lead"] === "in",
        availableCountedSundays: input.services.filter((s) =>
          s.month === month && s.counts && dayClass(s.kind, s.date) === "Sun" && (elig[s.id] ?? []).includes("Lead")).length,
      };
    });
    run.set(id, cadenceStates({ ledCountedSundayPreviousMonth: led, months }).map((o) => ({
      month: o.month, state: o.state, reason: o.reason, wire: o.reason === "not_eligible" ? "out" : o.state,
    })));
  }
  return run;
}

/** Every `P:` ruleKey the given people carry in IF2-8 `window` — presence keys to mint (RQ-5 (a)). */
export function carriedPresenceKeys(ledger: FairnessLedgerResponse, ids: Iterable<string>): string[] {
  const want = new Set(ids);
  const keys = new Set<string>();
  for (const person of ledger.people) {
    if (!want.has(person.memberId)) continue;
    for (const line of Object.keys(person.window)) if (line.startsWith("P:")) keys.add(line.slice(2));
  }
  return [...keys].sort(compareCodepoint);
}

/**
 * RQ-4's horizon-wide refusal, exported so the builder can run it BEFORE the specials pre-fill
 * (SP-5: the pre-fill reads both flags): a person listed in two months' sources with a different
 * «Exenta» or «Mes por medio» in each.
 */
export function flagDisagreementLines(input: {
  sources: readonly MonthSource[];
  ids: Iterable<string>;
  nameOf: (id: string) => string;
}): string[] {
  const lines: string[] = [];
  for (const id of [...new Set(input.ids)].sort(compareCodepoint)) {
    const listings = input.sources.map((s) => ({ month: s.month, item: listedIn(s, id) })).filter((x) => x.item !== undefined);
    for (let i = 1; i < listings.length; i++) {
      const a = listings[0];
      const b = listings[i];
      if (a.item!.exempt !== b.item!.exempt) lines.push(V3_LINES.horizonDisagreement(a.month, b.month, "Exenta", input.nameOf(id)));
      if ((a.item!.sundayCadence ?? null) !== (b.item!.sundayCadence ?? null)) {
        lines.push(V3_LINES.horizonDisagreement(a.month, b.month, "Mes por medio", input.nameOf(id)));
      }
    }
  }
  return lines;
}

export function buildV3People(input: {
  months: readonly string[];
  sources: readonly MonthSource[];
  ledger: FairnessLedgerResponse;
  members: ReadonlyArray<{ _id: string; member_name: string; alias?: string }>;
  eligibility: ReadonlyMap<string, Record<string, V3Role[]>>;
  extraIds: ReadonlySet<string>;
  cadence: RunCadence;
  presenceId: (ruleKey: string) => string;
  priorMonth: string;
}): { ok: true; people: V3Person[] } | { ok: false; lines: string[] } {
  const ids = new Set<string>(input.extraIds);
  for (const [id, byService] of input.eligibility) if (Object.values(byService).some((roles) => roles.length > 0)) ids.add(id);
  const nameOf = (id: string) => {
    const m = input.members.find((x) => x._id === id);
    return m ? (m.alias?.trim() || m.member_name) : (input.ledger.people.find((p) => p.memberId === id)?.name || id);
  };
  const lines = flagDisagreementLines({ sources: input.sources, ids, nameOf });
  const people: V3Person[] = [];
  for (const id of [...ids].sort(compareCodepoint)) {
    const listings = input.sources.map((s) => ({ month: s.month, item: listedIn(s, id) })).filter((x) => x.item !== undefined);
    const ledgerPerson = input.ledger.people.find((p) => p.memberId === id);
    const carried: Partial<Record<LineKey, number>> = {};
    for (const [line, fig] of Object.entries(ledgerPerson?.window ?? {})) {
      if (!fig) continue;
      const key = (line.startsWith("P:") ? `P:${input.presenceId(line.slice(2))}` : line) as LineKey;
      carried[key] = fig.balance;
    }
    const firstDl = ledgerPerson?.firstRecordedIn["Sun.Lead"];
    const dlSince = firstDl !== undefined && monthIndex(firstDl) < monthIndex(input.months[0])
      ? firstDl
      : (input.months.find((m) => {
          const source = input.sources.find((s) => s.month === m);
          return source ? listedIn(source, id)?.roles["Sun.Lead"] === "in" : false;
        }) ?? null);
    const eligibility = Object.fromEntries(Object.entries(input.eligibility.get(id) ?? {}).filter(([, roles]) => roles.length > 0));
    const cadence = input.cadence.get(id);
    people.push({
      id,
      name: nameOf(id),
      exempt: listings[0]?.item?.exempt ?? false,
      eligibility,
      carried,
      ...(cadence ? { cadence: Object.fromEntries(cadence.map((e) => [e.month, e.wire])) } : {}),
      dl_since: dlSince,
      prev_dl_leads: (ledgerPerson?.countedSundayLeads ?? []).filter((d) => d.slice(0, 7) === input.priorMonth).length,
    });
  }
  return lines.length > 0 ? { ok: false, lines: [...new Set(lines)] } : { ok: true, people };
}
