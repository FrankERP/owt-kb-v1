import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ fetch: vi.fn(), sendEmail: vi.fn() }));
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: h.fetch } }));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: vi.fn() }, writeClient: {} }));
vi.mock("../email", () => ({ sendEmail: h.sendEmail, SEND_CONCURRENCY: 8 }));

import {
  MUSIC_AUDIENCE_QUERY,
  NOTICE_PEOPLE_QUERY,
  planClassEmails,
  planEventEmails,
  sendClassNotices,
  sendMinistryEventNotices,
  type ClassNoticeEffects,
  type EventNoticeEffects,
} from "../ministryEventNotify";
import type { ClassLine } from "../ministryLessonNotices";

type Doc = Record<string, unknown> & { _id: string };
const J = (level = "member", groups: string[] = ["otro-nivel"]) => ({
  ministries: ["jovenes"],
  ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level, groups }],
});
const person = (id: string, over: Record<string, unknown> = {}): Doc => ({
  _id: id,
  _type: "teamMembers",
  member_name: id[0].toUpperCase() + id.slice(1),
  email: `${id}@example.com`,
  ...J(),
  ...over,
});

const PEOPLE: Doc[] = [
  person("jacob"),
  person("andy", { alias: "Andy A." }),
  person("gaby"),
  person("frank", { role: "super-admin", ministries: ["worship", "jovenes"] }),
  { _id: "service-account-claude", _type: "teamMembers", member_name: "Claude", role: "super-admin", email: "bot@example.com" },
  { _id: "member-dev-verify", _type: "teamMembers", member_name: "Verificador", role: "super-admin", email: "verify@example.com" },
];

async function groq(dataset: Doc[], query: string, params: Record<string, unknown> = {}) {
  const value = await evaluate(parse(query), { dataset, params });
  return (await value.get()) as Doc[];
}

const MEETING = { id: "ministryEvent.00000000-0000-4000-8000-000000000001", date: "2026-11-21", time: "18:10", arrival: null, place: null, title: null, kind: "saturday" };
const effects = (over: Partial<EventNoticeEffects> = {}): EventNoticeEffects => ({
  ministry: "jovenes",
  actorId: "noemi",
  meeting: MEETING,
  moved: false,
  assigned: [{ memberId: "jacob", roles: [{ kind: "part", id: "dinamica1", label: "Dinámica 1", partners: ["andy"] }] }],
  music: [],
  ...over,
});
const env = { baseUrl: "https://app.example", allow: ["*"] };
/** The rows as the sender reads them: through the real people query (it is what adds `name`). */
const read = (docs: Doc[]) => groq(docs, NOTICE_PEOPLE_QUERY, { ids: docs.map((d) => d._id) });
const plan = async (e: EventNoticeEffects, people: Doc[] = PEOPLE, music: Doc[] = []) => planEventEmails(e, await read(people), music, env);

