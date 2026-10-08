// Solver v3 C6 §5.11 (CRITICAL) — one confirm attempt with injected transports: the guard on EVERY
// attempt (A40), the ONE atomic PUT before any draft (CF-4), drafts oldest first and month by month
// (CF-5), a per-month report with nothing deleted (CF-6), «Reintentar» resending only what is missing
// with byte-identical bodies (CF-7), and the client-mutation invariant (CF-11).
import { describe, expect, it, vi } from "vitest";

import { INITIAL_V3_CONFIRM_STATE, pendingCount, runV3ConfirmAttempt, type V3ConfirmState } from "../v3ConfirmRun";
import { freezeConfirmEntries } from "../v3Confirm";
import type { MonthSource } from "../v3MonthSources";
import type { CreatableDraft, DraftPostOutcome } from "@/app/utils/monthDraftCreate";
import type { FairnessMonthsPut } from "@/app/utils/fairnessVocabulary";
import { ALL_IN } from "./v3Fixtures";

const src = (month: string, state: MonthSource["state"], rev: string | null): MonthSource => ({
  month, state, rev, recordedAt: null,
  body: { month, people: [{ memberId: "m-ana", roles: { ...ALL_IN }, exactRules: [], exempt: false, blocks: [] }], presence: [] },
});
const ENTRIES = freezeConfirmEntries([src("2026-11", "recorded_unbound", "r-nov"), src("2026-12", "unrecorded", null)], "auto");
const draft = (localId: string, date: string): CreatableDraft => ({
  localId, creationRequestId: `req-${localId}`, _type: "sunday_role", date, countsForFairness: true,
  leads: ["m-ana"], bgvs: [], chorus: [], instruments: [], foh: [],
});
const DRAFTS = [draft("n2", "2026-11-08"), draft("d1", "2026-12-06"), draft("n1", "2026-11-01")];
const okPut = (outcomes = ["replaced", "created"]) => vi.fn(async (_body: FairnessMonthsPut) => ({
  status: 200, body: { months: ["2026-11", "2026-12"].map((month, i) => ({ month, outcome: outcomes[i], rev: "x", contentHash: "sha256:x", recordedAt: "t" })) },
}));

function attempt(over: Partial<Parameters<typeof runV3ConfirmAttempt>[0]> = {}) {
  const log: string[] = [];
  const putRecords = over.putRecords ?? okPut();
  const postDraft = over.postDraft ?? vi.fn(async (_body: { creationRequestId: string }): Promise<DraftPostOutcome> => ({ ok: true, status: 201 }));
  const tracedPut = vi.fn(async (body: FairnessMonthsPut) => { log.push("PUT"); return putRecords(body); });
  const tracedPost = vi.fn(async (body: { creationRequestId: string; date: string }) => { log.push(`POST ${body.date}`); return postDraft(body as never); });
  const run = runV3ConfirmAttempt({
    entries: ENTRIES, months: ["2026-11", "2026-12"], drafts: DRAFTS, published: false,
    state: INITIAL_V3_CONFIRM_STATE, currentMonth: "2026-10",
    ...over, putRecords: tracedPut, postDraft: tracedPost as never,
  });
  return { run, log, tracedPut, tracedPost };
}

describe("order (CF-4, CF-5)", () => {
  it("exactly one PUT carrying every month's frozen entry, then POSTs oldest first, month by month", async () => {
    const { run, log, tracedPut } = attempt();
    const out = await run;
    expect(log).toEqual(["PUT", "POST 2026-11-01", "POST 2026-11-08", "POST 2026-12-06"]);
    expect(tracedPut.mock.calls[0][0]).toEqual({ months: ENTRIES.map((e) => e.write) });
    expect(out).toMatchObject({ kind: "drafts", complete: true, lines: [], retry: false });
  });

  it("a recordless month that gets no draft from this confirm still gets its create entry (A27)", async () => {
    const { run, tracedPut } = attempt({ drafts: [draft("n1", "2026-11-01")] });
    await run;
    expect(tracedPut.mock.calls[0][0].months.map((m) => [m.month, m.expectedRev])).toEqual([["2026-11", "r-nov"], ["2026-12", null]]);
  });
});

