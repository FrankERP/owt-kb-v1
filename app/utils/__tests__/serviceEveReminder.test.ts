import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";

vi.mock("server-only", () => ({}));
const opFetch = vi.fn();
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => opFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn() },
}));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: vi.fn(), patch: vi.fn() },
}));
const sendEmail = vi.fn();
vi.mock("../email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email")>()),
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

import {
  buildServiceEveEmail,
  EVE_PEOPLE_QUERY,
  eveMemberIds,
  planServiceEveEmails,
  seatBodyOf,
  SERVICE_EVE_QUERY,
  sendServiceEveReminders,
  songsOf,
  startTimeOf,
  type EvePersonRow,
  type EveServiceRow,
} from "../serviceEveReminder";

const ref = (id: string) => ({ _key: id, _type: "reference", _ref: id });
const slot = (field: "instrument" | "role", label: string, id: string) => ({ _key: `${label}-${id}`, [field]: label, person: ref(id) });

const ENV = { baseUrl: "https://app.test", allow: ["*"] };

function sunday(over: Partial<EveServiceRow> = {}): EveServiceRow {
  return {
    _id: "sun22",
    _type: "sunday_role",
    date: "2026-11-22",
    Lead: [ref("ana")],
    BGVs: [ref("beto")],
    Chorus: [],
    instruments: [slot("instrument", "Guitarra", "caro")],
    foh_team: [slot("role", "Audio", "dani")],
    setlists: [{ songs: [{ title: "Grande y fuerte", key: "Bb" }, { title: "Santo", key: null }] }],
    ...over,
  };
}

const PEOPLE: EvePersonRow[] = [
  { _id: "ana", name: "Ana López", email: "Ana@Oasis.mx" },
  { _id: "beto", name: "Beto", email: "beto@oasis.mx" },
  { _id: "caro", name: "Caro", email: "caro@oasis.mx" },
  { _id: "dani", name: "Dani", email: "dani@oasis.mx" },
];

describe("seatBodyOf", () => {
  it("reads all five seats and drops malformed rows", () => {
    const body = seatBodyOf(sunday({
      Chorus: [ref("eva"), null, { _ref: 7 } as never],
      instruments: [slot("instrument", "Guitarra", "caro"), { person: ref("x") }, { instrument: "Bajo" }],
      foh_team: [slot("role", "  Audio ", "dani"), { role: "", person: ref("y") }],
    }));
    expect(body).toEqual({
      leads: ["ana"],
      bgvs: ["beto"],
      chorus: ["eva"],
      instruments: [{ instrument: "Guitarra", personId: "caro" }],
      foh: [{ role: "Audio", personId: "dani" }],
    });
  });

  it("names every seated member once", () => {
    expect(eveMemberIds([sunday(), sunday({ _id: "sp", Lead: [ref("ana"), ref("fer")] })])).toEqual(["ana", "beto", "caro", "dani", "fer"]);
  });
});

describe("startTimeOf / songsOf", () => {
  it("uses the team's standing weekend times and a special's own time", () => {
    expect(startTimeOf({ _type: "saturday_role" })).toBe("18:00");
    expect(startTimeOf({ _type: "sunday_role" })).toBe("11:00");
    expect(startTimeOf({ _type: "special_role", time: "09:30" })).toBe("09:30");
    expect(startTimeOf({ _type: "special_role", time: "9am" })).toBeNull();
  });

  it("shows no songs when the week has two setlist documents (ambiguous)", () => {
    expect(songsOf(sunday({ setlists: [{ songs: [{ title: "A" }] }, { songs: [{ title: "B" }] }] }))).toEqual([]);
    expect(songsOf(sunday({ setlists: [] }))).toEqual([]);
  });

  it("keeps titled rows and trims keys", () => {
    expect(songsOf(sunday({ setlists: [{ songs: [{ title: " A ", key: " G " }, { title: "", key: "C" }, null as never] }] }))).toEqual([
      { title: "A", key: "G" },
    ]);
    expect(songsOf({ _id: "sp", _type: "special_role", date: "2026-11-22", songs: [{ title: "S", key: "D" }] })).toEqual([
      { title: "S", key: "D" },
    ]);
  });
});

