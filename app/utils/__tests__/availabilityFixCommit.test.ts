// The availability proposals' writer (ADR-0079; plan §5–§6), over mocked clients. Fictitious people.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));
vi.mock("next/server", () => ({ after: () => undefined }));

import { ALL_IN, ledgerResponse, record } from "@/app/components/admin/__tests__/v3Fixtures";
import type { LogicalRecord } from "@/app/utils/fairnessVocabulary";
import type { RoleDomainSummary } from "@/app/utils/serviceReadSummary";
import { snapshot, sources } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import { MEMBERS, RULES } from "@/app/mcp/monthProposals/__tests__/editorFixtures";
import type { EditorMember } from "@/app/mcp/monthProposals/revise";
import { NOVEMBER, applyPatch, summaryFor, type StoredRow } from "@/app/mcp/tools/__tests__/serviceEditorFixtures";
import type { ParsedEditRequest } from "../roleWriteRequest";
import {
  applyAvailabilityFix,
  availabilityTick,
  conflictRecordId,
  memberTick,
  precheckOpens,
  readConflictPanel,
  setConflictKept,
  sweepAvailabilityConflicts,
  transition,
  type AvailabilityDeps,
  type ConflictRecord,
} from "../availabilityFixCommit";

const TODAY = "2026-10-21";
const ELSA = { _id: "m-elsa", member_name: "Elsa Mora", alias: "Elsa", memberType: ["voz", "support"], ministries: ["worship"] };
const listed = (memberId: string): LogicalRecord["people"][number] => ({ memberId, name: memberId, roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] });
const conflictErr = () => Object.assign(new Error("conflict"), { statusCode: 409, details: { type: "mutationError", items: [] } });
const viaJson = <T>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;

interface World {
  roles: Map<string, StoredRow>;
  members: EditorMember[];
  records: Map<string, ConflictRecord>;
  sent: Array<{ to: string; subject: string; html: string }>;
  summary: { current: ((rows: StoredRow[]) => RoleDomainSummary) | null };
  engine: { current: string };
  acts: { current: boolean };
  blocked: { current: boolean };
  clock: { now: number };
  /** Runs inside the next record write, before it lands: another run acting meanwhile. */
  beforeRecordWrite: Array<(() => void) | null>;
  deps: AvailabilityDeps & { editRole: ReturnType<typeof vi.fn> };
  unavailable(memberId: string, ...dates: string[]): void;
}

let revs = 0;

