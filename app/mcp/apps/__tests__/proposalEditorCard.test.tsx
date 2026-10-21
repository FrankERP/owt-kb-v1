// The proposal card's editor (S4): its model read against the REAL editor tools' answers — the
// screen's own sequence (check, «¿Asignar de todos modos?», save with the keys shown, «Cargar»)
// run end to end into `apply_schedule` — plus the model's pure rules and the presentational half.
// Fictitious people only (the repository is public).
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test", useCdn: false }));

import { applyScheduleResult } from "@/app/mcp/tools/applySchedule";
import { checkProposalEditsResult, reviseProposalResult, saveProposalEditsResult } from "@/app/mcp/tools/proposalEditor";
import { HANDLE, PRINCIPAL } from "@/app/mcp/tools/__tests__/monthToolFixtures";
import { editorWorld, type EditorWorld } from "@/app/mcp/tools/__tests__/editorToolFixtures";
import { Editor, type EditorProps } from "@/mcp-app/proposal-card/Editor";
import { seatOf } from "@/mcp-app/proposal-card/useEditor";
import {
  afterRefusal,
  checkViewOf,
  confirmsOf,
  forceLast,
  loadMessage,
  newSaveId,
  saveViewOf,
  type CheckView,
  type TokenEdit,
} from "@/mcp-app/proposal-card/editorModel";
import { cardViewOf } from "@/mcp-app/proposal-card/model";

const check = (w: EditorWorld, edits: TokenEdit[], proposal = HANDLE, seat?: { service: string; row: string }) =>
  checkProposalEditsResult({ proposal, edits, ...(seat ? { seat } : {}) } as never, PRINCIPAL, w.deps).then(checkViewOf);
const save = (w: EditorWorld, edits: TokenEdit[], confirms: ReturnType<typeof confirmsOf>, saveId = newSaveId()) =>
  saveProposalEditsResult({ proposal: HANDLE, edits, confirms, saveId } as never, PRINCIPAL, w.deps).then(saveViewOf);
/** Ana onto Nov 8's Lead — her `!in Sun.Lead`, a C4. */
const anaOnLead = (w: EditorWorld): TokenEdit => ({ op: "place", service: w.sid("2026-11-08"), row: "lead", member: w.tok("m-ana") });