describe("planEventEmails — «Te toca» goes only to the person assigned", () => {
  it("one email, to the assigned person, naming their partner", async () => {
    const out = await plan(effects());
    expect(out.map((p) => p.email)).toEqual(["jacob@example.com"]);
    expect(out[0].subject).toBe("Te toca: Dinámica 1 — sábado 21 de noviembre");
    expect(out[0].html).toContain("junto con Andy A.");
    expect(out[0].html).toContain("https://app.example/jovenes/reunion/00000000-0000-4000-8000-000000000001");
  });

  it("«Cambió de fecha» only for who had been told the old date; someone the same write adds gets «Te toca»", async () => {
    const role = [{ kind: "part" as const, id: "dinamica1", label: "Dinámica 1", partners: [] }];
    const out = await plan(effects({ moved: true, assigned: [{ memberId: "jacob", roles: role, moved: true }, { memberId: "andy", roles: role }] }));
    expect(out.find((p) => p.memberId === "jacob")?.subject).toMatch(/^Cambió de fecha: /);
    expect(out.find((p) => p.memberId === "andy")?.subject).toMatch(/^Te toca: /);
  });

  it("the partner is named but not mailed", async () => {
    expect((await plan(effects())).some((p) => p.memberId === "andy")).toBe(false);
  });

  it.each([
    ["was disabled", { disabled: true }],
    ["left Jóvenes", { ministries: ["worship"] }],
    ["has no email", { email: "" }],
    ["turned «Asignaciones» off", { notifPrefs: { emailAssigned: false } }],
    ["turned every email off (legacy)", { notifPrefs: { email: false } }],
  ])("skips someone who %s", async (_why, over) => {
    const people = PEOPLE.map((p) => (p._id === "jacob" ? { ...p, ...over } : p));
    expect(await plan(effects(), people)).toEqual([]);
  });

  it("skips someone the read did not return, and the actor", async () => {
    expect(await plan(effects({ assigned: [{ memberId: "ghost", roles: [] }] }))).toEqual([]);
    expect(await plan(effects({ actorId: "jacob" }))).toEqual([]);
  });

  it("honours the allowlist", async () => {
    const rows = await read(PEOPLE);
    expect(planEventEmails(effects(), rows, [], { ...env, allow: ["andy@example.com"] })).toEqual([]);
    expect(planEventEmails(effects(), rows, [], { ...env, allow: ["jacob@example.com"] })).toHaveLength(1);
  });

  it("an explicit «Asignaciones» on wins over the legacy opt-out", async () => {
    const people = PEOPLE.map((p) => (p._id === "jacob" ? { ...p, notifPrefs: { email: false, emailAssigned: true } } : p));
    expect(await plan(effects(), people)).toHaveLength(1);
  });
});

describe("planEventEmails — the music request goes to the super-admins who are people", () => {
  const asking = effects({ assigned: [], actorId: "jacob", music: [{ part: "oracion", asks: true, note: "Suave", members: ["jacob"], names: [] }] });

  it("the real query returns Frank and neither system account", async () => {
    const audience = await groq(PEOPLE, MUSIC_AUDIENCE_QUERY);
    expect(audience.map((p) => p._id)).toEqual(["frank"]);
  });

  it("mails that audience, naming who asks", async () => {
    const out = await plan(asking, PEOPLE, await groq(PEOPLE, MUSIC_AUDIENCE_QUERY));
    expect(out.map((p) => p.email)).toEqual(["frank@example.com"]);
    expect(out[0].subject).toBe("Piden música de alabanza — Oración, sábado 21 de noviembre");
    expect(out[0].html).toContain("Jacob");
    expect(out[0].html).toContain("Suave");
  });

  it("re-checks every row it is handed: not a super-admin, a system account, disabled, opted out, the actor", async () => {
    const rows: Doc[] = [
      person("pastor"),
      { ...PEOPLE[4] },
      { ...PEOPLE[5] },
      person("exsuper", { role: "super-admin", disabled: true }),
      person("quiet", { role: "super-admin", notifPrefs: { emailProposals: false } }),
      person("jacob", { role: "super-admin" }),
    ];
    expect(await plan(asking, PEOPLE, rows)).toEqual([]);
  });

  it("a withdrawal is mailed the same way", async () => {
    const gone = effects({ assigned: [], actorId: "jacob", music: [{ part: "oracion", asks: false, note: null, members: ["jacob"], names: [] }] });
    const out = await plan(gone, PEOPLE, await groq(PEOPLE, MUSIC_AUDIENCE_QUERY));
    expect(out.map((p) => p.subject)).toEqual(["Ya no piden música de alabanza — Oración, sábado 21 de noviembre"]);
  });

  it("Frank asking for music himself is not told", async () => {
    const own = { ...asking, actorId: "frank" };
    expect(await plan(own, PEOPLE, await groq(PEOPLE, MUSIC_AUDIENCE_QUERY))).toEqual([]);
  });
});

