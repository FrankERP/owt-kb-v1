// The reminders two weeks and one week before a Jóvenes meeting (ADR-0089, addendum). Three
// layers, each on its own: who a meeting reminds and of what (`meetingReminders`, pure), who of
// them is written to (`planReminderEmails`, over the REAL people query on groq-js), and the cron
// step (`sendMinistryEventReminders`: dates, reads, waves, the route's deadline, never throwing).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ fetch: vi.fn(), sendEmail: vi.fn(), readAnnounced: vi.fn() }));
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: h.fetch } }));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: vi.fn() }, writeClient: {} }));
vi.mock("../email", () => ({ sendEmail: h.sendEmail, SEND_CONCURRENCY: 8, SEND_TIMEOUT_MS: 20_000 }));
vi.mock("../ministryEventReads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ministryEventReads")>()),
  readAnnouncedMeetings: h.readAnnounced,
}));

import type { MinistryEventLine, MinistryEventSeat, MinistryEventView } from "../ministryEventReads";
import { NOTICE_PEOPLE_QUERY } from "../ministryEventNotify";
import {
  REMINDER_STEP_DEADLINE_MS,
  meetingReminders,
  planReminderEmails,
  reminderDates,
  sendMinistryEventReminders,
} from "../ministryEventReminder";

// ── Fixtures ────────────────────────────────────────────────────────────────

const seat = (role: string, memberId: string | null, name: string | null = null): MinistryEventSeat => ({
  _key: `${role}-${memberId ?? name}`,
  role,
  memberId,
  name: name ?? memberId,
  photo: null,
  mine: false,
});
const line = (part: MinistryEventLine["part"], memberId: string | null, over: Partial<MinistryEventLine> = {}): MinistryEventLine => ({
  _key: `l-${part ?? over.label}`,
  memberId,
  name: memberId,
  photo: null,
  mine: false,
  label: part,
  note: null,
  part,
  music: null,
  helpers: null,
  second: null,
  ...over,
});
const second = (memberId: string) => ({ _key: "x", memberId, name: memberId, photo: null, mine: false });

const meeting = (over: Partial<MinistryEventView> = {}): MinistryEventView => ({
  _id: "ministryEvent.00000000-0000-4000-8000-000000000001",
  rev: "r1",
  ministry: "jovenes",
  audience: { kind: "ministry" },
  kind: "saturday",
  date: "2026-12-05",
  time: "18:10",
  arrival: null,
  title: null,
  notes: null,
  place: "Oasis Tlalpan",
  lesson: null,
  published: true,
  seats: [],
  program: [],
  createdById: null,
  createdByName: null,
  ...over,
});

/** A Saturday with everyone assigned and nothing filled. */
const FULL = meeting({
  seats: [seat("encargado", "noemi"), seat("apoyo", "goma"), seat("comparte", "gaby")],
  program: [
    line("oracion", "jacob"),
    line("dinamica1", "andy", { second: second("sofi") }),
    line("dinamica2", "leo"),
    line(null, "rafa", { label: "Anuncios" }),
  ],
});

type Doc = Record<string, unknown> & { _id: string };
const J = { ministries: ["jovenes"], ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "member", groups: ["otro-nivel"] }] };
const person = (id: string, over: Record<string, unknown> = {}): Doc => ({
  _id: id,
  _type: "teamMembers",
  member_name: id[0].toUpperCase() + id.slice(1),
  email: `${id}@example.com`,
  ...J,
  ...over,
});
const PEOPLE: Doc[] = ["noemi", "goma", "gaby", "jacob", "andy", "sofi", "leo", "rafa"].map((id) => person(id));

async function readPeople(docs: Doc[], ids: string[] = docs.map((d) => d._id)) {
  const value = await evaluate(parse(NOTICE_PEOPLE_QUERY), { dataset: docs, params: { ids } });
  return (await value.get()) as Doc[];
}
const env = { baseUrl: "https://app.example", allow: ["*"] };
const plan = async (m: MinistryEventView, days: 14 | 7 = 14, people: Doc[] = PEOPLE) =>
  planReminderEmails([{ meeting: m, days }], await readPeople(people), env);