describe("the editor model against the real tools", () => {
  it("reads the board: services, seats and people by token and name", async () => {
    const w = await editorWorld();
    const view = await check(w, []);
    expect(view.ok).toBe(true);
    const nov1 = view.board.find((s) => s.service === w.sid("2026-11-01"))!;
    expect(nov1.editable).toBe(true);
    expect(nov1.seats.find((s) => s.row === "lead")!.members).toEqual([{ token: w.tok("m-ana"), name: "Ana", unavailable: false }]);
    expect(view.lines.length).toBeGreaterThan(0);
    expect(view.diff).toEqual([]);
    expect(view.refusal).toBeNull();
  });

  it("a seat's candidates: tokens and names, in the server's order", async () => {
    const w = await editorWorld();
    const view = await check(w, [], HANDLE, { service: w.sid("2026-11-08"), row: "bgv" });
    expect(view.candidates?.map((c) => c.name)).toContain("Dani");
    expect(view.candidates?.find((c) => c.name === "Dani")?.token).toBe(w.tok("m-dani"));
  });

  it("the whole screen: a C4 asks, forcing it shows the key, the save keeps the waiver, «Cargar» is accepted by apply", async () => {
    const w = await editorWorld();
    let edits: TokenEdit[] = [anaOnLead(w)];

    const asked = await check(w, edits);
    expect(asked.refusal).toMatchObject({ index: 0, code: "hard_rule" });
    expect(asked.prompt).toEqual([expect.objectContaining({ where: "domingo 8 nov · Lead", names: ["Ana"], members: [w.tok("m-ana")] })]);
    const after = afterRefusal(edits, asked);
    expect(after).toEqual({ edits, askForce: true });

    edits = forceLast(after.edits);
    const forced = await check(w, edits);
    expect(forced.refusal).toBeNull();
    expect(forced.diff).toHaveLength(1);

    // The screen always sends `confirms`: none for a forced seat is stale, with the diff to ask about.
    const unconfirmed = await save(w, edits, []);
    expect(unconfirmed).toMatchObject({ ok: false, detail: "stale_check" });
    expect(unconfirmed.diff).toEqual([expect.objectContaining({ where: "domingo 8 nov · Lead", sentence: "Regla: excluido de Sun.Lead" })]);

    const saved = await save(w, edits, confirmsOf(forced));
    expect(saved).toMatchObject({ ok: true, revision: 2, checked: true });
    expect(saved.waivers).toEqual([{ service: "domingo 8 nov · Lead", members: ["Ana"], rule: "Regla: excluido de Sun.Lead" }]);

    // The new base, judged with no edits, keeps the waiver in the words apply asks for.
    const fresh = await check(w, [], saved.proposal!);
    expect(fresh).toMatchObject({ proposal: saved.proposal, revision: 2 });
    expect(fresh.waivers).toEqual(saved.waivers);
    // The old base now answers with its successor, which the screen follows on opening.
    const old = await check(w, []);
    expect(old).toMatchObject({ ok: false, successor: saved.proposal });

    const message = loadMessage(saved.proposal!, saved.revision!, fresh.waivers);
    expect(message).toContain(`Carga la versión 2 de la propuesta ${saved.proposal}`);
    const waivers = JSON.parse(message.split("\n").at(-1)!);
    const applied = await applyScheduleResult({ proposal: saved.proposal!, waivers } as never, PRINCIPAL, w.applyDeps);
    expect(applied.isError).toBeFalsy();
    expect(applied.structuredContent).toMatchObject({ complete: true, revision: 2 });
  });

  it("confirms from an older check are stale: refused with the new diff to ask about again", async () => {
    const w = await editorWorld();
    const edits = forceLast([anaOnLead(w)]);
    const stale = await save(w, edits, [{ kind: "exclusion", rule: "restriction[0].pattern[0]", service: w.sid("2026-11-01"), row: "lead", members: [w.tok("m-ana")] }]);
    expect(stale).toMatchObject({ ok: false, detail: "stale_check" });
    expect(stale.diff).toHaveLength(1);
  });

  it("a refusal that is not a C4 drops the edit; the board shown is the one before it", async () => {
    const w = await editorWorld();
    const edits: TokenEdit[] = [{ op: "place", service: w.sid("2026-11-08"), row: "lead", member: w.tok("m-tomas") }];
    const view = await check(w, edits);
    expect(view.refusal?.code).not.toBe("hard_rule");
    expect(afterRefusal(edits, view)).toEqual({ edits: [], askForce: false });
  });

  it("an unknown token is a refusal like any other: dropped", async () => {
    const w = await editorWorld();
    const edits: TokenEdit[] = [{ op: "place", service: w.sid("2026-11-08"), row: "lead", member: "x".repeat(22) }];
    const view = await check(w, edits);
    expect(view.refusal).not.toBeNull();
    expect(afterRefusal(edits, view)).toEqual({ edits: [], askForce: false });
  });

  it("an error answer is never ok, and reads as empty rather than invented", async () => {
    const w = await editorWorld();
    const view = await check(w, [], "r".padEnd(26, "9"));
    expect(view.ok).toBe(false);
    expect(view.board).toEqual([]);
    expect(view.lines.length).toBeGreaterThan(0);
    expect(checkViewOf(undefined)).toMatchObject({ ok: false, board: [], lines: [], refusal: null, prompt: null, candidates: null });
  });

  it("the card shows a revise_proposal answer as the edited version", async () => {
    const w = await editorWorld();
    const out = await reviseProposalResult({ proposal: HANDLE, edits: [{ op: "place", service: "2026-11-22", seat: "BGV", member: "Dani" }] }, PRINCIPAL, w.deps);
    const view = cardViewOf(out);
    if (view.kind !== "proposal") throw new Error(`expected a proposal, got ${view.kind}`);
    expect(view.title).toBe("Propuesta · versión 2");
    expect(view.revision).toBe(2);
    expect(view.handle).toBe((out.structuredContent as { proposal: string }).proposal);
    expect(view.services.some((s) => s.planned && s.rows.some((r) => r.names.includes("Dani")))).toBe(true);
  });
});