function world(opts: { rows?: StoredRow[]; members?: EditorMember[]; listed?: string[] } = {}): World {
  const roles = new Map((opts.rows ?? NOVEMBER()).map((r) => [r._id, r]));
  const members = (opts.members ?? [...MEMBERS, ELSA]).map((m) => ({ ...m, ministries: (m as { ministries?: unknown }).ministries ?? ["worship"] })) as EditorMember[];
  const records = new Map<string, ConflictRecord>();
  const sent: World["sent"] = [];
  const summary: World["summary"] = { current: null };
  const engine = { current: "v3" };
  const acts = { current: true };
  const blocked = { current: false };
  const clock = { now: Date.parse("2026-10-21T18:00:00Z") };
  const beforeRecordWrite: World["beforeRecordWrite"] = [];
  const people = opts.listed ?? ["m-ana", "m-bruno", "m-carla", "m-dani", "m-elsa"];
  const rows = () => [...roles.values()];
  const deps = {
    hasToken: () => true,
    readRecords: vi.fn(async (from: string) => viaJson<ConflictRecord[]>([...records.values()].filter((r) => r.date >= from))),
    reads: vi.fn(async () => ({
      ok: true as const,
      value: sources({
        adminRoles: viaJson(rows()),
        members: members as never,
        rules: { rev: "rules-rev-1", config: RULES },
        snapshot: (() => {
          const snap = snapshot({ roles: viaJson(rows()) });
          (snap.readiness as { roleSummary: RoleDomainSummary }).roleSummary = (summary.current ?? summaryFor)(rows());
          return snap;
        })(),
      }),
    })),
    readLedger: vi.fn(async (months: readonly string[]) =>
      ledgerResponse([...months], { horizon: [{ record: record(months[0], people.map(listed)), storedServices: roles.size, recordBinds: true }] })),
    engine: () => engine.current,
    acts: () => acts.current,
    todayIso: () => TODAY,
    now: () => clock.now,
    create: vi.fn(async (doc: Omit<ConflictRecord, "_rev">) => {
      beforeRecordWrite.shift()?.();
      if (records.has(doc._id)) throw conflictErr();
      records.set(doc._id, { ...viaJson<ConflictRecord>(doc), _rev: `r${++revs}` });
    }),
    patch: vi.fn(async (id: string, rev: string, set: Partial<ConflictRecord>, unset: string[] = []) => {
      beforeRecordWrite.shift()?.();
      const cur = records.get(id);
      if (!cur || cur._rev !== rev) throw conflictErr();
      const next = { ...cur, ...viaJson<Partial<ConflictRecord>>(set), _rev: `r${++revs}` } as ConflictRecord;
      for (const f of unset) delete (next as unknown as Record<string, unknown>)[f];
      records.set(id, next);
    }),
    readAudience: vi.fn(async () => [{ _id: "m-frank", email: "frank@example.test", notifPrefs: {} }]),
    deliveryBlocked: () => blocked.current,
    send: vi.fn(async (to: string, subject: string, html: string) => {
      sent.push({ to, subject, html });
      return { ok: true };
    }),
    editRole: vi.fn(async (id: string, request: ParsedEditRequest) => {
      const row = roles.get(id);
      if (!row) return { ok: false, status: 404, body: { error: "not_found" } };
      if (row._rev !== request.rev) return { ok: false, status: 409, body: { error: "stale_revision" } };
      roles.set(id, applyPatch(row, request));
      return { ok: true, status: 200, body: { ok: true } };
    }),
    readSeats: vi.fn(async (_filter: string, params: Record<string, unknown>) => {
      const dates = params.dates as string[] | undefined;
      return rows()
        .filter((r) => (dates ? dates.includes(r.date) : r.date >= (params.today as string) && r.date <= (params.end as string)))
        .map((r) => ({
          _id: r._id,
          date: r.date,
          members: [...new Set([...r.leads, ...r.bgvs, ...r.chorus].map((x) => x._id).concat([...r.instruments, ...r.foh].map((x) => x.person._id)))],
        }));
    }),
    readUnavailable: vi.fn(async () => members.map((m) => ({ _id: m._id, unavailableDates: m.unavailableDates ?? [] }))),
  } as unknown as World["deps"];
  return {
    roles, members, records, sent, summary, engine, acts, blocked, clock, beforeRecordWrite, deps,
    unavailable(memberId, ...dates) {
      const m = members.find((x) => x._id === memberId)!;
      m.unavailableDates = dates;
    },
  };
}

const sweep = (w: World, over: Partial<Parameters<typeof sweepAvailabilityConflicts>[0]> = {}) =>
  sweepAvailabilityConflicts({ trigger: "manual", deadlineMs: w.clock.now + 50_000, mode: "act", ...over }, w.deps);
const DANI_SUN1 = conflictRecordId("sun1", "m-dani", "2026-11-01");

