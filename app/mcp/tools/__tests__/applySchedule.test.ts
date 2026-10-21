// `apply_schedule` (P4 on solver v3, step 6) over a simulated world: a proposal stored by the
// REAL `solve_month` (real `planV3Month`), roles that a snapshot read returns as they are, a
// `createRole` that honours creation receipts (`monthToolFixtures.ts`). What it pins:
//   - the gate (engine, D10's one refusal for every unknown/foreign/expired proposal);
//   - D7/D11: any lost target, foreign special, changed stored set or changed rules refuses the
//     WHOLE call before any write;
//   - R-OBS: a draft whose create landed is recognised by its receipt and never re-posted, also
//     when its answer was lost or the `state` save failed; a draft created then deleted in
//     /admin is never re-created;
//   - D5: no create starts after 40 s; the answer says so without claiming «nada»;
//   - concurrency: two applies at once never create a service twice;
//   - R-CALL copy hygiene and key hygiene on every answer.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The tools import the store and the reads, which build Sanity clients at import (never called here).
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { V3_CONNECTOR_LINES as L } from "@/app/components/admin/v3Copy";
import { snapshot } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import { FAIRNESS_PUT_REFUSALS } from "@/app/utils/fairnessVocabulary";
import { APPLY_SCHEDULE_COPY, APPLY_SCHEDULE_INPUT, applyScheduleResult } from "../applySchedule";
import { solveMonthResult, type SolveMonthArgs } from "../solveMonth";
import { draftLabel } from "../../monthProposals/labels";
import type { StoredProposal } from "../../monthProposals/proposalDocument";
import type { McpPrincipal } from "../../monthProposals/principal";
import { BASE_MS, HANDLE, PRINCIPAL, applyWorld, solveDeps, storedFrom, textOf, type ApplyWorldOptions } from "./monthToolFixtures";

const ARGS = { proposal: HANDLE };
const SPECIAL = { date: "2026-11-18", name: "Noche de alabanza" };

async function solved(args: SolveMonthArgs = { month: "2026-11" }): Promise<StoredProposal> {
  const d = solveDeps();
  const out = await solveMonthResult(args, PRINCIPAL, d);
  if (!d.stored[0]) throw new Error(`solve stored nothing: ${textOf(out)}`);
  return storedFrom(d.stored[0]);
}

async function setup(opts: ApplyWorldOptions = {}, args?: SolveMonthArgs) {
  const proposal = await solved(args);
  return { proposal, w: applyWorld(proposal, opts) };
}

const creatableCount = (p: StoredProposal) => p.payload.drafts.filter((d) => d.atSolve === "creatable").length;

/** Every answer this suite produced, for the copy-hygiene sweep at the end. */
const answers: CallToolResult[] = [];
async function apply(w: ReturnType<typeof applyWorld>, principal: McpPrincipal | null = PRINCIPAL, args = ARGS) {
  const out = await applyScheduleResult(args, principal, w.deps);
  answers.push(out);
  return out;
}

describe("phase 0 — the gate", () => {
  it("engine v2 refuses before the proposal is read", async () => {
    const { w } = await setup();
    w.deps.engine = () => "v2";
    const out = await apply(w);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(L.engineNotV3);
    expect(w.deps.loadProposal).not.toHaveBeenCalled();
  });

  it("no principal refuses before the proposal is read", async () => {
    const { w } = await setup();
    const out = await apply(w, null);
    expect(textOf(out)).toContain(L.noPrincipal);
    expect(w.deps.loadProposal).not.toHaveBeenCalled();
  });

  it("D10: unknown, malformed, foreign-principal, foreign-origin and expired proposals get ONE refusal", async () => {
    const { proposal, w } = await setup();
    const texts: string[] = [];
    texts.push(textOf(await apply(w, PRINCIPAL, { proposal: "nope" })));
    texts.push(textOf(await apply(w, PRINCIPAL, { proposal: "zzzzzzzzzzzzzzzzzzzzzzzzzz" })));
    texts.push(textOf(await apply(w, { ...PRINCIPAL, sub: "m-other" })));
    texts.push(textOf(await apply(w, { ...PRINCIPAL, origin: "https://elsewhere.example" })));
    w.clock.t = Date.parse(proposal.header.expiresAt) + 1;
    texts.push(textOf(await apply(w)));
    expect(new Set(texts)).toEqual(new Set([L.proposalNotFound]));
    expect(w.deps.reads).not.toHaveBeenCalled();
    expect(w.deps.commitRecords).not.toHaveBeenCalled();
  });

  it("a failed proposal read offers a retry and writes nothing", async () => {
    const { w } = await setup();
    w.deps.loadProposal.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: null });
    const out = await apply(w);
    expect(out.structuredContent).toMatchObject({ code: "read_failed", retry: true });
    expect(w.deps.reads).not.toHaveBeenCalled();
  });

  it("the input schema is strict", () => {
    expect(APPLY_SCHEDULE_INPUT.safeParse({ proposal: HANDLE, extra: 1 }).success).toBe(false);
    expect(APPLY_SCHEDULE_INPUT.safeParse({ proposal: "x".repeat(65) }).success).toBe(false);
  });
});

