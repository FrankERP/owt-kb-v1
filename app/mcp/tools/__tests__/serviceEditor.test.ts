// Admin parity phase 1, S2 (ADR-0066): the saved-month editor — `check_service_edits`, its card
// twin and `save_service_edits` — over November 2026's stored services (`serviceEditorFixtures.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { PRINCIPAL, textOf } from "./monthToolFixtures";
import { SAVE_ARGS_PREFIX } from "@/app/components/admin/v3Copy";
import { MONTH, NOVEMBER, serviceWorld, storedRow, type ServiceWorld } from "./serviceEditorFixtures";
import {
  SAVE_SERVICE_EDITS_INPUT,
  SAVE_START_CUTOFF_MS,
  checkServiceEditsAppResult,
  checkServiceEditsResult,
  saveServiceEditsResult,
  type SaveServiceEditsArgs,
} from "../serviceEditor";

type Changes = SaveServiceEditsArgs["changes"];
const MOVE_ANA_CHECK = [{ op: "move" as const, from: { service: "sun8", seat: "BGV", member: "Ana" }, to: { service: "sun15", seat: "BGV" } }];
const sc = (out: CallToolResult) => out.structuredContent as Record<string, unknown>;
const changesOf = (out: CallToolResult) => sc(out).changes as Changes;
const statuses = (out: CallToolResult) => Object.fromEntries((sc(out).services as Array<{ service: string; status: string }>).map((s) => [s.service, s.status]));
const seatsOf = (w: ServiceWorld, id: string, section: "leads" | "bgvs" | "chorus") => w.store.get(id)![section].map((s) => s._id);

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

async function check(w: ServiceWorld, edits: Parameters<typeof checkServiceEditsResult>[0]["edits"]) {
  return checkServiceEditsResult({ month: MONTH, edits }, PRINCIPAL, w.deps);
}

