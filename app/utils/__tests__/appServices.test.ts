import { describe, expect, it } from "vitest";
import { APP_SERVICES_QUERY, appAvatarUrl, appServicesWindow, buildAppServices, type AppRoleRow } from "../appServices";

const ME = "member-me";
const member = (id: string, name: string, alias?: string, photo?: string) => ({ _id: id, member_name: name, alias: alias ?? null, photo: photo ?? null });

function sunday(week: string, over: Partial<AppRoleRow> = {}): AppRoleRow {
  return {
    _id: `sun-${week}`,
    _type: "sunday_role",
    week,
    Lead: [member("m-lead", "Liliana", "Liu", "https://cdn.sanity.io/images/p/d/face.jpg")],
    BGVs: [member(ME, "Francisco", "Frank")],
    Chorus: [],
    instruments: [
      { instrument: "Keys", id: ME, name: "Frank", photo: null },
      { instrument: "Drums", id: "m-drums", name: "Tony", photo: "https://lh3.googleusercontent.com/a/x" },
      { instrument: "Bass", id: null, name: null, photo: null },
    ],
    foh_team: [{ role: "Console", id: "m-foh", name: "Pato", photo: null }],
    pastor_message: "  Dios es fiel  ",
    ...over,
  };
}

describe("the read", () => {
  it("gates drafts on every role type and binds the window as parameters", () => {
    for (const t of ["sunday_role", "saturday_role", "special_role"]) {
      expect(APP_SERVICES_QUERY).toMatch(new RegExp(`_type == "${t}"[^\\]]*published != false`));
    }
    // `saturdarSongs` is the stored (typo) Saturday setlist type.
    expect(APP_SERVICES_QUERY).toContain(`_type == "saturdarSongs"`);
    expect(APP_SERVICES_QUERY).toContain("$from");
    expect(APP_SERVICES_QUERY).toContain("$to");
    expect(APP_SERVICES_QUERY).not.toContain("${");
  });

  it("spans today through +95 days, across a month and a year", () => {
    expect(appServicesWindow("2026-11-24")).toEqual({ from: "2026-11-24", to: "2027-02-27" });
    expect(appServicesWindow("2026-03-01").to).toBe("2026-06-04");
  });
});