let w: World;
beforeEach(() => {
  w = world();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("the sweep", () => {
  it("records a proposal, emails once, and never writes a role", async () => {
    w.unavailable("m-dani", "2026-11-01");
    const report = await sweep(w);
    expect(report.proposed).toEqual([DANI_SUN1]);
    expect(w.deps.editRole).not.toHaveBeenCalled();
    const rec = w.records.get(DANI_SUN1)!;
    expect(rec).toMatchObject({ status: "proposed", eventSeq: 1, notifiedSeq: 1, published: true });
    expect(rec.seats[0]).toMatchObject({ rowId: "coro", from: "m-dani" });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].subject).toBe("Conflictos de disponibilidad (1)");
    expect(w.sent[0].html).toContain("Dani");
    // A second sweep: nothing new, nothing sent.
    await sweep(w);
    expect(w.sent).toHaveLength(1);
    expect(w.records.get(DANI_SUN1)!.eventSeq).toBe(1);
  });

  it("never writes a role on a draft either", async () => {
    const rows = NOVEMBER().map((r) => (r._id === "sun1" ? { ...r, published: false } : r));
    w = world({ rows });
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    expect(w.deps.editRole).not.toHaveBeenCalled();
    expect(w.records.get(DANI_SUN1)).toMatchObject({ status: "proposed", published: false });
  });

  it("dry mode writes and sends nothing and answers what act would do", async () => {
    w.unavailable("m-dani", "2026-11-01");
    const report = await sweep(w, { mode: "dry" });
    expect(report).toMatchObject({ mode: "dry", proposed: [DANI_SUN1] });
    expect(w.records.size).toBe(0);
    expect(w.sent).toHaveLength(0);
  });

  it("makes no transition on an unjudgeable read: incoherent, engine v2, unready", async () => {
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    const before = JSON.stringify([...w.records.values()]);
    w.unavailable("m-dani");
    w.summary.current = (rows) => ({ ...summaryFor(rows), recordIssues: [{ code: "raw_draft" } as never] });
    expect(await sweep(w)).toMatchObject({ ok: false, reason: "incoherent" });
    w.summary.current = null;
    w.engine.current = "v2";
    expect(await sweep(w)).toMatchObject({ ok: false, reason: "engine" });
    expect(JSON.stringify([...w.records.values()])).toBe(before);
  });

  it("refuses before any read without the read token", async () => {
    w.deps.hasToken = () => false;
    expect(await sweep(w)).toMatchObject({ ok: false, reason: "no_token" });
    expect(w.deps.readRecords).not.toHaveBeenCalled();
    expect(w.deps.reads).not.toHaveBeenCalled();
  });

  it("proposed → date cleared → gone → re-marked → proposed, with one more email", async () => {
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    w.unavailable("m-dani");
    expect((await sweep(w)).gone).toEqual([DANI_SUN1]);
    expect(w.records.get(DANI_SUN1)!.status).toBe("gone");
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    expect(w.records.get(DANI_SUN1)).toMatchObject({ status: "proposed", eventSeq: 2, notifiedSeq: 2 });
    expect(w.sent).toHaveLength(2);
  });

  it("«Mantener» silences while the conflict lasts; it ends with the conflict and a re-mark is news", async () => {
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    const rec = w.records.get(DANI_SUN1)!;
    await setConflictKept({ roleId: "sun1", memberId: "m-dani", date: "2026-11-01", serviceKind: "sunday_role", published: true, rev: rec._rev, kept: true, actor: "m-frank" }, w.deps);
    w.clock.now += 7 * 3600_000;
    await sweep(w);
    expect(w.records.get(DANI_SUN1)!.status).toBe("kept");
    expect(w.sent).toHaveLength(1);
    w.unavailable("m-dani");
    await sweep(w);
    expect(w.records.get(DANI_SUN1)!.status).toBe("gone");
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    expect(w.records.get(DANI_SUN1)!.status).toBe("proposed");
    expect(w.sent).toHaveLength(2);
  });

  it("a conflict on a service the board cannot edit is «sin revisar», never gone", async () => {
    // A weekend role with no lock yet: shown, never edited (bootstrap-eligible, not approved).
    w.summary.current = (rows) => {
      const sum = summaryFor(rows);
      return { ...sum, targets: sum.targets.map((t) => (t.canonicalIds[0] === "sun1" ? { ...t, lock: null } : t)) };
    };
    w.unavailable("m-dani", "2026-11-01");
    expect((await sweep(w)).ok).toBe(true);
    expect(w.records.get(DANI_SUN1)).toMatchObject({ status: "none", reason: "unchecked" });
  });

  it("an unfixable conflict stops reopening the tick once checked, and is re-judged once editable", async () => {
    const locked = (rows: StoredRow[]) => {
      const sum = summaryFor(rows);
      return { ...sum, targets: sum.targets.map((t) => (t.canonicalIds[0] === "sun1" ? { ...t, lock: null } : t)) };
    };
    w.summary.current = locked;
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w, { trigger: "cron" });
    const rec = w.records.get(DANI_SUN1)!;
    expect(rec.checkedAt).toBeTruthy();
    const seats = [{ _id: "sun1", date: "2026-11-01", members: ["m-dani"] }];
    const off = new Map([["m-dani", new Set(["2026-11-01"])]]);
    expect(precheckOpens({ seats, unavailable: off, records: [{ ...rec, notifiedSeq: rec.eventSeq }], nowMs: w.clock.now })).toBe(false);
    // The service becomes editable: the next run re-judges the «unchecked» record at once, tick or not.
    w.summary.current = null;
    w.clock.now += 60_000;
    await sweep(w, { trigger: "cron" });
    expect(w.records.get(DANI_SUN1)!.status).toBe("proposed");
  });

  it("a person's own trigger re-judges a fresh open record; the tick waits for it to go stale", async () => {
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    const proposed = w.records.get(DANI_SUN1)!;
    expect(proposed.status).toBe("proposed");
    // Every candidate leaves: the tick keeps the fresh judgement, «Revisar ahora» re-judges it.
    for (const m of w.members) if (m._id !== "m-dani") m.unavailableDates = ["2026-11-01"];
    w.clock.now += 60_000;
    await sweep(w, { trigger: "cron" });
    expect(w.records.get(DANI_SUN1)!._rev).toBe(proposed._rev);
    await sweep(w, { trigger: "manual" });
    expect(w.records.get(DANI_SUN1)!.status).toBe("none");
  });

  it("the member scope never touches another member's identity", async () => {
    w.unavailable("m-dani", "2026-11-01");
    w.unavailable("m-ana", "2026-11-07");
    const report = await sweep(w, { trigger: "member", memberId: "m-ana" });
    expect(report.proposed.concat(report.none)).toEqual([conflictRecordId("sat7", "m-ana", "2026-11-07")]);
    expect(w.records.has(DANI_SUN1)).toBe(false);
  });

  it("two concurrent sweeps on one new identity: one create wins, one email", async () => {
    w.unavailable("m-dani", "2026-11-01");
    w.beforeRecordWrite.push(() => {
      w.records.set(DANI_SUN1, { _id: DANI_SUN1, _rev: "other", _type: "availabilityConflict", roleId: "sun1", memberId: "m-dani", date: "2026-11-01", serviceKind: "sunday_role", published: true, status: "proposed", seats: [], eventSeq: 1, notifiedSeq: 1, firstSeenAt: "", updatedAt: "", trigger: "cron" });
    });
    await sweep(w);
    expect(w.records.get(DANI_SUN1)!._rev).toBe("other");
    expect(w.sent).toHaveLength(0);
  });

  it("delivery blocked: nothing is claimed and the event stays due", async () => {
    w.blocked.current = true;
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    expect(w.records.get(DANI_SUN1)).toMatchObject({ eventSeq: 1, notifiedSeq: 0 });
    expect(w.sent).toHaveLength(0);
    w.blocked.current = false;
    await sweep(w);
    expect(w.sent).toHaveLength(1);
  });

  it("the deadline stops new judgements and leaves no claim without room to send", async () => {
    w.unavailable("m-dani", "2026-11-01");
    const report = await sweep(w, { deadlineMs: w.clock.now + 5_000 });
    expect(report.skipped).toEqual([DANI_SUN1]);
    expect(w.records.size).toBe(0);
  });

  it("a failed ledger read leaves the month untouched", async () => {
    w.unavailable("m-dani", "2026-11-01");
    w.deps.readLedger = vi.fn(async () => { throw new Error("down"); });
    const report = await sweep(w);
    expect(report.skipped).toEqual([DANI_SUN1]);
    expect(w.records.size).toBe(0);
  });
});

