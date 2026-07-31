import { describe, it, expect } from "vitest";
import { computeParticipation, serviceWeekKey } from "../computeParticipation";

const M = (id: string, alias?: string) => ({ _id: id, member_name: id, alias });
const sun = (over: Record<string, unknown> = {}) =>
  ({ _type: "sunday_role" as const, date: "2026-07-26", leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over });
const sat = (over: Record<string, unknown> = {}) =>
  ({ _type: "saturday_role" as const, date: "2026-07-25", leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over });
const special = (over: Record<string, unknown> = {}) =>
  ({ _type: "special_role" as const, date: "2026-07-22", leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over });

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

  it("counts chorus on a saturday_role, and routes a special's leads/bgvs/chorus into one especial bucket", () => {
    // Decision reversal (E12): a special no longer contributes zero. Its
    // leads, bgvs AND chorus all land in `especial`, never split into
    // sunLead/satLead/sunBGV/satBGV/coro, so those keep meaning "Sunday/
    // Saturday voice" and "Sunday choir" respectively regardless of service type.
    const r = computeParticipation([
      sat({ chorus: [M("a")] }),
      special({ leads: [M("a")], bgvs: [M("a")], chorus: [M("a")] }),
    ]);
    const a = r.find(x => x.id === "a")!;
    expect(a).toMatchObject({
      coro: 1, especial: 3, sunLead: 0, satLead: 0, sunBGV: 0, satBGV: 0,
      total: 4, // sum of every field, including the new bucket
    });
  });

  it("a special's leads do not land in satLead/satBGV (the compiling-but-wrong-data trap)", () => {
    const r = computeParticipation([special({ leads: [M("a")], bgvs: [M("b")] })]);
    expect(r.find(x => x.id === "a")).toMatchObject({ satLead: 0, sunLead: 0, especial: 1, total: 1 });
    expect(r.find(x => x.id === "b")).toMatchObject({ satBGV: 0, sunBGV: 0, especial: 1, total: 1 });
  });

  it("a special dated on a Sunday keys to that same Sunday, not the next one", () => {
    // 2026-07-26 is itself a Sunday; a naive nextSunday() would push it to 08-02.
    expect(serviceWeekKey(special({ date: "2026-07-26" }))).toBe("2026-07-26");
  });

  it("a weekday special keys forward to the following Sunday", () => {
    // 2026-07-22 is a Wednesday; the following Sunday is 2026-07-26.
    expect(serviceWeekKey(special({ date: "2026-07-22" }))).toBe("2026-07-26");
  });

  it("a special's instrument/FOH weeks join the same week cell as the following Sunday", () => {
    const r = computeParticipation([
      special({ date: "2026-07-22", instruments: [{ person: M("a") }] }),
      sun({ date: "2026-07-26", instruments: [{ person: M("a") }] }),
    ]);
    expect(r.find(x => x.id === "a")).toMatchObject({ instrWeeks: 1 });
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