describe("buildAppServices", () => {
  it("shapes a weekend service with its setlist, seats by id, and the standing time", () => {
    const [s] = buildAppServices(
      {
        sundays: [sunday("2026-11-29")],
        sunSetlists: [
          {
            week: "2026-11-29",
            team_notes: "Llegar 9:30",
            songs: [
              { title: "Gracia sublime", play_key: "G", songKey: "A", bpm: "72", cover: "https://cdn.sanity.io/images/p/d/c.jpg?x=1", slug: "gracia", id: "s1", medley_tag: "A" },
              { title: null, play_key: "C" },
            ],
          },
        ],
      },
      ME,
    );
    expect(s).toMatchObject({
      id: "sun-2026-11-29",
      kind: "sunday",
      date: "2026-11-29",
      time: "11:00",
      title: "Domingo",
      worshipNight: false,
      seated: true,
      mySeats: ["Keys", "BGV"],
      teamNotes: "Llegar 9:30",
      pastorMessage: "Dios es fiel",
    });
    expect(s!.sections.map((x) => x.id)).toEqual(["voces", "banda", "cabina"]);
    expect(s!.sections[0]!.people).toEqual([
      { name: "Liu", seat: "Lead", photo: "https://cdn.sanity.io/images/p/d/face.jpg?w=144&h=144&fit=crop&fm=jpg", mine: false },
      { name: "Frank", seat: "BGV", photo: null, mine: true },
    ]);
    // The empty Bass seat is not a person.
    expect(s!.sections[1]!.people.map((p) => p.seat)).toEqual(["Keys", "Drums"]);
    expect(s!.sections[1]!.people[1]!.photo).toBe("https://lh3.googleusercontent.com/a/x");
    expect(s!.songs).toHaveLength(1);
    expect(s!.songs[0]).toMatchObject({ title: "Gracia sublime", key: "G", songKey: "A", bpm: 72, medley: "A", leads: [] });
    expect(s!.songs[0]!.cover).toMatch(/^https:\/\/cdn\.sanity\.io\/images\/p\/d\/c\.jpg\?w=\d+&h=\d+&fit=crop&fm=jpg$/);
  });

  it("decides «mine» by id, not by a shared display name", () => {
    const role = sunday("2026-11-29", { BGVs: [member("someone-else", "Francisco", "Frank")], instruments: [] });
    const [s] = buildAppServices({ sundays: [role] }, ME);
    expect(s!.mySeats).toEqual([]);
    expect(s!.seated).toBe(false);
    expect(s!.sections.flatMap((x) => x.people).some((p) => p.mine)).toBe(false);
    // No member id goes over the wire.
    expect(s!.sections.flatMap((x) => x.people).every((p) => !("id" in p))).toBe(true);
  });

  it("is seated on a seat with no name, and keeps «FOH:» on every booth seat", () => {
    const nameless = sunday("2026-11-29", { BGVs: [], instruments: [{ instrument: null, id: ME, name: "Frank", photo: null }] });
    const [a] = buildAppServices({ sundays: [nameless] }, ME);
    expect(a).toMatchObject({ seated: true, mySeats: [] });
    const booth = sunday("2026-11-29", {
      BGVs: [],
      instruments: [],
      foh_team: [
        { role: "Console", id: ME, name: "Frank", photo: null },
        { role: "Luces", id: ME, name: "Frank", photo: null },
      ],
    });
    expect(buildAppServices({ sundays: [booth] }, ME)[0]!.mySeats).toEqual(["FOH: Console", "FOH: Luces"]);
  });

  it("leaves out a service the web would paint as nothing (no one seated, no songs)", () => {
    const empty = sunday("2026-11-29", { Lead: [], BGVs: [], instruments: [], foh_team: [] });
    expect(buildAppServices({ sundays: [empty] }, ME)).toEqual([]);
    expect(buildAppServices({ sundays: [empty], sunSetlists: [{ week: "2026-11-29", songs: [{ title: "A" }] }] }, ME)).toHaveLength(1);
  });

  it("fails closed on a duplicate weekend role or setlist", () => {
    expect(buildAppServices({ sundays: [sunday("2026-11-29"), sunday("2026-11-29", { _id: "dup" })] }, ME)).toEqual([]);
    const [s] = buildAppServices(
      { sundays: [sunday("2026-11-29")], sunSetlists: [{ week: "2026-11-29", songs: [{ title: "A" }] }, { week: "2026-11-29", songs: [{ title: "B" }] }] },
      ME,
    );
    expect(s!.songs).toEqual([]);
  });

  it("keeps two specials on one day, with their own time, name, format and song leaders", () => {
    const special = (id: string, time: string | null, name: string | null, format?: string): AppRoleRow => ({
      _id: id,
      _type: "special_role",
      date: "2026-12-05",
      time,
      service_name: name,
      format: format ?? null,
      Lead: [member("m1", "Ana")],
      songs: [{ title: "Canción", play_key: "D", leads: [{ member_name: "Ana", alias: null }] }],
    });
    const out = buildAppServices(
      {
        specials: [special("sp-b", "19:00", "  Noche   de alabanza ", "worship_night"), special("sp-a", "09:00", null), special("sp-bad", "9am", "Sin hora")],
        saturdays: [{ _id: "sat-1", _type: "saturday_role", week: "2026-12-05", Lead: [member("m2", "Toño")] }],
      },
      ME,
    );
    // A special with no time comes first in its day, as the Calendario orders it.
    expect(out.map((s) => [s.id, s.time, s.title, s.worshipNight])).toEqual([
      ["sp-bad", null, "Sin hora", false],
      ["sp-a", "09:00", "Servicio especial", false],
      ["sat-1", "18:00", "Sábado", false],
      ["sp-b", "19:00", "Noche de alabanza", true],
    ]);
    expect(out.find((s) => s.id === "sp-b")!.songs[0]!.leads).toEqual(["Ana"]);
  });

  it("drops records with no usable date or id, and tolerates null arrays", () => {
    expect(
      buildAppServices(
        {
          sundays: [sunday("not-a-date"), { ...sunday("2026-11-29"), _id: null }],
          specials: [null as unknown as AppRoleRow, { _id: "x", date: "2026-02-30" }],
          saturdays: null,
          sunSetlists: null,
          satSetlists: undefined,
        },
        ME,
      ),
    ).toEqual([]);
  });

  it("orders by date, then time", () => {
    const out = buildAppServices({ sundays: [sunday("2026-12-06"), sunday("2026-11-29")], saturdays: [{ _id: "s", week: "2026-11-28", Lead: [member("m2", "Toño")] }] }, ME);
    expect(out.map((s) => s.date)).toEqual(["2026-11-28", "2026-11-29", "2026-12-06"]);
  });
});

describe("appAvatarUrl", () => {
  it("sizes a Sanity image as JPEG and passes any other URL through", () => {
    expect(appAvatarUrl("https://cdn.sanity.io/images/p/d/a.webp?rect=1")).toBe("https://cdn.sanity.io/images/p/d/a.webp?w=144&h=144&fit=crop&fm=jpg");
    expect(appAvatarUrl("https://lh3.googleusercontent.com/a/b=s96")).toBe("https://lh3.googleusercontent.com/a/b=s96");
    expect(appAvatarUrl("  ")).toBeNull();
    expect(appAvatarUrl(null)).toBeNull();
  });
});