describe("the people query", () => {
  it("returns exactly the ids asked for, never a draft", async () => {
    const rows = await groq([...PEOPLE, { ...person("jacob"), _id: "drafts.jacob" }], NOTICE_PEOPLE_QUERY, { ids: ["jacob", "andy", "drafts.jacob"] });
    expect(rows.map((r) => r._id).sort()).toEqual(["andy", "jacob"]);
    expect(rows.find((r) => r._id === "andy")?.name).toBe("Andy A.");
  });
});

describe("sendMinistryEventNotices", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    h.fetch.mockReset();
    h.sendEmail.mockReset();
    h.sendEmail.mockResolvedValue({ ok: true });
    h.fetch.mockImplementation((query: string, params?: Record<string, unknown>) => groq(PEOPLE, query, params));
    delete process.env.EMAIL_REDIRECT_TO;
    delete process.env.EMAIL_ALLOWLIST;
    process.env.NEXTAUTH_URL = "https://app.example";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it("does nothing, and reads nothing, without notices", async () => {
    await sendMinistryEventNotices(null);
    await sendMinistryEventNotices(effects({ assigned: [] }));
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("reads the people by id and sends one email per assigned person", async () => {
    await sendMinistryEventNotices(effects());
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0][1]).toEqual({ ids: ["jacob", "andy"] });
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.sendEmail.mock.calls[0][0]).toMatchObject({ to: "jacob@example.com", subject: "Te toca: Dinámica 1 — sábado 21 de noviembre" });
  });

  it("reads the music audience only when there is a music notice", async () => {
    await sendMinistryEventNotices(effects({ assigned: [], actorId: "jacob", music: [{ part: "oracion", asks: true, note: null, members: ["jacob"], names: [] }] }));
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.sendEmail.mock.calls.map((c) => c[0].to)).toEqual(["frank@example.com"]);
  });

  it("on preview every email goes to the one redirect address, with the real one in the subject", async () => {
    process.env.EMAIL_REDIRECT_TO = "solo@example.com";
    await sendMinistryEventNotices(effects());
    expect(h.sendEmail.mock.calls[0][0]).toMatchObject({ to: "solo@example.com", subject: "[→ jacob@example.com] Te toca: Dinámica 1 — sábado 21 de noviembre" });
  });

  it("never throws: a failed read and a failed send are logged", async () => {
    h.fetch.mockImplementation(async () => {
      throw new Error("sanity down");
    });
    await expect(sendMinistryEventNotices(effects())).resolves.toBeUndefined();
    h.fetch.mockImplementation((query: string, params?: Record<string, unknown>) => groq(PEOPLE, query, params));
    h.sendEmail.mockResolvedValue({ ok: false, error: "smtp" });
    await expect(sendMinistryEventNotices(effects())).resolves.toBeUndefined();
    h.sendEmail.mockImplementation(async () => {
      throw new Error("boom");
    });
    await expect(sendMinistryEventNotices(effects())).resolves.toBeUndefined();
  });
});

// ── A group's classes (ADR-0089, addendum of 2026-11-25) ────────────────────

