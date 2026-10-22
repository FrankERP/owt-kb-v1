// Admin parity phase 1, S3 (ADR-0066): `copy_instruments` — checked as `copy` in either check, then
// written through `/admin`'s own copy writer (`copyInstrumentsCommit.ts`) — over November 2026's
// stored services (`serviceEditorFixtures.ts`).
import { COPY_ARGS_PREFIX } from "@/app/components/admin/v3Copy";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { PRINCIPAL, textOf } from "./monthToolFixtures";
import { MONTH, NOVEMBER, serviceWorld, storedRow, type ServiceWorld } from "./serviceEditorFixtures";
import { MEMBERS, RULES, rules } from "../../monthProposals/__tests__/editorFixtures";
import type { EditorMember } from "../../monthProposals/revise";
import { COPY_INSTRUMENTS_INPUT, checkServiceEditsResult, copyInstrumentsResult, type CopyInstrumentsArgs } from "../serviceEditor";

const sc = (out: CallToolResult) => out.structuredContent as Record<string, unknown>;
const copyOf = (out: CallToolResult) => sc(out).copy as CopyInstrumentsArgs | null;
const instrumentsOf = (w: ServiceWorld, id: string) => w.store.get(id)!.instruments.map((i) => [i.instrument, i.person._id]);

/** A second bass player, who may not serve with Ana. */
const LUIS = { _id: "m-luis", member_name: "Luis Paz", alias: "Luis", memberType: ["instrumento"], instruments: ["Bass"] } as EditorMember;
const LUIS_WORLD = { members: [...MEMBERS, LUIS], config: rules({ restrictions: RULES.restrictions, conflicts: [...RULES.conflicts, { id: "c-ana-luis", personA: "Ana", personB: "Luis", pattern: "*.*" }] }) };
/** November, plus an October Sunday whose Bass is Luis. */
const withOctober = () => [...NOVEMBER(), storedRow("oct25", "sunday_role", "2026-10-25", { leads: ["m-bruno"], instruments: [["Bass", "m-luis"]] })];