describe("the editor model's own rules", () => {
  const checkWith = (refusal: CheckView["refusal"]): CheckView => ({
    ok: true, proposal: null, revision: null, successor: null, board: [], lines: [], diff: [], refusal, prompt: null, candidates: null, waivers: [],
  });
  const a: TokenEdit = { op: "place", service: "s1", row: "lead", member: "t1" };
  const b: TokenEdit = { op: "clear", service: "s1", row: "bgv", member: "t2" };

  it("a C4 asks only when it is the last edit; any other refusal drops that one edit", () => {
    expect(afterRefusal([a, b], checkWith(null))).toEqual({ edits: [a, b], askForce: false });
    expect(afterRefusal([b, a], checkWith({ index: 1, code: "hard_rule", sentence: "x" }))).toEqual({ edits: [b, a], askForce: true });
    expect(afterRefusal([a, b], checkWith({ index: 0, code: "hard_rule", sentence: "x" }))).toEqual({ edits: [b], askForce: false });
    expect(afterRefusal([a, b], checkWith({ index: 1, code: "not_seated", sentence: "x" }))).toEqual({ edits: [a], askForce: false });
  });

  it("a save the server could not confirm is a retry (the screen keeps its saveId); a refusal is not", () => {
    expect(saveViewOf({ isError: true, structuredContent: { refused: true, code: "server_error", detail: "unknown", retry: true } })).toMatchObject({ ok: false, retry: true });
    expect(saveViewOf({ isError: true, structuredContent: { refused: true, code: "stale_revision", detail: "superseded" } })).toMatchObject({ ok: false, retry: false });
  });

  it("forces only the last edit, and never a clear", () => {
    expect(forceLast([b, a])).toEqual([b, { ...a, force: true }]);
    expect(forceLast([a, b])).toEqual([a, b]);
    expect(forceLast([])).toEqual([]);
  });

  it("a save id fits the server's schema (`card-` and 16 characters)", () => {
    expect(newSaveId()).toMatch(/^card-[a-z0-9]{16}$/);
    expect(newSaveId(() => 0)).toBe("card-aaaaaaaaaaaaaaaa");
  });

  it("«Cargar» names the version; waivers go verbatim, as JSON on the last line", () => {
    expect(loadMessage("h1", 1, [])).toBe("Carga la propuesta h1 con apply_schedule.");
    const waivers = [{ service: "domingo 8 nov · Lead", members: ["Ana", "Dani"], rule: "Regla: no juntos" }];
    const msg = loadMessage("h2", 3, waivers);
    expect(msg.split("\n")[0]).toBe("Carga la versión 3 de la propuesta h2 con apply_schedule.");
    expect(msg).toContain("- domingo 8 nov · Lead · Ana y Dani · Regla: no juntos");
    expect(JSON.parse(msg.split("\n").at(-1)!)).toEqual(waivers);
  });
});

