// Solver v3 C6 RQ-3, RQ-7, ST-4–ST-7 — the request holds exactly the services that will exist;
// stored services and counted specials go FIXED with their kept seats as pins; `prior` comes from
// the roles read. Fictitious people; ids are opaque.
import { describe, expect, it } from "vitest";

import { keepVoiceSeats } from "@/app/utils/fairnessLedger";
import { buildV3Prior, buildV3Services, type PlannedColumn, type V3StoredRole } from "../v3Services";

const m = (id: string) => ({ _id: id });
const stored = (over: Partial<V3StoredRole> & Pick<V3StoredRole, "_id" | "_type" | "date">): V3StoredRole => ({
  leads: [], bgvs: [], chorus: [], ...over,
});
const SEATS = { Lead: 2, BGV: 3, Choir: 3 };
const MEMBERS = new Set(["m-ana", "m-bruno", "m-carla", "m-dani"]);
const nameOf = (id: string) => ({ "m-ana": "Ana", "m-bruno": "Bruno", "m-carla": "Carla", "m-dani": "Dani" })[id] ?? id;

const planned: PlannedColumn[] = [
  { columnId: "create:sunday_role__2026-11-08", date: "2026-11-08", type: "sunday_role", countsForFairness: true },
  { columnId: "create:saturday_role__2026-11-14", date: "2026-11-14", type: "saturday_role", countsForFairness: false },
  { columnId: "create:special_role__2026-11-20", date: "2026-11-20", type: "special_role", serviceName: "Bautizos", time: "19:00", countsForFairness: true },
  { columnId: "create:special_role__2026-11-27", date: "2026-11-27", type: "special_role", serviceName: "Ensayo", countsForFairness: false },
];

