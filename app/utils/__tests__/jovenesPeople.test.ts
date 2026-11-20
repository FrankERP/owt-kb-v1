// The roster read, and its opt-in second read of the days a pastor marked (ADR-0090; plan
// 2026-11-17 §3 R1, R3). Bare, it must stay exactly what the member pages always got: no
// availability token in the query, no `away` on anybody.

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetch = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (q: string, p?: Record<string, unknown>) => fetch(q, p) },
}));

import { readJovenesPeople } from "../jovenesPeople";

const member = (id: string, name: string, groups: string[]) => ({
  _id: id,
  role: "member",
  ministries: ["jovenes"],
  ministryRoles: [{ ministry: "jovenes", level: "member", groups }],
  name,
});
const ROWS = [member("ana", "Ana", ["otro-nivel"]), member("beto", "Beto", ["invencibles"]), member("caro", "Caro", ["otro-nivel", "invencibles"])];
const access = (level: string, groups: string[], leaderOf: string[] = []) => ({
  active: true,
  role: "member",
  ministries: ["jovenes" as const],
  managesMinistries: [],
  ministryRoles: [{ ministry: "jovenes" as const, level, groups, leaderOf }] as never,
});
const ADMIN = access("admin", []);
const LEADER = access("leader", ["otro-nivel", "invencibles"], ["otro-nivel"]);
const TODAY = "2026-11-17";

beforeEach(() => {
  fetch.mockReset();
  fetch.mockImplementation(async (q: string) => (q.includes("$ids") ? [] : ROWS));
});

describe("readJovenesPeople()", () => {
  it("bare: ONE query that names no availability field, and nobody carries `away`", async () => {
    const people = await readJovenesPeople();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).not.toMatch(/unavailab/i);
    expect(people).toEqual([
      { id: "ana", name: "Ana", groups: ["otro-nivel"] },
      { id: "beto", name: "Beto", groups: ["invencibles"] },
      { id: "caro", name: "Caro", groups: ["otro-nivel", "invencibles"] },
    ]);
    for (const p of people) expect(p).not.toHaveProperty("away");
  });
});

describe("readJovenesPeople({ awayFor })", () => {
  it("runs the SAME people query first, so the list is identical with or without the option", async () => {
    const bare = await readJovenesPeople();
    const bareQuery = fetch.mock.calls[0][0];
    fetch.mockClear();
    const withDays = await readJovenesPeople({ awayFor: ADMIN, today: TODAY });
    expect(fetch.mock.calls[0][0]).toBe(bareQuery);
    expect(withDays).toEqual(bare);
  });

  it("asks for dates only, of the visible ids only, from today to a year out", async () => {
    await readJovenesPeople({ awayFor: LEADER, today: TODAY });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [query, params] = fetch.mock.calls[1] as [string, Record<string, unknown>];
    expect(query).toContain("unavailableDates[@ >= $today && @ <= $limit]");
    expect(query).not.toContain("unavailabilityNotes");
    expect(query).not.toMatch(/note/i);
    // The leader leads Otro Nivel: Ana and Caro are in it, Beto (Invencibles, a group the leader
    // is in but does not lead) is never asked about.
    expect(params).toEqual({ ids: ["ana", "caro"], today: TODAY, limit: "2027-11-17" });
  });

  it("an admin asks about everyone", async () => {
    await readJovenesPeople({ awayFor: ADMIN, today: TODAY });
    expect((fetch.mock.calls[1][1] as { ids: string[] }).ids).toEqual(["ana", "beto", "caro"]);
  });

  it("someone who may see nobody triggers no second query", async () => {
    const people = await readJovenesPeople({ awayFor: access("member", ["otro-nivel"]), today: TODAY });
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const p of people) expect(p).not.toHaveProperty("away");
  });

  it("sets `away` only where there is a real day: well-formed, in the window, once, sorted", async () => {
    fetch.mockImplementation(async (q: string) =>
      q.includes("$ids")
        ? [
            { _id: "ana", away: ["2026-12-05", "2026-11-21", "2026-11-21", "x", "2026-11-16", "2028-01-01", 7, null] },
            { _id: "beto", away: null },
            { _id: "caro", away: [] },
          ]
        : ROWS,
    );
    const people = await readJovenesPeople({ awayFor: ADMIN, today: TODAY });
    expect(people.find((p) => p.id === "ana")).toEqual({ id: "ana", name: "Ana", groups: ["otro-nivel"], away: ["2026-11-21", "2026-12-05"] });
    // An absent field (`null`) and an empty array are the same as «not told»: no key at all.
    expect(people.find((p) => p.id === "beto")).not.toHaveProperty("away");
    expect(people.find((p) => p.id === "caro")).not.toHaveProperty("away");
  });

  it("drops a row for an id it did not ask about, rather than trust the answer", async () => {
    fetch.mockImplementation(async (q: string) =>
      q.includes("$ids") ? [{ _id: "beto", away: ["2026-11-21"] }, { _id: "ana", away: ["2026-11-21"] }] : ROWS,
    );
    const people = await readJovenesPeople({ awayFor: LEADER, today: TODAY });
    expect(people.find((p) => p.id === "ana")?.away).toEqual(["2026-11-21"]);
    expect(people.find((p) => p.id === "beto")).not.toHaveProperty("away");
  });

  it("a failed days read throws: «no mark» never stands in for «could not ask»", async () => {
    fetch.mockImplementation(async (q: string) => {
      if (q.includes("$ids")) throw new Error("boom");
      return ROWS;
    });
    await expect(readJovenesPeople({ awayFor: ADMIN, today: TODAY })).rejects.toThrow("boom");
  });
});
