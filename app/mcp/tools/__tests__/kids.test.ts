// Admin parity phase 3 (S4): the Oasis Kids tools over fakes of the planner's own code — the
// writers (`kidsCommit.ts`, whose parity with the routes is `kidsRoutes.test.ts` and
// `kidsAvailabilityConflict.test.ts`), the month read and the proposal. What is proved here is the
// tool's own part: names to ids, what it refuses before the first write, how it words the answer.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loadKidsRoster: vi.fn(),
  readKidsMonthSchedules: vi.fn(),
  proposeKidsMonth: vi.fn(),
  saveKidsSunday: vi.fn(),
  createKidsPair: vi.fn(),
  patchKidsPair: vi.fn(),
  setKidsAvailability: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));
vi.mock("@/app/mcp/reads/kidsRoster", () => ({ loadKidsRoster: h.loadKidsRoster }));
vi.mock("@/app/utils/kidsScheduleReads", () => ({ readKidsMonthSchedules: h.readKidsMonthSchedules }));
vi.mock("@/app/utils/kidsMonthPlan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/utils/kidsMonthPlan")>()),
  proposeKidsMonth: h.proposeKidsMonth,
}));
vi.mock("@/app/utils/kidsCommit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/utils/kidsCommit")>()),
  saveKidsSunday: h.saveKidsSunday,
  createKidsPair: h.createKidsPair,
  patchKidsPair: h.patchKidsPair,
  setKidsAvailability: h.setKidsAvailability,
}));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { KIDS_ERROR } from "@/app/utils/kidsCommit";
import { PRINCIPAL, textOf } from "./monthToolFixtures";
import {
  SAVE_KIDS_PAIR_DESCRIPTION,
  SAVE_KIDS_SUNDAYS_DESCRIPTION,
  SAVE_KIDS_SUNDAYS_INPUT,
  SET_KIDS_ABSENCES_DESCRIPTION,
  generateKidsMonthResult,
  getKidsMonthResult,
  saveKidsPairResult,
  saveKidsSundaysResult,
  setKidsAbsencesResult,
} from "../kids";

const sc = (out: CallToolResult) => out.structuredContent as Record<string, unknown>;

const volunteer = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  _id: id,
  _rev: `rev-${id}`,
  member_name: name,
  alias: null,
  unavailableDates: [],
  unavailabilityNotes: [],
  ...over,
});