describe("buildV3Services (RQ-3)", () => {
  it("planned weekend columns are sent with their row targets; a non-fixed Saturday sends no Choir", () => {
    const out = buildV3Services({ months: ["2026-11"], stored: [], planned, seats: SEATS, memberIds: MEMBERS, nameOf });
    expect(out.services.find((s) => s.id === "create:sunday_role__2026-11-08")).toEqual({
      id: "create:sunday_role__2026-11-08", date: "2026-11-08", month: "2026-11", kind: "sunday", fixed: false, counts: true,
      seats: { Lead: 2, BGV: 3, Choir: 3 },
    });
    expect(out.services.find((s) => s.id === "create:saturday_role__2026-11-14")).toEqual({
      id: "create:saturday_role__2026-11-14", date: "2026-11-14", month: "2026-11", kind: "saturday", fixed: false, counts: false,
      seats: { Lead: 2, BGV: 3 },
    });
  });

  it("a planned COUNTED special is sent fixed (filled by the pre-fill); an uncounted one is never sent (SP-3, SP-4)", () => {
    const out = buildV3Services({ months: ["2026-11"], stored: [], planned, seats: SEATS, memberIds: MEMBERS, nameOf });
    expect(out.services.find((s) => s.id === "create:special_role__2026-11-20")).toEqual({
      id: "create:special_role__2026-11-20", date: "2026-11-20", month: "2026-11", kind: "special", time: "19:00", fixed: true, counts: true,
    });
    expect(out.plannedSpecialIds).toEqual(["create:special_role__2026-11-20"]);
    expect(out.services.some((s) => s.id === "create:special_role__2026-11-27")).toBe(false);
  });

  it("a stored id outside [A-Za-z0-9:._-] or longer than 64 is sent byte-identical, and its pins carry it", () => {
    const longId = `role.${"x".repeat(80)}`;
    const odd = "role:Ñandú@2026/11/01";
    const out = buildV3Services({
      months: ["2026-11"],
      stored: [
        stored({ _id: odd, _type: "sunday_role", date: "2026-11-01", leads: [m("m-ana")] }),
        stored({ _id: longId, _type: "sunday_role", date: "2026-11-15", leads: [m("m-bruno")] }),
      ],
      planned: [], seats: SEATS, memberIds: MEMBERS, nameOf,
    });
    expect(out.services.map((s) => s.id)).toEqual([odd, longId]);
    expect(out.storedPins).toEqual([
      { service: odd, date: "2026-11-01", role: "Lead", person: "m-ana" },
      { service: longId, date: "2026-11-15", role: "Lead", person: "m-bruno" },
    ]);
  });

  it("a stored special's time is sent only when isServiceTime holds", () => {
    const out = buildV3Services({
      months: ["2026-11"],
      stored: [
        stored({ _id: "sp-bad", _type: "special_role", date: "2026-11-11", time: "7pm", countsForFairness: true, service_name: "Vigilia" }),
        stored({ _id: "sp-ok", _type: "special_role", date: "2026-11-12", time: "19:00", countsForFairness: true, service_name: "Vigilia" }),
      ],
      planned: [], seats: SEATS, memberIds: MEMBERS, nameOf,
    });
    expect("time" in out.services.find((s) => s.id === "sp-bad")!).toBe(false);
    expect(out.services.find((s) => s.id === "sp-ok")!.time).toBe("19:00");
  });

  it("stored weekend services go fixed with their counted flag; a stored UNCOUNTED special is never sent (ST-4)", () => {
    const out = buildV3Services({
      months: ["2026-11"],
      stored: [
        stored({ _id: "sat-1", _type: "saturday_role", date: "2026-11-07", countsForFairness: false, chorus: [m("m-dani")] }),
        stored({ _id: "sp-uncounted", _type: "special_role", date: "2026-11-13", service_name: "Ensayo" }),
        stored({ _id: "sun-dec", _type: "sunday_role", date: "2026-12-06", leads: [m("m-ana")] }),
      ],
      planned: [], seats: SEATS, memberIds: MEMBERS, nameOf,
    });
    expect(out.services).toEqual([{ id: "sat-1", date: "2026-11-07", month: "2026-11", kind: "saturday", fixed: true, counts: false }]);
    expect(out.storedPins).toEqual([{ service: "sat-1", date: "2026-11-07", role: "Choir", person: "m-dani" }]);
    expect(out.storedServiceIds).toEqual(new Set(["sat-1"]));
  });

  it("ST-5: one notice for the stored services' empty voice seats", () => {
    const out = buildV3Services({
      months: ["2026-11"],
      stored: [stored({ _id: "sun-1", _type: "sunday_role", date: "2026-11-01", leads: [m("m-ana")], bgvs: [m("m-bruno"), m("m-carla")] })],
      planned: [], seats: SEATS, memberIds: MEMBERS, nameOf,
    });
    // Lead 1 of 2, BGV 2 of 3, Coro 0 of 3 → 1 + 1 + 3 = 5 empty voice seats.
    expect(out.notices).toContain("Los servicios guardados no se tocan: sus 5 lugares de voz vacíos se quedan vacíos. Llénalos en «Editar mes».");
  });

  it("ST-6: a non-member's stored seat is not sent, and a double seat is sent once, by Lead > BGV > Coro", () => {
    const out = buildV3Services({
      months: ["2026-11"],
      stored: [stored({
        _id: "sun-1", _type: "sunday_role", date: "2026-11-01",
        leads: [m("m-ana"), m("m-gone")], bgvs: [m("m-ana"), m("m-bruno")], chorus: [m("m-bruno")],
      })],
      planned: [], seats: SEATS, memberIds: MEMBERS, nameOf,
    });
    expect(out.storedPins).toEqual([
      { service: "sun-1", date: "2026-11-01", role: "Lead", person: "m-ana" },
      { service: "sun-1", date: "2026-11-01", role: "BGV", person: "m-bruno" },
    ]);
    expect(out.notices).toContain("Domingo 1 nov: un lugar guardado es de alguien que ya no está en la lista; no se envió al solver.");
    expect(out.notices).toContain("Ana está dos veces en el domingo 1 nov guardado; se envió solo como Lead y su saldo cuenta solo ese lugar.");
    expect(out.notices).toContain("Bruno está dos veces en el domingo 1 nov guardado; se envió solo como BGV y su saldo cuenta solo ese lugar.");
  });

  it("ST-6: for a counted stored service, the seat sent is the one C2 IF2-11 keeps", () => {
    const role = stored({ _id: "sun-1", _type: "sunday_role", date: "2026-11-01", countsForFairness: true, leads: [m("m-carla")], bgvs: [m("m-carla"), m("m-ana")], chorus: [m("m-ana")] });
    const out = buildV3Services({ months: ["2026-11"], stored: [role], planned: [], seats: SEATS, memberIds: MEMBERS, nameOf });
    const ledgerKept = keepVoiceSeats([{ _id: role._id, _type: "sunday_role", date: role.date, countsForFairness: true, Lead: ["m-carla"], BGVs: ["m-carla", "m-ana"], Chorus: ["m-ana"] }]).kept;
    const roleOf = (key: string) => key.split(".")[1];
    expect(out.storedPins.map((p) => `${p.person}:${p.role}`).sort())
      .toEqual(ledgerKept.map((k) => `${k.memberId}:${roleOf(k.roleKey)}`).sort());
  });

  it("ST-7: a target created earlier in the session is just another stored service — sent fixed, never re-planned", () => {
    const created = stored({ _id: "new-sun-08", _type: "sunday_role", date: "2026-11-08", leads: [m("m-ana")] });
    const out = buildV3Services({ months: ["2026-11"], stored: [created], planned: [], seats: SEATS, memberIds: MEMBERS, nameOf });
    expect(out.services).toEqual([{ id: "new-sun-08", date: "2026-11-08", month: "2026-11", kind: "sunday", fixed: true, counts: true }]);
  });

  it("labels each service for the copy: «domingo 8 nov», «sábado 14 nov», «Bautizos 20 nov»", () => {
    const out = buildV3Services({ months: ["2026-11"], stored: [], planned, seats: SEATS, memberIds: MEMBERS, nameOf });
    expect(out.labels.get("create:sunday_role__2026-11-08")).toBe("domingo 8 nov");
    expect(out.labels.get("create:saturday_role__2026-11-14")).toBe("sábado 14 nov");
    expect(out.labels.get("create:special_role__2026-11-20")).toBe("Bautizos 20 nov");
  });
});

