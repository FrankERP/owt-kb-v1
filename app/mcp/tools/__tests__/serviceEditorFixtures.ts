// Shared by the saved-month editor's suites — NOT a test file (no `.test.` in the name).
// Fictitious people only (the repository is public).
//
// One world: November 2026's SAVED services as the admin roles read returns them, a coherent
// integrity summary derived from them (every weekend lock claimed by its role), an in-memory store
// the fake writer (`editRole`) patches under the `_rev` it asserts — as `roleEditCommit` does —
// and the re-read the save makes after a refusal.
//
//   sun1   Sunday 1 Nov    Lead Bruno · BGV Carla · Coro Dani · Bass Tomás
//   sat7   Saturday 7 Nov  Lead Carla · BGV Ana
//   sun8   Sunday 8 Nov    Lead Bruno · BGV Ana   (Bruno is out of week 2's Sundays: a BASELINE finding)
//   sun15  Sunday 15 Nov   Lead Bruno, no BGV
//   esp18  «Noche de alabanza» 18 Nov, 19:00, no seats (a special: no weekend lock)
import { vi } from "vitest";

import { ledgerResponse, record } from "@/app/components/admin/__tests__/v3Fixtures";
import type { SolverConfig } from "@/app/components/admin/plannerModel";
import { assembleFairnessLedger } from "@/app/utils/fairnessLedgerRead";
import type { ParsedEditRequest } from "@/app/utils/roleWriteRequest";
import type { RoleDomainSummary, RoleTarget } from "@/app/utils/serviceReadSummary";
import { snapshot, sources } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import { memberToken } from "../../monthProposals/memberTokens";
import type { EditorMember } from "../../monthProposals/revise";
import { MEMBERS, RULES } from "../../monthProposals/__tests__/editorFixtures";
import type { ServiceEditorDeps } from "../serviceEditor";

export const TOKEN_KEY = new TextEncoder().encode("t".repeat(32));
export const MONTH = "2026-11";

type Seat = { _id: string; _key: string; member_name: string };
export interface StoredRow {
  _id: string;
  _rev: string;
  _type: "sunday_role" | "saturday_role" | "special_role";
  date: string;
  published: boolean;
  countsForFairness: boolean;
  service_name?: string;
  time?: string;
  format?: string;
  leads: Seat[];
  bgvs: Seat[];
  chorus: Seat[];
  instruments: Array<{ _key: string; instrument: string; person: Seat }>;
  foh: Array<{ _key: string; role: string; person: Seat }>;
  songs: unknown[];
}

let keys = 0;
const seat = (id: string): Seat => ({ _id: id, _key: `k${++keys}`, member_name: id });

export function storedRow(
  id: string,
  type: StoredRow["_type"],
  date: string,
  seats: { leads?: string[]; bgvs?: string[]; chorus?: string[]; instruments?: Array<[string, string]>; foh?: Array<[string, string]> } = {},
  over: Partial<StoredRow> = {},
): StoredRow {
  return {
    _id: id,
    _rev: `${id}-r1`,
    _type: type,
    date,
    published: true,
    countsForFairness: type !== "special_role",
    leads: (seats.leads ?? []).map(seat),
    bgvs: (seats.bgvs ?? []).map(seat),
    chorus: (seats.chorus ?? []).map(seat),
    instruments: (seats.instruments ?? []).map(([instrument, m]) => ({ _key: `k${++keys}`, instrument, person: seat(m) })),
    foh: (seats.foh ?? []).map(([role, m]) => ({ _key: `k${++keys}`, role, person: seat(m) })),
    songs: [],
    ...(type === "special_role" ? { service_name: "Noche de alabanza", time: "19:00" } : {}),
    ...over,
  };
}

