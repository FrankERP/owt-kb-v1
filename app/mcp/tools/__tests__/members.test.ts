// Admin parity phase 4 (slice M): the seven people tools over fakes of their reads and of the people
// writer (`memberCommit.ts`, whose own half is `memberCommit.test.ts`). Proved here: the checks never
// write, a save writes only what was checked (the call's MAC first, then the fresh lines through the
// writer's `verify`), a retry answers «ya estaba», a create is keyed by its token, the access switch
// names the operator, and an unknown outcome is never worded as «no se escribió nada».
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: {}, writeClient: {} }));
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: {}, rawIntegrityClient: {} }));
vi.mock("@/app/utils/revalidate", () => ({ revalidateServiceViews: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { memberView } from "@/app/utils/memberEdits";
import { MEMBER_ERROR } from "@/app/utils/memberCommit";
import { PRINCIPAL, textOf } from "./monthToolFixtures";
import {
  CHECK_MEMBER_CHANGES_DESCRIPTION,
  CHECK_MEMBER_CHANGES_INPUT,
  CHECK_NEW_MEMBERS_DESCRIPTION,
  CHECK_NEW_MEMBERS_INPUT,
  checkMemberChangesResult,
  checkNewMembersResult,
  createMembersResult,
  getMemberResult,
  listMembersResult,
  saveMemberChangesResult,
  setMemberAccessResult,
  type MemberToolDeps,
} from "../members";
import { PEOPLE_TOKEN_TTL_S, memberCreateIds } from "../../members/peopleTokens";

const sc = (out: CallToolResult) => out.structuredContent as Record<string, unknown>;
const KEY = new TextEncoder().encode("k".repeat(48));
const NOW = 1_800_000_000;
const LINES = ["Alias: «Vale» → «Valeria»", "Regla: «Vale: Nunca en sábado» → «Valeria: Nunca en sábado»"];
const EDITS = [{ op: "set" as const, field: "alias" as const, value: "Valeria" }];

type FakeDeps = { [K in keyof MemberToolDeps]: Mock<MemberToolDeps[K]> };

const vale = { id: "vale", view: memberView({ member_name: "Valentina Sosa", alias: "Vale", email: "vale@example.com", role: "member" }) };
const kidsOnly = { id: "kid", view: memberView({ member_name: "Kiko", email: "kiko@example.com", ministries: ["kids"], disabled: true }) };

function deps(over: Partial<FakeDeps> = {}): FakeDeps {
  return {
    people: vi.fn<MemberToolDeps["people"]>(async () => [vale, kidsOnly]),
    person: vi.fn<MemberToolDeps["person"]>(async (id) => (id === "vale" ? vale : null)),
    countExisting: vi.fn<MemberToolDeps["countExisting"]>(async () => 0),
    check: vi.fn<MemberToolDeps["check"]>(async () => ({ ok: true, name: "Vale", lines: LINES, hasDraft: false })),
    save: vi.fn<MemberToolDeps["save"]>(async (_id, _edits, opts) => {
      const refused = opts.verify(LINES);
      if (refused) return { ok: false, status: 409, body: { error: refused, code: "not_the_checked" } };
      return { ok: true, status: 200, body: { saved: true }, effects: { unchanged: false, lines: LINES, name: "Vale" } };
    }),
    planNew: vi.fn<MemberToolDeps["planNew"]>(async (bodies) => ({ ok: true, plan: { docs: bodies as Array<Record<string, unknown>>, lines: ["Persona nueva:", "  Nombre: (sin nombre) → «Ana»"] } })),
    create: vi.fn<MemberToolDeps["create"]>(async (_b, opts) => {
      const refused = opts.verify(["Persona nueva:", "  Nombre: (sin nombre) → «Ana»"]);
      if (refused) return { ok: false, status: 409, body: { error: refused, code: "not_the_checked" } };
      return { ok: true, status: 200, body: {}, effects: { ids: [...opts.ids], lines: [] } };
    }),
    setAccess: vi.fn<MemberToolDeps["setAccess"]>(async () => ({ ok: true, status: 200, body: {}, effects: { changed: true } })),
    tokenKey: vi.fn<MemberToolDeps["tokenKey"]>(() => ({ ok: true, key: KEY })),
    nowS: vi.fn<MemberToolDeps["nowS"]>(() => NOW),
    ...over,
  };
}

async function checkedToken(d: FakeDeps, edits = EDITS): Promise<string> {
  const out = await checkMemberChangesResult({ memberId: "vale", edits }, d);
  return String(sc(out).token);
}

let d: FakeDeps;
beforeEach(() => {
  d = deps();
});

describe("list_members / get_member", () => {
  it("lists without emails, hides disabled people unless asked, filters by ministry name", async () => {
    const all = sc(await listMembersResult({}, d));
    expect(all.total).toBe(1);
    expect(JSON.stringify(all)).not.toContain("@example.com");
    const kids = sc(await listMembersResult({ ministry: "Oasis Kids", includeDisabled: true }, d));
    expect((kids.personas as Array<Record<string, unknown>>).map((p) => p.memberId)).toEqual(["kid"]);
  });

  it("get_member carries the email; a draft id is refused", async () => {
    expect(JSON.stringify(sc(await getMemberResult({ memberId: "vale" }, d)))).toContain("vale@example.com");
    expect(textOf(await getMemberResult({ memberId: "drafts.vale" }, d))).toMatch(/borrador/);
  });
});

describe("check_member_changes / save_member_changes", () => {
  it("the input is strict", () => {
    expect(CHECK_MEMBER_CHANGES_INPUT.safeParse({ memberId: "vale", edits: EDITS, extra: 1 }).success).toBe(false);
    expect(CHECK_MEMBER_CHANGES_INPUT.safeParse({ memberId: "vale", edits: [{ op: "set", field: "disabled", value: "x" }] }).success).toBe(false);
  });

  it("the check shows the lines and the proposal note when rules move, and writes nothing", async () => {
    const out = await checkMemberChangesResult({ memberId: "vale", edits: EDITS }, d);
    expect(textOf(out)).toContain(LINES[1]);
    expect(textOf(out)).toMatch(/propuesta de mes abierta/);
    expect(d.save).not.toHaveBeenCalled();
  });

  it("the save with the check's token writes; the writer sees the bearer as the actor", async () => {
    const token = await checkedToken(d);
    const out = await saveMemberChangesResult({ memberId: "vale", edits: EDITS, token }, PRINCIPAL, d);
    expect(sc(out)).toMatchObject({ ok: true, saved: true });
    expect(d.save.mock.calls[0][2].actorId).toBe(PRINCIPAL.sub);
  });

  it("other edits than the checked ones are refused before the writer", async () => {
    const token = await checkedToken(d);
    const out = await saveMemberChangesResult({ memberId: "vale", edits: [{ op: "set", field: "alias", value: "Otra" }], token }, PRINCIPAL, d);
    expect(sc(out)).toMatchObject({ refused: true, detail: "mismatch" });
    expect(d.save).not.toHaveBeenCalled();
  });

  it("fresh lines that differ from the checked ones are refused by the writer's verify", async () => {
    const token = await checkedToken(d, EDITS);
    d.save.mockImplementationOnce(async (_id, _e, opts) => {
      const refused = opts.verify([...LINES, "Ojo: la regla «Gaby» empezaría a aplicarle."]);
      return refused ? { ok: false, status: 409, body: { error: refused, code: "not_the_checked" } } : { ok: true, status: 200, body: {}, effects: { unchanged: false, lines: [], name: "Vale" } };
    });
    const out = await saveMemberChangesResult({ memberId: "vale", edits: EDITS, token }, PRINCIPAL, d);
    expect(textOf(out)).toMatch(/no son los que se revisaron/);
  });

  it("an expired token is refused, but a retry of a save that landed still answers «ya estaba guardado»", async () => {
    const token = await checkedToken(d);
    d.nowS.mockReturnValue(NOW + PEOPLE_TOKEN_TTL_S + 1);
    expect(textOf(await saveMemberChangesResult({ memberId: "vale", edits: EDITS, token }, PRINCIPAL, d))).toMatch(/más de 30 minutos/);
    d.save.mockResolvedValueOnce({ ok: true, status: 200, body: { unchanged: true }, effects: { unchanged: true, lines: [], name: "Vale" } });
    expect(textOf(await saveMemberChangesResult({ memberId: "vale", edits: EDITS, token }, PRINCIPAL, d))).toMatch(/Ya estaba guardado/);
  });

  it("a one-letter name is refused before the writer, as Personas' form refuses it (I15)", async () => {
    const out = await checkMemberChangesResult({ memberId: "vale", edits: [{ op: "set", field: "name", value: " V " }] }, d);
    expect(textOf(out)).toMatch(/al menos dos letras/);
    const created = await checkNewMembersResult({ members: [{ name: "Ana", email: "ana@example.com", ministries: ["Alabanza"] }, { name: "B", email: "b@example.com", ministries: ["Alabanza"] }] }, d);
    expect(textOf(created)).toMatch(/Persona 2: El nombre necesita al menos dos letras/);
  });

  it("only «someone changed it» is stale; a taken email is a 409 the model must not re-check", async () => {
    const token = await checkedToken(d);
    d.save.mockResolvedValueOnce({ ok: false, status: 409, body: { error: MEMBER_ERROR.changed } });
    expect(sc(await saveMemberChangesResult({ memberId: "vale", edits: EDITS, token }, PRINCIPAL, d))).toMatchObject({ code: "stale_revision" });
    d.save.mockResolvedValueOnce({ ok: false, status: 409, body: { error: "Ese correo ya lo tiene Pau.", code: "email_taken" } });
    expect(sc(await saveMemberChangesResult({ memberId: "vale", edits: EDITS, token }, PRINCIPAL, d))).toMatchObject({ code: "invalid_request", detail: "email_taken" });
  });

  it("a §3.1 refusal from the writer is passed on with «hazlo en la página»", async () => {
    const token = await checkedToken(d);
    d.save.mockResolvedValueOnce({ ok: false, status: 403, body: { error: "Desde el chat no se le quita el rol Admin a nadie; hazlo en la página.", code: "chat_access" } });
    const out = await saveMemberChangesResult({ memberId: "vale", edits: EDITS, token }, PRINCIPAL, d);
    expect(sc(out)).toMatchObject({ refused: true, code: "forbidden" });
    expect(textOf(out)).toMatch(/hazlo en la página/);
  });

  it("a writer that throws is an UNKNOWN outcome, never «no se escribió nada»", async () => {
    const token = await checkedToken(d);
    d.save.mockRejectedValueOnce(new Error("network"));
    const out = await saveMemberChangesResult({ memberId: "vale", edits: EDITS, token }, PRINCIPAL, d);
    expect(textOf(out)).toMatch(/No sé si se guardó/);
    expect(textOf(out)).not.toMatch(/No se escribió nada/);
  });

  it("no bearer → refused before any read", async () => {
    const out = await saveMemberChangesResult({ memberId: "vale", edits: EDITS, token: "x" }, null, d);
    expect(sc(out)).toMatchObject({ refused: true, code: "forbidden" });
    expect(d.save).not.toHaveBeenCalled();
  });
});

describe("check_new_members / create_members", () => {
  const MEMBERS = [{ name: "Ana", email: "Ana@Example.com", ministries: ["Jóvenes"], tipo: ["Voz"] }];

  it("the check maps names to the writer's body (ministries required) and mints a token", async () => {
    const out = await checkNewMembersResult({ members: MEMBERS }, d);
    expect(sc(out).token).toEqual(expect.any(String));
    expect(d.planNew.mock.calls[0][0]).toEqual([{ member_name: "Ana", email: "ana@example.com", memberType: ["voz"], ministries: ["jovenes"] }]);
  });

  it("creates at the token's ids; a retry where all exist answers «Ya estaban»; some existing is refused", async () => {
    const token = String(sc(await checkNewMembersResult({ members: MEMBERS }, d)).token);
    const ids = memberCreateIds(KEY, token, 1);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const out = await createMembersResult({ members: MEMBERS, token }, PRINCIPAL, d);
    expect(sc(out)).toMatchObject({ created: true, memberIds: ids });
    expect(d.create.mock.calls[0][1].ids).toEqual(ids);

    d.countExisting.mockResolvedValueOnce(1);
    expect(textOf(await createMembersResult({ members: MEMBERS, token }, PRINCIPAL, d))).toMatch(/Ya estaban/);

    const two = [...MEMBERS, { name: "Beto", email: "beto@example.com", ministries: ["Alabanza"] }];
    const token2 = String(sc(await checkNewMembersResult({ members: two }, d)).token);
    d.countExisting.mockResolvedValueOnce(1);
    expect(sc(await createMembersResult({ members: two, token: token2 }, PRINCIPAL, d))).toMatchObject({ refused: true, detail: "some_exist" });
  });

  it("an expired token whose people all exist still answers «Ya estaban»; otherwise it is refused", async () => {
    const token = String(sc(await checkNewMembersResult({ members: MEMBERS }, d)).token);
    d.nowS.mockReturnValue(NOW + PEOPLE_TOKEN_TTL_S + 1);
    d.countExisting.mockResolvedValueOnce(1);
    expect(textOf(await createMembersResult({ members: MEMBERS, token }, PRINCIPAL, d))).toMatch(/Ya estaban/);
    expect(textOf(await createMembersResult({ members: MEMBERS, token }, PRINCIPAL, d))).toMatch(/más de 30 minutos/);
    expect(d.create).not.toHaveBeenCalled();
  });

  it("a different batch than the checked one is refused", async () => {
    const token = String(sc(await checkNewMembersResult({ members: MEMBERS }, d)).token);
    const out = await createMembersResult({ members: [{ ...MEMBERS[0], role: "Admin" }], token }, PRINCIPAL, d);
    expect(sc(out)).toMatchObject({ refused: true, detail: "mismatch" });
  });
});

describe("set_member_access", () => {
  it("names the person, passes the bearer as the operator and the chat flag", async () => {
    const out = await setMemberAccessResult({ memberId: "vale", enabled: false }, PRINCIPAL, d);
    expect(textOf(out)).toMatch(/Vale ya no puede entrar/);
    expect(d.setAccess).toHaveBeenCalledWith("vale", true, { operatorIds: new Set([PRINCIPAL.sub]), chat: true });
  });

  it("a writer refusal (a manager) is passed on", async () => {
    d.setAccess.mockResolvedValueOnce({ ok: false, status: 403, body: { error: "Desde el chat no se deshabilita a quien administra; hazlo en la página.", code: "chat_access" } });
    expect(textOf(await setMemberAccessResult({ memberId: "vale", enabled: false }, PRINCIPAL, d))).toMatch(/hazlo en la página/);
  });
});

describe("the people tools' Jóvenes groups bound follows the registry (T5b)", () => {
  const five = ["otro-nivel", "invencibles", "emprendedores", "adrenalin", "guerreras"];
  const six = [...five, "otro-nivel"];
  const edit = (groups: string[]) => ({ memberId: "vale", edits: [{ op: "jovenes", level: "member", groups }] });
  const person = (groups: string[]) => ({
    members: [{ name: "Noemí", email: "noemi@example.com", ministries: ["jovenes"], jovenes: { level: "admin", groups } }],
  });

  it("the edit op accepts all five groups and refuses a sixth entry", () => {
    expect(CHECK_MEMBER_CHANGES_INPUT.safeParse(edit(five)).success).toBe(true);
    expect(CHECK_MEMBER_CHANGES_INPUT.safeParse(edit(six)).success).toBe(false);
  });

  it("a new person accepts all five groups and refuses a sixth entry", () => {
    expect(CHECK_NEW_MEMBERS_INPUT.safeParse(person(five)).success).toBe(true);
    expect(CHECK_NEW_MEMBERS_INPUT.safeParse(person(six)).success).toBe(false);
  });
});

describe("leaderOf in the people tools (per-group leadership T7, §11 N2)", () => {
  type Jovenes = { level: "member" | "leader" | "admin"; groups?: string[]; leaderOf?: string[] };
  const person = (jovenes: Jovenes) => ({ name: "Jacob", email: "jacob@example.com", ministries: ["Jóvenes"], jovenes });

  it("the edit op and a new person take leaderOf, bounded by the registry", () => {
    const five = ["otro-nivel", "invencibles", "emprendedores", "adrenalin", "guerreras"];
    const edit = (leaderOf: string[]) => ({ memberId: "vale", edits: [{ op: "jovenes", level: "leader", groups: five, leaderOf }] });
    expect(CHECK_MEMBER_CHANGES_INPUT.safeParse(edit(five)).success).toBe(true);
    expect(CHECK_MEMBER_CHANGES_INPUT.safeParse(edit([...five, "otro-nivel"])).success).toBe(false);
    expect(CHECK_NEW_MEMBERS_INPUT.safeParse({ members: [person({ level: "leader", groups: five, leaderOf: five })] }).success).toBe(true);
    expect(CHECK_NEW_MEMBERS_INPUT.safeParse({ members: [person({ level: "leader", groups: five, leaderOf: [...five, "x"] })] }).success).toBe(false);
  });

  it("both descriptions name leaderOf and its rule", () => {
    for (const text of [CHECK_MEMBER_CHANGES_DESCRIPTION, CHECK_NEW_MEMBERS_DESCRIPTION]) {
      expect(text).toContain("leaderOf son los grupos que lidera, parte de groups; solo con level leader");
    }
  });

  it("a new leader's names become ids and the body carries leaderOf; a member's carries []", async () => {
    const members = [
      person({ level: "leader", groups: ["Otro Nivel", "Invencibles", "Adrenalin"], leaderOf: ["Otro Nivel", "adrenalin"] }),
      { name: "Milo", email: "milo@example.com", ministries: ["Jóvenes"], jovenes: { level: "member" as const, groups: ["Emprendedores"] } },
    ];
    expect(sc(await checkNewMembersResult({ members }, d)).token).toEqual(expect.any(String));
    const bodies = d.planNew.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(bodies[0].ministryRoles).toEqual([
      { ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles", "adrenalin"], leaderOf: ["otro-nivel", "adrenalin"] },
    ]);
    expect(bodies[1].ministryRoles).toEqual([{ ministry: "jovenes", level: "member", groups: ["emprendedores"], leaderOf: [] }]);
  });

  it("a new person: a leader with no leaderOf, a led group outside groups, and leaderOf on an admin are refused before any plan", async () => {
    const refusedWith = async (jovenes: Jovenes) => {
      d.planNew.mockClear();
      const out = await checkNewMembersResult({ members: [person(jovenes)] }, d);
      expect(d.planNew).not.toHaveBeenCalled();
      return textOf(out);
    };
    expect(await refusedWith({ level: "leader", groups: ["Otro Nivel"] })).toContain("Di qué grupos lidera (leaderOf); los demás quedan como miembro.");
    expect(await refusedWith({ level: "leader", groups: ["Otro Nivel"], leaderOf: ["Invencibles"] })).toContain(
      "Para liderar «Invencibles» tiene que pertenecer a «Invencibles»: agrégalo a groups.",
    );
    expect(await refusedWith({ level: "admin", groups: ["Otro Nivel"], leaderOf: ["Otro Nivel"] })).toContain("Solo un líder lidera grupos; un admin ya administra todos.");
  });

  it("list_members and get_member say who leads what, in the chat's own words", async () => {
    const jacob = {
      id: "jacob",
      view: memberView({
        member_name: "Jacob", email: "jacob@example.com", ministries: ["jovenes"],
        ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles", "adrenalin"], leaderOf: ["otro-nivel", "adrenalin"] }],
      }),
    };
    d.people.mockResolvedValue([jacob]);
    d.person.mockResolvedValue(jacob);
    const listed = (sc(await listMembersResult({}, d)).personas as Array<Record<string, unknown>>)[0];
    expect(listed.jovenes).toBe("líder de Otro Nivel y Adrenalin; miembro de Invencibles");
    expect((sc(await getMemberResult({ memberId: "jacob" }, d)).persona as Record<string, unknown>).jovenes).toBe(
      "líder de Otro Nivel y Adrenalin; miembro de Invencibles",
    );
  });
});