const checkCopy = (w: ServiceWorld, from: string, to: string) => checkServiceEditsResult({ month: MONTH, edits: [], copy: { from, to } }, PRINCIPAL, w.deps);
const copy = (w: ServiceWorld, args: CopyInstrumentsArgs) => copyInstrumentsResult(args, PRINCIPAL, w.deps);

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("check_service_edits with copy", () => {
  it("names every instrument seat of the result, by name, and writes nothing", async () => {
    const w = serviceWorld();
    const out = await checkCopy(w, "2026-11-01", "2026-11-08");
    expect(out.isError).toBeFalsy();
    expect(copyOf(out)).toEqual({
      month: MONTH,
      from: "sun1",
      to: "sun8",
      lines: ["Copiar los instrumentos de domingo 1 nov a domingo 8 nov (reemplaza los que tiene domingo 8 nov):", "domingo 8 nov · Bass: Tomás"],
    });
    // The model sees only the text: the copy's arguments are its last line, the same as `copy`.
    const last = textOf(out).split("\n").at(-1)!;
    expect(last.startsWith(COPY_ARGS_PREFIX)).toBe(true);
    expect(JSON.parse(last.slice(COPY_ARGS_PREFIX.length))).toEqual(copyOf(out));
    expect(w.deps.copyInstruments).not.toHaveBeenCalled();
    expect(w.deps.editRole).not.toHaveBeenCalled();
  });

  it("a copy is checked alone, never with other edits", async () => {
    const w = serviceWorld();
    const out = await checkServiceEditsResult(
      { month: MONTH, edits: [{ op: "place", service: "sun15", seat: "BGV", member: "Carla" }], copy: { from: "sun1", to: "sun8" } },
      PRINCIPAL,
      w.deps,
    );
    expect(sc(out)).toMatchObject({ refused: true, detail: "copy_alone" });
  });

  it("refuses a copy onto itself, from nowhere, and an empty call", async () => {
    const w = serviceWorld();
    expect(sc(await checkCopy(w, "sun1", "sun1"))).toMatchObject({ refused: true, detail: "copy" });
    expect(sc(await checkCopy(w, "nope", "sun8"))).toMatchObject({ refused: true, detail: "copy_from" });
    expect(sc(await checkServiceEditsResult({ month: MONTH, edits: [] }, PRINCIPAL, w.deps))).toMatchObject({ refused: true, detail: "empty" });
  });

  it("the same instruments already there: nothing to copy", async () => {
    const w = serviceWorld({ rows: [...NOVEMBER().filter((r) => r._id !== "sun8"), storedRow("sun8", "sunday_role", "2026-11-08", { leads: ["m-bruno"], bgvs: ["m-ana"], instruments: [["Bass", "m-tomas"]] })] });
    const out = await checkCopy(w, "sun1", "sun8");
    expect(copyOf(out)).toBeNull();
    expect(textOf(out)).toContain("ya tiene esos mismos instrumentos");
  });

  it("a row the copy empties is named; a source from another month is allowed", async () => {
    const w = serviceWorld({ ...LUIS_WORLD, rows: [...withOctober(), storedRow("oct18", "sunday_role", "2026-10-18")] });
    // October 18 has no instruments; sun1's Bass (Tomás) is emptied.
    const emptied = await checkCopy(w, "oct18", "sun1");
    expect(copyOf(emptied)!.lines).toEqual([
      "Copiar los instrumentos de domingo 18 oct a domingo 1 nov (reemplaza los que tiene domingo 1 nov):",
      "domingo 1 nov · Bass: queda vacío",
      "domingo 1 nov queda sin instrumentos.",
    ]);
    // October 25's Bass is Luis; sun15 has no Ana, so the pair rule does not apply.
    const out = await checkCopy(w, "oct25", "sun15");
    expect(copyOf(out)!.lines).toEqual([
      "Copiar los instrumentos de domingo 25 oct a domingo 15 nov (reemplaza los que tiene domingo 15 nov):",
      "domingo 15 nov · Bass: Luis",
    ]);
  });

  it("someone without the instrument's Tipo is refused, as in the grid (the copy writer would not check it)", async () => {
    const w = serviceWorld({ rows: [...NOVEMBER(), storedRow("oct25", "sunday_role", "2026-10-25", { instruments: [["Bass", "m-dani"]] })] });
    const out = await checkCopy(w, "oct25", "sun15");
    expect(copyOf(out)).toBeNull();
    expect(textOf(out)).toContain("Bass");
  });
});