// ── Which days ──────────────────────────────────────────────────────────────

describe("reminderDates", () => {
  it("exactly 14 and 7 calendar days ahead, across a month and a year end", () => {
    expect(reminderDates("2026-11-21")).toEqual([
      { date: "2026-12-05", days: 14 },
      { date: "2026-11-28", days: 7 },
    ]);
    expect(reminderDates("2026-12-26")).toEqual([
      { date: "2027-01-09", days: 14 },
      { date: "2027-01-02", days: 7 },
    ]);
  });

  it("a day that is not a date covers nothing", () => {
    expect(reminderDates("21/11/2026")).toEqual([]);
  });
});

// ── Who a meeting reminds ───────────────────────────────────────────────────

describe("meetingReminders — only whoever still owes something", () => {
  it("each responsable hears of their own part and what it lacks; seats and free lines owe nothing", () => {
    const got = meetingReminders(FULL);
    expect(got.map((r) => r.memberId)).toEqual(["jacob", "andy", "sofi", "leo", "gaby"]);
    expect(got.find((r) => r.memberId === "jacob")?.fill).toEqual([{ part: "oracion", gaps: ["music"], partners: [], partnerNames: [] }]);
    expect(got.find((r) => r.memberId === "andy")?.fill).toEqual([{ part: "dinamica1", gaps: ["note"], partners: ["sofi"], partnerNames: [] }]);
    expect(got.find((r) => r.memberId === "sofi")?.fill[0].partners).toEqual(["andy"]);
    expect(got.find((r) => r.memberId === "gaby")?.fill).toEqual([{ part: "platica", gaps: ["note", "music"], partners: [], partnerNames: [] }]);
    // Encargado, apoyo and the «Anuncios» line: nothing to fill, and nothing lacks a person.
    for (const id of ["noemi", "goma", "rafa"]) expect(got.some((r) => r.memberId === id)).toBe(false);
  });

  it("a filled part is silent — Oración with its music and no note is filled", () => {
    const done = meeting({
      seats: [seat("encargado", "noemi"), seat("comparte", "gaby")],
      program: [
        line("oracion", "jacob", { music: "track" }),
        line("dinamica1", "andy", { note: "Sillas musicales" }),
        line("dinamica2", "leo", { note: "Trivia", helpers: "Majo" }),
        line("platica", null, { note: "La fe", music: "alabanza" }),
      ],
    });
    expect(meetingReminders(done)).toEqual([]);
  });

  it("Plática half filled: only the missing half is named, to everyone who shares", () => {
    const half = meeting({
      seats: [seat("comparte", "gaby"), seat("comparte", "leo"), seat("comparte", null, "Pastor invitado")],
      program: [line("oracion", "jacob", { music: "alabanza" }), line("dinamica1", "andy", { note: "x" }), line("dinamica2", "sofi", { note: "y" }), line("platica", null, { note: "La fe" })],
    });
    expect(meetingReminders(half)).toEqual([
      { memberId: "gaby", fill: [{ part: "platica", gaps: ["music"], partners: ["leo"], partnerNames: ["Pastor invitado"] }], assign: [] },
      { memberId: "leo", fill: [{ part: "platica", gaps: ["music"], partners: ["gaby"], partnerNames: ["Pastor invitado"] }], assign: [] },
    ]);
  });

  it("a typed-name guest alone has no account: nobody is written to about the Plática", () => {
    const guest = meeting({
      seats: [seat("comparte", null, "Pastor invitado")],
      program: [line("oracion", "jacob", { music: "track" }), line("dinamica1", "andy", { note: "x" }), line("dinamica2", "sofi", { note: "y" })],
    });
    expect(meetingReminders(guest)).toEqual([]);
  });

  it("someone with two parts gets ONE reminder naming both", () => {
    const both = meeting({ program: [line("oracion", "jacob"), line("dinamica1", "jacob"), line("dinamica2", "leo", { note: "ok" })] });
    expect(meetingReminders(both)).toEqual([
      {
        memberId: "jacob",
        fill: [
          { part: "oracion", gaps: ["music"], partners: [], partnerNames: [] },
          { part: "dinamica1", gaps: ["note"], partners: [], partnerNames: [] },
        ],
        assign: [],
      },
    ]);
  });

  it("the same person twice on a dinámica is one responsable, not their own partner", () => {
    const twice = meeting({ program: [line("dinamica1", "andy", { second: second("andy") })] });
    expect(meetingReminders({ ...twice, kind: "ministry" })).toEqual([
      { memberId: "andy", fill: [{ part: "dinamica1", gaps: ["note"], partners: [], partnerNames: [] }], assign: [] },
    ]);
  });
});

