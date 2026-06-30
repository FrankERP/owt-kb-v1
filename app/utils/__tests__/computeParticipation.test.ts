import { describe, it, expect } from "vitest";
import { computeParticipation } from "../computeParticipation";

const M = (id: string, alias?: string) => ({ _id: id, member_name: id, alias });
const sun = (over: Record<string, unknown> = {}) =>
  ({ _type: "sunday_role" as const, date: "2026-07-26", leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over });
const sat = (over: Record<string, unknown> = {}) =>
  ({ _type: "saturday_role" as const, date: "2026-07-25", leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over });

describe("computeParticipation", () => {
  it("routes voz appearances to Sun/Sat columns and totals them", () => {
    const r = computeParticipation([
      sun({ leads: [M("a")], bgvs: [M("b")], chorus: [M("c")] }),
      sat({ leads: [M("a")], bgvs: [M("b")] }),
    ]);
    const a = r.find(x => x.id === "a")!;
    expect(a).toMatchObject({ sunLead: 1, satLead: 1, sunBGV: 0, satBGV: 0, coro: 0, total: 2 });
    expect(r.find(x => x.id === "b")).toMatchObject({ sunBGV: 1, satBGV: 1, total: 2 });
    expect(r.find(x => x.id === "c")).toMatchObject({ coro: 1, total: 1 });
  });

  it("counts an instrument on the Sat AND Sun of one weekend as instrWeeks: 1", () => {
    const r = computeParticipation([
      sat({ instruments: [{ person: M("a") }] }),   // 2026-07-25 -> normalizes to 07-26
      sun({ instruments: [{ person: M("a") }] }),   // 2026-07-26
    ]);
    expect(r.find(x => x.id === "a")).toMatchObject({ instrWeeks: 1, total: 0 });
  });

  it("counts instruments on two different weekends as instrWeeks: 2", () => {
    const r = computeParticipation([
      sun({ date: "2026-07-26", instruments: [{ person: M("a") }] }),
      sun({ date: "2026-07-19", instruments: [{ person: M("a") }] }),
    ]);
    expect(r.find(x => x.id === "a")!.instrWeeks).toBe(2);
  });

  it("skips a null instrument/FOH person without throwing", () => {
    const r = computeParticipation([sun({ instruments: [{ person: null }], foh: [{ person: null }] })]);
    expect(r).toEqual([]);
  });

  it("counts chorus on a saturday_role and ignores special_role entirely", () => {
    const r = computeParticipation([
      sat({ chorus: [M("a")] }),
      { _type: "special_role", date: "2026-07-20", leads: [M("a")], bgvs: [], chorus: [M("a")], instruments: [], foh: [] },
    ]);
    expect(r.find(x => x.id === "a")).toMatchObject({ coro: 1, total: 1 }); // special contributes nothing
  });

  it("omits zero-participation members and sorts by total desc", () => {
    const r = computeParticipation([sun({ leads: [M("a"), M("b")], bgvs: [M("b")] })]);
    expect(r.map(x => x.id)).toEqual(["b", "a"]); // b total 2, a total 1
  });

  it("resolves name from alias when present", () => {
    const r = computeParticipation([sun({ leads: [M("a", "Frankie")] })]);
    expect(r[0].name).toBe("Frankie");
  });
});