describe("the record step (CF-4): any refusal or unexpected outcome creates no draft", () => {
  it.each([
    ["a refusal", vi.fn(async () => ({ status: 409, body: { error: "integrity_conflict", conflict: true, details: { detail: "month_has_services", months: [{ month: "2026-11", verdict: "month_has_services" }] } } })), false],
    ["an unexpected outcome", okPut(["created", "created"]), true],
    ["a network error", vi.fn(async () => { throw new TypeError("fetch failed"); }), true],
    ["a 500", vi.fn(async () => ({ status: 500, body: null })), true],
  ])("%s → zero POSTs, the record line, retry %s", async (_name, putRecords, retry) => {
    const { run, tracedPost } = attempt({ putRecords: putRecords as never });
    const out = await run;
    expect(tracedPost).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "record_failed", retry, state: { recordsDone: false } });
  });
});

describe("drafts (CF-5, CF-6)", () => {
  it("a failure in month 1 ⇒ zero POSTs for month 2, and one line per month", async () => {
    const postDraft = vi.fn(async (body: { creationRequestId: string }): Promise<DraftPostOutcome> =>
      body.creationRequestId === "req-n2" ? { ok: false, status: 500 } : { ok: true, status: 201 });
    const { run, log } = attempt({ postDraft: postDraft as never });
    const out = await run;
    expect(log).toEqual(["PUT", "POST 2026-11-01", "POST 2026-11-08"]);
    expect(out).toMatchObject({
      kind: "drafts", complete: false, retry: true,
      lines: ["Noviembre: 1 de 2 creados; 1 fallaron.", "Diciembre: no se intentó porque noviembre quedó incompleto."],
    });
  });

  it("a draft 409 adds today's note to its month's line; a thrown POST is a failure, never a creation (CF-11)", async () => {
    const postDraft = vi.fn(async (body: { creationRequestId: string }): Promise<DraftPostOutcome> => {
      if (body.creationRequestId === "req-n1") return { ok: false, status: 409, error: "stale_revision" };
      if (body.creationRequestId === "req-n2") throw new TypeError("network");
      return { ok: true, status: 201 };
    });
    const { run } = attempt({ postDraft: postDraft as never });
    const out = await run;
    if (out.kind !== "drafts") throw new Error(out.kind);
    expect(out.lines[0]).toBe("Noviembre: 0 de 2 creados; 2 fallaron. Alguien más cambió esas fechas: recarga y revisa.");
    expect([...out.state.createdLocalIds]).toEqual([]);
  });
});

describe("«Reintentar» resends only what is missing (CF-7)", () => {
  it("after a month-1 failure: no PUT again, only the missing draft with its same id, then month 2", async () => {
    const failOnce = vi.fn()
      .mockImplementationOnce(async () => ({ ok: true, status: 201 }))
      .mockImplementationOnce(async () => ({ ok: false, status: 500 }));
    const first = attempt({ postDraft: failOnce as never });
    const one = await first.run;
    if (one.kind !== "drafts") throw new Error(one.kind);
    expect(pendingCount(DRAFTS, one.state)).toBe(2);
    const second = attempt({ state: one.state });
    await second.run;
    expect(second.log).toEqual(["POST 2026-11-08", "POST 2026-12-06"]);
    expect(second.tracedPost.mock.calls[0][0]).toMatchObject({ creationRequestId: "req-n2" });
  });

  it("a month-2-only failure: the retry posts only month 2's missing draft", async () => {
    const post = vi.fn(async (body: { creationRequestId: string }): Promise<DraftPostOutcome> =>
      body.creationRequestId === "req-d1" ? { ok: false, status: 503 } : { ok: true, status: 201 });
    const one = await attempt({ postDraft: post as never }).run;
    if (one.kind !== "drafts") throw new Error(one.kind);
    const second = attempt({ state: one.state });
    await second.run;
    expect(second.log).toEqual(["POST 2026-12-06"]);
  });

  it.each([
    ["recorded-unbound (the pre-replace rev)", "recorded_unbound" as const, "r-nov"],
    ["unrecorded (expectedRev null)", "unrecorded" as const, null],
    ["bound", "bound" as const, "r-nov"],
  ])("a lost-response replay of a %s entry is byte-identical and answers `unchanged`", async (_name, state, rev) => {
    const entries = freezeConfirmEntries([src("2026-11", state, rev)], "auto");
    const bodies: string[] = [];
    const lost = vi.fn(async (body: FairnessMonthsPut) => { bodies.push(JSON.stringify(body)); throw new TypeError("lost response"); });
    const replay = vi.fn(async (body: FairnessMonthsPut) => {
      bodies.push(JSON.stringify(body));
      return { status: 200, body: { months: [{ month: "2026-11", outcome: "unchanged", rev: "x", contentHash: "sha256:x", recordedAt: "t" }] } };
    });
    const one = await attempt({ entries, months: ["2026-11"], drafts: [draft("n1", "2026-11-01")], putRecords: lost }).run;
    expect(one).toMatchObject({ kind: "record_failed", retry: true });
    const two = await attempt({ entries, months: ["2026-11"], drafts: [draft("n1", "2026-11-01")], putRecords: replay, state: one.state }).run;
    expect(two).toMatchObject({ kind: "drafts", complete: true });
    expect(bodies[0]).toBe(bodies[1]);
  });
});