describe("copy_instruments", () => {
  it("writes through the copy writer with both revisions, notices inline; a repeat answers «ya estaba»", async () => {
    const w = serviceWorld();
    const args = copyOf(await checkCopy(w, "sun1", "sun8"))!;
    const out = await copy(w, args);
    expect(out.isError).toBeFalsy();
    expect(sc(out)).toMatchObject({ ok: true, status: "saved" });
    expect(w.deps.copyInstruments).toHaveBeenCalledWith({ source: { id: "sun1", rev: "sun1-r1" }, target: { id: "sun8", rev: "sun8-r1" } }, { notices: "inline" });
    expect(w.log).toEqual(["copy:sun8", "notices:sun8"]);
    expect(instrumentsOf(w, "sun8")).toEqual([["Bass", "m-tomas"]]);
    const again = await copy(w, args);
    expect(sc(again)).toMatchObject({ ok: true, status: "already" });
    expect(w.deps.copyInstruments).toHaveBeenCalledTimes(1);
  });

  it("lines that are not the server's rendering refuse it (F4)", async () => {
    const w = serviceWorld();
    const args = copyOf(await checkCopy(w, "sun1", "sun8"))!;
    const out = await copy(w, { ...args, lines: [args.lines[0]!, "domingo 8 nov · Bass: Carla"] });
    expect(sc(out)).toMatchObject({ refused: true, detail: "not_the_checked" });
    expect(w.deps.copyInstruments).not.toHaveBeenCalled();
  });

  it("a source whose instruments changed since the check is refused: the prompt no longer says who is seated", async () => {
    const w = serviceWorld({ members: [...MEMBERS, LUIS] });
    const args = copyOf(await checkCopy(w, "sun1", "sun8"))!;
    const sun1 = w.store.get("sun1")!;
    w.store.set("sun1", { ...sun1, _rev: "sun1-r2", instruments: [{ ...sun1.instruments[0]!, person: { ...sun1.instruments[0]!.person, _id: "m-luis" } }] });
    const out = await copy(w, args);
    expect(sc(out)).toMatchObject({ refused: true, detail: "not_the_checked" });
    expect(w.deps.copyInstruments).not.toHaveBeenCalled();
  });

  it("instruments carry no per-seat rule: a copy never needs forcing, and a service's old finding stays a warning", async () => {
    const w = serviceWorld({ ...LUIS_WORLD, rows: withOctober() });
    // Luis onto sun8's Bass, where Ana serves BGV: the Ana/Luis pair binds voice seats only.
    const out = await checkCopy(w, "oct25", "sun8");
    const args = copyOf(out)!;
    expect(args.lines).toEqual(["Copiar los instrumentos de domingo 25 oct a domingo 8 nov (reemplaza los que tiene domingo 8 nov):", "domingo 8 nov · Bass: Luis"]);
    // Bruno's week-2 exclusion on sun8's Lead predates the copy: a warning, not in the prompt.
    expect(textOf(out)).toContain("ya estaba así antes de este cambio");
    expect(sc(await copy(w, args))).toMatchObject({ ok: true, status: "saved" });
  });

  it("the schema takes no waivers and no force", () => {
    expect(COPY_INSTRUMENTS_INPUT.safeParse({ month: MONTH, from: "a", to: "b", lines: ["x"], waivers: [] }).success).toBe(false);
  });

  it("a destination edited meanwhile (409, `_rev` moved) is told to check again", async () => {
    const w = serviceWorld();
    const args = copyOf(await checkCopy(w, "sun1", "sun8"))!;
    w.beforeWrite.push((id) => {
      const row = w.store.get(id)!;
      w.store.set(id, { ...row, _rev: "sun8-r9", bgvs: [] });
    });
    const out = await copy(w, args);
    expect(sc(out)).toMatchObject({ ok: false, status: "not_saved", next: "check_again" });
  });

  it("lock contention (409 with both revisions unchanged) is told to repeat", async () => {
    const w = serviceWorld();
    const args = copyOf(await checkCopy(w, "sun1", "sun8"))!;
    w.deps.copyInstruments.mockResolvedValueOnce({ ok: false, status: 409, body: { error: "stale_revision" } });
    const out = await copy(w, args);
    expect(sc(out)).toMatchObject({ ok: false, status: "not_saved", next: "repeat_same_call" });
    expect(sc(await copy(w, args))).toMatchObject({ ok: true, status: "saved" });
  });

  it("an unknown outcome says «sin confirmar»; the repeat after it landed answers «ya estaba»", async () => {
    const w = serviceWorld();
    const args = copyOf(await checkCopy(w, "sun1", "sun8"))!;
    const real = w.deps.copyInstruments.getMockImplementation() as (...a: unknown[]) => Promise<unknown>;
    w.deps.copyInstruments.mockImplementationOnce(async (...a: unknown[]) => {
      await real(...a);
      throw new Error("socket hang up");
    });
    const out = await copy(w, args);
    expect(sc(out)).toMatchObject({ ok: false, status: "unknown", next: "repeat_same_call" });
    expect(sc(await copy(w, args))).toMatchObject({ ok: true, status: "already" });
  });

  it("a failed inline notice upsert is «guardado, avisos sin confirmar»", async () => {
    const w = serviceWorld();
    const args = copyOf(await checkCopy(w, "sun1", "sun8"))!;
    w.deps.copyInstruments.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true }, effects: { noticesQueued: false } });
    const out = await copy(w, args);
    expect(sc(out)).toMatchObject({ ok: true, status: "saved_notices_unknown" });
    expect(textOf(out)).toContain("avisos");
  });

  it("logs no id, name or token", async () => {
    const w = serviceWorld();
    const args = copyOf(await checkCopy(w, "sun1", "sun8"))!;
    w.deps.copyInstruments.mockRejectedValueOnce(new Error("sun8 m-tomas"));
    await copy(w, args);
    const logged = errors.mock.calls.flat().map(String).join("\n");
    for (const leak of ["sun8", "sun1", "m-tomas", "Tomás"]) expect(logged).not.toContain(leak);
  });
});