export const NOVEMBER = (): StoredRow[] => [
  storedRow("sun1", "sunday_role", "2026-11-01", { leads: ["m-bruno"], bgvs: ["m-carla"], chorus: ["m-dani"], instruments: [["Bass", "m-tomas"]] }),
  storedRow("sat7", "saturday_role", "2026-11-07", { leads: ["m-carla"], bgvs: ["m-ana"] }),
  storedRow("sun8", "sunday_role", "2026-11-08", { leads: ["m-bruno"], bgvs: ["m-ana"] }),
  storedRow("sun15", "sunday_role", "2026-11-15", { leads: ["m-bruno"] }),
  storedRow("esp18", "special_role", "2026-11-18"),
];

const refsOf = (r: StoredRow) => [...new Set([...r.leads, ...r.bgvs, ...r.chorus].map((s) => s._id).concat([...r.instruments, ...r.foh].map((x) => x.person._id)))];

/** A coherent integrity summary for `rows`: one single target each, weekend locks claimed by their role. */
export function summaryFor(rows: readonly StoredRow[]): RoleDomainSummary {
  const targets: RoleTarget[] = rows.map((r) => {
    const weekend = r._type !== "special_role";
    return {
      targetKey: weekend ? `${r._type}:${r.date}` : `special_role:${r.date}:${r.service_name}`,
      type: r._type,
      canonicalCount: 1,
      canonicalIds: [r._id],
      canonicalState: "single",
      publicState: "single",
      memberVisibleCount: r.published ? 1 : 0,
      draftIds: [],
      records: [{ id: r._id, rev: r._rev, type: r._type, serviceDate: r.date, published: r.published, assignedRefs: refsOf(r), members: [], danglingRefs: [] }],
      expectsLock: weekend,
      lock: weekend ? { id: `roleTarget.${r._type}.${r.date}`, rev: `lock-${r._id}`, state: "claimed", roleId: r._id, generation: 1 } : null,
      lockIssues: [],
    } as RoleTarget;
  });
  return { targets, recordIssues: [], lockIssues: [] };
}

export interface ServiceWorld {
  store: Map<string, StoredRow>;
  config: { current: SolverConfig };
  members: { current: EditorMember[] };
  /** Overrides the summary the next reads return (an incoherent inventory, a lock issue). */
  summary: { current: ((rows: StoredRow[]) => RoleDomainSummary) | null };
  /** Runs inside the next write, before it commits: another writer acting meanwhile. */
  beforeWrite: Array<((id: string) => void) | null>;
  /** The order things happened: `write:<id>`, `copy:<id>`, `notices:<id>`. */
  log: string[];
  clock: { now: number };
  deps: ServiceEditorDeps & { editRole: ReturnType<typeof vi.fn>; copyInstruments: ReturnType<typeof vi.fn>; rereadRole: ReturnType<typeof vi.fn>; reads: ReturnType<typeof vi.fn> };
  tok(memberId: string): string;
}

const nextRev = (rev: string) => rev.replace(/-r(\d+)$/, (_, n) => `-r${Number(n) + 1}`);

/** Applies a parsed PATCH to a stored row, as the writer stores it (a fresh `_key` per item). */
export function applyPatch(row: StoredRow, request: ParsedEditRequest): StoredRow {
  const s = request.seats;
  return {
    ...row,
    _rev: nextRev(row._rev),
    ...(row._type === "special_role" ? { service_name: request.serviceName ?? row.service_name } : {}),
    ...(row._type === "special_role" ? (request.time ? { time: request.time } : { time: undefined }) : {}),
    ...(request.countsForFairness !== undefined ? { countsForFairness: request.countsForFairness } : {}),
    leads: s.leads.map(seat),
    bgvs: s.bgvs.map(seat),
    chorus: s.chorus.map(seat),
    instruments: s.instruments.map((i) => ({ _key: `k${++keys}`, instrument: i.instrument, person: seat(i.personId) })),
    foh: s.foh.map((f) => ({ _key: `k${++keys}`, role: f.role, person: seat(f.personId) })),
  };
}

const viaJson = <T>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;