describe("transition (§5.2)", () => {
  const conflict = { roleId: "sun1", roleRev: "r", roleType: "sunday_role" as const, memberId: "m-dani", date: "2026-11-01", published: true };
  const rec = (status: ConflictRecord["status"], over: Partial<ConflictRecord> = {}): ConflictRecord => ({
    _id: "x", _rev: "r", _type: "availabilityConflict", roleId: "sun1", memberId: "m-dani", date: "2026-11-01", serviceKind: "sunday_role",
    published: true, status, seats: [{ _key: "s0", rowId: "coro", from: "m-dani" }], reason: "no_candidate", eventSeq: 1, notifiedSeq: 1, firstSeenAt: "", updatedAt: "", trigger: "cron", ...over,
  });
  const pick = { c: true as const, conflict, e: true as const, proposal: { kind: "replace" as const, target: {} as never, seats: [{ rowId: "coro", from: "m-dani", to: "m-ana" }] } };
  const none = { c: true as const, conflict, e: true as const, proposal: { kind: "none" as const, reason: "no_candidate" as const } };
  const notE = { c: true as const, conflict, e: false as const };

  it("covers every cell of the table", () => {
    // no record / gone / applied + C → new event
    for (const r of [null, rec("gone"), rec("applied")]) {
      expect(transition(r, pick, ["coro"], false)).toMatchObject({ status: "proposed", event: true });
      expect(transition(r, notE, ["coro"], false)).toMatchObject({ status: "none", reason: "unchecked", event: true });
    }
    expect(transition(null, { c: false }, [], false)).toBeNull();
    expect(transition(rec("applied"), { c: false }, [], false)).toBeNull();
    // proposed/none
    expect(transition(rec("none"), none, ["coro"], false)).toBeNull();
    expect(transition(rec("none"), pick, ["coro"], false)).toMatchObject({ status: "proposed", event: true });
    expect(transition(rec("proposed", { reason: undefined, seats: [{ _key: "s0", rowId: "coro", from: "m-dani", to: "m-ana" }] }), none, ["coro"], false)).toMatchObject({ status: "none", event: true });
    expect(transition(rec("proposed", { reason: undefined, seats: [{ _key: "s0", rowId: "coro", from: "m-dani", to: "m-elsa" }] }), pick, ["coro"], false)).toMatchObject({ status: "proposed", event: false });
    expect(transition(rec("none"), none, ["coro"], true)).toMatchObject({ status: "none", event: false, checked: true });
    expect(transition(rec("proposed", { reason: undefined }), notE, ["coro"], false)).toMatchObject({ status: "none", reason: "unchecked", event: true });
    expect(transition(rec("none"), { c: false }, [], false)).toMatchObject({ status: "gone", event: false });
    // kept
    expect(transition(rec("kept"), pick, ["coro"], false)).toBeNull();
    expect(transition(rec("kept"), notE, ["coro"], false)).toBeNull();
    expect(transition(rec("kept"), { c: false }, [], false)).toMatchObject({ status: "gone" });
  });
});