describe("planClassEmails — a class change goes only to its holder, while in that group", () => {
  const line = (over: Partial<ClassLine> = {}): ClassLine => ({
    id: "ministryEvent.00000000-0000-4000-8000-0000000000c6",
    group: "otro-nivel",
    series: "El Caos Dentro de Mi",
    label: "Cap 6",
    date: "2026-11-29",
    time: "11:40",
    place: "Oasis Tepepan",
    ...over,
  });
  const classEffects = (notices: ClassNoticeEffects["notices"], actorId = "frank"): ClassNoticeEffects => ({ ministry: "jovenes", actorId, notices });
  const planC = async (e: ClassNoticeEffects, people: Doc[] = PEOPLE) => planClassEmails(e, await read(people), env);

  it("one email per person, a single new class saying its day, linking to it", async () => {
    const out = await planC(classEffects([{ memberId: "jacob", changes: [{ kind: "added", now: line() }] }]));
    expect(out.map((p) => [p.email, p.subject])).toEqual([["jacob@example.com", "Te toca dar la clase — domingo 29 de noviembre"]]);
    expect(out[0].html).toContain("Cap 6");
    expect(out[0].html).toContain("Otro Nivel");
    expect(out[0].html).toContain("domingo 29 de noviembre · 11:40 · Oasis Tepepan");
    expect(out[0].html).toContain("https://app.example/jovenes/reunion/00000000-0000-4000-8000-0000000000c6");
  });

  it("several changes in one email, with what it was before; the subject is constants and the group", async () => {
    const out = await planC(
      classEffects([
        {
          memberId: "jacob",
          changes: [
            { kind: "changed", was: line({ label: "Cap 7", date: "2026-11-29" }), now: line({ label: "Cap 7", date: "2026-12-06" }) },
            { kind: "changed", was: line({ label: "Cap 9", date: "2026-12-13" }), now: line({ label: "Cap 9", date: "2026-12-20" }) },
          ],
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].subject).toBe("Cambió tu rol de clases — Otro Nivel");
    expect(out[0].html).toContain("Antes: domingo 29 de noviembre · 11:40 · Oasis Tepepan");
    expect(out[0].html).toContain("domingo 6 de diciembre");
    expect(out[0].html).toContain("Cap 9");
  });

  it("only a class taken away: «ya no te toca», linking to the calendar", async () => {
    const out = await planC(classEffects([{ memberId: "jacob", changes: [{ kind: "removed", was: line() }] }]));
    expect(out[0].subject).toBe("Ya no te toca dar la clase — domingo 29 de noviembre");
    expect(out[0].html).toContain("YA NO TE TOCA");
    expect(out[0].html).toContain("https://app.example/jovenes/calendario");
  });

  it("a typed title is escaped in the body and never reaches the subject", async () => {
    const out = await planC(classEffects([{ memberId: "jacob", changes: [{ kind: "added", now: line({ label: "<b>Cap</b>" }) }] }]));
    expect(out[0].html).toContain("&lt;b&gt;Cap&lt;/b&gt;");
    expect(out[0].subject).not.toContain("Cap");
  });

  it("nothing to the actor, to someone outside the class's group, or to someone who may not be written to", async () => {
    const one = (memberId: string) => classEffects([{ memberId, changes: [{ kind: "added", now: line() }] }], "andy");
    expect(await planC(one("andy"))).toEqual([]);
    const moved = PEOPLE.map((p) => (p._id === "jacob" ? { ...p, ...J("member", ["invencibles"]) } : p));
    expect(await planC(one("jacob"), moved)).toEqual([]);
    expect(await planC(one("jacob"), PEOPLE.map((p) => (p._id === "jacob" ? { ...p, notifPrefs: { emailAssigned: false } } : p)))).toEqual([]);
    expect(await planC(one("jacob"), PEOPLE.map((p) => (p._id === "jacob" ? { ...p, disabled: true } : p)))).toEqual([]);
  });

  it("sendClassNotices reads only the people named, sends, and never throws", async () => {
    h.fetch.mockReset();
    h.sendEmail.mockReset();
    h.fetch.mockImplementation(async (q: string, p: Record<string, unknown>) => groq(PEOPLE, q, p));
    h.sendEmail.mockResolvedValue({ ok: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EMAIL_ALLOWLIST", "*");
    vi.stubEnv("EMAIL_REDIRECT_TO", "");
    try {
      await sendClassNotices(classEffects([{ memberId: "jacob", changes: [{ kind: "added", now: line() }] }]));
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(h.fetch.mock.calls[0][1]).toEqual({ ids: ["jacob"] });
      expect(h.sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(["jacob@example.com"]);
      h.fetch.mockRejectedValue(new Error("down"));
      await expect(sendClassNotices(classEffects([{ memberId: "jacob", changes: [{ kind: "added", now: line() }] }]))).resolves.toBeUndefined();
      await expect(sendClassNotices(null)).resolves.toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      log.mockRestore();
      error.mockRestore();
    }
  });
});