describe("check_service_edits (the chat)", () => {
  it("answers one change set per changed service, its lines in words, and writes nothing", async () => {
    const w = serviceWorld();
    const out = await check(w, [{ op: "place", service: "2026-11-15", seat: "BGV", member: "Carla" }]);
    expect(out.isError).toBeFalsy();
    const changes = changesOf(out);
    expect(changes.map((c) => c.service)).toEqual(["sun15"]);
    expect(changes[0].lines).toEqual(["domingo 15 nov · BGV: entra Carla"]);
    expect(changes[0].baseRev).toBe("sun15-r1");
    expect(w.deps.editRole).not.toHaveBeenCalled();
    expect(textOf(out)).toContain("save_service_edits");
  });

  it("the save's arguments ride in the TEXT (the model never sees structuredContent), and saving from the text alone works", async () => {
    const w = serviceWorld();
    const out = await check(w, MOVE_ANA_CHECK);
    const last = textOf(out).split("\n").at(-1)!;
    expect(last.startsWith(SAVE_ARGS_PREFIX)).toBe(true);
    const args = JSON.parse(last.slice(SAVE_ARGS_PREFIX.length)) as SaveServiceEditsArgs;
    expect(args).toEqual({ month: MONTH, changes: changesOf(out) });
    const saved = await saveServiceEditsResult(args, PRINCIPAL, w.deps);
    expect(statuses(saved)).toEqual({ sun8: "saved", sun15: "saved" });
    // The card's twin keeps its text free of them: the card reads the structured answer.
    const appEdits = [{ op: "place" as const, service: "sun15", row: "bgv", member: w.tok("m-carla") }];
    const app = await checkServiceEditsAppResult({ month: MONTH, edits: appEdits }, PRINCIPAL, w.deps);
    expect(changesOf(app)).toHaveLength(1);
    expect(textOf(app)).not.toContain(SAVE_ARGS_PREFIX);
    expect(textOf(app)).not.toContain("Para guardar");
  });

  it("focus only tells the card which days to show: echoed, checked against the month, and it may open the card without edits", async () => {
    const w = serviceWorld();
    const day = await checkServiceEditsResult({ month: MONTH, edits: [], focus: { from: "2026-11-08", to: "2026-11-08" } }, PRINCIPAL, w.deps);
    expect(day.isError).toBeFalsy();
    expect(sc(day)).toMatchObject({ ok: true, focus: { from: "2026-11-08", to: "2026-11-08" }, changes: [] });
    expect(textOf(day)).not.toContain(SAVE_ARGS_PREFIX);
    const edited = await checkServiceEditsResult({ month: MONTH, edits: [{ op: "place", service: "2026-11-15", seat: "BGV", member: "Carla" }], focus: { from: "2026-11-14", to: "2026-11-15" } }, PRINCIPAL, w.deps);
    expect(sc(edited)).toMatchObject({ focus: { from: "2026-11-14", to: "2026-11-15" } });
    expect(changesOf(edited).map((c) => c.service)).toEqual(["sun15"]);
    const outside = await checkServiceEditsResult({ month: MONTH, edits: [], focus: { from: "2026-12-05", to: "2026-12-06" } }, PRINCIPAL, w.deps);
    expect(sc(outside)).toMatchObject({ detail: "focus" });
    const backwards = await checkServiceEditsResult({ month: MONTH, edits: [], focus: { from: "2026-11-08", to: "2026-11-07" } }, PRINCIPAL, w.deps);
    expect(sc(backwards)).toMatchObject({ detail: "focus" });
    const empty = await checkServiceEditsResult({ month: MONTH, edits: [], focus: { from: "2026-11-02", to: "2026-11-03" } }, PRINCIPAL, w.deps);
    expect(textOf(empty)).toContain("No hay servicios guardados entre esas fechas");
    const copyFocus = await checkServiceEditsResult({ month: MONTH, edits: [], copy: { from: "sun1", to: "sun8" }, focus: { from: "2026-11-08", to: "2026-11-08" } }, PRINCIPAL, w.deps);
    expect(sc(copyFocus)).toMatchObject({ detail: "focus" });
    expect(w.deps.editRole).not.toHaveBeenCalled();
  });

  it("a focus keeps the focused day's own warnings (no Lead) and never claims the month is clear", async () => {
    const w = serviceWorld();
    const whole = textOf(await checkServiceEditsResult({ month: MONTH, edits: [], focus: { from: "2026-11-01", to: "2026-11-30" } }, PRINCIPAL, w.deps));
    expect(whole).toContain("Noche de alabanza 18 nov quedó sin Lead");
    expect(whole).not.toContain("Los avisos por servicio son solo de esos días");
    const day = textOf(await checkServiceEditsResult({ month: MONTH, edits: [], focus: { from: "2026-11-18", to: "2026-11-18" } }, PRINCIPAL, w.deps));
    expect(day).toContain("Noche de alabanza 18 nov quedó sin Lead");
    expect(day).toContain("Los avisos por servicio son solo de esos días");
    expect(day).not.toContain("domingo 1 nov:");
    expect(day).not.toContain("Todo cuadra");
  });

  it("a move between two services is one group, saved back to back", async () => {
    const w = serviceWorld();
    const out = await check(w, [{ op: "move", from: { service: "sun8", seat: "BGV", member: "Ana" }, to: { service: "sun15", seat: "BGV" } }]);
    expect(changesOf(out).map((c) => c.service)).toEqual(["sun8", "sun15"]);
    expect(sc(out).groups).toEqual([["sun8", "sun15"]]);
    expect(changesOf(out).flatMap((c) => c.lines)).toEqual(["domingo 8 nov · BGV: sale Ana", "domingo 15 nov · BGV: entra Ana"]);
  });

  it("a per-seat rule refuses the edit from the chat (nothing is forced)", async () => {
    const w = serviceWorld();
    // Ana and Dani may not serve together.
    const out = await check(w, [{ op: "place", service: "sun1", seat: "BGV", member: "Ana" }]);
    expect(changesOf(out)).toEqual([]);
    expect(sc(out).refusal).toMatchObject({ code: "hard_rule" });
  });

  it("a service already breaking a rule can still be edited (baseline), and says so as a warning", async () => {
    const w = serviceWorld();
    const out = await check(w, [{ op: "place", service: "sun8", seat: "Coro", member: "Carla" }]);
    expect(changesOf(out).map((c) => c.service)).toEqual(["sun8"]);
    expect(changesOf(out)[0].waivers).toBeUndefined();
    expect(textOf(out)).toContain("ya estaba así antes de este cambio");
  });

  it("never changes the date, and refuses «Cuenta para equidad» in a past month", async () => {
    const w = serviceWorld({ rows: [...NOVEMBER(), storedRow("sep6", "sunday_role", "2026-09-06", { leads: ["m-bruno"] })] });
    const past = await checkServiceEditsResult({ month: "2026-09", edits: [{ op: "header", service: "sep6", countsForFairness: false }] }, PRINCIPAL, w.deps);
    expect(textOf(past)).toContain("no se puede cambiar en un mes que ya pasó");
    expect(changesOf(past)).toEqual([]);
  });

  it("a special's name and time are header edits; a weekend has neither", async () => {
    const w = serviceWorld();
    const ok = await check(w, [{ op: "header", service: "esp18", name: "Noche de oración", time: "20:00" }]);
    expect(changesOf(ok)[0].lines).toEqual([
      "miércoles 18 nov · Noche de alabanza · nombre: «Noche de alabanza» → «Noche de oración»",
      "miércoles 18 nov · Noche de alabanza · hora: 19:00 → 20:00",
    ].map((l) => expect.stringContaining(l.split(" · ").slice(-1)[0]!)) as never);
    const weekend = await check(w, [{ op: "header", service: "sun8", name: "Otro" }]);
    expect(changesOf(weekend)).toEqual([]);
    expect(textOf(weekend)).toContain("Solo un servicio especial");
  });

  it("names no member id and no rule key", async () => {
    const w = serviceWorld();
    const out = await check(w, [{ op: "move", from: { service: "sun8", seat: "BGV", member: "Ana" }, to: { service: "sun15", seat: "BGV" } }]);
    const surface = textOf(out) + JSON.stringify(out.structuredContent);
    for (const id of ["m-ana", "m-bruno", "m-carla", "m-dani", "m-tomas", "x-ana", "c-ana-dani", "rules-rev-1"]) expect(surface, id).not.toContain(id);
  });
});

