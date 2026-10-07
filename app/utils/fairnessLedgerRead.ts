import "server-only";

// app/utils/fairnessLedgerRead.ts
//
// `loadFairnessLedger` — the server-side reader behind `GET /api/admin/fairness` (solver
// v3 C2 RD-1 … RD-3). It reads the eligibility records, the voice services, the horizon's
// freezing-service counts and the referenced members through `operationalClient`
// imported DIRECTLY (published perspective, no CDN, the read token), every query a
// `serviceReadQueries.ts` builder with no `published` filter (prior-month drafts count),
// passes each record through the ONE record-schema check (`parseStoredFairnessMonth`)
// and hands everything to THE ledger (`computeFairnessLedger`). It performs no
// authorization: the route gates.
//
// FAIL CLOSED (RD-2): a record's id is DOTTED, so a read made WITHOUT the read token
// answers zero records with no error and the past would read as «sin registro» — the
// token is therefore checked before any read. That, a rejected read, a non-list answer
// or a record the parser refuses throws `FairnessLedgerUnavailableError`, whose message
// is fixed and carries no Sanity text. It never returns an empty or partial ledger in
// place of a failed read; a month without a record is not a failure (F3).
//
// Logs carry no content (spec §6 «Key hygiene» (c)): a failed read logs the error's class
// and status only (a raw client error can carry the request URL and its `$ids`); a
// refused record logs the parser's issues, whose paths are index-based and whose
// messages are fixed.

import { operationalClient } from "@/sanity/lib/operationalClient";

import { computeFairnessLedger, type LedgerService } from "./fairnessLedger";
import { parseStoredFairnessMonth } from "./fairnessMonthWriteRequest";
import {
  FAIRNESS_UNAVAILABLE_MESSAGE,
  compareCodepoint,
  monthIndex,
  shiftMonth,
  type FairnessLedgerResponse,
  type LogicalRecord,
} from "./fairnessVocabulary";
import { displayMemberName } from "./memberRuleNames";
import {
  fairnessMembersByIdsQuery,
  fairnessMonthsThroughQuery,
  serviceCountsInMonths,
  voiceRolesInRangeQuery,
  type BoundQuery,
} from "./serviceReadQueries";
import { serviceDayKey } from "./serviceReadSelect";

/** The `Error.name` the route discriminates on — pinned so neither side can drift. */
export const FAIRNESS_LEDGER_UNAVAILABLE_ERROR_NAME = "FairnessLedgerUnavailableError";

/** The ledger could not be read. Its message is fixed and carries nothing from Sanity. */
export class FairnessLedgerUnavailableError extends Error {
  constructor() {
    super(FAIRNESS_UNAVAILABLE_MESSAGE);
    this.name = FAIRNESS_LEDGER_UNAVAILABLE_ERROR_NAME;
  }
}

/** An error's class and HTTP status — never its message, which may carry the request. */
export function fairnessErrorClass(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const status = err && typeof err === "object" && "statusCode" in err ? ` ${String((err as { statusCode: unknown }).statusCode)}` : "";
  return `${name}${status}`;
}

/**
 * An error's stack FRAMES only — the `at …` lines (function names and file positions).
 * Never the stack's head, which repeats the message, nor any continuation of a multi-line
 * message: a raw client error's message carries the request URL and its `$ids`.
 */
export function fairnessErrorFrames(err: unknown): string {
  const stack = err instanceof Error ? (err.stack ?? "") : "";
  return stack
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n");
}

