// The proposal editor's three tools and their contract with `apply_schedule` (plan T2.5, T2.6, Q1,
// E2, E3), over one simulated world (`editorToolFixtures.ts`): a proposal stored by the REAL
// `solve_month` with Ana on Nov 1's Lead — a breach of the bound rules (`Ana !in Sun.Lead`), so the
// solve's own warning is in play — every revision in an in-memory store, and apply on the same data.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { V3_EDITOR_LINES as E } from "@/app/components/admin/v3Copy";
import { receiptIdForRequestId } from "@/app/utils/roleCreationReceipt";
import { applyScheduleResult } from "../applySchedule";
import {
  CHECK_PROPOSAL_EDITS_INPUT,
  REVISE_PROPOSAL_INPUT,
  SAVE_PROPOSAL_EDITS_INPUT,
  checkProposalEditsResult,
  reviseProposalResult,
  saveProposalEditsResult,
  type SaveProposalEditsArgs,
} from "../proposalEditor";
import { HANDLE, PRINCIPAL, textOf } from "./monthToolFixtures";
import { editorWorld, type EditorWorld } from "./editorToolFixtures";
import { MEMBERS } from "../../monthProposals/__tests__/editorFixtures";
import type { ProposalPayloadV2 } from "../../monthProposals/proposalDocument";

type Content = Record<string, unknown>;
const sc = (out: CallToolResult) => (out.structuredContent ?? {}) as Content;

/** Every answer this suite produced, for the hygiene sweep at the end. */
const answers: CallToolResult[] = [];
/** Every console line of the suite, for the same sweep. */
const consoleCalls: string[] = [];
beforeEach(() => {
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { consoleCalls.push(a.map(String).join(" ")); });
  }
});
afterEach(() => vi.restoreAllMocks());

const keep = (out: CallToolResult) => (answers.push(out), out);
const check = (w: EditorWorld, args: Partial<Parameters<typeof checkProposalEditsResult>[0]> = {}) =>
  checkProposalEditsResult({ proposal: HANDLE, edits: [], ...args }, PRINCIPAL, w.deps).then(keep);
const save = (w: EditorWorld, args: Partial<SaveProposalEditsArgs> = {}) =>
  saveProposalEditsResult({ proposal: HANDLE, edits: [], saveId: "save-0001", ...args }, PRINCIPAL, w.deps).then(keep);
const revise = (w: EditorWorld, proposal: string, edits: Parameters<typeof reviseProposalResult>[0]["edits"]) =>
  reviseProposalResult({ proposal, edits }, PRINCIPAL, w.deps).then(keep);
const apply = (w: EditorWorld, proposal: string, waivers?: unknown) =>
  applyScheduleResult({ proposal, ...(waivers ? { waivers } : {}) } as never, PRINCIPAL, w.applyDeps).then(keep);

/** Ana onto Nov 8's Lead: her `!in Sun.Lead` — the screen's «Asignar de todos modos». */
const forceAna = (w: EditorWorld) => ({ op: "place" as const, service: w.sid("2026-11-08"), row: "lead", member: w.tok("m-ana"), force: true });

/** The keys a check showed for `edits`: what the screen sends back as `confirms` (A5). */
async function confirmsFor(w: EditorWorld, edits: SaveProposalEditsArgs["edits"], proposal = HANDLE) {
  const checked = await checkProposalEditsResult({ proposal, edits }, PRINCIPAL, w.deps);
  const diff = (sc(checked).rules as { diff: Array<Record<string, unknown>> }).diff;
  return diff.map(({ kind, rule, service, row, members }) => ({ kind, rule, service, row, members })) as SaveProposalEditsArgs["confirms"];
}

/** Check, then save with exactly the keys the check showed: the screen's own sequence. */
async function forcedSave(w: EditorWorld, edits = [forceAna(w)], proposal = HANDLE, saveId = "save-0001", confirms?: SaveProposalEditsArgs["confirms"]) {
  return save(w, { proposal, edits, confirms: confirms ?? (await confirmsFor(w, edits, proposal)), saveId });
}