describe("planServiceEveEmails", () => {
  it("sends one email per seated person, with their seat", () => {
    const planned = planServiceEveEmails([sunday()], PEOPLE, ENV);
    expect(planned.map((p) => [p.memberId, p.email])).toEqual([
      ["ana", "ana@oasis.mx"],
      ["beto", "beto@oasis.mx"],
      ["caro", "caro@oasis.mx"],
      ["dani", "dani@oasis.mx"],
    ]);
    expect(planned[0].subject).toBe("Sirves mañana — Domingo 22 nov");
    expect(planned[0].html).toContain("Líder");
    expect(planned[2].html).toContain("Guitarra");
    expect(planned[3].html).toContain("Audio");
  });

  it("leaves out no email, no app access, outside the allowlist and «Nuevas asignaciones» off", () => {
    const people: EvePersonRow[] = [
      { _id: "ana", name: "Ana", email: "" },
      { _id: "beto", name: "Beto", email: "beto@oasis.mx", disabled: true },
      { _id: "caro", name: "Caro", email: "caro@oasis.mx", notifPrefs: { emailAssigned: false } },
      { _id: "dani", name: "Dani", email: "dani@oasis.mx", notifPrefs: { email: false } },
    ];
    expect(planServiceEveEmails([sunday()], people, ENV)).toEqual([]);
    expect(planServiceEveEmails([sunday()], PEOPLE, { ...ENV, allow: ["beto@oasis.mx"] }).map((p) => p.memberId)).toEqual(["beto"]);
  });

  it("gives someone on two services ONE email naming both, in start-time order", () => {
    const special: EveServiceRow = {
      _id: "sp22", _type: "special_role", date: "2026-11-22", service_name: "Bautizos", time: "09:00",
      Lead: [], BGVs: [ref("ana")], Chorus: [], instruments: [], foh_team: [], songs: [],
    };
    const planned = planServiceEveEmails([sunday(), special], PEOPLE, ENV);
    const ana = planned.filter((p) => p.memberId === "ana");
    expect(ana).toHaveLength(1);
    expect(ana[0].subject).toBe("Sirves mañana — 2 servicios");
    const html = ana[0].html;
    expect(html.indexOf("Bautizos")).toBeGreaterThan(-1);
    expect(html.indexOf("Bautizos")).toBeLessThan(html.indexOf("11:00"));
  });

  it("names a person in two seats of one service once, with both seats", () => {
    const planned = planServiceEveEmails([sunday({ BGVs: [ref("ana")] })], PEOPLE, ENV);
    const ana = planned.filter((p) => p.memberId === "ana");
    expect(ana).toHaveLength(1);
    expect(ana[0].html).toContain("Líder y BGV");
  });
});

describe("buildServiceEveEmail", () => {
  it("escapes stored text and lists the songs with their key", () => {
    const { subject, html } = buildServiceEveEmail({
      name: "<b>Ana</b> López",
      items: [{ label: "Sábado 21 nov", time: "18:00", roles: ["Coro"], songs: [{ title: "Dios <3", key: "Bb" }] }],
      link: "https://app.test/",
      settingsLink: "https://app.test/me/ajustes",
    });
    expect(subject).toBe("Sirves mañana — Sábado 21 nov");
    expect(html).toContain("Hola, &lt;b&gt;Ana&lt;/b&gt;.");
    expect(html).toContain("Dios &lt;3");
    expect(html).toContain("· Bb");
    expect(html).toContain("Sábado 21 nov · 18:00");
    expect(html).toContain("Ensayar el setlist");
    expect(html).toContain("https://app.test/me/ajustes");
  });

  it("says the setlist is not ready when it has no songs", () => {
    const { html } = buildServiceEveEmail({
      name: "Ana",
      items: [{ label: "Sábado 21 nov", time: "18:00", roles: ["Coro"], songs: [] }],
      link: "https://app.test/",
      settingsLink: "https://app.test/me/ajustes",
    });
    expect(html).toContain("Todavía no hay canciones en el setlist.");
    expect(html).toContain("Ver el servicio");
  });
});