describe("the presentational editor", () => {
  const noop = () => {};
  const props: EditorProps = {
    revision: 2,
    board: [
      { service: "s1", label: "domingo 8 nov", date: "2026-11-08", type: "sunday", editable: true, seats: [
        { row: "lead", label: "Lead", target: 2, members: [{ token: "t1", name: "Ana", unavailable: true }] },
        { row: "bgv", label: "BGV", target: 1, members: [{ token: "t4", name: "Eva", unavailable: false }] },
      ] },
      { service: "s2", label: "sábado 14 nov", date: "2026-11-14", type: "saturday", editable: false, seats: [] },
    ],
    lines: ["Todo cuadra."],
    pending: 0,
    busy: false,
    notice: null,
    sheet: null,
    ask: null,
    exchanging: null,
    saved: null,
    loadSent: false,
    onOpenSeat: noop, onPick: noop, onCloseSheet: noop, onClear: noop, onExchange: noop,
    onForce: noop, onSave: noop, onDiscard: noop, onLoad: noop, onClose: noop,
  };
  const html = (over: Partial<EditorProps> = {}) => renderToStaticMarkup(<Editor {...props} {...over} />);

  it("shows each seat's people with «No disp.», a × and a «+»; a service that will not be created is tagged", () => {
    const out = html();
    expect(out).toContain("Ana<span class=\"badge\">No disp.</span>");
    expect(out).toContain('aria-label="Quitar a Ana"');
    expect(out).toContain('aria-label="Agregar en Lead"');
    expect(out).toMatch(/sábado 14 nov<\/span><span class="tag">No se creará/);
    expect(out).toContain("<li>Todo cuadra.</li>");
  });

  it("saves only with pending edits, loads only without them, and once", () => {
    const disabled = (out: string, label: string) => new RegExp(`<button[^>]*disabled=""[^>]*>${label}<`).test(out);
    expect(disabled(html(), "Revisar y guardar")).toBe(true);
    expect(disabled(html(), "Cargar")).toBe(false);
    expect(disabled(html({ pending: 1 }), "Revisar y guardar")).toBe(false);
    expect(disabled(html({ pending: 1 }), "Cargar")).toBe(true);
    expect(html({ loadSent: true })).toContain("Enviado al chat");
  });

  // The host sizes the frame to the content, so a fixed overlay lands at the bottom of the whole
  // month, screens away from the seat (Frank, 2026-10-21): both panels open under the seat tapped.
  const between = (out: string, needle: string, after: string, before: string) => {
    const at = out.indexOf(needle);
    return at > out.indexOf(after) && at < out.indexOf(before);
  };

  const ask = { sentence: "Regla: excluido de Sun.Lead", items: [{ where: "domingo 8 nov · Lead", sentence: "Regla: excluido de Sun.Lead" }] };
  const count = (out: string, needle: string) => out.split(needle).length - 1;

  it("asks before forcing, with where and why, once, under the row the edit touched", () => {
    const out = html({ ask: { at: { service: "s1", row: "lead" }, ...ask } });
    expect(count(out, 'role="alertdialog"')).toBe(1);
    expect(out).toContain("¿Asignar de todos modos?");
    expect(out).toContain("<li>domingo 8 nov · Lead: Regla: excluido de Sun.Lead</li>");
    expect(between(out, 'role="alertdialog"', 'aria-label="Agregar en Lead"', 'aria-label="Agregar en BGV"')).toBe(true);
    const bgv = html({ ask: { at: { service: "s1", row: "bgv" }, ...ask } });
    expect(count(bgv, 'role="alertdialog"')).toBe(1);
    expect(between(bgv, 'role="alertdialog"', 'aria-label="Agregar en BGV"', "sábado 14 nov")).toBe(true);
    // A save's ask has no seat, and a seat not on the board has no row to sit under: either opens,
    // once, by the buttons.
    for (const at of [null, { service: "s2", row: "lead" }, { service: "s1", row: "nope" }]) {
      const out = html({ ask: { at, ...ask } });
      expect(count(out, 'role="alertdialog"')).toBe(1);
      expect(between(out, 'role="alertdialog"', "<li>Todo cuadra.</li>", "Revisar y guardar")).toBe(true);
    }
  });

  it("an open question holds the board: only its own buttons and «Cerrar» stay live", () => {
    const enabled = (out: string, label: string) => new RegExp(`<button(?![^>]*disabled="")[^>]*>${label}<`).test(out);
    const out = html({ pending: 1, ask: { at: { service: "s1", row: "lead" }, ...ask } });
    expect(out).not.toMatch(/<button(?![^>]*disabled="")[^>]*aria-label="(Agregar|Quitar)/);
    expect(out).not.toMatch(/<button(?![^>]*disabled="")[^>]*title="Intercambiar"/);
    for (const label of ["Revisar y guardar", "Descartar cambios", "Cargar"]) expect(enabled(out, label)).toBe(false);
    for (const label of ["Asignar de todos modos", "Cancelar", "Cerrar"]) expect(enabled(out, label)).toBe(true);
    expect(enabled(html({ pending: 1 }), "Revisar y guardar")).toBe(true);
  });

  it("an exchange's question sits under the seat tapped last", () => {
    expect(seatOf({ op: "exchange", a: { service: "s1", row: "lead", member: "t1" }, b: { service: "s3", row: "bgv", member: "t4" } })).toEqual({ service: "s3", row: "bgv" });
    expect(seatOf({ op: "place", service: "s1", row: "lead", member: "t2" })).toEqual({ service: "s1", row: "lead" });
    expect(seatOf(undefined)).toBeNull();
  });

  it("lists a seat's candidates under that seat; a blocked one cannot be picked", () => {
    const out = html({ sheet: { seat: { service: "s1", row: "lead" }, label: "domingo 8 nov · Lead", candidates: [
      { token: "t2", name: "Dani", available: true, blocked: null, rule: null },
      { token: "t3", name: "Bruno", available: false, blocked: "Ya está en este servicio", rule: null },
    ] } });
    expect(count(out, 'class="picker"')).toBe(1);
    expect(between(out, 'class="picker"', 'aria-label="Agregar en Lead"', 'aria-label="Agregar en BGV"')).toBe(true);
    expect(out).toMatch(/<button type="button"><span>Dani<\/span>/);
    expect(out).toMatch(/<button type="button" disabled=""><span>Bruno<\/span><span class="badge">No disp.<\/span>/);
  });

  it("the stylesheet fixes nothing to the frame", () => {
    expect(readFileSync("mcp-app/proposal-card/styles.css", "utf8")).not.toMatch(/position:\s*fixed/);
  });

  it("after a save, lists what was assigned anyway", () => {
    const out = html({ saved: { revision: 2, waivers: [{ service: "domingo 8 nov · Lead", members: ["Ana"], rule: "Regla: excluido de Sun.Lead" }] } });
    expect(out).toContain("Versión 2 guardada.");
    expect(out).toContain("<li>domingo 8 nov · Lead · Ana · Regla: excluido de Sun.Lead</li>");
  });
});