describe("check_service_edits_app (the card)", () => {
  it("a forced per-seat rule mints a waiver token and its line goes to the prompt", async () => {
    const w = serviceWorld();
    const edits = [{ op: "place" as const, service: "sun1", row: "bgv", member: w.tok("m-ana"), force: true }];
    const out = await checkServiceEditsAppResult({ month: MONTH, edits }, PRINCIPAL, w.deps);
    const [change] = changesOf(out);
    expect(change.waivers).toHaveLength(1);
    expect(change.lines.some((l) => l.includes("asignado de todos modos"))).toBe(true);
  });

  it("lists a seat's candidates by token and name", async () => {
    const w = serviceWorld();
    const out = await checkServiceEditsAppResult({ month: MONTH, edits: [], seat: { service: "sun15", row: "bgv" } }, PRINCIPAL, w.deps);
    const candidates = sc(out).candidates as Array<{ token: string; name: string }>;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => /^[A-Za-z0-9_-]{22}$/.test(c.token))).toBe(true);
  });
});

async function checked(w: ServiceWorld, edits: Parameters<typeof checkServiceEditsResult>[0]["edits"]): Promise<Changes> {
  const out = await check(w, edits);
  const changes = changesOf(out);
  if (!changes.length) throw new Error(textOf(out));
  return changes;
}

const save = (w: ServiceWorld, changes: Changes) => saveServiceEditsResult({ month: MONTH, changes }, PRINCIPAL, w.deps);
const MOVE_ANA = [{ op: "move" as const, from: { service: "sun8", seat: "BGV", member: "Ana" }, to: { service: "sun15", seat: "BGV" } }];