describe("the happy path and its replay", () => {
  it("records first, then every draft; a second call writes nothing", async () => {
    const { proposal, w } = await setup({}, { month: "2026-11", specials: [SPECIAL] });
    const out = await apply(w);
    expect(out.isError).toBeFalsy();
    const text = textOf(out);
    expect(text.split("\n")[0]).toBe(L.complete);
    expect(text).toContain(L.recordsSaved(["2026-11"]));
    expect(w.deps.commitRecords).toHaveBeenCalledTimes(1);
    expect(w.deps.commitRecords.mock.calls[0][1]).toEqual({ recordedBy: PRINCIPAL.sub });
    expect(w.deps.createRole).toHaveBeenCalledTimes(creatableCount(proposal));
    expect(w.deps.createRole.mock.calls.every(([body]) => body.published === false)).toBe(true);
    expect(w.roles).toHaveLength(creatableCount(proposal));
    expect(out.structuredContent).toMatchObject({ ok: true, complete: true, recordsSaved: true });
    // The records were written before the first draft.
    expect(w.deps.commitRecords.mock.invocationCallOrder[0]).toBeLessThan(w.deps.createRole.mock.invocationCallOrder[0]);
    expect(w.deps.writeState).toHaveBeenCalledTimes(1);
    expect(w.proposal!.state.recordsDone).toBe(true);
    expect(Object.keys(w.proposal!.state.created)).toHaveLength(creatableCount(proposal));

    const again = await apply(w);
    expect(textOf(again).split("\n")[0]).toBe(L.complete);
    expect(textOf(again)).toContain(L.noWriteThisCall);
    expect(w.deps.commitRecords).toHaveBeenCalledTimes(1);
    expect(w.deps.createRole).toHaveBeenCalledTimes(creatableCount(proposal));
    expect(w.deps.writeState).toHaveBeenCalledTimes(1);
  });
});

describe("R-OBS — what landed is recognised by its receipt", () => {
  it("a create whose answer was lost is «sin confirmar», then «ya estaba creado» — never posted twice", async () => {
    const { proposal, w } = await setup({ afterInsert: (n) => { if (n === 1) throw new Error("socket"); } });
    const first = await apply(w);
    expect(first.isError).toBeFalsy();
    const firstDraft = proposal.payload.drafts.filter((d) => d.atSolve === "creatable").map((d) => d.draft).sort((a, b) => a.date.localeCompare(b.date))[0];
    expect(textOf(first)).toContain(L.serviceUnknown(draftLabel(firstDraft)));
    expect(first.structuredContent).toMatchObject({ complete: false, next: "apply_schedule", retry: true });

    const before = w.deps.createRole.mock.calls.length;
    const second = await apply(w);
    expect(textOf(second)).toContain(L.serviceAlready(draftLabel(firstDraft)));
    expect(second.structuredContent).toMatchObject({ complete: true });
    // Nothing posted again: every draft was already inserted by the first call.
    expect(w.deps.createRole.mock.calls.length).toBe(before);
    expect(w.roles).toHaveLength(creatableCount(proposal));
  });

  it("a failed `state` save is said, and the next call still knows by receipt", async () => {
    const { proposal, w } = await setup();
    w.deps.writeState.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: null });
    const out = await apply(w);
    expect(textOf(out)).toContain(L.stateSaveFailed);
    expect(out.structuredContent).toMatchObject({ complete: true, stateSaved: false });
    const again = await apply(w);
    expect(again.structuredContent).toMatchObject({ complete: true });
    expect(w.roles).toHaveLength(creatableCount(proposal));
  });

  it("a draft created then deleted in /admin is reported, never re-created", async () => {
    const { proposal, w } = await setup();
    await apply(w);
    const gone = w.roles.shift()!;
    const out = await apply(w);
    expect(out.isError).toBeFalsy();
    const draft = proposal.payload.drafts.find((d) => w.proposal!.state.created[d.draft.localId] === gone._id)!.draft;
    expect(textOf(out)).toContain(L.serviceDeleted(draftLabel(draft)));
    expect(out.structuredContent).toMatchObject({ complete: false, next: "solve_month" });
    expect(w.deps.createRole).toHaveBeenCalledTimes(creatableCount(proposal));
  });
});