describe("«Aplicar»", () => {
  it("writes through editRole (deferred notices) and records `applied`", async () => {
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    const rec = w.records.get(DANI_SUN1)!;
    const to = rec.seats[0].to!;
    const out = await applyAvailabilityFix({ roleId: "sun1", rev: "sun1-r1", memberId: "m-dani", replacements: [{ rowId: "coro", to }], actor: "m-frank" }, w.deps);
    expect(out).toMatchObject({ ok: true, body: { recorded: true } });
    expect(w.deps.editRole).toHaveBeenCalledTimes(1);
    expect(w.deps.editRole.mock.calls[0][2]).toEqual({ notices: "deferred" });
    expect(w.roles.get("sun1")!.chorus.map((s) => s._id)).toEqual([to]);
    expect(w.records.get(DANI_SUN1)).toMatchObject({ status: "applied", appliedBy: "m-frank" });
    expect(w.records.get(DANI_SUN1)!.reason).toBeUndefined();
  });

  it("refuses a stale rev, a partial cover and a replacement that no longer passes", async () => {
    w.unavailable("m-dani", "2026-11-01");
    expect(await applyAvailabilityFix({ roleId: "sun1", rev: "old", memberId: "m-dani", replacements: [{ rowId: "coro", to: "m-ana" }], actor: "a" }, w.deps)).toMatchObject({ status: 409, body: { error: "stale_revision" } });
    expect(await applyAvailabilityFix({ roleId: "sun1", rev: "sun1-r1", memberId: "m-dani", replacements: [], actor: "a" }, w.deps)).toMatchObject({ status: 400 });
    // Bruno already serves sun1: he never passes.
    expect(await applyAvailabilityFix({ roleId: "sun1", rev: "sun1-r1", memberId: "m-dani", replacements: [{ rowId: "coro", to: "m-bruno" }], actor: "a" }, w.deps)).toMatchObject({ status: 409, body: { error: "refused" } });
    expect(w.deps.editRole).not.toHaveBeenCalled();
  });

  it("a lost record write still answers ok, and the next sweep records `gone`", async () => {
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    const to = w.records.get(DANI_SUN1)!.seats[0].to!;
    w.beforeRecordWrite.push(() => {
      const r = w.records.get(DANI_SUN1)!;
      w.records.set(DANI_SUN1, { ...r, _rev: "moved" });
    });
    const out = await applyAvailabilityFix({ roleId: "sun1", rev: "sun1-r1", memberId: "m-dani", replacements: [{ rowId: "coro", to }], actor: "a" }, w.deps);
    expect(out).toMatchObject({ ok: true, body: { recorded: false } });
    await sweep(w);
    expect(w.records.get(DANI_SUN1)!.status).toBe("gone");
  });
});