export function serviceWorld(opts: { rows?: StoredRow[]; config?: SolverConfig; members?: EditorMember[]; withRecord?: boolean } = {}): ServiceWorld {
  const store = new Map((opts.rows ?? NOVEMBER()).map((r) => [r._id, r]));
  const config = { current: opts.config ?? RULES };
  const members = { current: opts.members ?? MEMBERS };
  const summary: ServiceWorld["summary"] = { current: null };
  const beforeWrite: ServiceWorld["beforeWrite"] = [];
  const log: string[] = [];
  const clock = { now: 1_000_000 };
  const rows = () => [...store.values()];

  const deps = {
    engine: () => "v3",
    reads: vi.fn(async () => ({
      ok: true as const,
      value: sources({
        adminRoles: viaJson(rows()),
        members: members.current as never,
        rules: { rev: "rules-rev-1", config: config.current },
        snapshot: (() => {
          const snap = snapshot({ roles: viaJson(rows()) });
          (snap.readiness as { roleSummary: RoleDomainSummary }).roleSummary = (summary.current ?? summaryFor)(rows());
          return snap;
        })(),
      }),
    })),
    readLedger: vi.fn(async (months: readonly string[]) =>
      ledgerResponse([...months], opts.withRecord === false ? {} : { horizon: [{ record: record(MONTH, []), storedServices: store.size, recordBinds: true }] })),
    readFairShare: vi.fn(async (input: Parameters<ServiceEditorDeps["readFairShare"]>[0]) => {
      const { records, services } = input.adjust({ records: [], services: [] });
      return assembleFairnessLedger({
        target: input.target, records, services,
        members: members.current.map((m) => ({ id: m._id, name: m.alias ?? m.member_name, unavailableDates: m.unavailableDates ?? [] })),
      });
    }),
    tokenKey: () => ({ ok: true as const, key: TOKEN_KEY }),
    environment: () => "local" as const,
    nowMs: () => clock.now,
    todayIso: () => "2026-10-21",
    // `roleEditCommit`'s contract over the map: refuse a stale `_rev`, else patch and bump it.
    editRole: vi.fn(async (id: string, request: ParsedEditRequest, options?: { notices?: string }) => {
      const hook = beforeWrite.shift();
      hook?.(id);
      const row = store.get(id);
      if (!row) return { ok: false, status: 404, body: { error: "not_found" } };
      if (row._rev !== request.rev) return { ok: false, status: 409, body: { error: "stale_revision" } };
      store.set(id, applyPatch(row, request));
      log.push(`write:${id}`);
      if (options?.notices === "inline") log.push(`notices:${id}`);
      return { ok: true, status: 200, body: { ok: true }, effects: { noticesQueued: options?.notices === "inline" ? true : null } };
    }),
    // `copyInstrumentsCommit`'s contract: both revisions asserted, the source's instruments onto the target.
    copyInstruments: vi.fn(async (body: { source: { id: string; rev: string }; target: { id: string; rev: string } }, options?: { notices?: string }) => {
      const hook = beforeWrite.shift();
      hook?.(body.target.id);
      const source = store.get(body.source.id);
      const target = store.get(body.target.id);
      if (!source || !target) return { ok: false, status: 404, body: { error: "not_found" } };
      if (source._rev !== body.source.rev || target._rev !== body.target.rev) return { ok: false, status: 409, body: { error: "stale_revision" } };
      store.set(target._id, { ...target, _rev: nextRev(target._rev), instruments: source.instruments.map((i) => ({ ...i, _key: `k${++keys}` })) });
      log.push(`copy:${target._id}`);
      if (options?.notices === "inline") log.push(`notices:${target._id}`);
      return { ok: true, status: 200, body: { ok: true }, effects: { noticesQueued: options?.notices === "inline" ? true : null } };
    }),
    keepAlive: vi.fn(),
    rereadRole: vi.fn(async (id: string) => {
      const row = store.get(id);
      return row ? viaJson(row) : null;
    }),
  } as unknown as ServiceWorld["deps"];

  return {
    store, config, members, summary, beforeWrite, log, clock, deps,
    tok: (id) => memberToken(TOKEN_KEY, `month|${MONTH}`, id),
  };
}