describe("schemas", () => {
  it("are strict; only the app-only save carries force and confirms; the chat's has neither", () => {
    expect(CHECK_PROPOSAL_EDITS_INPUT.safeParse({ proposal: HANDLE, edits: [], extra: 1 }).success).toBe(false);
    expect(SAVE_PROPOSAL_EDITS_INPUT.safeParse({ proposal: HANDLE, edits: [], saveId: "short" }).success).toBe(false);
    expect(REVISE_PROPOSAL_INPUT.safeParse({ proposal: HANDLE, edits: [{ op: "place", service: "2026-11-08", seat: "Lead", member: "Ana", force: true }] }).success).toBe(false);
    expect(REVISE_PROPOSAL_INPUT.safeParse({ proposal: HANDLE, edits: [] }).success).toBe(false);
  });
});

describe("check_proposal_edits", () => {
  it("no edits: the board with tokens and names, the solve's own breach as a solver warning, the month check", async () => {
    const w = await editorWorld();
    const out = await check(w);
    expect(out.isError).toBeFalsy();
    const c = sc(out);
    expect(c).toMatchObject({ ok: true, proposal: HANDLE, revision: 1 });
    const board = c.board as Array<{ service: string; seats: Array<{ row: string; members: Array<{ token: string; name: string }> }> }>;
    const nov1 = board.find((s) => s.service === w.sid("2026-11-01"))!;
    expect(nov1.seats.find((s) => s.row === "lead")!.members).toEqual([{ token: w.tok("m-ana"), name: "Ana", unavailable: false }]);
    expect(textOf(out)).toContain(E.solverWarning("Regla: excluido de Sun.Lead", "domingo 1 nov · Lead"));
    expect((c.rules as { diff: unknown[] }).diff).toEqual([]);
    expect(c.monthCheck).toMatchObject({ checked: true });
    expect(w.deps.saveRevision).not.toHaveBeenCalled();
  });

  it("a C4 as the last edit: refused with the prompt, and the diff forcing it would confirm, as tokens", async () => {
    const w = await editorWorld();
    const out = await check(w, { edits: [{ ...forceAna(w), force: undefined }] });
    const c = sc(out);
    expect(c.refusal).toMatchObject({ index: 0, code: "hard_rule", prompt: { member: w.tok("m-ana"), rules: [{ kind: "exclusion", rule: "restriction[0].pattern[0]" }] } });
    expect((c.prompt as { diff: Array<Content> }).diff).toEqual([
      expect.objectContaining({ kind: "exclusion", rule: "restriction[0].pattern[0]", service: w.sid("2026-11-08"), row: "lead", members: [w.tok("m-ana")], names: ["Ana"] }),
    ]);
  });

  it("a seat's candidates come from the worship audience only (I5): Kira's Tipo fits, she is never listed", async () => {
    const w = await editorWorld();
    const out = await check(w, { seat: { service: w.sid("2026-11-08"), row: "bgv" } });
    const names = (sc(out).candidates as Array<{ name: string }>).map((x) => x.name);
    expect(names).toContain("Dani");
    expect(names).not.toContain("Kira");
    expect(sc(out).monthCheck).toBeUndefined();
  });

  it("a token resolves for a seated member who left the pool", async () => {
    const w = await editorWorld();
    w.members.current = MEMBERS.filter((m) => m._id !== "m-ana");
    const out = await check(w, { edits: [{ op: "clear", service: w.sid("2026-11-01"), row: "lead", member: w.tok("m-ana") }] });
    expect(sc(out).refusal).toBeUndefined();
    expect((sc(out).verdicts as unknown[]).length).toBe(1);
  });

  it("an unknown token is the collapsed sentence, never a hint of who exists", async () => {
    const w = await editorWorld();
    const out = await check(w, { edits: [{ op: "place", service: w.sid("2026-11-08"), row: "bgv", member: "AAAAAAAAAAAAAAAAAAAAAA" }] });
    expect(sc(out).refusal).toMatchObject({ code: "member_not_eligible", sentence: E.notEligible });
  });
});