describe("SERVICE_EVE_QUERY", () => {
  const DATASET = [
    { _id: "sun22", _type: "sunday_role", week: "2026-11-22", Lead: [ref("ana")], BGVs: [], Chorus: [], instruments: [slot("instrument", "Bajo", "caro")], foh_team: [] },
    { _id: "sat21", _type: "saturday_role", week: "2026-11-21", Lead: [ref("beto")] },
    { _id: "hidden", _type: "sunday_role", week: "2026-11-22", published: false, Lead: [ref("dani")] },
    { _id: "sp22", _type: "special_role", date: "2026-11-22", service_name: "Bautizos", time: "09:00", Lead: [ref("eva")], songs: [{ _key: "s1", song: ref("p2"), play_key: "D" }] },
    { _id: "set22", _type: "featuredSongs", week: "2026-11-22", songs: [{ _key: "s1", song: ref("p1"), play_key: "Bb" }] },
    { _id: "satset22", _type: "saturdarSongs", week: "2026-11-22", songs: [{ _key: "s1", song: ref("p2") }] },
    { _id: "p1", _type: "post", title: "Grande y fuerte" },
    { _id: "p2", _type: "post", title: "Santo" },
    { _id: "ana", _type: "teamMembers", member_name: "Ana María", alias: "Ana", email: "ana@oasis.mx", notifPrefs: { emailAssigned: true } },
    { _id: "caro", _type: "teamMembers", member_name: "Caro", email: "caro@oasis.mx", disabled: true },
  ];

  it("reads tomorrow's published services with their seats and songs", async () => {
    const rows = (await (await evaluate(parse(SERVICE_EVE_QUERY), { dataset: DATASET, params: { day: "2026-11-22" } })).get()) as EveServiceRow[];
    const byId = Object.fromEntries(rows.map((r) => [r._id, r]));
    expect(Object.keys(byId).sort()).toEqual(["sp22", "sun22"]);
    expect(byId.sun22.date).toBe("2026-11-22");
    expect(songsOf(byId.sun22)).toEqual([{ title: "Grande y fuerte", key: "Bb" }]);
    expect(songsOf(byId.sp22)).toEqual([{ title: "Santo", key: "D" }]);
    expect(eveMemberIds(rows).sort()).toEqual(["ana", "caro", "eva"]);
  });

  it("reads the people with their gates", async () => {
    const people = (await (await evaluate(parse(EVE_PEOPLE_QUERY), { dataset: DATASET, params: { ids: ["ana", "caro"] } })).get()) as EvePersonRow[];
    expect(people).toEqual([
      { _id: "ana", name: "Ana", email: "ana@oasis.mx", disabled: null, notifPrefs: { emailAssigned: true } },
      { _id: "caro", name: "Caro", email: "caro@oasis.mx", disabled: true, notifPrefs: null },
    ]);
  });
});

describe("sendServiceEveReminders", () => {
  beforeEach(() => {
    opFetch.mockReset();
    sendEmail.mockReset();
    delete process.env.EMAIL_REDIRECT_TO;
  });

  it("reads, plans and sends, and reports what happened", async () => {
    opFetch.mockImplementation(async (query: string) => (query === SERVICE_EVE_QUERY ? [sunday()] : PEOPLE));
    sendEmail.mockImplementation(async (o: { to: string }) => (o.to === "dani@oasis.mx" ? { ok: false, error: "smtp" } : { ok: true }));
    const report = await sendServiceEveReminders("2026-11-22");
    expect(opFetch).toHaveBeenCalledWith(SERVICE_EVE_QUERY, { day: "2026-11-22" });
    expect(report).toMatchObject({ services: 1, planned: 4, emailed: 3, failed: 1, skipped: 0 });
  });

  it("does not read people or send when nobody serves tomorrow", async () => {
    opFetch.mockResolvedValue([]);
    const report = await sendServiceEveReminders("2026-11-23");
    expect(opFetch).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(report).toMatchObject({ services: 0, planned: 0, emailed: 0 });
  });

  it("starts no wave once the route has no time left", async () => {
    opFetch.mockImplementation(async (query: string) => (query === SERVICE_EVE_QUERY ? [sunday()] : PEOPLE));
    const report = await sendServiceEveReminders("2026-11-22", { spentMs: 30_000 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(report).toMatchObject({ planned: 4, emailed: 0, skipped: 4 });
  });

  it("never throws", async () => {
    opFetch.mockRejectedValue(new Error("sanity down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendServiceEveReminders("2026-11-22")).resolves.toMatchObject({ error: "service_eve_failed" });
    spy.mockRestore();
  });

  it("redirects preview mail to one address", async () => {
    process.env.EMAIL_REDIRECT_TO = "frank@test";
    opFetch.mockImplementation(async (query: string) => (query === SERVICE_EVE_QUERY ? [sunday({ BGVs: [], instruments: [], foh_team: [] })] : PEOPLE));
    sendEmail.mockResolvedValue({ ok: true });
    await sendServiceEveReminders("2026-11-22");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "frank@test", subject: "[→ ana@oasis.mx] Sirves mañana — Domingo 22 nov" }));
  });
});