async function readList(label: string, bound: BoundQuery): Promise<unknown[]> {
  let rows: unknown;
  try {
    rows = await operationalClient.fetch<unknown>(bound.query, bound.params);
  } catch (err) {
    console.error(`[fairnessLedgerRead] the ${label} read failed: ${fairnessErrorClass(err)}`);
    throw new FairnessLedgerUnavailableError();
  }
  if (!Array.isArray(rows)) {
    console.error(`[fairnessLedgerRead] the ${label} read returned no list`);
    throw new FairnessLedgerUnavailableError();
  }
  return rows;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const refs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

/** An IF2-26 row → IF2-10's `LedgerService`; a row with no valid stored date is dropped. */
function toLedgerService(row: unknown): LedgerService | null {
  if (!isObj(row) || typeof row._id !== "string") return null;
  if (row._type !== "sunday_role" && row._type !== "saturday_role" && row._type !== "special_role") return null;
  const date = serviceDayKey(row.date);
  if (!date) return null;
  return {
    _id: row._id,
    _type: row._type,
    date,
    ...(typeof row.time === "string" ? { time: row.time } : {}),
    ...(typeof row.published === "boolean" ? { published: row.published } : {}),
    ...(typeof row.countsForFairness === "boolean" ? { countsForFairness: row.countsForFairness } : {}),
    Lead: refs(row.Lead),
    BGVs: refs(row.BGVs),
    Chorus: refs(row.Chorus),
  };
}

export async function loadFairnessLedger(input: {
  month: string;
  horizon: 1 | 2;
  currentMonth: string;
  engine: FairnessLedgerResponse["engine"];
  environment: FairnessLedgerResponse["environment"];
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<FairnessLedgerResponse> {
  const env = input.env ?? process.env;
  if (!env.SANITY_API_READ_TOKEN) {
    console.error("[fairnessLedgerRead] SANITY_API_READ_TOKEN is not set: fairnessMonth ids are private, refusing to read");
    throw new FairnessLedgerUnavailableError();
  }
  const target = input.month;
  const horizonMonths = input.horizon === 2 ? [target, shiftMonth(target, 1)] : [target];

  // Records through the last horizon month, each through the ONE record-schema check.
  const recordRows = await readList("records", fairnessMonthsThroughQuery(horizonMonths[horizonMonths.length - 1]));
  const records: LogicalRecord[] = [];
  recordRows.forEach((row, i) => {
    const parsed = parseStoredFairnessMonth(row);
    if (!parsed.ok) {
      console.error(
        `[fairnessLedgerRead] stored record ${i + 1} of ${recordRows.length} failed the record-schema check: ` +
          parsed.issues.map((issue) => `${issue.path} ${issue.message}`).join("; "),
      );
      throw new FairnessLedgerUnavailableError();
    }
    records.push(parsed.record);
  });

  // Services from min(earliest record before the target, target − 3) to the target.
  const earliest = records.map((r) => r.month).filter((m) => monthIndex(m) < monthIndex(target)).sort(compareCodepoint)[0];
  const windowStart = shiftMonth(target, -3);
  const from = earliest && monthIndex(earliest) < monthIndex(windowStart) ? earliest : windowStart;
  const [serviceRows, countRows] = await Promise.all([
    readList("services", voiceRolesInRangeQuery(`${from}-01`, `${target}-01`)),
    readList("service counts", serviceCountsInMonths(horizonMonths)),
  ]);
  const services = serviceRows.map(toLedgerService).filter((s): s is LedgerService => s !== null);

  // The members the records and the seats reference (RD-5: nobody else).
  const ids = new Set<string>();
  for (const r of records) for (const p of r.people) ids.add(p.memberId);
  for (const s of services) for (const id of [...s.Lead, ...s.BGVs, ...s.Chorus]) ids.add(id);
  const memberRows = ids.size ? await readList("members", fairnessMembersByIdsQuery([...ids].sort(compareCodepoint))) : [];
  const members = memberRows.filter(isObj).filter((m) => typeof m._id === "string").map((m) => ({
    id: m._id as string,
    name: displayMemberName({ member_name: typeof m.member_name === "string" ? m.member_name : undefined, alias: typeof m.alias === "string" ? m.alias : undefined }),
    unavailableDates: Array.isArray(m.unavailableDates) ? m.unavailableDates.filter((d): d is string => typeof d === "string") : [],
  }));

  const ledger = computeFairnessLedger({ target, records, services, members });
  const freezing = new Map<string, number>();
  for (const row of countRows) {
    if (isObj(row) && typeof row.month === "string") freezing.set(row.month, Number(row.weekend ?? 0) + Number(row.countedSpecials ?? 0));
  }
  return {
    v: 1,
    engine: input.engine,
    environment: input.environment,
    currentMonth: input.currentMonth,
    target,
    window: ledger.window,
    recordsSince: ledger.recordsSince,
    horizon: horizonMonths.map((month) => {
      const record = records.find((r) => r.month === month) ?? null;
      const storedServices = freezing.get(month) ?? 0;
      return { month, record, storedServices, recordBinds: record !== null && storedServices > 0 };
    }),
    people: ledger.people,
    diagnostics: ledger.diagnostics,
  };
}