describe("the guard runs on EVERY attempt (CF-1, A40, HZ-9)", () => {
  it("a first attempt across the month boundary writes nothing and offers no «Reintentar»", async () => {
    const { run, tracedPut, tracedPost } = attempt({ currentMonth: "2026-12" });
    const out = await run;
    expect(out).toEqual({ kind: "refused_guard", lines: ["Noviembre ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto."], state: INITIAL_V3_CONFIRM_STATE, retry: false });
    expect(tracedPut).not.toHaveBeenCalled();
    expect(tracedPost).not.toHaveBeenCalled();
  });

  it("a «Reintentar» after the boundary (records landed, month 1 partly drafted) refuses too, with the «nada más» line", async () => {
    const landed: V3ConfirmState = { recordsDone: true, createdLocalIds: new Set(["n1"]) };
    const { run, tracedPut, tracedPost } = attempt({ state: landed, currentMonth: "2026-12" });
    const out = await run;
    expect(tracedPut).not.toHaveBeenCalled();
    expect(tracedPost).not.toHaveBeenCalled();
    expect(out.kind).toBe("refused_guard");
    expect(out.lines[0]).toBe("Noviembre ya pasó mientras planeabas, así que no se creó nada más. Lo ya creado se queda; completa lo que falta en «Editar mes».");
    expect(out.lines).toContain("Noviembre: 1 de 2 creados; 1 fallaron.");
    expect(out.lines).toContain("Diciembre: no se intentó porque noviembre quedó incompleto.");
    expect(out.retry).toBe(false);
  });

  it("a «Reintentar» after the boundary when the records landed but EVERY draft failed: the «ningún servicio» line plus CF-6's per-month lines", async () => {
    const recordsOnly: V3ConfirmState = { recordsDone: true, createdLocalIds: new Set() };
    const { run, tracedPut, tracedPost } = attempt({ state: recordsOnly, currentMonth: "2026-12" });
    const out = await run;
    expect(tracedPut).not.toHaveBeenCalled();
    expect(tracedPost).not.toHaveBeenCalled();
    expect(out).toEqual({
      kind: "refused_guard",
      lines: [
        "Noviembre ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto.",
        "Noviembre: 0 de 2 creados; 2 fallaron.",
        "Diciembre: no se intentó porque noviembre quedó incompleto.",
      ],
      state: recordsOnly,
      retry: false,
    });
  });

  it("a month past the ceiling refuses before writing (HZ-9), the entry set unchanged", async () => {
    const { run, tracedPut } = attempt({ months: ["2027-11"], currentMonth: "2026-10" });
    const out = await run;
    expect(out.lines).toEqual(["Auto no planea más de 12 meses adelante: Noviembre queda fuera. Elige un mes hasta octubre."]);
    expect(tracedPut).not.toHaveBeenCalled();
  });
});

describe("publishing passes through for a 1-month confirm (CF-8)", () => {
  it("posts with published: true when asked", async () => {
    const seen: boolean[] = [];
    const post = vi.fn(async (body: { published: boolean }): Promise<DraftPostOutcome> => { seen.push(body.published); return { ok: true, status: 201 }; });
    await attempt({ published: true, postDraft: post as never }).run;
    expect(seen.every(Boolean)).toBe(true);
  });
});