describe("buildV3Prior (RQ-7)", () => {
  const roles: V3StoredRole[] = [
    stored({ _id: "oct-18", _type: "sunday_role", date: "2026-10-18", leads: [m("m-ana")] }),
    stored({ _id: "oct-25", _type: "sunday_role", date: "2026-10-25", leads: [m("m-bruno")], countsForFairness: false }),
    stored({ _id: "oct-31", _type: "saturday_role", date: "2026-10-31", leads: [m("m-carla")], bgvs: [m("m-dani")] }),
    stored({ _id: "oct-29-sp", _type: "special_role", date: "2026-10-29", countsForFairness: true, leads: [m("m-ana")] }),
    stored({ _id: "oct-30-sp", _type: "special_role", date: "2026-10-30", leads: [m("m-ana")] }),
    stored({ _id: "oct-24-a", _type: "saturday_role", date: "2026-10-24" }),
    stored({ _id: "oct-24-b", _type: "saturday_role", date: "2026-10-24" }),
  ];

  it("is the month before, with the stored services of the 14 days before the horizon (incl. the trailing Saturday)", () => {
    const prior = buildV3Prior("2026-11", roles);
    expect(prior.month).toBe("2026-10");
    expect(prior.has_services).toBe(true);
    expect(prior.services.map((s) => s.date)).toEqual(["2026-10-18", "2026-10-25", "2026-10-29", "2026-10-31"]);
    expect(prior.services[1]).toEqual({ date: "2026-10-25", kind: "sunday", counts: false, seats: { Lead: ["m-bruno"], BGV: [], Choir: [] } });
    expect(prior.services[3].seats).toEqual({ Lead: ["m-carla"], BGV: ["m-dani"], Choir: [] });
  });

  it("drops two stored documents of one weekend type on one date together (C2 LG-1), and never an uncounted special", () => {
    const prior = buildV3Prior("2026-11", roles);
    expect(prior.services.some((s) => s.date === "2026-10-24")).toBe(false);
    expect(prior.services.some((s) => s.date === "2026-10-30")).toBe(false);
  });

  it("has_services is false when the month before holds no weekend service and no counted special", () => {
    expect(buildV3Prior("2026-11", [stored({ _id: "sp", _type: "special_role", date: "2026-10-20" })]).has_services).toBe(false);
  });
});