describe("save_proposal_edits", () => {
  it("a forced seat without confirms is refused as needs_confirmation; nothing stored", async () => {
    const w = await editorWorld();
    const out = await save(w, { edits: [forceAna(w)] });
    expect(sc(out)).toMatchObject({ code: "invalid_request", detail: "needs_confirmation" });
    expect(w.deps.saveRevision).not.toHaveBeenCalled();
    expect(w.store.size).toBe(1);
  });

  it("confirms that differ from the recomputed diff: stale_check, with the new diff", async () => {
    const w = await editorWorld();
    const out = await save(w, {
      edits: [forceAna(w)],
      confirms: [{ kind: "exclusion", rule: "restriction[0].pattern[0]", service: w.sid("2026-11-15"), row: "lead", members: [w.tok("m-ana")] }],
    });
    expect(sc(out)).toMatchObject({ detail: "stale_check" });
    expect((sc(out).diff as Array<Content>)[0]).toMatchObject({ service: w.sid("2026-11-08") });
    expect(w.store.size).toBe(1);
  });

  it("forced and confirmed: revision 2 stored with its waiver, the base marked superseded in the same save", async () => {
    const w = await editorWorld();
    const out = await forcedSave(w);
    expect(out.isError).toBeFalsy();
    const child = sc(out).proposal as string;
    expect(sc(out)).toMatchObject({ ok: true, revision: 2, checked: true });
    expect(textOf(out)).toContain(E.saved(child, 2));
    expect(textOf(out)).toContain(E.forceNotice);
    expect(sc(out).waivers).toEqual([{ service: "domingo 8 nov · Lead", members: ["Ana"], rule: "Regla: excluido de Sun.Lead" }]);
    expect(w.store.get(HANDLE)!.state.supersededBy).toBe(child);
    const stored = w.store.get(child)!;
    expect(stored.header.lineage).toEqual({ parent: HANDLE, revision: 2, root: HANDLE });
    const payload = stored.payload as ProposalPayloadV2;
    expect(payload.waivers.map((x) => x.key.service)).toEqual([w.sid("2026-11-08")]);
    expect(payload.baseline.map((k) => k.service)).toEqual([w.sid("2026-11-01")]);
    // E2: fresh creation request ids, everything else copied.
    const base = w.store.get(HANDLE)!.payload.drafts;
    expect(payload.drafts.map((x) => x.draft.localId)).toEqual(base.map((x) => x.draft.localId));
    for (let i = 0; i < base.length; i++) expect(payload.drafts[i].draft.creationRequestId).not.toBe(base[i].draft.creationRequestId);
    expect(payload.drafts.find((x) => x.draft.date === "2026-11-08")!.draft.leads).toEqual(["m-ana"]);
  });

  it("a lost answer: the same saveId again answers the stored child, never a second one", async () => {
    const w = await editorWorld();
    const confirms = await confirmsFor(w, [forceAna(w)]);
    const first = await forcedSave(w, undefined, HANDLE, "save-0001", confirms);
    const again = await forcedSave(w, undefined, HANDLE, "save-0001", confirms);
    expect(sc(again)).toMatchObject({ ok: true, replayed: true, proposal: sc(first).proposal, revision: 2 });
    expect(w.store.size).toBe(2);
  });

  it("two saves on one base: exactly one child; the second is refused naming it", async () => {
    const w = await editorWorld();
    const confirms = await confirmsFor(w, [forceAna(w)]);
    const first = await forcedSave(w, undefined, HANDLE, "save-0001", confirms);
    const second = await forcedSave(w, undefined, HANDLE, "save-0002", confirms);
    expect(sc(second)).toMatchObject({ code: "stale_revision", detail: "superseded", successor: sc(first).proposal });
    expect(textOf(second)).toContain(E.superseded(sc(first).proposal as string));
    expect(w.store.size).toBe(2);
  });

  it("the base superseded while the save ran: refused naming the other child", async () => {
    const w = await editorWorld();
    w.beforeCommit.current = () => {
      const base = w.store.get(HANDLE)!;
      w.store.set(HANDLE, { ...base, rev: "other", state: { ...base.state, supersededBy: "zzzzzzzzzzzzzzzzzzzzzzzzzz" } });
    };
    const out = await forcedSave(w);
    expect(sc(out)).toMatchObject({ detail: "superseded", successor: "zzzzzzzzzzzzzzzzzzzzzzzzzz" });
    expect(w.store.size).toBe(1);
  });

  it("a base that started applying cannot be edited", async () => {
    const w = await editorWorld();
    const confirms = await confirmsFor(w, [forceAna(w)]);
    w.apply.roles.push({ _id: "role-x", _type: "sunday_role", week: "2026-11-01", creationReceiptId: receiptIdForRequestId(w.store.get(HANDLE)!.payload.drafts[0].draft.creationRequestId) });
    const check2 = await check(w);
    expect(sc(check2)).toMatchObject({ detail: "started_applying" });
    const out = await forcedSave(w, undefined, HANDLE, "save-0001", confirms);
    expect(sc(out)).toMatchObject({ code: "stale_revision", detail: "started_applying" });
    expect(textOf(out)).toContain(E.startedApplying);
  });

  it("a failed ledger read still saves, «sin revisar», and apply repeats it", async () => {
    const w = await editorWorld();
    w.deps.readLedger.mockRejectedValueOnce(new Error("down"));
    const out = await save(w, { edits: [{ op: "place", service: w.sid("2026-11-08"), row: "bgv", member: w.tok("m-dani") }] });
    expect(sc(out)).toMatchObject({ ok: true, checked: false });
    expect(textOf(out)).toContain(E.savedUnchecked);
    const applied = await apply(w, sc(out).proposal as string);
    expect(textOf(applied)).toContain(E.applyUnchecked);
    expect(sc(applied)).toMatchObject({ revision: 2, checked: false });
  });
});