describe("the triggers", () => {
  it("memberTick sweeps only when a date the member serves on moved", async () => {
    expect(await memberTick({ memberId: "m-dani", addedDates: ["2026-11-02"], removedDates: [], startedAt: w.clock.now }, w.deps)).toBeNull();
    w.unavailable("m-dani", "2026-11-01");
    const report = await memberTick({ memberId: "m-dani", addedDates: ["2026-11-01"], removedDates: [], startedAt: w.clock.now }, w.deps);
    expect(report?.proposed).toEqual([DANI_SUN1]);
    // A clear of a kept conflict opens a sweep too (it ends the keep).
    await setConflictKept({ roleId: "sun1", memberId: "m-dani", date: "2026-11-01", serviceKind: "sunday_role", published: true, kept: true, actor: "a" }, w.deps);
    w.unavailable("m-dani");
    await memberTick({ memberId: "m-dani", addedDates: [], removedDates: ["2026-11-01"], startedAt: w.clock.now }, w.deps);
    expect(w.records.get(DANI_SUN1)!.status).toBe("gone");
  });

  it("the tick skips outside its bucket and with too little time left", async () => {
    w.clock.now = 300_000 * 3 * 1000 + 300_000; // bucket % 3 === 1
    expect(await availabilityTick({ startedAt: w.clock.now }, w.deps)).toBe("skipped");
    w.clock.now = 300_000 * 3 * 1000;
    expect(await availabilityTick({ startedAt: w.clock.now - 20_000 }, w.deps)).toBe("skipped");
    expect(await availabilityTick({ startedAt: w.clock.now }, w.deps)).toBe("clear");
    w.unavailable("m-dani", "2026-11-01");
    expect(await availabilityTick({ startedAt: w.clock.now }, w.deps)).toBe("swept");
  });

  it("«Deshacer» empties the old judgement and the next sweep re-judges it", async () => {
    w.unavailable("m-dani", "2026-11-01");
    await sweep(w);
    let rec = w.records.get(DANI_SUN1)!;
    await setConflictKept({ roleId: "sun1", memberId: "m-dani", date: "2026-11-01", serviceKind: "sunday_role", published: true, rev: rec._rev, kept: true, actor: "m-frank" }, w.deps);
    rec = w.records.get(DANI_SUN1)!;
    await setConflictKept({ roleId: "sun1", memberId: "m-dani", date: "2026-11-01", serviceKind: "sunday_role", published: true, rev: rec._rev, kept: false, actor: "m-frank" }, w.deps);
    rec = w.records.get(DANI_SUN1)!;
    expect(rec).toMatchObject({ status: "none", seats: [] });
    expect(rec.reason).toBeUndefined();
    await sweep(w, { trigger: "cron" });
    expect(w.records.get(DANI_SUN1)!.status).toBe("proposed");
  });

  it("the pre-check opens for each case §5.4 names and not otherwise", () => {
    const now = Date.parse("2026-10-21T18:00:00Z");
    const id = conflictRecordId("sun1", "m-dani", "2026-11-01");
    const seats = [{ _id: "sun1", date: "2026-11-01", members: ["m-dani"] }];
    const off = new Map<string, Set<string>>([["m-dani", new Set(["2026-11-01"])]]);
    const rec = (over: Partial<ConflictRecord>): ConflictRecord => ({
      _id: id, _rev: "r", _type: "availabilityConflict", roleId: "sun1", memberId: "m-dani", date: "2026-11-01", serviceKind: "sunday_role", published: true,
      status: "proposed", seats: [], eventSeq: 1, notifiedSeq: 1, firstSeenAt: "", updatedAt: "", checkedAt: new Date(now).toISOString(), trigger: "cron", ...over,
    });
    expect(precheckOpens({ seats, unavailable: off, records: [], nowMs: now })).toBe(true);
    expect(precheckOpens({ seats, unavailable: off, records: [rec({})], nowMs: now })).toBe(false);
    expect(precheckOpens({ seats, unavailable: off, records: [rec({ status: "applied" })], nowMs: now })).toBe(true);
    expect(precheckOpens({ seats, unavailable: new Map(), records: [rec({})], nowMs: now })).toBe(true);
    expect(precheckOpens({ seats, unavailable: new Map(), records: [rec({ status: "kept" })], nowMs: now })).toBe(true);
    expect(precheckOpens({ seats, unavailable: off, records: [rec({ status: "kept" })], nowMs: now })).toBe(false);
    expect(precheckOpens({ seats, unavailable: off, records: [rec({ checkedAt: new Date(now - 7 * 3600_000).toISOString() })], nowMs: now })).toBe(true);
    expect(precheckOpens({ seats, unavailable: off, records: [rec({ notifiedSeq: 0 })], nowMs: now })).toBe(true);
    expect(precheckOpens({ seats, unavailable: new Map(), records: [rec({ status: "gone" })], nowMs: now })).toBe(false);
  });
});

describe("the panel's read", () => {
  it("lists the open conflict with its proposal and alternatives, and the blocked reason", async () => {
    w.unavailable("m-dani", "2026-11-01");
    const read = await readConflictPanel(w.deps);
    expect(read).toMatchObject({ ok: true, blocked: null });
    if (!read.ok) return;
    expect(read.open).toHaveLength(1);
    expect(read.open[0]).toMatchObject({ roleId: "sun1", memberId: "m-dani", person: "Dani", roleRev: "sun1-r1" });
    expect(read.open[0].options.length).toBeGreaterThanOrEqual(1);
    const firsts = read.open[0].options.map((o) => o.seats[0].to);
    expect(new Set(firsts).size).toBe(firsts.length);
    w.engine.current = "v2";
    expect(await readConflictPanel(w.deps)).toMatchObject({ ok: true, blocked: "engine", open: [] });
  });
});