describe("D5 — the create cut-off", () => {
  it("no create starts after 40 s; the rest is pending and the next call finishes", async () => {
    const { proposal, w } = await setup({ createMs: 15_000 });
    const out = await apply(w);
    expect(out.isError).toBeFalsy();
    // Creates start at 0, 15 and 30 s; the fourth would start at 45 s.
    expect(w.deps.createRole).toHaveBeenCalledTimes(3);
    const text = textOf(out);
    expect(text).toContain(": pendiente; vuelve a llamar apply_schedule.");
    expect(text).not.toContain(L.cutoffNothing);
    expect(out.structuredContent).toMatchObject({ complete: false, next: "apply_schedule" });
    // 45 s had passed: no sweep in this call.
    expect(w.deps.sweepExpired).not.toHaveBeenCalled();

    let total = 3;
    while (total < creatableCount(proposal)) {
      const before = w.deps.createRole.mock.calls.length;
      const next = await apply(w);
      total += w.deps.createRole.mock.calls.length - before;
      if ((next.structuredContent as { complete?: boolean }).complete) break;
    }
    expect(w.roles).toHaveLength(creatableCount(proposal));
    expect(w.deps.commitRecords.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("a call that reaches the cut-off before its first create says so, without «nada»", async () => {
    const { w } = await setup();
    let calls = 0;
    w.deps.nowMs = () => BASE_MS + (calls++ < 1 ? 0 : 41_000);
    const out = await apply(w);
    expect(w.deps.createRole).not.toHaveBeenCalled();
    expect(textOf(out)).toContain(L.cutoffNothing);
    expect(out.structuredContent).toMatchObject({ complete: false, next: "apply_schedule", retry: true });
  });

  it("a first create whose answer is lost, then the cut-off: «sin confirmar», never «antes de crear»", async () => {
    // The create lands (the role is inserted) but its answer is lost, and it ends past 40 s.
    const { w } = await setup({ createMs: 41_000, afterInsert: (n) => { if (n === 1) throw new Error("socket"); } });
    const out = await apply(w);
    expect(w.deps.createRole).toHaveBeenCalledTimes(1);
    expect(w.roles).toHaveLength(1);
    const text = textOf(out);
    expect(text).toContain("sin confirmar");
    expect(text).not.toContain(L.cutoffNothing);
    expect(text).not.toMatch(/No se creó nada|ningún servicio|falló/);
    expect(out.structuredContent).toMatchObject({ complete: false, next: "apply_schedule", retry: true });
  });
});

describe("phase 4 — the records", () => {
  it("a PUT whose answer is lost is «sin confirmar», with a retry and no draft posted", async () => {
    const { w } = await setup();
    w.deps.commitRecords.mockRejectedValueOnce(new Error("socket"));
    const out = await apply(w);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(L.recordUnknown);
    expect(out.structuredContent).toMatchObject({ code: "record_unknown", retry: true, next: "apply_schedule" });
    expect(w.deps.createRole).not.toHaveBeenCalled();
  });

  it("a refused PUT (record_exists) answers the connector's twin line", async () => {
    const { w } = await setup();
    w.deps.commitRecords.mockResolvedValueOnce({
      ok: false, status: 409,
      body: { error: "stale_revision", details: { detail: "record_exists", months: [{ month: "2026-11", verdict: "record_exists" }] } },
    });
    const out = await apply(w);
    expect(textOf(out)).toContain(L.recordRefusal.record_exists("2026-11"));
    expect(out.structuredContent).toMatchObject({ code: "record_refused", detail: "record_exists", next: "solve_month" });
    expect(w.deps.createRole).not.toHaveBeenCalled();
  });

  it("CF-1: a month that has passed since the solve refuses before any write", async () => {
    const { w } = await setup({ todayIso: "2026-12-02" });
    const out = await apply(w);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(L.guardPast("2026-11"));
    expect(w.deps.commitRecords).not.toHaveBeenCalled();
    expect(w.deps.createRole).not.toHaveBeenCalled();
  });
});

describe("D7/D11 — the whole call refuses before any write", () => {
  const noWrites = (w: ReturnType<typeof applyWorld>) => {
    expect(w.deps.commitRecords).not.toHaveBeenCalled();
    expect(w.deps.createRole).not.toHaveBeenCalled();
    expect(w.deps.writeState).not.toHaveBeenCalled();
  };

  it("changed rules refuse (D11)", async () => {
    const { w } = await setup({ rulesRev: "rules-rev-2" });
    const out = await apply(w);
    expect(textOf(out)).toBe(L.rulesChanged);
    expect(out.structuredContent).toMatchObject({ code: "stale_revision", detail: "rules_changed", next: "solve_month" });
    noWrites(w);
  });

  it("a special stored on a pending special's date refuses", async () => {
    const { proposal, w } = await setup(
      { roles: [{ _id: "role-x", _type: "special_role", date: SPECIAL.date, service_name: "Boda" }] },
      { month: "2026-11", specials: [SPECIAL] },
    );
    const out = await apply(w);
    expect(out.isError).toBe(true);
    const special = proposal.payload.drafts.find((d) => d.draft._type === "special_role")!.draft;
    const text = textOf(out);
    expect(text).toMatch(new RegExp(`^${draftLabel(special)}: `, "m"));
    expect(text).toContain(L.storedChanged(["2026-11"]));
    expect(text).toContain(L.resolveAgain);
    expect(out.structuredContent).toMatchObject({ code: "integrity_conflict", detail: "target_lost", next: "solve_month" });
    noWrites(w);
  });

  it("a stored service deleted since the solve refuses", async () => {
    // The frozen set as a solve over one stored service would have frozen it (the planner's
    // own stored-service inputs are pinned by `v3MonthPlan.test.ts`).
    const solvedOnce = await solved();
    const proposal = { ...solvedOnce, payload: { ...solvedOnce.payload, storedServiceIds: ["role-old"] } };
    const w = applyWorld(proposal);
    const out = await apply(w);
    expect(textOf(out)).toContain(L.storedChanged(["2026-11"]));
    noWrites(w);
  });

  it("an unready source refuses with a retry", async () => {
    const proposal = await solved();
    const w = applyWorld(proposal, { sourcesOver: { snapshot: snapshot({ sources: { roles: "unknown" } }) } });
    const out = await apply(w);
    expect(out.structuredContent).toMatchObject({ code: "integrity_conflict", detail: "sources", retry: true });
    noWrites(w);
  });
});

describe("concurrency", () => {
  it("two applies at once never create a service twice", async () => {
    const { proposal, w } = await setup({}, { month: "2026-11", specials: [SPECIAL] });
    const [a, b] = await Promise.all([apply(w), apply(w)]);
    answers.push(a, b);
    expect(w.roles).toHaveLength(creatableCount(proposal));
    expect(new Set(w.roles.map((r) => r.creationReceiptId)).size).toBe(creatableCount(proposal));
    // The saved state is the union of both calls' facts.
    expect(Object.keys(w.proposal!.state.created).sort()).toEqual(
      proposal.payload.drafts.filter((d) => d.atSolve === "creatable").map((d) => d.draft.localId).sort());
    const third = await apply(w);
    expect(third.structuredContent).toMatchObject({ complete: true });
  });
});

describe("a throw before the confirm", () => {
  it("is the pre side: nothing was written by this call", async () => {
    const { w } = await setup();
    w.deps.todayIso = () => { throw new Error("clock"); };
    const out = await apply(w);
    expect(out.isError).toBe(true);
    // `todayIso` is read before `callDomain`: the pre side.
    expect(textOf(out)).toBe(APPLY_SCHEDULE_COPY.pre);
  });
});

describe("recovery across calls (step 7)", () => {
  const sorted = (p: StoredProposal) =>
    p.payload.drafts.filter((d) => d.atSolve === "creatable").map((d) => d.draft).sort((a, b) => a.date.localeCompare(b.date));
  const statelessFail = (w: ReturnType<typeof applyWorld>) =>
    w.deps.writeState.mockResolvedValueOnce({ ok: false, reason: "server_error", cause: null });

  it("killed between the PUT and the first create: the next call creates every draft once", async () => {
    const { proposal, w } = await setup({ failFrom: 1 });
    statelessFail(w);
    await apply(w);                                    // its answer never arrives (killed)
    expect(w.roles).toHaveLength(0);
    const healthy = applyWorld(proposal);
    healthy.roles = w.roles;
    const out = await apply(healthy);
    expect(out.structuredContent).toMatchObject({ complete: true });
    expect(healthy.roles).toHaveLength(creatableCount(proposal));
  });

  it("killed mid-month with no state saved: the next call recognises the landed ones by receipt", async () => {
    const { proposal, w } = await setup({ failFrom: 4 });
    statelessFail(w);
    await apply(w);
    expect(w.roles).toHaveLength(3);
    const healthy = applyWorld(proposal);
    healthy.roles = w.roles;
    const out = await apply(healthy);
    const first = sorted(proposal)[0];
    expect(textOf(out)).toContain(L.serviceAlready(draftLabel(first)));
    expect(healthy.deps.createRole).toHaveBeenCalledTimes(creatableCount(proposal) - 3);
    expect(healthy.roles).toHaveLength(creatableCount(proposal));
  });

  it.each(FAIRNESS_PUT_REFUSALS)("CF-4 «%s»: the connector's line, zero creates", async (detail) => {
    const { w } = await setup();
    w.deps.commitRecords.mockResolvedValueOnce({
      ok: false, status: 409, body: { error: "stale_revision", details: { detail, months: [{ month: "2026-11", verdict: detail }] } },
    });
    const out = await apply(w);
    expect(textOf(out)).toContain(L.recordRefusal[detail]("2026-11"));
    expect(out.structuredContent).toMatchObject({ code: "record_refused", detail });
    expect(w.deps.createRole).not.toHaveBeenCalled();
  });

  it("call 1 lands the records and some drafts; a foreign writer replaces the record; call 2 names what exists", async () => {
    const { proposal, w } = await setup({ createMs: 15_000 });
    await apply(w);                                    // three created, the rest deferred
    w.clock.t = BASE_MS + 120_000;
    w.deps.commitRecords.mockResolvedValueOnce({
      ok: false, status: 409, body: { error: "stale_revision", details: { detail: "record_exists", months: [{ month: "2026-11", verdict: "record_exists" }] } },
    });
    const out = await apply(w);
    const created = sorted(proposal).slice(0, 3).map(draftLabel);
    expect(textOf(out)).toContain(L.exists(created));
    expect(textOf(out)).not.toMatch(/No se creó nada/);
  });

  it.each([
    ["the PUT fails «other»", (w: ReturnType<typeof applyWorld>) => w.deps.commitRecords.mockResolvedValueOnce({ ok: false, status: 500, body: {} }), L.recordUnknown],
    ["record_exists", (w: ReturnType<typeof applyWorld>) => w.deps.commitRecords.mockResolvedValueOnce({
      ok: false, status: 409, body: { error: "stale_revision", details: { detail: "record_exists", months: [{ month: "2026-11", verdict: "record_exists" }] } },
    }), L.recordRefusal.record_exists("2026-11")],
    ["the guard refuses a past month", (w: ReturnType<typeof applyWorld>) => { w.deps.todayIso = () => "2026-12-01"; }, L.guardPast("2026-11")],
  ])("call 1's state lost, then %s: the answer lists the receipt-proven drafts", async (_name, arrange, line) => {
    const { proposal, w } = await setup({ failFrom: 4 });
    statelessFail(w);
    await apply(w);
    expect(Object.keys(w.proposal!.state.created)).toHaveLength(0);
    const next = applyWorld(proposal);
    next.roles = w.roles;
    arrange(next);
    const out = await apply(next);
    const text = textOf(out);
    expect(text).toContain(line);
    expect(text).toContain(L.exists(sorted(proposal).slice(0, 3).map(draftLabel)));
    expect(text).not.toMatch(/No se creó nada|ningún servicio/);
    expect(next.deps.createRole).not.toHaveBeenCalled();
  });

  it("A4: a pending candidate turned blocked refuses the whole call", async () => {
    const { proposal, w } = await setup({
      readinessOver: {
        roleSummary: {
          targets: [], recordIssues: [],
          lockIssues: [{ kind: "orphan_lock", lockId: "roleTarget.sunday_role.2026-11-15", targetKey: "sunday_role:2026-11-15", roleId: "role-ghost" }],
        },
      },
    });
    const out = await apply(w);
    const sunday15 = sorted(proposal).find((d) => d.date === "2026-11-15")!;
    expect(textOf(out)).toMatch(new RegExp(`^${draftLabel(sunday15)} ya no se puede crear`, "m"));
    expect(w.deps.commitRecords).not.toHaveBeenCalled();
    expect(w.deps.createRole).not.toHaveBeenCalled();
  });

  it.each([
    ["no receipt", undefined],
    ["another receipt", "roleCreate.someone-else"],
  ])("A4: a foreign weekend occupant (%s) on a never-posted date refuses, zero writes", async (_name, receipt) => {
    const { w } = await setup({
      roles: [{ _id: "role-foreign", _type: "sunday_role", week: "2026-11-15", ...(receipt ? { creationReceiptId: receipt } : {}) }],
    });
    const out = await apply(w);
    expect(textOf(out)).toContain(L.storedChanged(["2026-11"]));
    expect(w.deps.commitRecords).not.toHaveBeenCalled();
    expect(w.deps.createRole).not.toHaveBeenCalled();
  });

  it("a stored service added on an unplanned date refuses, zero writes", async () => {
    const { w } = await setup({ roles: [{ _id: "role-new", _type: "special_role", date: "2026-11-11", service_name: "Retiro" }] });
    const out = await apply(w);
    expect(textOf(out)).toContain(L.storedChanged(["2026-11"]));
    expect(w.deps.commitRecords).not.toHaveBeenCalled();
  });

  it("A4: the draft's own landed creates (weekend and special), absent from state, pass every check", async () => {
    const { proposal, w } = await setup({ failFrom: 99 }, { month: "2026-11", specials: [SPECIAL] });
    // Land the special and the first Sunday through the world's own create, with no state saved.
    const special = proposal.payload.drafts.find((d) => d.draft._type === "special_role")!.draft;
    const sunday = sorted(proposal).find((d) => d._type === "sunday_role")!;
    for (const d of [special, sunday]) await w.deps.createRole({ creationRequestId: d.creationRequestId, _type: d._type, date: d.date, service_name: d.service_name });
    w.deps.createRole.mockClear();
    const out = await apply(w);
    expect(out.isError).toBeFalsy();
    expect(textOf(out)).toContain(L.serviceAlready(draftLabel(special)));
    expect(textOf(out)).toContain(L.serviceAlready(draftLabel(sunday)));
    expect(w.deps.createRole).toHaveBeenCalledTimes(creatableCount(proposal) - 2);
    expect(out.structuredContent).toMatchObject({ complete: true });
  });
});

describe("R-CALL and key hygiene, over every answer above", () => {
  it("no forbidden claim, no id", () => {
    expect(answers.length).toBeGreaterThan(20);
    for (const out of answers) {
      const all = `${textOf(out)}\n${JSON.stringify(out.structuredContent ?? {})}`;
      expect(all).not.toMatch(/No se creó nada|ningún servicio|otro administrador|falló/i);
      expect(all).not.toMatch(/\bm-(ana|bruno|carla|dani|admin|other)\b/);
      expect(all).not.toMatch(/\brole-(\d+|x|old)\b/);
      expect(all).not.toContain("rules-rev");
    }
  });
});
