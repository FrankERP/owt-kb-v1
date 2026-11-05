import { describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: vi.fn() },
  rawIntegrityClient: { fetch: vi.fn() },
}));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: vi.fn(), patch: vi.fn() },
}));

import {
  addDays,
  buildLeadSongReminderEmail,
  LEAD_REMINDER_QUERY,
  leadReminderWindow,
  planLeadReminders,
  reminderStateOf,
  sweepOptionsAfterReminders,
  weekdayOf,
  type LeadReminderRow,
} from "../leadSongReminder";
import { SEND_BUDGET_MS, SWEEP_DEADLINE_MS } from "../outboxSweep";

describe("leadReminderWindow", () => {
  it("is null on every day but Sunday", () => {
    // 2026-11-02 is a Monday … 2026-11-07 a Saturday.
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]) {
      expect(leadReminderWindow(d)).toBeNull();
    }
    expect(leadReminderWindow("not-a-date")).toBeNull();
  });

  it("covers Monday through the next Sunday on a Sunday ('week')", () => {
    expect(weekdayOf("2026-11-08")).toBe(0);
    expect(leadReminderWindow("2026-11-08", "week")).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
      types: ["sunday_role", "saturday_role", "special_role"],
    });
  });

  it("covers only the next Sunday's sunday_role ('sunday')", () => {
    expect(leadReminderWindow("2026-11-08", "sunday")).toEqual({
      from: "2026-11-15",
      to: "2026-11-15",
      types: ["sunday_role"],
    });
  });

  it("crosses month and year ends", () => {
    expect(addDays("2026-12-27", 7)).toBe("2027-01-03");
    expect(addDays("2026-11-29", 1)).toBe("2026-11-30");
  });
});

describe("reminderStateOf", () => {
  it("stays silent once songs exist or the proposal was sent", () => {
    expect(reminderStateOf({ setlistSongs: 1, proposal: null })).toBeNull();
    expect(reminderStateOf({ setlistSongs: 0, proposal: { status: "pending", songCount: 4 } })).toBeNull();
    expect(reminderStateOf({ setlistSongs: 0, proposal: { status: "approved", songCount: 4 } })).toBeNull();
  });

  it("names what is left to do", () => {
    expect(reminderStateOf({ setlistSongs: 0, proposal: null })).toBe("choose");
    expect(reminderStateOf({ setlistSongs: 0, proposal: { status: "draft", songCount: 0 } })).toBe("choose");
    expect(reminderStateOf({ setlistSongs: 0, proposal: { status: "draft", songCount: 3 } })).toBe("draft");
    expect(reminderStateOf({ setlistSongs: 0, proposal: { status: "changes_requested", songCount: 3 } })).toBe("changes");
  });
});

describe("buildLeadSongReminderEmail", () => {
  it("greets by first name, names the co-lead, links the proposal and escapes everything", () => {
    const { subject, html } = buildLeadSongReminderEmail({
      name: "Pau <b>Elizondo",
      label: "Domingo 15 nov",
      state: "choose",
      coLeads: ["Mkz & Co"],
      pastorMessage: "Hablaremos de <gracia>",
      link: "https://x.test/me/propose/abc",
    });
    expect(subject).toBe("Te toca dirigir — Domingo 15 nov");
    expect(html).toContain("Hola, Pau.");
    expect(html).toContain("Domingo 15 nov");
    expect(html).toContain("junto con");
    expect(html).toContain("Mkz &amp; Co");
    expect(html).toContain("MENSAJE DEL PASTOR");
    expect(html).toContain("Hablaremos de &lt;gracia&gt;");
    expect(html).toContain('href="https://x.test/me/propose/abc"');
    expect(html).not.toContain("<gracia>");
  });

  it("leaves out the pastor block and the co-lead clause when there are none", () => {
    const { subject, html } = buildLeadSongReminderEmail({
      name: "",
      label: "Sábado 14 nov",
      state: "changes",
      coLeads: [],
      pastorMessage: "   ",
      link: "https://x.test/p",
    });
    expect(subject).toBe("Tu propuesta tiene cambios pedidos — Sábado 14 nov");
    expect(html).toContain("Hola.");
    expect(html).not.toContain("MENSAJE DEL PASTOR");
    expect(html).not.toContain("junto con");
  });
});

describe("planLeadReminders", () => {
  const base = { baseUrl: "https://app.test", allow: ["*"] };
  const row = (over: Partial<LeadReminderRow> = {}): LeadReminderRow => ({
    _id: "role-1",
    _type: "sunday_role",
    date: "2026-11-15",
    leads: [
      { _id: "m1", name: "Pau", email: "Pau@Mail.com" },
      { _id: "m2", name: "Mkz", email: "mkz@mail.com" },
    ],
    setlistSongs: 0,
    proposal: null,
    pastorMessage: null,
    ...over,
  });

  it("emails each lead once, naming the other", () => {
    const out = planLeadReminders([row()], base);
    expect(out.map((p) => p.email)).toEqual(["pau@mail.com", "mkz@mail.com"]);
    expect(out[0].html).toContain("Mkz");
    expect(out[1].html).toContain("Pau");
    expect(out[0].html).toContain("https://app.test/me/propose/role-1");
  });

  it("skips a service that needs nothing", () => {
    expect(planLeadReminders([row({ setlistSongs: 1 })], base)).toEqual([]);
    expect(planLeadReminders([row({ proposal: { status: "pending", songCount: 3 } })], base)).toEqual([]);
  });

  it("skips a lead without email, without access, outside the allowlist, or a broken reference", () => {
    const out = planLeadReminders(
      [row({
        leads: [
          null,
          { _id: "a", name: "Sin correo", email: "" },
          { _id: "b", name: "Sin acceso", email: "b@mail.com", disabled: true },
          { _id: "c", name: "Fuera", email: "c@mail.com" },
          { _id: "d", name: "Dentro", email: "d@mail.com" },
          { _id: "d", name: "Dentro", email: "d@mail.com" },
        ],
      })],
      { baseUrl: "https://app.test", allow: ["d@mail.com"] },
    );
    expect(out.map((p) => p.memberId)).toEqual(["d"]);
  });

  it("labels a special with its name and time", () => {
    const [p] = planLeadReminders(
      [row({ _type: "special_role", service_name: "Noche de alabanza", time: "19:00", leads: [{ _id: "m1", name: "Pau", email: "p@m.com" }] })],
      base,
    );
    expect(p.subject).toBe("Te toca dirigir — Domingo 15 nov · Noche de alabanza · 19:00");
  });
});

