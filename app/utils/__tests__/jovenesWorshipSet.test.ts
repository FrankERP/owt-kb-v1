import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";

vi.mock("server-only", () => ({}));
const fetch = vi.hoisted(() => vi.fn());
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch } }));

import { SATURDAY_SETS_QUERY, readSaturdaySets, saturdaySetsFrom } from "../jovenesWorshipSet";

type Doc = Record<string, unknown>;
const song = (id: string, title: string): Doc => ({ _id: id, _type: "post", title, author: "Autor", body: "letra privada" });
const item = (id: string, key: string) => ({ _key: id, song: { _type: "reference", _ref: id }, play_key: key, medley_tag: "m1" });

async function run(dataset: Doc[], dates: string[]) {
  const value = await evaluate(parse(SATURDAY_SETS_QUERY), { dataset, params: { dates } });
  return (await value.get()) as Parameters<typeof saturdaySetsFrom>[0];
}

const SAT = "2026-11-21";
const SONGS = [song("p1", "Grande y fuerte"), song("p2", "Tu fidelidad")];
const SET: Doc = { _id: "set1", _type: "saturdarSongs", week: SAT, songs: [item("p1", "D"), item("p2", "G")], team_notes: "nota del equipo" };
const ROLE: Doc = { _id: "role1", _type: "saturday_role", week: SAT, published: true, Lead: [{ _ref: "m1" }] };

describe("the Saturday setlist a Jóvenes meeting shows", () => {
  it("returns titles and keys only, in order", async () => {
    const sets = saturdaySetsFrom(await run([...SONGS, SET, ROLE], [SAT]), [SAT]);
    expect(sets.get(SAT)).toEqual([
      { title: "Grande y fuerte", key: "D" },
      { title: "Tu fidelidad", key: "G" },
    ]);
  });

  it("the query itself projects nothing but week, title and key", async () => {
    const raw = await run([...SONGS, SET, ROLE], [SAT]);
    expect(raw).toEqual({
      roles: [{ week: SAT }],
      sets: [{ week: SAT, songs: [{ title: "Grande y fuerte", key: "D" }, { title: "Tu fidelidad", key: "G" }] }],
    });
  });

  it("a draft service hides its setlist", async () => {
    const sets = saturdaySetsFrom(await run([...SONGS, SET, { ...ROLE, published: false }], [SAT]), [SAT]);
    expect(sets.has(SAT)).toBe(false);
  });

  it("a role with no `published` field is published (worship's absent = visible)", async () => {
    const { published: _p, ...legacy } = ROLE;
    expect(saturdaySetsFrom(await run([...SONGS, SET, legacy], [SAT]), [SAT]).has(SAT)).toBe(true);
  });

  it("no service that day, no setlist", async () => {
    expect(saturdaySetsFrom(await run([...SONGS, SET], [SAT]), [SAT]).size).toBe(0);
  });

  it("an ambiguous duplicate of the role or of the setlist shows nothing", async () => {
    const twoRoles = await run([...SONGS, SET, ROLE, { ...ROLE, _id: "role2" }], [SAT]);
    expect(saturdaySetsFrom(twoRoles, [SAT]).size).toBe(0);
    const twoSets = await run([...SONGS, SET, { ...SET, _id: "set2" }, ROLE], [SAT]);
    expect(saturdaySetsFrom(twoSets, [SAT]).size).toBe(0);
  });

  it("only the dates asked for come back", async () => {
    const other: Doc[] = [
      { ...SET, _id: "set9", week: "2026-11-28" },
      { ...ROLE, _id: "role9", week: "2026-11-28" },
    ];
    const sets = saturdaySetsFrom(await run([...SONGS, SET, ROLE, ...other], [SAT]), [SAT]);
    expect([...sets.keys()]).toEqual([SAT]);
  });

  it("a song whose reference is gone is left out; an empty setlist is absent", async () => {
    const dangling = { ...SET, songs: [item("gone", "A"), item("p1", "")] };
    expect(saturdaySetsFrom(await run([...SONGS, dangling, ROLE], [SAT]), [SAT]).get(SAT)).toEqual([{ title: "Grande y fuerte", key: null }]);
    expect(saturdaySetsFrom(await run([...SONGS, { ...SET, songs: [] }, ROLE], [SAT]), [SAT]).size).toBe(0);
  });
});

describe("readSaturdaySets", () => {
  // Braces on purpose: a function RETURNED from `beforeEach` is run as the test's cleanup.
  beforeEach(() => {
    fetch.mockReset();
  });

  it("asks for nothing when there are no valid dates", async () => {
    expect((await readSaturdaySets([])).size).toBe(0);
    expect((await readSaturdaySets(["mañana", ""])).size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads once, with the distinct dates as a parameter", async () => {
    fetch.mockResolvedValue({ roles: [{ week: SAT }], sets: [{ week: SAT, songs: [{ title: "A", key: "E" }] }] });
    const sets = await readSaturdaySets([SAT, SAT]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toEqual({ dates: [SAT] });
    expect(sets.get(SAT)).toEqual([{ title: "A", key: "E" }]);
  });

  it("a failed read is «no setlists», never an error page", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetch.mockImplementation(async () => {
      throw new Error("boom");
    });
    expect((await readSaturdaySets([SAT])).size).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