describe("meetingReminders — a part with nobody is the encargado's to assign", () => {
  it("on a Saturday, each encargado hears which of Oración and the dinámicas lack a person; never Plática", () => {
    const empty = meeting({ seats: [seat("encargado", "noemi"), seat("encargado", "goma"), seat("apoyo", "gaby")], program: [line("dinamica1", "andy", { note: "x" })] });
    expect(meetingReminders(empty)).toEqual([
      { memberId: "noemi", fill: [], assign: ["oracion", "dinamica2"] },
      { memberId: "goma", fill: [], assign: ["oracion", "dinamica2"] },
    ]);
  });

  it("a line that names no person counts as nobody", () => {
    const blank = meeting({ seats: [seat("encargado", "noemi")], program: [line("oracion", null), line("dinamica1", "andy", { note: "x" }), line("dinamica2", "leo", { note: "y" })] });
    expect(meetingReminders(blank)).toEqual([{ memberId: "noemi", fill: [], assign: ["oracion"] }]);
  });

  it("an encargado who also owes a part gets both in one reminder", () => {
    const mixed = meeting({ seats: [seat("encargado", "noemi")], program: [line("oracion", "noemi"), line("dinamica1", "andy", { note: "x" })] });
    expect(meetingReminders(mixed)).toEqual([
      { memberId: "noemi", fill: [{ part: "oracion", gaps: ["music"], partners: [], partnerNames: [] }], assign: ["dinamica2"] },
    ]);
  });

  it("no encargado, or a typed-name one: nobody is told", () => {
    expect(meetingReminders(meeting({ seats: [seat("apoyo", "goma")] }))).toEqual([]);
    expect(meetingReminders(meeting({ seats: [seat("encargado", null, "Invitado")] }))).toEqual([]);
  });

  it("a meeting that is not the Saturday has no fixed program: nothing is «missing», only what it holds is reminded", () => {
    const junta = meeting({ kind: "ministry", seats: [seat("encargado", "noemi"), seat("comparte", "gaby")], program: [] });
    expect(meetingReminders(junta)).toEqual([
      { memberId: "gaby", fill: [{ part: "platica", gaps: ["note", "music"], partners: [], partnerNames: [] }], assign: [] },
    ]);
  });
});

describe("meetingReminders — never for a meeting that was not announced", () => {
  it.each([
    ["a draft", { published: false }],
    ["a group's meeting", { audience: { kind: "groups" as const, groups: ["otro-nivel"] } }],
    ["a meeting with no readable audience", { audience: null }],
  ])("%s reminds nobody", (_what, over) => {
    expect(meetingReminders({ ...FULL, ...over })).toEqual([]);
  });
});

// ── Who is written to ───────────────────────────────────────────────────────