const ROSTER = {
  pairs: [
    { id: "p-chi", name: "Ana y Luis", room: "chiquitos", active: true, memberIds: ["v-ana", "v-luis"] },
    { id: "p-med", name: "Mara y Toño", room: "medianos", active: true, memberIds: ["v-mara", "v-tono"] },
    { id: "p-gra", name: "Sofía y Beto", room: "grandes", active: true, memberIds: ["v-sofia", "v-beto"] },
    { id: "p-old", name: "Retirados", room: "chiquitos", active: false, memberIds: ["v-ana", "v-beto"] },
  ],
  volunteers: [
    volunteer("v-ana", "Ana", {
      unavailableDates: ["2026-11-08", "2026-12-06"],
      unavailabilityNotes: [{ date: "2026-11-08", note: "viaje" }],
    }),
    volunteer("v-luis", "Luis"),
    volunteer("v-mara", "Mara"),
    volunteer("v-tono", "Toño"),
    volunteer("v-sofia", "Sofía"),
    volunteer("v-beto", "Beto"),
  ],
};

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.loadKidsRoster.mockResolvedValue(ROSTER);
  h.readKidsMonthSchedules.mockResolvedValue([]);
  h.saveKidsSunday.mockImplementation(async (raw: { date: string; seats: Record<string, string>; published?: boolean }) => ({
    ok: true,
    status: 200,
    body: {},
    effects: { date: raw.date, seats: raw.seats, ...(raw.published !== undefined ? { published: raw.published } : {}) },
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("get_kids_month", () => {
  it("lists every Sunday of the month, names each seat's pair, marks drafts, and keeps only that month's absences", async () => {
    h.readKidsMonthSchedules.mockResolvedValue([
      { date: "2026-11-08", seats: { chiquitos: "p-chi", grandes: "p-gra" }, published: false },
    ]);
    const out = await getKidsMonthResult({ month: "2026-11" });
    expect(out.isError).toBeFalsy();
    const body = sc(out);
    const sundays = body.sundays as { date: string; saved: boolean; published: boolean; seats: Record<string, string | null> }[];
    expect(sundays.map((s) => s.date)).toEqual(["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]);
    expect(sundays[1]).toEqual({
      date: "2026-11-08",
      saved: true,
      published: false,
      seats: { ensenanza: null, chiquitos: "Ana y Luis", medianos: null, grandes: "Sofía y Beto" },
    });
    expect(sundays[0].saved).toBe(false);
    expect(body.absences).toEqual([{ name: "Ana", dates: [{ date: "2026-11-08", note: "viaje" }] }]);
    expect((body.pairs as { name: string; volunteers: string[]; active: boolean }[])[3]).toMatchObject({
      name: "Retirados",
      active: false,
      volunteers: ["Ana", "Beto"],
    });
    expect(h.readKidsMonthSchedules).toHaveBeenCalledWith("2026-11");
  });
});

describe("generate_kids_month", () => {
  it("names the proposal and passes the seed and the excluded fingerprints through; it saves nothing", async () => {
    h.proposeKidsMonth.mockResolvedValue({
      proposal: [{ date: "2026-11-01", seats: { ensenanza: "p-med", chiquitos: "p-chi" } }],
      warnings: [{ date: "2026-11-01", seat: "chiquitos", pairId: "p-chi", memberId: "v-luis", kind: "worship-overlap" }],
      diagnostics: [{ date: "2026-11-01", seat: "grandes", kind: "unfillable", reason: "Nadie disponible" }],
      seed: 3,
      fingerprint: "fp-3",
      exhausted: false,
    });
    const out = await generateKidsMonthResult({ month: "2026-11", seed: 3, exclude: ["fp-2"] });
    expect(h.proposeKidsMonth).toHaveBeenCalledWith("2026-11", 3, new Set(["fp-2"]));
    const body = sc(out);
    expect((body.proposal as { seats: Record<string, string | null> }[])[0].seats).toEqual({
      ensenanza: "Mara y Toño",
      chiquitos: "Ana y Luis",
      medianos: null,
      grandes: null,
    });
    expect(body.warnings).toEqual([
      { date: "2026-11-01", seat: "RG Chiquitos", pair: "Ana y Luis", volunteer: "Luis", what: "también sirve en alabanza ese día" },
    ]);
    expect(body.unfillable).toEqual([{ date: "2026-11-01", seat: "RG Grandes", reason: "Nadie disponible" }]);
    expect(body).toMatchObject({ seed: 3, fingerprint: "fp-3", exhausted: false, saved: false });
    expect(h.saveKidsSunday).not.toHaveBeenCalled();
  });

  it("asks for the fairest month when no seed is given", async () => {
    h.proposeKidsMonth.mockResolvedValue({ proposal: [], warnings: [], diagnostics: [], seed: 0, fingerprint: "f", exhausted: false });
    await generateKidsMonthResult({ month: "2026-11" });
    expect(h.proposeKidsMonth).toHaveBeenCalledWith("2026-11", 0, new Set());
  });
});

describe("save_kids_sundays", () => {
  it("refuses with no principal before any read or write", async () => {
    const out = await saveKidsSundaysResult({ sundays: [{ date: "2026-11-01", seats: {} }] }, null);
    expect(out.isError).toBe(true);
    expect(sc(out)).toMatchObject({ refused: true, code: "forbidden", detail: "no_principal" });
    expect(h.loadKidsRoster).not.toHaveBeenCalled();
    expect(h.saveKidsSunday).not.toHaveBeenCalled();
  });

  it("resolves pair names (no accents, no case) to ids and sends the WHOLE Sunday, an omitted seat absent so the writer clears it", async () => {
    const out = await saveKidsSundaysResult(
      { sundays: [{ date: "2026-11-01", seats: { ensenanza: "mara y tono", chiquitos: "Ana y Luis", grandes: null } }] },
      PRINCIPAL,
    );
    expect(out.isError).toBeFalsy();
    expect(h.saveKidsSunday).toHaveBeenCalledTimes(1);
    expect(h.saveKidsSunday).toHaveBeenCalledWith({ date: "2026-11-01", seats: { ensenanza: "p-med", chiquitos: "p-chi" } });
    expect(textOf(out)).toContain("Enseñanza: Mara y Toño, RG Chiquitos: Ana y Luis, RG Medianos: vacío, RG Grandes: vacío");
    expect(textOf(out)).toContain("Kids no avisa a nadie");
  });

  it("passes published only when it was given", async () => {
    await saveKidsSundaysResult(
      { sundays: [{ date: "2026-11-01", seats: {} }, { date: "2026-11-08", seats: {}, published: true }] },
      PRINCIPAL,
    );
    expect(h.saveKidsSunday.mock.calls[0][0]).not.toHaveProperty("published");
    expect(h.saveKidsSunday.mock.calls[1][0]).toMatchObject({ published: true });
  });

  it.each([
    ["a date that is not a Sunday", [{ date: "2026-11-02", seats: {} }], "no es domingo"],
    ["a day that does not exist", [{ date: "2026-02-30", seats: {} }], "no es domingo"],
    ["the same Sunday twice", [{ date: "2026-11-01", seats: {} }, { date: "2026-11-01", seats: {} }], "dos veces"],
    ["an unknown pair (listing the pairs)", [{ date: "2026-11-01", seats: { ensenanza: "Nadie" } }], "Parejas: Ana y Luis (Chiquitos)"],
    ["a retired pair", [{ date: "2026-11-01", seats: { ensenanza: "Retirados" } }], "retirada"],
    ["a pair outside its room", [{ date: "2026-11-01", seats: { grandes: "Ana y Luis" } }], "no puede cubrir RG Grandes"],
    ["one pair in two seats", [{ date: "2026-11-01", seats: { ensenanza: "Ana y Luis", chiquitos: "Ana y Luis" } }], "dos lugares"],
  ])("refuses %s before ANY Sunday is written", async (_label, sundays, words) => {
    const out = await saveKidsSundaysResult(
      { sundays: [{ date: "2026-11-15", seats: { chiquitos: "Ana y Luis" } }, ...sundays] as never },
      PRINCIPAL,
    );
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(words);
    expect(textOf(out)).toContain("No se escribió nada.");
    expect(h.saveKidsSunday).not.toHaveBeenCalled();
  });

  it("refuses an ambiguous pair name with its candidates' ids", async () => {
    h.loadKidsRoster.mockResolvedValue({
      ...ROSTER,
      pairs: [...ROSTER.pairs, { id: "p-dup", name: "Ana y Luis", room: "medianos", active: true, memberIds: [] }],
    });
    const out = await saveKidsSundaysResult({ sundays: [{ date: "2026-11-01", seats: { ensenanza: "ana y luis" } }] }, PRINCIPAL);
    expect(textOf(out)).toContain("Hay 2 parejas");
    expect(textOf(out)).toContain("p-dup (Medianos)");
    expect(h.saveKidsSunday).not.toHaveBeenCalled();
  });

  it("reports which Sundays were saved when a later one is refused by the writer, without «No se escribió nada.»", async () => {
    h.saveKidsSunday
      .mockImplementationOnce(async (raw: { date: string; seats: Record<string, string> }) => ({
        ok: true,
        status: 200,
        body: {},
        effects: { date: raw.date, seats: raw.seats },
      }))
      .mockResolvedValueOnce({ ok: false, status: 400, body: { error: KIDS_ERROR.unknownPair } });
    const out = await saveKidsSundaysResult(
      { sundays: [{ date: "2026-11-01", seats: {} }, { date: "2026-11-08", seats: {} }, { date: "2026-11-15", seats: {} }] },
      PRINCIPAL,
    );
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("Se guardaron 2026-11-01. 2026-11-08 NO se guardó");
    expect(textOf(out)).not.toContain("No se escribió nada.");
    expect(sc(out)).toMatchObject({ code: "partial", saved: ["2026-11-01"], failed: "2026-11-08" });
    expect(h.saveKidsSunday).toHaveBeenCalledTimes(2);
  });

  it("allows at most six Sundays", () => {
    const sunday = { date: "2026-11-01", seats: {} };
    expect(SAVE_KIDS_SUNDAYS_INPUT.safeParse({ sundays: Array(7).fill(sunday) }).success).toBe(false);
  });
});

describe("save_kids_pair", () => {
  it("creates a pair from volunteer names, active", async () => {
    h.createKidsPair.mockResolvedValue({ ok: true, status: 201, body: {}, effects: { id: "p-new" } });
    const out = await saveKidsPairResult({ name: "Mara y Beto", room: "grandes", members: ["mara", "Beto"] }, PRINCIPAL);
    expect(h.createKidsPair).toHaveBeenCalledWith({ name: "Mara y Beto", room: "grandes", memberIds: ["v-mara", "v-beto"] });
    expect(textOf(out)).toContain("Pareja «Mara y Beto» creada en Grandes con Mara y Beto; está activa.");
    expect(sc(out)).toMatchObject({ pairId: "p-new", created: true });
  });

  it.each([
    ["no room", { name: "X", members: ["Ana", "Luis"] }, "Para crear una pareja"],
    ["a name already used", { name: "ana y luis", room: "chiquitos", members: ["Ana", "Luis"] }, "Ya hay una pareja"],
    ["the same volunteer twice", { name: "X", room: "chiquitos", members: ["Ana", "v-ana"] }, "dos voluntarios distintos"],
    ["an unknown volunteer", { name: "X", room: "chiquitos", members: ["Ana", "Zoe"] }, "No hay un voluntario de Kids llamado «Zoe»"],
  ])("refuses a create with %s", async (_label, args, words) => {
    const out = await saveKidsPairResult(args as never, PRINCIPAL);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(words);
    expect(h.createKidsPair).not.toHaveBeenCalled();
  });

  it("edits only the fields given, by pair name; retiring is active: false", async () => {
    h.patchKidsPair.mockResolvedValue({ ok: true, status: 200, body: {}, effects: { id: "p-chi" } });
    const out = await saveKidsPairResult({ pair: "Ana y Luis", active: false }, PRINCIPAL);
    expect(h.patchKidsPair).toHaveBeenCalledWith("p-chi", { active: false });
    expect(textOf(out)).toContain("retirada de la rotación");
  });

  it("words the writer's refusal", async () => {
    h.patchKidsPair.mockResolvedValue({ ok: false, status: 404, body: { error: KIDS_ERROR.notAPair } });
    const out = await saveKidsPairResult({ pair: "p-chi", room: "medianos" }, PRINCIPAL);
    expect(textOf(out)).toContain("Esa pareja ya no existe");
    expect(sc(out)).toMatchObject({ refused: true, code: "not_found" });
  });

  it("refuses an edit that changes nothing", async () => {
    const out = await saveKidsPairResult({ pair: "Ana y Luis" }, PRINCIPAL);
    expect(textOf(out)).toContain("No pediste ningún cambio");
    expect(h.patchKidsPair).not.toHaveBeenCalled();
  });
});

describe("set_kids_absences", () => {
  it("adds and removes by parts on the revision it read, keeping every date nobody mentioned and its note", async () => {
    h.setKidsAvailability.mockResolvedValue({
      ok: true,
      status: 200,
      body: {},
      effects: { rev: "rev-2", unavailableDates: ["2026-11-15", "2026-12-06"], unavailabilityNotes: [] },
    });
    const out = await setKidsAbsencesResult(
      { member: "ana", add: [{ date: "2026-11-15", note: " boda " }], remove: ["2026-11-08", "2026-11-22"] },
      PRINCIPAL,
    );
    expect(h.setKidsAvailability).toHaveBeenCalledWith("v-ana", {
      _rev: "rev-v-ana",
      unavailableDates: ["2026-11-15", "2026-12-06"],
      unavailabilityNotes: [{ date: "2026-11-15", note: "boda" }],
    });
    const text = textOf(out);
    expect(text).toContain("No puede: 2026-11-15.");
    expect(text).toContain("Ya puede: 2026-11-08.");
    expect(text).toContain("2026-11-22 no estaba marcada.");
    expect(text).toContain("misma lista que el voluntario ve en su perfil");
  });

  it("answers a lost race as «cambió mientras tanto»", async () => {
    h.setKidsAvailability.mockResolvedValue({ ok: false, status: 409, body: { error: KIDS_ERROR.staleRevision } });
    const out = await setKidsAbsencesResult({ member: "Luis", add: [{ date: "2026-11-15" }] }, PRINCIPAL);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("cambiaron mientras tanto");
    expect(sc(out)).toMatchObject({ code: "stale_revision" });
  });

  it.each([
    ["nothing to change", { member: "Luis" }, "al menos una fecha"],
    ["a date in both lists", { member: "Luis", add: [{ date: "2026-11-15" }], remove: ["2026-11-15"] }, "en add y en remove"],
    ["a day that does not exist", { member: "Luis", add: [{ date: "2026-02-30" }] }, "no es una fecha válida"],
  ])("refuses %s before reading", async (_label, args, words) => {
    const out = await setKidsAbsencesResult(args as never, PRINCIPAL);
    expect(textOf(out)).toContain(words);
    expect(h.loadKidsRoster).not.toHaveBeenCalled();
  });
});

describe("descriptions", () => {
  it("every write says to show the change and wait for the person's word, and that Kids notifies nobody", () => {
    for (const d of [SAVE_KIDS_SUNDAYS_DESCRIPTION, SAVE_KIDS_PAIR_DESCRIPTION, SET_KIDS_ABSENCES_DESCRIPTION]) {
      expect(d).toContain("espera a que diga que sí en esta conversación");
      expect(d).toContain("Kids no avisa a nadie");
      expect(d).toContain("get_kids_month");
    }
    expect(SAVE_KIDS_SUNDAYS_DESCRIPTION).toContain("queda VACÍO");
  });
});