describe("sweepOptionsAfterReminders", () => {
  it("keeps the defaults when the reminders did not run", () => {
    expect(sweepOptionsAfterReminders(undefined)).toEqual({});
    expect(sweepOptionsAfterReminders(0)).toEqual({});
  });

  it("charges the time the reminders spent to both sweep clocks", () => {
    expect(sweepOptionsAfterReminders(3_000)).toEqual({
      sendBudgetMs: SEND_BUDGET_MS - 3_000,
      sweepDeadlineMs: SWEEP_DEADLINE_MS - 3_000,
    });
    expect(sweepOptionsAfterReminders(120_000)).toEqual({ sendBudgetMs: 1_000, sweepDeadlineMs: 1_000 });
  });
});

// The query against groq-js — the engine Sanity runs — so the select(), the
// paired-setlist join and the `^` references are executed, not hand-mirrored.
describe("LEAD_REMINDER_QUERY", () => {
  const DATASET = [
    { _id: "m1", _type: "teamMembers", member_name: "Paulina Pérez", alias: "Pau", email: "pau@mail.com" },
    { _id: "m2", _type: "teamMembers", member_name: "Marco", email: "mkz@mail.com", disabled: true },
    // Next Sunday — no songs, with a pastor message.
    { _id: "sun15", _type: "sunday_role", week: "2026-11-15", published: true, Lead: [{ _ref: "m1" }, { _ref: "m2" }] },
    { _id: "serviceThread.sun15", _type: "serviceThread", pastor_message: { body: "Gracia" } },
    { _id: "fs15", _type: "featuredSongs", week: "2026-11-15", songs: [] },
    // Saturday with a chosen setlist.
    { _id: "sat14", _type: "saturday_role", week: "2026-11-14", Lead: [{ _ref: "m1" }] },
    { _id: "ss14", _type: "saturdarSongs", week: "2026-11-14", songs: [{ _key: "a", song: { _ref: "s1" } }] },
    // A special with a sent proposal.
    { _id: "sp12", _type: "special_role", date: "2026-11-12", published: true, Lead: [{ _ref: "m1" }], songs: [] },
    { _id: "setlistProposal.sp12", _type: "setlistProposal", service_ref: { _ref: "sp12" }, status: "pending", songs: [{ _key: "a" }], _createdAt: "2026-11-01T00:00:00Z" },
    // A draft service, a service with no Lead, and one outside the window.
    { _id: "sun15b", _type: "special_role", date: "2026-11-15", published: false, Lead: [{ _ref: "m1" }] },
    { _id: "sat14b", _type: "special_role", date: "2026-11-14", Lead: [] },
    { _id: "sun22", _type: "sunday_role", week: "2026-11-22", Lead: [{ _ref: "m1" }] },
  ];

  async function run(params: Record<string, unknown>): Promise<LeadReminderRow[]> {
    const value = await evaluate(parse(LEAD_REMINDER_QUERY), { dataset: DATASET, params });
    return (await value.get()) as LeadReminderRow[];
  }

  it("reads the week's published services with their songs, proposal and pastor message", async () => {
    const rows = await run({
      types: ["sunday_role", "saturday_role", "special_role"],
      from: "2026-11-09",
      to: "2026-11-15",
    });
    expect(rows.map((r) => r._id)).toEqual(["sp12", "sat14", "sun15"]);
    const byId = Object.fromEntries(rows.map((r) => [r._id, r]));
    expect(byId.sun15.date).toBe("2026-11-15");
    expect(byId.sun15.setlistSongs).toBe(0);
    expect(byId.sun15.pastorMessage).toBe("Gracia");
    expect(byId.sun15.leads).toEqual([
      { _id: "m1", name: "Pau", email: "pau@mail.com", disabled: null },
      { _id: "m2", name: "Marco", email: "mkz@mail.com", disabled: true },
    ]);
    expect(byId.sat14.setlistSongs).toBe(1);
    expect(byId.sp12.setlistSongs).toBe(0);
    expect(byId.sp12.proposal).toEqual({ status: "pending", songCount: 1 });

    // Only the Sunday needs a reminder, and only Pau has access.
    const planned = planLeadReminders(rows, { baseUrl: "https://app.test", allow: ["*"] });
    expect(planned.map((p) => [p.roleId, p.memberId])).toEqual([["sun15", "m1"]]);
    expect(planned[0].html).toContain("Marco");
  });
});