describe("planReminderEmails — the audience only narrows", () => {
  it("one email per person who owes something, saying how far the meeting is and linking its page", async () => {
    const out = await plan(FULL, 14);
    expect(out.map((p) => p.email)).toEqual(["jacob@example.com", "andy@example.com", "sofi@example.com", "leo@example.com", "gaby@example.com"]);
    const andy = out.find((p) => p.memberId === "andy")!;
    expect(andy.subject).toBe("Recordatorio: falta llenar Dinámica 1 — sábado 5 de diciembre");
    expect(andy.html).toContain("Faltan dos semanas");
    expect(andy.html).toContain("junto con Sofi");
    expect(andy.html).toContain("https://app.example/jovenes/reunion/00000000-0000-4000-8000-000000000001");
    expect((await plan(FULL, 7))[0].html).toContain("Falta una semana");
  });

  it("the encargado's email names the parts with nobody", async () => {
    const out = await plan(meeting({ seats: [seat("encargado", "noemi")], program: [line("dinamica1", "andy", { note: "x" })] }));
    expect(out.map((p) => p.memberId)).toEqual(["noemi"]);
    expect(out[0].subject).toBe("Recordatorio: falta asignar Oración y Dinámica 2 — sábado 5 de diciembre");
    expect(out[0].html).toContain("Ver la reunión");
  });

  it.each([
    ["was disabled", { disabled: true }],
    ["left Jóvenes", { ministries: ["worship"] }],
    ["has no email", { email: "" }],
    ["turned «Asignaciones» off", { notifPrefs: { emailAssigned: false } }],
    ["turned every email off (legacy)", { notifPrefs: { email: false } }],
  ])("skips someone who %s, and still names them to their partner", async (_why, over) => {
    const people = PEOPLE.map((p) => (p._id === "andy" ? { ...p, ...over } : p));
    const out = await plan(FULL, 14, people);
    expect(out.some((p) => p.memberId === "andy")).toBe(false);
    expect(out.find((p) => p.memberId === "sofi")?.html).toContain("junto con Andy");
  });

  it("skips someone the read did not return", async () => {
    const out = await plan(FULL, 14, PEOPLE.filter((p) => p._id !== "jacob"));
    expect(out.some((p) => p.memberId === "jacob")).toBe(false);
  });

  it("honours the allowlist", async () => {
    const rows = await readPeople(PEOPLE);
    const out = planReminderEmails([{ meeting: FULL, days: 14 }], rows, { ...env, allow: ["leo@example.com"] });
    expect(out.map((p) => p.memberId)).toEqual(["leo"]);
  });

  it("a meeting that was not announced plans nothing, whoever is on it", async () => {
    expect(await plan({ ...FULL, published: false })).toEqual([]);
    expect(await plan({ ...FULL, audience: { kind: "groups", groups: ["otro-nivel"] } })).toEqual([]);
  });

  it("nobody outside the meeting is ever written to", async () => {
    const out = await plan(FULL, 14, [...PEOPLE, person("stranger"), person("frank", { role: "super-admin" })]);
    expect(out.some((p) => p.memberId === "stranger" || p.memberId === "frank")).toBe(false);
  });
});

// ── The cron step ───────────────────────────────────────────────────────────

