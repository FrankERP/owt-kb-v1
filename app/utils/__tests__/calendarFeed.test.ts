// The member calendar feed's pure half (spec D4, CF5/CF6): which services become events, how a
// seated member is marked, and what each event carries.

import { describe, expect, it } from "vitest";
import {
  buildFeedEvents,
  calendarFeedQuery,
  feedScopeFromSearch,
  feedWindow,
  isCanonicalFeedSearch,
  type FeedRole,
} from "../calendarFeed";

const ORIGIN = "https://owt-backstage.vercel.app";

const sunday = (over: Partial<FeedRole> = {}): FeedRole => ({
  _id: "sun-1",
  date: "2026-10-18",
  seated: false,
  Lead: [{ member_name: "Ana Pérez", alias: "Ana" }],
  BGVs: [{ member_name: "Luis" }],
  Chorus: [],
  instruments: [{ instrument: "Bajo", member_name: "Beto" }, { instrument: "Batería", member_name: null }],
  foh_team: [{ role: "Audio", member_name: "Caro" }],
  setlists: [{ songs: [{ title: "Gracia", play_key: "G", key: "A" }, { title: "Rey", key: "D", medley_tag: "m1" }] }],
  ...over,
});

describe("buildFeedEvents", () => {
  it("marks a seated member with ⭐ and their seat, in /me's seat wording", () => {
    const [e] = buildFeedEvents({ sundays: [sunday({ seated: true, isLead: true, myInstrument: "Bajo" })] }, ORIGIN);
    expect(e.title).toBe("⭐ Domingo · Lead · Bajo · Oasis Worship");
    expect(e.description?.split("\n")[0]).toBe("Tu lugar: Lead · Bajo");
  });

  it("leaves a service the member does not serve unmarked", () => {
    const [e] = buildFeedEvents({ sundays: [sunday()] }, ORIGIN);
    expect(e.title).toBe("Domingo · Oasis Worship");
    expect(e.description).not.toContain("Tu lugar");
  });

  it("marks a seated member even when the seat has no label", () => {
    const [e] = buildFeedEvents({ sundays: [sunday({ seated: true, myInstrument: "" })] }, ORIGIN);
    expect(e.title).toBe("⭐ Domingo · Oasis Worship");
    expect(e.description?.split("\n")[0]).toBe("Te toca servir");
  });

  it("lists songs with the key to play (play_key over the song's key), and the team by section", () => {
    const [e] = buildFeedEvents({ sundays: [sunday()] }, ORIGIN);
    const d = e.description!.split("\n");
    expect(d).toContain("1. Gracia — Tono: G");
    expect(d).toContain("2. Rey — Tono: D (medley)");
    expect(d).toContain("Lead: Ana");
    expect(d).toContain("BGVs: Luis");
    expect(d).toContain("Bajo: Beto");
    expect(d).toContain("FOH · Audio: Caro");
    expect(d.some((l) => l.startsWith("Coro"))).toBe(false); // empty section omitted
    expect(d.some((l) => l.startsWith("Batería"))).toBe(false); // empty seat omitted
    expect(d.at(-1)).toBe(`Abrir en la app: ${ORIGIN}/me`);
    expect(e.url).toBe(`${ORIGIN}/me`);
  });

  it("says «Setlist pendiente» when the weekend setlist is missing OR ambiguous (pickUnique)", () => {
    const none = buildFeedEvents({ sundays: [sunday({ setlists: [] })] }, ORIGIN)[0];
    expect(none.description).toContain("Setlist pendiente");
    const two = buildFeedEvents({ sundays: [sunday({ setlists: [{ songs: [{ title: "A" }] }, { songs: [{ title: "B" }] }] })] }, ORIGIN)[0];
    expect(two.description).toContain("Setlist pendiente");
  });

  it("skips a service that paints nothing (no seat filled, no song)", () => {
    const empty = sunday({ Lead: [], BGVs: [], instruments: [], foh_team: [], setlists: [] });
    expect(buildFeedEvents({ sundays: [empty] }, ORIGIN)).toEqual([]);
  });

  it("makes weekends all-day and a special with a valid time a timed event", () => {
    const events = buildFeedEvents({
      saturdays: [sunday({ _id: "sat-1", date: "2026-10-17" })],
      specials: [
        { ...sunday({ _id: "sp-1", date: "2026-10-17", setlists: undefined }), time: "19:00", service_name: "  Noche  de alabanza ",
          songs: [{ title: "Santo", leads: [{ member_name: "Ana" }, { member_name: "Luis", alias: "Lu" }] }] },
        { ...sunday({ _id: "sp-2", date: "2026-10-19" }), time: "25:00", service_name: "" },
      ],
    }, ORIGIN);
    expect(events.map((e) => [e.uid, e.date, e.time])).toEqual([
      ["sat-1", "2026-10-17", undefined],
      ["sp-1", "2026-10-17", "19:00"],
      ["sp-2", "2026-10-19", undefined], // invalid time → all-day, never guessed
    ]);
    expect(events[0].title).toBe("Sábado · Oasis Worship");
    expect(events[1].title).toBe("Noche de alabanza · Oasis Worship");
    expect(events[1].description).toContain("1. Santo · dirige Ana y Lu");
    expect(events[2].title).toBe("Servicio especial · Oasis Worship");
  });

  it("drops a role with a malformed date instead of throwing", () => {
    expect(buildFeedEvents({ sundays: [sunday({ date: "mañana" })] }, ORIGIN)).toEqual([]);
  });

  it("tolerates a null read", () => {
    expect(buildFeedEvents(null, ORIGIN)).toEqual([]);
  });
});

describe("calendarFeedQuery", () => {
  it("gates every role type on published != false and never projects team_notes", () => {
    for (const scope of ["all", "mine"] as const) {
      const q = calendarFeedQuery(scope);
      expect(q.match(/published != false/g)?.length).toBe(3);
      expect(q).not.toContain("team_notes");
      expect(q).toContain('*[_type == "saturdarSongs" && week == ^.week]');
    }
  });

  it("decides «seated» by member id across all five seat paths", () => {
    const q = calendarFeedQuery("all");
    for (const path of ["Lead[]._ref", "BGVs[]._ref", "Chorus[]._ref", "instruments[].person._ref", "foh_team[].person._ref"]) {
      expect(q).toContain(`$id in ${path}`);
    }
  });

  it("filters to the member's seats only in the «mine» variant", () => {
    expect(calendarFeedQuery("all")).not.toMatch(/published != false && \(/);
    expect(calendarFeedQuery("mine").match(/published != false && \(/g)?.length).toBe(3);
  });
});

describe("URL helpers", () => {
  it("accepts only the two canonical query strings", () => {
    expect(isCanonicalFeedSearch("")).toBe(true);
    expect(isCanonicalFeedSearch("?solo=mios")).toBe(true);
    for (const s of ["?", "?solo=mios&x=1", "?x=1", "?solo=MIOS"]) expect(isCanonicalFeedSearch(s)).toBe(false);
    expect(feedScopeFromSearch(new URLSearchParams("solo=mios"))).toBe("mine");
    expect(feedScopeFromSearch(new URLSearchParams(""))).toBe("all");
  });

  it("spans 60 days back to a year ahead, in CDMX calendar days", () => {
    // 2026-10-15 03:00 UTC is still 2026-10-14 in Mexico City.
    const { from, to } = feedWindow(Date.UTC(2026, 9, 15, 3));
    expect(from).toBe("2026-08-15");
    expect(to).toBe("2027-10-14");
  });
});