describe("apply_schedule with revisions", () => {
  it("a superseded base that created nothing is refused naming its successor; nothing written", async () => {
    const w = await editorWorld();
    const child = sc(await forcedSave(w)).proposal as string;
    const out = await apply(w, HANDLE);
    expect(sc(out)).toMatchObject({ code: "stale_revision", detail: "superseded", supersededBy: child });
    expect(textOf(out)).toContain(E.applySuperseded(child));
    expect(w.applyDeps.commitRecords).not.toHaveBeenCalled();
    expect(w.applyDeps.createRole).not.toHaveBeenCalled();
  });

  it("waivers missing or altered: refused before any write, with the exact list; repeated exactly: applied", async () => {
    const w = await editorWorld();
    const saved = await forcedSave(w);
    const child = sc(saved).proposal as string;
    const expected = sc(saved).waivers as Array<{ service: string; members: string[]; rule: string }>;

    const missing = await apply(w, child);
    expect(sc(missing)).toMatchObject({ code: "invalid_request", detail: "waivers", expectedWaivers: expected });
    expect(textOf(missing)).toContain(E.applyWaiversMissing(1));
    expect(textOf(missing)).toContain(E.applyWaiverItem("domingo 8 nov · Lead", "Ana", "Regla: excluido de Sun.Lead"));
    const altered = await apply(w, child, [{ ...expected[0], rule: "Regla: excluido de Sun.BGV" }]);
    expect(sc(altered)).toMatchObject({ detail: "waivers" });
    const doubled = await apply(w, child, [...expected, ...expected]);
    expect(sc(doubled)).toMatchObject({ detail: "waivers" });
    expect(w.applyDeps.commitRecords).not.toHaveBeenCalled();
    expect(w.applyDeps.createRole).not.toHaveBeenCalled();

    // NFC only: a decomposed accent in the argument still matches.
    const ok = await apply(w, child, [{ ...expected[0], service: expected[0].service.normalize("NFD") }]);
    expect(ok.isError).toBeFalsy();
    expect(sc(ok)).toMatchObject({ complete: true, revision: 2 });
    expect(textOf(ok)).toContain(E.applyRevision(2));
  });

  it("force in revision 2, an unrelated chat edit in revision 3: the waiver is kept and apply still demands it", async () => {
    const w = await editorWorld();
    const r2 = sc(await forcedSave(w)).proposal as string;
    const r3out = await revise(w, r2, [{ op: "place", service: "2026-11-22", seat: "BGV", member: "Dani" }]);
    expect(r3out.isError).toBeFalsy();
    const r3 = sc(r3out).proposal as string;
    expect(sc(r3out)).toMatchObject({ revision: 3 });
    expect(textOf(r3out)).toContain(E.waived("Regla: excluido de Sun.Lead", "domingo 8 nov · Lead"));
    expect(w.store.get(r3)!.header.lineage).toEqual({ parent: r2, revision: 3, root: HANDLE });
    const refused = await apply(w, r3);
    expect(sc(refused)).toMatchObject({ detail: "waivers" });
    const ok = await apply(w, r3, sc(r3out).waivers);
    expect(sc(ok)).toMatchObject({ complete: true, revision: 3 });
  });

  it("a superseded base that already created a service CONTINUES; its successor is refused by D7 with nothing written", async () => {
    const w = await editorWorld();
    const child = sc(await forcedSave(w)).proposal as string;
    // The base's apply had raced the save: its first draft landed.
    const first = w.store.get(HANDLE)!.payload.drafts[0].draft;
    w.apply.roles.push({ _id: "role-raced", _type: first._type, week: first.date, creationReceiptId: receiptIdForRequestId(first.creationRequestId) });
    const base = await apply(w, HANDLE);
    expect(base.isError).toBeFalsy();
    expect(textOf(base)).toContain(E.applySupersededContinuing(child));
    expect(sc(base)).toMatchObject({ complete: true, supersededBy: child });
    const calls = w.applyDeps.createRole.mock.calls.length;
    const childOut = await apply(w, child);
    expect(childOut.isError).toBe(true);
    expect(sc(childOut)).toMatchObject({ code: "integrity_conflict", detail: "target_lost" });
    expect(w.applyDeps.createRole.mock.calls.length).toBe(calls);
  });
});

