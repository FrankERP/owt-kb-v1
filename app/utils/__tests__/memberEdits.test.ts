// People edited by parts, and §3.1 — what the chat may grant and never revoke (slice M, D2, D8, D13).

import { describe, expect, it } from "vitest";

import {
  CHAT_ACCESS,
  applyMemberEdits,
  chatAccessRefusal,
  chatAccessToggleRefusal,
  holdsManagement,
  memberChangeLines,
  memberView,
  resultingDoc,
  type MemberEdit,
  type MemberView,
  type StoredMember,
} from "../memberEdits";

type Doc = Omit<StoredMember, "_id" | "_rev">;

const worshipMember: Doc = { member_name: "Paula Ríos", alias: "Pau", email: "pau@example.com", role: "member", memberType: ["voz"], instruments: ["Bass"] };

function apply(doc: Doc, edits: MemberEdit[]) {
  const r = applyMemberEdits(doc, edits);
  if (!r.ok) throw new Error(r.message);
  return { body: r.body, before: memberView(doc), after: memberView(resultingDoc(doc, r.body)) };
}

describe("memberView — the guards' own reading", () => {
  it("absent ministries reads as worship; an absent or unknown role as member; a missing name as empty", () => {
    const v = memberView({ role: "boss" });
    expect(v.ministries).toEqual(["worship"]);
    expect(v.role).toBe("member");
    expect(v.name).toBe("");
    expect(memberView({}).role).toBe("member");
  });

  it("a Jóvenes level counts only while jovenes is in ministries (levelIn)", () => {
    const stale = { ministries: ["worship"], ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "admin", groups: [] }] };
    expect(memberView(stale).jovenes).toBeNull();
    expect(holdsManagement(memberView(stale))).toBe(false);
    expect(memberView({ ...stale, ministries: ["worship", "jovenes"] }).jovenes).toEqual({ level: "admin", groups: [], leaderOf: [] });
  });

  it("jovenes.leaderOf is ledGroupsIn's answer: the led subset; [] for a legacy leader, a member or an admin", () => {
    const leader = (p: Record<string, unknown>) =>
      memberView({ ministries: ["jovenes"], ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles"], ...p }] }).jovenes;
    expect(leader({ leaderOf: ["otro-nivel"] })).toEqual({ level: "leader", groups: ["otro-nivel", "invencibles"], leaderOf: ["otro-nivel"] });
    expect(leader({})?.leaderOf).toEqual([]);
    expect(leader({ level: "admin", leaderOf: ["otro-nivel"] })?.leaderOf).toEqual([]);
  });
});