describe("save_service_edits", () => {
  it("writes each changed service through the writer, notices inline, and a repeat answers «ya estaba»", async () => {
    const w = serviceWorld();
    const changes = await checked(w, MOVE_ANA);
    const out = await save(w, changes);
    expect(out.isError).toBeFalsy();
    expect(statuses(out)).toEqual({ sun8: "saved", sun15: "saved" });
    expect(seatsOf(w, "sun8", "bgvs")).toEqual([]);
    expect(seatsOf(w, "sun15", "bgvs")).toEqual(["m-ana"]);
    // Each write's notices are queued before the next write starts.
    expect(w.log).toEqual(["write:sun8", "notices:sun8", "write:sun15", "notices:sun15"]);
    const again = await save(w, changes);
    expect(statuses(again)).toEqual({ sun8: "already", sun15: "already" });
    expect(w.deps.editRole).toHaveBeenCalledTimes(2);
  });

  it("a stale service refuses the whole call before any write", async () => {
    const w = serviceWorld();
    const changes = await checked(w, MOVE_ANA);
    w.store.set("sun15", { ...w.store.get("sun15")!, _rev: "sun15-r9" });
    const out = await save(w, changes);
    expect(out.isError).toBe(true);
    expect(sc(out)).toMatchObject({ code: "stale_revision", detail: "changed" });
    expect(w.deps.editRole).not.toHaveBeenCalled();
  });

  it("lines that are not the server's own rendering refuse the call (F4)", async () => {
    const w = serviceWorld();
    const changes = await checked(w, MOVE_ANA);
    const forged = changes.map((c, i) => (i === 0 ? { ...c, lines: ["domingo 8 nov · BGV: sale Bruno"] } : c));
    const out = await save(w, forged);
    expect(sc(out)).toMatchObject({ detail: "not_the_checked" });
    expect(w.deps.editRole).not.toHaveBeenCalled();
  });

  it("a tampered target fails its MAC", async () => {
    const w = serviceWorld();
    const changes = await checked(w, [{ op: "place", service: "sun15", seat: "BGV", member: "Carla" }]);
    const forged = [{ ...changes[0], target: { ...changes[0].target, leads: [] } }];
    expect(sc(await save(w, forged))).toMatchObject({ detail: "not_the_checked" });
  });

  it("a client-sent group is refused by the schema (groups are the server's)", () => {
    const parsed = SAVE_SERVICE_EDITS_INPUT.safeParse({ month: MONTH, changes: [{ service: "s", baseRev: "r", target: {}, diff: {}, mac: "", unit: ["s"], lines: [], group: 1 }] });
    expect(parsed.success).toBe(false);
  });

  it("half of a move is refused before any write: the unit is signed and must come whole", async () => {
    const w = serviceWorld();
    const changes = await checked(w, MOVE_ANA);
    expect(changes.map((c) => c.unit)).toEqual([["sun8", "sun15"], ["sun8", "sun15"]]);
    const half = await save(w, [changes[0]!]);
    expect(sc(half)).toMatchObject({ refused: true, detail: "unit_incomplete" });
    // Shrinking the unit to fit the half breaks its MAC.
    const forged = await save(w, [{ ...changes[0]!, unit: ["sun8"] }]);
    expect(sc(forged)).toMatchObject({ detail: "not_the_checked" });
    expect(w.deps.editRole).not.toHaveBeenCalled();
  });

  it("every write is kept alive past the answer", async () => {
    const w = serviceWorld();
    await save(w, await checked(w, MOVE_ANA));
    expect(w.deps.keepAlive).toHaveBeenCalledTimes(2);
  });

  it("a maintenance reload (the commit repaired the document and refused) is «revisa de nuevo», never «sin confirmar»", async () => {
    const w = serviceWorld();
    const changes = await checked(w, [{ op: "place", service: "sun15", seat: "BGV", member: "Carla" }]);
    w.deps.editRole.mockImplementationOnce(async () => {
      w.store.set("sun15", { ...w.store.get("sun15")!, _rev: "sun15-r2" });
      return { ok: false, status: 409, body: { error: "bootstrap_completed_reload" } };
    });
    const out = await save(w, changes);
    expect(statuses(out)).toEqual({ sun15: "notSavedRecheck" });
    expect(sc(out).next).toBe("check_again");
    expect(textOf(out)).toContain("se acaba de reparar");
  });

  it("a run with something to re-check never tells the model to repeat the same call", async () => {
    const w = serviceWorld();
    const changes = [
      ...(await checked(w, [{ op: "clear", service: "sun1", seat: "Coro", member: "Dani" }])),
      ...(await checked(w, [{ op: "place", service: "sun15", seat: "BGV", member: "Carla" }])),
    ];
    w.deps.editRole
      .mockResolvedValueOnce({ ok: false, status: 409, body: { error: "stale_revision" } })
      .mockResolvedValueOnce({ ok: false, status: 409, body: { error: "ambiguous_target" } });
    const out = await save(w, changes);
    expect(statuses(out)).toEqual({ sun1: "notSavedRepeat", sun15: "notSavedRecheck" });
    expect(sc(out).next).toBe("check_again");
  });

  it("a forced rule needs the card's token; from the chat it is refused, with the token it is saved", async () => {
    const w = serviceWorld();
    const edits = [{ op: "place" as const, service: "sun1", row: "bgv", member: w.tok("m-ana"), force: true }];
    const app = changesOf(await checkServiceEditsAppResult({ month: MONTH, edits }, PRINCIPAL, w.deps));
    const stripped = await save(w, app.map(({ waivers: _w, ...c }) => c));
    expect(sc(stripped)).toMatchObject({ detail: "needs_card" });
    expect(w.deps.editRole).not.toHaveBeenCalled();
    const ok = await save(w, app);
    expect(statuses(ok)).toEqual({ sun1: "saved" });
  });

  it("a waiver token dies with the base revision it was minted for", async () => {
    const w = serviceWorld();
    const edits = [{ op: "place" as const, service: "sun1", row: "bgv", member: w.tok("m-ana"), force: true }];
    const app = changesOf(await checkServiceEditsAppResult({ month: MONTH, edits }, PRINCIPAL, w.deps));
    // Replayed on a later base: the MAC binds the base too, so the call is «not the checked».
    const later = app.map((c) => ({ ...c, baseRev: "sun1-r2" }));
    w.store.set("sun1", { ...w.store.get("sun1")!, _rev: "sun1-r2" });
    expect(sc(await save(w, later))).toMatchObject({ detail: "not_the_checked" });
  });

  it("a 409 on the SECOND service of a group stops the run and says who is where", async () => {
    const w = serviceWorld();
    const changes = await checked(w, MOVE_ANA);
    w.beforeWrite.push(null, () => w.store.set("sun15", { ...w.store.get("sun15")!, _rev: "sun15-r7" }));
    const out = await save(w, changes);
    expect(statuses(out)).toEqual({ sun8: "saved", sun15: "notSavedRecheck" });
    // Out of Sunday 8, never into Sunday 15: only her Saturday is left.
    expect(textOf(out)).toContain("Ana quedó en sábado 7 nov.");
  });

  it("a 404 (deleted) on the second service of a group does the same", async () => {
    const w = serviceWorld();
    const changes = await checked(w, MOVE_ANA);
    w.beforeWrite.push(null, () => w.store.delete("sun15"));
    const out = await save(w, changes);
    expect(statuses(out)).toEqual({ sun8: "saved", sun15: "notSavedRecheck" });
    expect(textOf(out)).toContain("Ana quedó en sábado 7 nov.");
  });

  it("a 409 on the FIRST service of a group writes nothing of it and the run goes on", async () => {
    const w = serviceWorld();
    const changes = [
      ...(await checked(w, MOVE_ANA)),
      ...(await checked(w, [{ op: "clear", service: "sun1", seat: "Coro", member: "Dani" }])),
    ];
    w.beforeWrite.push(() => w.store.set("sun1", { ...w.store.get("sun1")!, _rev: "sun1-r5" }));
    // sun1 is earliest: it fails alone; then the group writes.
    const out = await save(w, changes);
    expect(statuses(out).sun1).toBe("notSavedRecheck");
    expect(statuses(out)).toMatchObject({ sun8: "saved", sun15: "saved" });
  });

  it("lock contention (a refusal with the `_rev` unchanged) is told to repeat, and the repeat writes it", async () => {
    const w = serviceWorld();
    const changes = await checked(w, [{ op: "place", service: "sun15", seat: "BGV", member: "Carla" }]);
    w.deps.editRole.mockResolvedValueOnce({ ok: false, status: 409, body: { error: "stale_revision" } });
    const out = await save(w, changes);
    expect(statuses(out)).toEqual({ sun15: "notSavedRepeat" });
    expect(sc(out).next).toBe("repeat_same_call");
    expect(statuses(await save(w, changes))).toEqual({ sun15: "saved" });
  });

  it("an ambiguous_target refusal is never told to repeat", async () => {
    const w = serviceWorld();
    const changes = await checked(w, [{ op: "place", service: "sun15", seat: "BGV", member: "Carla" }]);
    w.deps.editRole.mockResolvedValueOnce({ ok: false, status: 409, body: { error: "ambiguous_target" } });
    const out = await save(w, changes);
    expect(statuses(out)).toEqual({ sun15: "notSavedRecheck" });
    expect(sc(out).next).toBe("check_again");
  });

  it("a refusal whose re-read equals the target answers «ya estaba»", async () => {
    const w = serviceWorld();
    const changes = await checked(w, [{ op: "place", service: "sun15", seat: "BGV", member: "Carla" }]);
    w.deps.editRole.mockImplementationOnce(async () => {
      const row = w.store.get("sun15")!;
      w.store.set("sun15", { ...row, _rev: "sun15-r2", bgvs: [...row.bgvs, { _id: "m-carla", _key: "x", member_name: "m-carla" }] });
      return { ok: false, status: 409, body: { error: "stale_revision" } };
    });
    expect(statuses(await save(w, changes))).toEqual({ sun15: "already" });
  });

  it("an unknown outcome stops the run; the repeat finishes the group", async () => {
    const w = serviceWorld();
    const changes = await checked(w, MOVE_ANA);
    w.deps.editRole.mockImplementationOnce(async (id: string, request: never) => {
      // The write lands, but the answer is lost.
      const { applyPatch } = await import("./serviceEditorFixtures");
      w.store.set(id, applyPatch(w.store.get(id)!, request));
      throw new Error("socket hang up");
    });
    const first = await save(w, changes);
    expect(statuses(first)).toEqual({ sun8: "unknown", sun15: "pending" });
    expect(sc(first).next).toBe("repeat_same_call");
    const again = await save(w, changes);
    expect(statuses(again)).toEqual({ sun8: "already", sun15: "saved" });
  });

  it("a stalled write is «sin confirmar» at the hard stop and stops the run", async () => {
    vi.useFakeTimers();
    try {
      const w = serviceWorld();
      const changes = await checked(w, MOVE_ANA);
      w.deps.editRole.mockImplementationOnce(() => new Promise(() => {}));
      const pending = save(w, changes);
      await vi.advanceTimersByTimeAsync(46_000);
      const out = await pending;
      expect(statuses(out)).toEqual({ sun8: "unknown", sun15: "pending" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("nothing starts after the cut-off: «pendiente», and the repeat writes it", async () => {
    const w = serviceWorld();
    const changes = [
      ...(await checked(w, [{ op: "clear", service: "sun1", seat: "Coro", member: "Dani" }])),
      ...(await checked(w, [{ op: "place", service: "sun15", seat: "BGV", member: "Carla" }])),
    ];
    w.deps.editRole.mockImplementationOnce(async (id: string, request: never) => {
      const { applyPatch } = await import("./serviceEditorFixtures");
      w.store.set(id, applyPatch(w.store.get(id)!, request));
      w.clock.now += SAVE_START_CUTOFF_MS;
      return { ok: true, status: 200, body: { ok: true }, effects: { noticesQueued: true } };
    });
    const out = await save(w, changes);
    expect(statuses(out)).toEqual({ sun1: "saved", sun15: "pending" });
    expect(statuses(await save(w, changes))).toEqual({ sun1: "already", sun15: "saved" });
  });

  it("a failed inline notice upsert is «guardado, avisos sin confirmar» and the run goes on", async () => {
    const w = serviceWorld();
    const changes = await checked(w, MOVE_ANA);
    w.deps.editRole.mockImplementationOnce(async (id: string, request: never) => {
      const { applyPatch } = await import("./serviceEditorFixtures");
      w.store.set(id, applyPatch(w.store.get(id)!, request));
      return { ok: true, status: 200, body: { ok: true }, effects: { noticesQueued: false } };
    });
    const out = await save(w, changes);
    expect(statuses(out)).toEqual({ sun8: "saved", sun15: "saved" });
    expect(textOf(out)).toContain("avisos sin confirmar");
  });

  it("a group of seven services is refused before any write", async () => {
    const people = ["p0", "p1", "p2", "p3", "p4", "p5"].map((id) => ({ _id: id, member_name: `Persona ${id}`, alias: `Persona ${id}`, memberType: ["voz", "support"], ministries: ["worship"] }));
    const ids = ["s0", "s1", "s2", "s3", "s4", "t0", "t1"];
    const dates = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29", "2026-11-07", "2026-11-14"];
    const rows = ids.map((id, i) => storedRow(id, id.startsWith("t") ? "saturday_role" : "sunday_role", dates[i]!, { bgvs: i < 6 ? [people[i]!._id] : [] }));
    const w = serviceWorld({ rows, members: people as never, config: { ...serviceWorld().config.current, restrictions: [], conflicts: [] } });
    // Each person moves to the next service: every service loses one and gains one, all linked.
    const edits = ids.slice(0, -1).map((from, i) => ({ op: "move" as const, from: { service: from, seat: "BGV", member: `Persona p${i}` }, to: { service: ids[i + 1]!, seat: "BGV" } }));
    const out = await check(w, edits);
    expect(sc(out).groups, textOf(out)).toEqual([["s0", "t0", "s1", "t1", "s2", "s3", "s4"]]);
    expect(textOf(out)).toContain("se guardan en partes");
    const saved = await save(w, changesOf(out));
    expect(sc(saved)).toMatchObject({ detail: "group_too_big" });
    expect(w.deps.editRole).not.toHaveBeenCalled();
    // The text closes with one argument line per signed unit (6 + 1), and saving from those lines alone works.
    expect(textOf(out)).toContain("una vez por cada una de las 2 líneas «Argumentos para save_service_edits»");
    const argLines = textOf(out).split("\n").slice(-2);
    expect(argLines.every((l) => l.startsWith(SAVE_ARGS_PREFIX)), textOf(out)).toBe(true);
    const parts = argLines.map((l) => JSON.parse(l.slice(SAVE_ARGS_PREFIX.length)) as SaveServiceEditsArgs);
    expect(parts.map((p) => p.changes.length)).toEqual([6, 1]);
    expect(parts.flatMap((p) => p.changes)).toEqual(changesOf(out));
    for (const args of parts) {
      const part = await saveServiceEditsResult(args, PRINCIPAL, w.deps);
      expect(Object.values(statuses(part)).every((x) => x === "saved"), textOf(part)).toBe(true);
    }
  });

  it("a weekend setlist saved between check and save does not block it; a special's does («cambió»)", async () => {
    const w = serviceWorld();
    const weekend = await checked(w, [{ op: "place", service: "sun15", seat: "BGV", member: "Carla" }]);
    // A weekend setlist heartbeats the LOCK, never the role: the role's `_rev` is unchanged.
    expect(statuses(await save(w, weekend))).toEqual({ sun15: "saved" });
    const special = await checked(w, [{ op: "place", service: "esp18", seat: "Lead", member: "Bruno" }]);
    // A special's setlist lives on the role itself.
    w.store.set("esp18", { ...w.store.get("esp18")!, _rev: "esp18-r2", songs: [{}] });
    const out = await save(w, special);
    expect(sc(out)).toMatchObject({ detail: "changed" });
  });

  it("a non-approved service is refused (a lock issue makes it read-only)", async () => {
    const w = serviceWorld();
    const changes = await checked(w, [{ op: "place", service: "sun15", seat: "BGV", member: "Carla" }]);
    const { summaryFor } = await import("./serviceEditorFixtures");
    w.summary.current = (rows) => {
      const s = summaryFor(rows);
      return { ...s, targets: s.targets.map((t) => (t.canonicalIds[0] === "sun15" ? { ...t, lock: null, lockIssues: [{ kind: "missing_lock" } as never] } : t)) };
    };
    expect(sc(await save(w, changes))).toMatchObject({ detail: "not_editable" });
  });

  it("logs no id, name or token", async () => {
    const w = serviceWorld();
    const changes = await checked(w, MOVE_ANA);
    w.beforeWrite.push(null, () => w.store.delete("sun15"));
    await save(w, changes);
    const logged = JSON.stringify(errors.mock.calls);
    for (const x of ["m-ana", "sun8", "sun15", "Ana", w.tok("m-ana")]) expect(logged).not.toContain(x);
  });
});