describe("sendMinistryEventReminders", () => {
  const NOW = new Date("2026-11-22T01:10:00Z"); // 19:10 CDMX, Saturday 2026-11-21
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    h.fetch.mockReset();
    h.sendEmail.mockReset();
    h.readAnnounced.mockReset();
    h.sendEmail.mockResolvedValue({ ok: true });
    h.fetch.mockImplementation(async (_q: string, p: { ids: string[] }) => readPeople(PEOPLE, p.ids));
    vi.stubEnv("EMAIL_ALLOWLIST", "*");
    vi.stubEnv("EMAIL_REDIRECT_TO", "");
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    log.mockRestore();
    error.mockRestore();
  });

  it("asks for the CDMX day's two dates and mails each meeting with its own distance", async () => {
    const week = meeting({ _id: "ministryEvent.week", date: "2026-11-28", program: [line("oracion", "jacob")] });
    h.readAnnounced.mockResolvedValue([week, FULL]);
    const report = await sendMinistryEventReminders(NOW);
    expect(h.readAnnounced).toHaveBeenCalledWith("jovenes", ["2026-12-05", "2026-11-28"]);
    expect(report).toMatchObject({ ran: true, meetings: 2, planned: 6, emailed: 6, failed: 0, skipped: 0 });
    const sent = h.sendEmail.mock.calls.map((c) => c[0] as { to: string; subject: string; html: string });
    const jacob = sent.filter((m) => m.to === "jacob@example.com");
    // Jacob has Oración on both Saturdays: one email per meeting, each saying its own distance.
    expect(jacob.map((m) => m.subject).sort()).toEqual([
      "Recordatorio: falta llenar Oración — sábado 28 de noviembre",
      "Recordatorio: falta llenar Oración — sábado 5 de diciembre",
    ]);
    expect(jacob.find((m) => m.subject.includes("28 de noviembre"))?.html).toContain("Falta una semana");
    expect(jacob.find((m) => m.subject.includes("5 de diciembre"))?.html).toContain("Faltan dos semanas");
  });

  it("reads only the people the reminders name", async () => {
    h.readAnnounced.mockResolvedValue([FULL]);
    await sendMinistryEventReminders(NOW);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect((h.fetch.mock.calls[0][1] as { ids: string[] }).ids.sort()).toEqual(["andy", "gaby", "jacob", "leo", "sofi"]);
  });

  it("no meeting on those days, or nothing owed: no people read, no email", async () => {
    h.readAnnounced.mockResolvedValue([]);
    expect(await sendMinistryEventReminders(NOW)).toMatchObject({ ran: true, meetings: 0, planned: 0, emailed: 0 });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("a meeting the read returns on a day it did not ask for is ignored", async () => {
    h.readAnnounced.mockResolvedValue([{ ...FULL, date: "2026-12-06" }]);
    expect(await sendMinistryEventReminders(NOW)).toMatchObject({ meetings: 0, planned: 0 });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("on preview every email goes to the one redirect address, naming who it was for", async () => {
    vi.stubEnv("EMAIL_REDIRECT_TO", "one@example.com");
    h.readAnnounced.mockResolvedValue([meeting({ program: [line("oracion", "jacob")] })]);
    await sendMinistryEventReminders(NOW);
    expect(h.sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(["one@example.com"]);
    expect((h.sendEmail.mock.calls[0][0] as { subject: string }).subject).toMatch(/^\[→ jacob@example\.com\] Recordatorio: /);
  });

  it("a failed send is counted and logged, never thrown or retried", async () => {
    h.readAnnounced.mockResolvedValue([FULL]);
    h.sendEmail.mockResolvedValueOnce({ ok: false, error: "throttled" }).mockRejectedValueOnce(new Error("boom"));
    const report = await sendMinistryEventReminders(NOW);
    expect(report).toMatchObject({ planned: 5, emailed: 3, failed: 2, skipped: 0 });
    expect(h.sendEmail).toHaveBeenCalledTimes(5);
  });

  it("never throws: a read that fails is a report, so the cron's sweep and alarms still run", async () => {
    h.readAnnounced.mockRejectedValue(new Error("no token"));
    expect(await sendMinistryEventReminders(NOW)).toMatchObject({ ran: true, error: "ministry_reminder_failed" });
    h.readAnnounced.mockResolvedValue([FULL]);
    h.fetch.mockRejectedValue(new Error("sanity down"));
    expect(await sendMinistryEventReminders(NOW)).toMatchObject({ ran: true, error: "ministry_reminder_failed" });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("starts no wave once another send timeout would outlast the route, and says how many it left", async () => {
    h.readAnnounced.mockResolvedValue([FULL]);
    // The route already spent all but less than one send timeout of the step's deadline.
    const report = await sendMinistryEventReminders(NOW, { spentMs: REMINDER_STEP_DEADLINE_MS - 19_000 });
    expect(report).toMatchObject({ planned: 5, emailed: 0, failed: 0, skipped: 5 });
    expect(h.sendEmail).not.toHaveBeenCalled();
    // With room for one timeout, the wave goes.
    expect(await sendMinistryEventReminders(NOW, { spentMs: REMINDER_STEP_DEADLINE_MS - 21_000 })).toMatchObject({ emailed: 5, skipped: 0 });
  });

  it("more people than the pool is wide go in waves", async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      meeting({ _id: `ministryEvent.m${i}`, program: [line("dinamica1", "andy", { second: second("sofi") })] }),
    );
    h.readAnnounced.mockResolvedValue(many);
    let inFlight = 0;
    let widest = 0;
    h.sendEmail.mockImplementation(async () => {
      inFlight++;
      widest = Math.max(widest, inFlight);
      await Promise.resolve();
      inFlight--;
      return { ok: true };
    });
    expect(await sendMinistryEventReminders(NOW)).toMatchObject({ planned: 10, emailed: 10 });
    expect(widest).toBe(8);
  });
});