describe("applyMemberEdits — by parts, on the fresh person (D2, D13)", () => {
  it("Tipo and instruments by parts; untouched items kept; the lines name only the change", () => {
    const { body, before, after } = apply(worshipMember, [
      { op: "add", field: "tipo", value: "Instrumento" },
      { op: "remove", field: "instruments", value: "bass" },
    ]);
    expect(body).toEqual({ memberType: ["voz", "instrumento"], instruments: [] });
    expect(memberChangeLines(before, after)).toEqual(["Tipo: + Instrumento", "Instrumentos: − Bass"]);
  });

  it("adding Kids to a member with NO ministries field gives worship and kids, and «+ Oasis Kids»", () => {
    const { body, before, after } = apply(worshipMember, [{ op: "add", field: "ministries", value: "Oasis Kids" }]);
    expect(body.ministries).toEqual(["worship", "kids"]);
    expect(memberChangeLines(before, after)).toEqual(["Ministerios: + Oasis Kids"]);
  });

  it("a no-op edit gives no body field and no line", () => {
    const { body, before, after } = apply(worshipMember, [
      { op: "set", field: "name", value: " Paula Ríos " },
      { op: "set", field: "email", value: "PAU@example.com" },
      { op: "add", field: "tipo", value: "voz" },
      { op: "remove", field: "ministries", value: "kids" },
    ]);
    expect(body).toEqual({});
    expect(memberChangeLines(before, after)).toEqual([]);
  });

  it("refuses an empty name or email, an unknown Tipo, ministry or group, and an empty ministries list", () => {
    expect(applyMemberEdits(worshipMember, [{ op: "set", field: "name", value: "  " }]).ok).toBe(false);
    expect(applyMemberEdits(worshipMember, [{ op: "set", field: "email", value: "" }]).ok).toBe(false);
    expect(applyMemberEdits(worshipMember, [{ op: "set", field: "email", value: "not-an-email" }]).ok).toBe(false);
    expect(applyMemberEdits(worshipMember, [{ op: "add", field: "tipo", value: "Coro" }]).ok).toBe(false);
    expect(applyMemberEdits(worshipMember, [{ op: "add", field: "ministries", value: "Youth" }]).ok).toBe(false);
    expect(applyMemberEdits(worshipMember, [{ op: "remove", field: "ministries", value: "Alabanza" }]).ok).toBe(false);
    expect(
      applyMemberEdits({ ...worshipMember, ministries: ["worship", "jovenes"] }, [{ op: "jovenes", level: "leader", groups: ["Nope"], leaderOf: ["Nope"] }]).ok,
    ).toBe(false);
  });

  it("alias \"\" clears; a role by its Spanish label", () => {
    const { body, before, after } = apply(worshipMember, [
      { op: "set", field: "alias", value: "" },
      { op: "set", field: "role", value: "Editor" },
    ]);
    expect(body).toEqual({ alias: "", role: "content-editor" });
    expect(memberChangeLines(before, after)).toEqual(["Alias: «Pau» → (sin alias)", "Rol: Miembro → Editor"]);
  });

  it("a Jóvenes level always travels with ministries (§7.7) and needs Jóvenes in them", () => {
    expect(applyMemberEdits(worshipMember, [{ op: "jovenes", level: "leader", groups: ["Otro Nivel"], leaderOf: ["Otro Nivel"] }]).ok).toBe(false);
    const { body, before, after } = apply(worshipMember, [
      { op: "add", field: "ministries", value: "Jóvenes" },
      { op: "jovenes", level: "leader", groups: ["Otro Nivel"], leaderOf: ["otro nivel"] },
    ]);
    expect(body).toEqual({
      ministries: ["worship", "jovenes"],
      ministryRoles: [{ ministry: "jovenes", level: "leader", groups: ["otro-nivel"], leaderOf: ["otro-nivel"] }],
    });
    expect(memberChangeLines(before, after)).toEqual(["Ministerios: + Jóvenes", "Jóvenes: no es de Jóvenes → líder de Otro Nivel"]);
  });

  it("a member or admin item always carries leaderOf [] (the request's exact key set, §11 N2)", () => {
    for (const level of ["member", "admin"] as const) {
      const { body } = apply(worshipMember, [
        { op: "add", field: "ministries", value: "Jóvenes" },
        { op: "jovenes", level, groups: ["Emprendedores"] },
      ]);
      expect(body.ministryRoles).toEqual([{ ministry: "jovenes", level, groups: ["emprendedores"], leaderOf: [] }]);
    }
  });


  it("leaderOf: names or ids; a leader must name it; it must be in groups; never on a member or admin (T7)", () => {
    const inJovenes: Doc = { ...worshipMember, ministries: ["worship", "jovenes"] };
    const refused = (e: MemberEdit) => {
      const r = applyMemberEdits(inJovenes, [e]);
      return r.ok ? null : r.message;
    };
    const ASK = "Di qué grupos lidera (leaderOf); los demás quedan como miembro.";
    expect(refused({ op: "jovenes", level: "leader", groups: ["Otro Nivel"] })).toBe(ASK);
    expect(refused({ op: "jovenes", level: "leader", groups: ["Otro Nivel"], leaderOf: [] })).toBe(ASK);
    expect(refused({ op: "jovenes", level: "leader", groups: ["Otro Nivel"], leaderOf: ["Adrenalin"] })).toBe(
      "Para liderar «Adrenalin» tiene que pertenecer a «Adrenalin»: agrégalo a groups.",
    );
    expect(refused({ op: "jovenes", level: "leader", groups: ["Otro Nivel"], leaderOf: ["Nope"] })).toMatch(/^«Nope» no es un grupo de Jóvenes/);
    for (const level of ["member", "admin"] as const) {
      expect(refused({ op: "jovenes", level, groups: ["Otro Nivel"], leaderOf: ["Otro Nivel"] })).toBe("Solo un líder lidera grupos; un admin ya administra todos.");
      expect(refused({ op: "jovenes", level, groups: ["Otro Nivel"], leaderOf: [] })).toBeNull();
    }
  });

  it("Jacob's roster line: «líder de Otro Nivel y Adrenalin; miembro de Invencibles»; admin and member keep their list", () => {
    const jacob: Doc = { ...worshipMember, ministries: ["worship", "jovenes"], ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles"], leaderOf: ["otro-nivel", "invencibles"] }] };
    const { body, before, after } = apply(jacob, [
      { op: "jovenes", level: "leader", groups: ["Otro Nivel", "Invencibles", "Adrenalin"], leaderOf: ["Otro Nivel", "adrenalin"] },
    ]);
    expect(body).toEqual({
      ministries: ["worship", "jovenes"],
      ministryRoles: [{ ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles", "adrenalin"], leaderOf: ["otro-nivel", "adrenalin"] }],
    });
    expect(memberChangeLines(before, after)).toEqual([
      "Jóvenes: líder de Otro Nivel e Invencibles → líder de Otro Nivel y Adrenalin; miembro de Invencibles",
    ]);
    const noemi = apply(jacob, [{ op: "jovenes", level: "admin", groups: ["Emprendedores", "Guerreras"] }]);
    expect(memberChangeLines(noemi.before, noemi.after)).toEqual([
      "Jóvenes: líder de Otro Nivel e Invencibles → admin (Emprendedores, Guerreras)",
    ]);
    const milo = apply(jacob, [{ op: "jovenes", level: "member", groups: ["Emprendedores"] }]);
    expect(memberChangeLines(milo.before, milo.after)).toEqual(["Jóvenes: líder de Otro Nivel e Invencibles → miembro (Emprendedores)"]);
  });

  it("a change of leaderOf alone is a body and a line; the same leaderOf is no change", () => {
    const jacob: Doc = { ...worshipMember, ministries: ["worship", "jovenes"], ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles"], leaderOf: ["otro-nivel"] }] };
    const changed = apply(jacob, [{ op: "jovenes", level: "leader", groups: ["Otro Nivel", "Invencibles"], leaderOf: ["Invencibles", "Otro Nivel"] }]);
    expect(changed.body.ministryRoles).toEqual([{ ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles"], leaderOf: ["invencibles", "otro-nivel"] }]);
    expect(memberChangeLines(changed.before, changed.after)).toEqual([
      "Jóvenes: líder de Otro Nivel; miembro de Invencibles → líder de Invencibles y Otro Nivel",
    ]);
    const same = apply(jacob, [{ op: "jovenes", level: "leader", groups: ["Invencibles", "Otro Nivel"], leaderOf: ["Otro Nivel"] }]);
    expect(same.body).toEqual({});
    expect(memberChangeLines(same.before, same.after)).toEqual([]);
  });

  it("a legacy leader (no leaderOf) reads as leading no group, and says so", () => {
    const legacy: Doc = { ...worshipMember, ministries: ["worship", "jovenes"], ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "leader", groups: ["otro-nivel"] }] };
    const { before, after } = apply(legacy, [{ op: "jovenes", level: "leader", groups: ["Otro Nivel"], leaderOf: ["Otro Nivel"] }]);
    expect(memberChangeLines(before, after)).toEqual(["Jóvenes: líder de ningún grupo; miembro de Otro Nivel → líder de Otro Nivel"]);
  });

  it("a stale stored level that ministries brings back is shown", () => {
    const doc: Doc = { ...worshipMember, ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "admin", groups: [] }] };
    const { before, after } = apply(doc, [{ op: "add", field: "ministries", value: "jovenes" }]);
    expect(memberChangeLines(before, after)).toEqual(["Ministerios: + Jóvenes", "Jóvenes: no es de Jóvenes → admin"]);
  });
});

// ── §3.1, every row both ways ───────────────────────────────────────────────

const people: Record<string, Doc> = {
  worshipAdmin: { member_name: "A", email: "a@x.io", role: "admin" },
  superAdmin: { member_name: "S", email: "s@x.io", role: "super-admin" },
  kidsManager: { member_name: "K", email: "k@x.io", role: "member", ministries: ["kids"], managesMinistries: ["kids"] },
  jovenesAdmin: { member_name: "J", email: "j@x.io", role: "member", ministries: ["jovenes"], ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "admin", groups: [] }] },
  contentEditor: { member_name: "E", email: "e@x.io", role: "content-editor" },
  member: { member_name: "M", email: "m@x.io", role: "member" },
};

function judge(doc: Doc, edits: MemberEdit[]): string | null {
  const r = applyMemberEdits(doc, edits);
  if (!r.ok) throw new Error(r.message);
  return chatAccessRefusal(memberView(doc), memberView(resultingDoc(doc, r.body)));
}

describe("chatAccessRefusal — the chat grants, never revokes (§3.1)", () => {
  it("holdsManagement: admin, super-admin, a Kids manager, a Jóvenes admin — not a content-editor or a member", () => {
    const held = Object.fromEntries(Object.entries(people).map(([k, d]) => [k, holdsManagement(memberView(d))]));
    expect(held).toEqual({ worshipAdmin: true, superAdmin: true, kidsManager: true, jovenesAdmin: true, contentEditor: false, member: false });
  });

  it("role on create: member, content-editor, admin allowed; super-admin refused", () => {
    for (const role of ["member", "content-editor", "admin"]) expect(chatAccessRefusal(null, memberView({ role })), role).toBeNull();
    expect(chatAccessRefusal(null, memberView({ role: "super-admin" }))).toBe(CHAT_ACCESS.grantSuperAdmin);
  });

  it("role change: member/content-editor may go to member, editor, admin; never to super-admin", () => {
    for (const from of [people.member, people.contentEditor]) {
      for (const to of ["member", "content-editor", "admin"]) expect(judge(from, [{ op: "set", field: "role", value: to }]), to).toBeNull();
      expect(judge(from, [{ op: "set", field: "role", value: "super-admin" }])).toBe(CHAT_ACCESS.grantSuperAdmin);
    }
  });

  it("role change: a super-admin's role never changes; an admin is never lowered", () => {
    for (const to of ["member", "content-editor", "admin"]) {
      expect(judge(people.superAdmin, [{ op: "set", field: "role", value: to }]), to).toBe(CHAT_ACCESS.changeSuperAdmin);
    }
    for (const to of ["member", "content-editor"]) expect(judge(people.worshipAdmin, [{ op: "set", field: "role", value: to }]), to).toBe(CHAT_ACCESS.lowerAdmin);
    expect(judge(people.worshipAdmin, [{ op: "set", field: "role", value: "super-admin" }])).toBe(CHAT_ACCESS.grantSuperAdmin);
  });

  it("managesMinistries: add allowed, remove refused", () => {
    expect(judge(people.member, [{ op: "add", field: "managesMinistries", value: "kids" }])).toBeNull();
    expect(judge(people.kidsManager, [{ op: "remove", field: "managesMinistries", value: "kids" }])).toBe(CHAT_ACCESS.dropManages);
  });

  it("Jóvenes: raise to admin allowed; drop from admin, or leave Jóvenes as its admin, refused", () => {
    const leader: Doc = { ...people.member, ministries: ["jovenes"], ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "leader", groups: ["invencibles"], leaderOf: ["invencibles"] }] };
    expect(judge(leader, [{ op: "jovenes", level: "admin", groups: [] }])).toBeNull();
    expect(judge(leader, [{ op: "jovenes", level: "leader", groups: ["otro-nivel"], leaderOf: ["otro-nivel"] }])).toBeNull();
    // Leadership of a group is not management (ADR-0082 untouched): the chat adds or removes it.
    expect(judge(leader, [{ op: "jovenes", level: "leader", groups: ["invencibles", "otro-nivel"], leaderOf: ["otro-nivel"] }])).toBeNull();
    expect(judge(leader, [{ op: "jovenes", level: "member", groups: ["invencibles"] }])).toBeNull();
    expect(judge(people.jovenesAdmin, [{ op: "jovenes", level: "leader", groups: ["invencibles"], leaderOf: ["invencibles"] }])).toBe(CHAT_ACCESS.dropJovenesAdmin);
    expect(judge(people.jovenesAdmin, [{ op: "jovenes", level: null }])).toBe(CHAT_ACCESS.dropJovenesAdmin);
    expect(judge({ ...people.jovenesAdmin, ministries: ["worship", "jovenes"] }, [{ op: "remove", field: "ministries", value: "jovenes" }])).toBe(
      CHAT_ACCESS.dropJovenesAdmin,
    );
  });

  it("email: changed for a member; refused for everyone who manages, and for a content-editor (§7.3)", () => {
    expect(judge(people.member, [{ op: "set", field: "email", value: "new@x.io" }])).toBeNull();
    for (const k of ["worshipAdmin", "superAdmin", "kidsManager", "jovenesAdmin", "contentEditor"]) {
      expect(judge(people[k], [{ op: "set", field: "email", value: "new@x.io" }]), k).toBe(CHAT_ACCESS.managerEmail);
    }
  });

  it("name, alias, Tipo, instruments and «Canta y toca» are always allowed", () => {
    for (const doc of Object.values(people)) {
      expect(
        judge(doc, [
          { op: "set", field: "alias", value: "Nuevo" },
          { op: "add", field: "tipo", value: "voz" },
          { op: "singsAndPlays", value: true },
        ]),
      ).toBeNull();
    }
  });
});

describe("chatAccessToggleRefusal — the disabled row", () => {
  it("disables only someone who manages nothing; never enables a super-admin", () => {
    const v = (k: string): MemberView => memberView(people[k]);
    for (const k of ["member", "contentEditor"]) expect(chatAccessToggleRefusal(v(k), false), k).toBeNull();
    for (const k of ["worshipAdmin", "superAdmin", "kidsManager", "jovenesAdmin"]) expect(chatAccessToggleRefusal(v(k), false), k).toBe(CHAT_ACCESS.disableManager);
    for (const k of ["member", "contentEditor", "worshipAdmin", "kidsManager", "jovenesAdmin"]) expect(chatAccessToggleRefusal(v(k), true), k).toBeNull();
    expect(chatAccessToggleRefusal(v("superAdmin"), true)).toBe(CHAT_ACCESS.enableSuperAdmin);
  });
});