describe("revise_proposal (the chat)", () => {
  it("never forces: a C4 from the chat is refused and nothing is stored", async () => {
    const w = await editorWorld();
    const out = await revise(w, HANDLE, [{ op: "place", service: "2026-11-08", seat: "Lead", member: "Ana" }]);
    expect(sc(out)).toMatchObject({ code: "invalid_request", detail: "hard_rule" });
    expect(textOf(out)).toContain(E.editRefused(0, "Regla: excluido de Sun.Lead"));
    expect(w.store.size).toBe(1);
  });

  it("an ambiguous or unknown name lists only the worship audience — never a kids-only member", async () => {
    const w = await editorWorld();
    const out = await revise(w, HANDLE, [{ op: "place", service: "2026-11-08", seat: "BGV", member: "a" }]);
    expect(out.isError).toBe(true);
    const text = textOf(out);
    expect(text).toMatch(/«a» puede ser/);
    expect(text).not.toContain("Kira");
    const kira = await revise(w, HANDLE, [{ op: "place", service: "2026-11-08", seat: "BGV", member: "Kira" }]);
    expect(textOf(kira)).toContain(E.ambiguousName("Kira", []));
  });

  it("unknown dates and seats are refused by name", async () => {
    const w = await editorWorld();
    expect(textOf(await revise(w, HANDLE, [{ op: "place", service: "2026-11-09", seat: "BGV", member: "Dani" }]))).toContain(E.replay.unknown_service);
    expect(textOf(await revise(w, HANDLE, [{ op: "place", service: "2026-11-08", seat: "Piano", member: "Dani" }]))).toContain(E.unknownSeat("Piano"));
  });

  it("a member renamed after the solve: the rule now names them, the breach «apareció sin que editaras», and the save succeeds", async () => {
    // Revision 2 saved while Ana was «Anita»: the rule `Ana` named nobody, so the baseline is empty.
    const w = await editorWorld();
    w.members.current = MEMBERS.map((m) => (m._id === "m-ana" ? { ...m, alias: "Anita", member_name: "Anita Ruiz" } : m));
    const r2out = await revise(w, HANDLE, [{ op: "place", service: "2026-11-22", seat: "BGV", member: "Dani" }]);
    const r2 = sc(r2out).proposal as string;
    expect((w.store.get(r2)!.payload as ProposalPayloadV2).baseline).toEqual([]);
    // Renamed back: the rule names Ana again, on a seat nobody edited.
    w.members.current = MEMBERS;
    const r3out = await revise(w, r2, [{ op: "place", service: "2026-11-29", seat: "BGV", member: "Dani" }]);
    expect(r3out.isError).toBeFalsy();
    expect(textOf(r3out)).toContain(E.appeared("Regla: excluido de Sun.Lead", "domingo 1 nov · Lead"));
    expect(sc(r3out).waivers).toEqual([]);
  });
});

describe("hygiene", () => {
  it("no member id, config key or rules revision in any answer of this suite or any log line", () => {
    const SECRETS = ["m-ana", "m-bruno", "m-carla", "m-dani", "m-kira", "m-tomas", "m-admin", "x-ana", "x-carla", "x-bruno", "c-ana-dani", "rules-rev-1"];
    expect(answers.length).toBeGreaterThan(20);
    for (const out of answers) {
      for (const text of [textOf(out), JSON.stringify(out.structuredContent ?? {})]) {
        for (const s of SECRETS) expect(text, `«${s}» leaked`).not.toContain(s);
      }
    }
    for (const line of consoleCalls) for (const s of [...SECRETS, HANDLE]) expect(line).not.toContain(s);
  });
});
