// Solver v3 C6 §5.11 (CRITICAL) — the confirm's pure half: one frozen PUT entry per horizon month in
// the shape its state calls for (§4, CF-3, A27), the guard every attempt runs first (CF-1, A40, HZ-9),
// the verdict on the PUT's answer (CF-4) and §7.8's lines. Fictitious people only.
import { describe, expect, it } from "vitest";

import {
  classifyRecordPut, confirmGuard, draftsByMonth, freezeConfirmEntries, guardLine, monthReportLines,
  recordRetryOffered, recordVerdictLine, twoMonthSummaryLine, type V3ConfirmEntry,
} from "../v3Confirm";
import { bodyFromRecord, resolveMonthSources, type MonthSource } from "../v3MonthSources";
import { V3_LINES } from "../v3Copy";
import { FAIRNESS_PUT_REFUSALS, type FairnessMonthBody } from "@/app/utils/fairnessVocabulary";
import {
  buildFairnessMonthDocument, contentHashOfWrite, parseStoredFairnessMonth, validateFairnessMonthWrite,
} from "@/app/utils/fairnessMonthWriteRequest";
import { ALL_IN, MEMBERS, NAME_SHAPED_KEYS, config, ledgerResponse } from "./v3Fixtures";

const body = (month: string): FairnessMonthBody => ({
  month,
  people: [{ memberId: "m-ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }],
  presence: [],
});
const src = (month: string, state: MonthSource["state"], rev: string | null): MonthSource => ({ month, state, rev, recordedAt: null, body: body(month) });

describe("freezeConfirmEntries — one entry per horizon month, one shape per state (CF-1, CF-3, A27)", () => {
  const entries = freezeConfirmEntries([
    src("2026-11", "bound", "rev-nov"),
    src("2026-12", "recorded_unbound", "rev-dec"),
  ], "auto");
  const more = freezeConfirmEntries([src("2027-01", "unrecorded", null), src("2027-02", "anchored_unrecorded", null)], "manual");

  it("bound: the record's own content, its rev, source auto — expects `unchanged` only", () => {
    expect(entries[0]).toEqual({ month: "2026-11", state: "bound", write: { ...body("2026-11"), source: "auto", expectedRev: "rev-nov" }, expects: ["unchanged"] });
  });

  it("recorded, unbound: the frozen screen body under the record's rev — `replaced` or `unchanged`", () => {
    expect(entries[1].write).toMatchObject({ month: "2026-12", source: "auto", expectedRev: "rev-dec" });
    expect(entries[1].expects).toEqual(["replaced", "unchanged"]);
  });

  it("unrecorded AND anchored-unrecorded: a create with expectedRev null — `created` or `unchanged` (A27, no skip)", () => {
    for (const e of more) {
      expect(e.write).toMatchObject({ source: "manual", expectedRev: null });
      expect(e.expects).toEqual(["created", "unchanged"]);
    }
  });

  it("a bound month's entry is `auto` even on the no-Auto path (its hash excludes the stamp; it must answer `unchanged`)", () => {
    expect(freezeConfirmEntries([src("2026-11", "bound", "rev-nov")], "manual")[0].write.source).toBe("auto");
  });

  it("carries no name, key, hash or stamp beyond IF2-4's fields; frozen against mutation", () => {
    expect(Object.keys(entries[0].write).sort()).toEqual(["expectedRev", "month", "people", "presence", "source"]);
    expect(entries[0].write.people[0]).not.toHaveProperty("name");
    expect(() => { (entries as V3ConfirmEntry[])[0].write.people.length = 0; }).toThrow();
  });
});

describe("the round trip (CF-3, the test's only use of IF2-19)", () => {
  it("a GET logical record turned into a bound PUT entry hashes to the record's own contentHash", () => {
    const write = { month: "2026-11", people: [
      // An exact rule's roles must carry status `exact` (WR-3 `notExact`, and `exactUnlisted` the other way), or the last assertion fails.
      { memberId: "m-bruno", roles: { ...ALL_IN, "Sun.Lead": "exact" as const, "Sat.Lead": "out" as const }, exactRules: [{ roles: ["Sun.Lead" as const], count: 2 }], exempt: true, blocks: [{ date: "2026-11-15", unavailable: true, excludedRoles: [] }] },
      { memberId: "m-ana", roles: { ...ALL_IN }, exactRules: [], sundayCadence: "alternate" as const, exempt: false, blocks: [] },
    ], presence: [{ ruleKey: "r-ana-bruno", roles: ["Sun.BGV" as const], members: ["m-ana", "m-bruno"], exclusive: false }] };
    const doc = {
      ...buildFairnessMonthDocument({ body: write, source: "auto", engine: "v3", environment: "local", recordedAt: "2026-11-02T18:00:00.000Z", recordedBy: "m-ana", names: new Map([["m-ana", "Ana"], ["m-bruno", "Bruno"]]) }),
      _rev: "rev-1", _createdAt: "2026-11-02T18:00:00Z", _updatedAt: "2026-11-02T18:00:00Z",
    };
    const parsed = parseStoredFairnessMonth(doc);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const sources = resolveMonthSources({
      months: ["2026-11"], ledger: ledgerResponse(["2026-11"], { horizon: [{ record: parsed.record, storedServices: 1, recordBinds: true }] }),
      config: config(), members: MEMBERS, exactLeadLabel: () => null,
    });
    if (!sources.ok) throw new Error(sources.lines.join());
    const [entry] = freezeConfirmEntries(sources.sources, "auto");
    const { month, people, presence } = entry.write;
    expect(contentHashOfWrite(month, { month, people, presence })).toBe(parsed.record.contentHash);
    expect(bodyFromRecord(parsed.record).people.map((p) => p.memberId)).toEqual(parsed.record.people.map((p) => p.memberId));
    // …and WR-3 accepts the entry as the route would (strict fields, no name/_key/stamp): no 400.
    expect(validateFairnessMonthWrite(entry.write, "route", "2026-10")).toMatchObject({ ok: true });
  });
});

describe("confirmGuard — every attempt, before anything (CF-1, A40, HZ-9)", () => {
  it("a month that became past refuses; the line depends on whether this confirm already created drafts", () => {
    const guard = confirmGuard(["2026-10", "2026-11"], "2026-11");
    expect(guard).toEqual({ kind: "past", month: "2026-10" });
    expect(guardLine(guard!, false)).toBe("Octubre ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto.");
    expect(guardLine(guard!, true)).toBe("Octubre ya pasó mientras planeabas, así que no se creó nada más. Lo ya creado se queda; completa lo que falta en «Editar mes».");
  });

  it("a month past C2's ceiling refuses with HZ-9's line", () => {
    const guard = confirmGuard(["2027-11"], "2026-10");
    expect(guardLine(guard!, false)).toBe("Auto no planea más de 12 meses adelante: Noviembre queda fuera. Elige un mes hasta octubre.");
  });

  it("admits a horizon inside both bounds", () => expect(confirmGuard(["2026-11", "2026-12"], "2026-11")).toBeNull());
});

describe("classifyRecordPut (CF-4) — drafts only on a 200 whose every month has an expected outcome", () => {
  const entries = freezeConfirmEntries([src("2026-11", "bound", "r1"), src("2026-12", "recorded_unbound", "r2"), src("2027-01", "unrecorded", null)], "auto");
  const ok = (outcomes: string[]) => ({ kind: "http" as const, status: 200, body: { months: ["2026-11", "2026-12", "2027-01"].map((month, i) => ({ month, outcome: outcomes[i], rev: "x", contentHash: "sha256:x", recordedAt: "t" })) } });

  it("expected outcomes proceed", () => {
    expect(classifyRecordPut(entries, ok(["unchanged", "replaced", "created"]))).toEqual({ ok: true });
    expect(classifyRecordPut(entries, ok(["unchanged", "unchanged", "unchanged"]))).toEqual({ ok: true });
  });

  it("`replaced` for a bound month, `created` for a recorded one, or a missing month is «other failure»", () => {
    expect(classifyRecordPut(entries, ok(["replaced", "replaced", "created"]))).toEqual({ ok: false, kind: "other" });
    expect(classifyRecordPut(entries, ok(["unchanged", "created", "created"]))).toEqual({ ok: false, kind: "other" });
    expect(classifyRecordPut(entries, { kind: "http", status: 200, body: { months: [] } })).toEqual({ ok: false, kind: "other" });
  });

  it.each(FAIRNESS_PUT_REFUSALS.map((d) => [d]))("409 %s is a refusal naming the month, with no «Reintentar»", (detail) => {
    const answer = { kind: "http" as const, status: 409, body: { error: "stale_revision", message: "x", conflict: true, details: { detail, months: [{ month: "2026-11", verdict: "unchanged" }, { month: "2026-12", verdict: detail }] } } };
    const verdict = classifyRecordPut(entries, answer);
    expect(verdict).toEqual({ ok: false, kind: "refusal", detail, month: "2026-12" });
    expect(recordRetryOffered(verdict)).toBe(false);
    expect(recordVerdictLine(verdict as Exclude<typeof verdict, { ok: true }>).length).toBeGreaterThan(0);
  });

  it("engine_not_v3 before any read (no months) names the first month and asks for a reload", () => {
    const verdict = classifyRecordPut(entries, { kind: "http", status: 409, body: { error: "integrity_conflict", conflict: true, details: { detail: "engine_not_v3", months: [] } } });
    expect(verdict).toEqual({ ok: false, kind: "refusal", detail: "engine_not_v3", month: "2026-11" });
    expect(recordVerdictLine(verdict as Exclude<typeof verdict, { ok: true }>)).toBe("El solver cambió de versión. Recarga la página; no se creó nada.");
  });

  it.each([
    ["a 400", { kind: "http" as const, status: 400, body: { error: "invalid_request", details: { issues: [] } } }],
    ["a 500", { kind: "http" as const, status: 500, body: null }],
    ["an unparseable 409", { kind: "http" as const, status: 409, body: null }],
    ["a network error", { kind: "threw" as const }],
  ])("%s is «other failure» with «Reintentar»", (_name, answer) => {
    const verdict = classifyRecordPut(entries, answer);
    expect(verdict).toEqual({ ok: false, kind: "other" });
    expect(recordRetryOffered(verdict)).toBe(true);
    expect(recordVerdictLine({ ok: false, kind: "other" })).toBe("No se pudo registrar la elegibilidad. No se creó nada; pulsa «Reintentar».");
  });
});

describe("drafts and the per-month report (CF-5, CF-6, CF-8)", () => {
  it("groups drafts by horizon month, oldest first", () => {
    const drafts = [{ date: "2026-12-06", id: "d" }, { date: "2026-11-08", id: "b" }, { date: "2026-11-01", id: "a" }];
    expect(draftsByMonth(drafts, ["2026-11", "2026-12"])).toEqual([
      { month: "2026-11", drafts: [{ date: "2026-11-01", id: "a" }, { date: "2026-11-08", id: "b" }] },
      { month: "2026-12", drafts: [{ date: "2026-12-06", id: "d" }] },
    ]);
  });

  it("one line per month: complete, partial (with a 409's note), not attempted", () => {
    expect(monthReportLines([
      { month: "2026-11", total: 4, created: 3, failed: 1, attempted: true, conflict: true },
      { month: "2026-12", total: 5, created: 0, failed: 0, attempted: false, conflict: false },
    ])).toEqual([
      "Noviembre: 3 de 4 creados; 1 fallaron. Alguien más cambió esas fechas: recarga y revisa.",
      "Diciembre: no se intentó porque noviembre quedó incompleto.",
    ]);
    expect(monthReportLines([{ month: "2026-11", total: 4, created: 4, failed: 0, attempted: true, conflict: false }])).toEqual(["Noviembre: 4 de 4 creados."]);
  });

  it("the 2-month summary (CF-8)", () => {
    expect(twoMonthSummaryLine([{ month: "2026-11", drafts: [1, 2] }, { month: "2026-12", drafts: [1] }])).toBe(
      "Noviembre: 2 · Diciembre: 1. Se crean como borradores; publícalos después.",
    );
  });
});

describe("KH-1 on the confirm path — no line the confirm renders carries a rule key", () => {
  it("entries and answers that carry name-shaped keys still render lines with none of them", () => {
    const keyed: MonthSource = {
      ...src("2026-11", "recorded_unbound", "r1"),
      body: { ...body("2026-11"), presence: [{ ruleKey: "d-carla-dani", roles: ["Sun.BGV"], members: ["m-ana"], exclusive: false }] },
    };
    const entries = freezeConfirmEntries([keyed, src("2026-12", "unrecorded", null)], "auto");
    const leak = `${NAME_SHAPED_KEYS.join(" ")} P:d-carla-dani`;
    const lines: string[] = [];
    for (const detail of FAIRNESS_PUT_REFUSALS) {
      const v = classifyRecordPut(entries, { kind: "http", status: 409, body: { error: "stale_revision", message: leak, conflict: true, details: { detail, months: [{ month: "2026-11", verdict: detail, ruleKey: "d-carla-dani" }] } } });
      if (!v.ok) lines.push(recordVerdictLine(v));
    }
    const invalid = classifyRecordPut(entries, { kind: "http", status: 400, body: { error: "invalid_request", message: leak, details: { issues: [{ path: "presence[0].ruleKey", message: leak }] } } });
    if (!invalid.ok) lines.push(recordVerdictLine(invalid));
    lines.push(guardLine(confirmGuard(["2026-10", "2026-11"], "2026-11")!, false), guardLine(confirmGuard(["2026-10", "2026-11"], "2026-11")!, true));
    lines.push(guardLine(confirmGuard(["2027-11"], "2026-10")!, false));
    lines.push(...monthReportLines([
      { month: "2026-11", total: 2, created: 1, failed: 1, attempted: true, conflict: true },
      { month: "2026-12", total: 1, created: 0, failed: 0, attempted: false, conflict: false },
    ]));
    lines.push(twoMonthSummaryLine(draftsByMonth([{ date: "2026-11-08" }, { date: "2026-12-06" }], ["2026-11", "2026-12"])));
    lines.push(V3_LINES.incompleteBody([{ month: "2026-11", missing: 1 }]), V3_LINES.retry(2));
    expect(lines.length).toBe(FAIRNESS_PUT_REFUSALS.length + 9);
    for (const line of lines) for (const key of NAME_SHAPED_KEYS) expect(line).not.toContain(key);
  });
});
