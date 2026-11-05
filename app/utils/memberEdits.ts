// People edited by parts (admin parity phase 4, slice M:
// docs/superpowers/plans/2026-11-05-owt-mcp-admin-parity-f4m-members.md, D2, D8, D13). Pure: no
// Sanity client, no `server-only`, so the commit (`memberCommit.ts`), the chat tools and the tests
// all run the same code.
//
//   · `memberView` reads a stored person the way every guard reads it: absent `ministries` ⇒ worship
//     (`normalizeMinistries`), a Jóvenes level only through `levelIn` (it counts only while `jovenes`
//     is in `ministries`), an absent or unknown `role` ⇒ `member`, a missing name ⇒ `""` (§7.8).
//   · `applyMemberEdits` turns the chat's small edits into the members PATCH's own touched-field body,
//     applied to the FRESH person, so a forgotten Tipo or ministry is never a removed one (D2). A field
//     whose result equals the stored one is left out (D13), so a no-op edit writes nothing.
//   · `resultingDoc` is what the PATCH would leave (the writer's own field rules), `memberChangeLines`
//     the Spanish before/after of every changed field — the lines the chat shows and its token binds.
//   · `holdsManagement` / `chatAccessRefusal` / `chatAccessToggleRefusal` are §3.1, the ONE definition
//     of what the chat may grant and never revoke (Frank, 2026-11-05: «un admin puede agregar admins,
//     pero no los puede revocar»). The routes never call them; only the chat's calls do.

import {
  ASSIGNABLE_MINISTRY_IDS,
  MANAGEABLE_MINISTRY_IDS,
  MINISTRIES,
  MINISTRY_LEVELS,
  normalizeMinistries,
  normalizeMinistryRoles,
  type MinistryId,
  type MinistryLevel,
  type MinistryRole,
} from "@/app/ministries";
import { parseMemberInstruments } from "@/app/components/admin/seatModel";
import { groupsIn, levelIn } from "./ministryAccess";
import { MEMBER_TYPES, MEMBER_TYPE_LABEL } from "./memberTypes";
import { ROLE_LABEL, type OWTRole } from "./roleLabel";

export const MEMBER_ROLES: readonly OWTRole[] = ["super-admin", "admin", "content-editor", "member"];

/** `/me`'s address check, now on every surface (§7.2). */
export const MEMBER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A stored `teamMembers` document as the commit reads it (untrusted shapes). */
export interface StoredMember {
  _id: string;
  _rev: string;
  member_name?: unknown;
  alias?: unknown;
  email?: unknown;
  role?: unknown;
  memberType?: unknown;
  instruments?: unknown;
  singsAndPlays?: unknown;
  ministries?: unknown;
  managesMinistries?: unknown;
  ministryRoles?: unknown;
  disabled?: unknown;
}

export const STORED_MEMBER_PROJECTION =
  "{ _id, _rev, member_name, alias, email, role, memberType, instruments, singsAndPlays, ministries, managesMinistries, ministryRoles, disabled }";

/** One person as every guard reads them. */
export interface MemberView {
  name: string;
  alias: string;
  email: string;
  role: OWTRole;
  tipo: string[];
  instruments: string[];
  singsAndPlays: boolean;
  ministries: MinistryId[];
  managesMinistries: MinistryId[];
  /** `null` when the person is not in Jóvenes; otherwise their level there (`levelIn`) and groups. */
  jovenes: { level: MinistryLevel; groups: string[] } | null;
  disabled: boolean;
}

/** The members PATCH/POST body fields a person edit may carry (the route's own names). */
export interface MemberWriteBody {
  member_name?: string;
  alias?: string;
  email?: string;
  role?: string;
  memberType?: string[];
  instruments?: string[];
  singsAndPlays?: boolean;
  ministries?: string[];
  managesMinistries?: string[];
  ministryRoles?: MinistryRole[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");

/** An absent or unknown stored role reads as `member` (§3.1). */
export function storedRole(v: unknown): OWTRole {
  return (MEMBER_ROLES as readonly unknown[]).includes(v) ? (v as OWTRole) : "member";
}

/** A person as every guard reads them (see the header). */
export function memberView(doc: Omit<StoredMember, "_id" | "_rev">): MemberView {
  const ministries = normalizeMinistries(doc.ministries);
  const access = {
    role: storedRole(doc.role),
    ministries,
    managesMinistries: (Array.isArray(doc.managesMinistries) ? doc.managesMinistries : []).filter(
      (m): m is MinistryId => typeof m === "string" && (Object.keys(MINISTRIES) as string[]).includes(m),
    ),
    ministryRoles: normalizeMinistryRoles(doc.ministryRoles, ministries),
  };
  const level = levelIn(access, "jovenes");
  return {
    name: str(doc.member_name),
    alias: str(doc.alias),
    email: str(doc.email),
    role: access.role,
    tipo: strings(doc.memberType),
    instruments: strings(doc.instruments),
    singsAndPlays: doc.singsAndPlays === true,
    ministries,
    managesMinistries: access.managesMinistries,
    jovenes: level === null ? null : { level, groups: groupsIn(access, "jovenes") },
    disabled: doc.disabled === true,
  };
}

/**
 * What a PATCH with this body leaves stored, by the writer's own field rules (`memberCommit.ts`): name
 * and alias trimmed (an empty name is skipped), email trimmed and lowercased, Tipo kept to
 * `MEMBER_TYPES`, `ministryRoles` set whole, or its levels for ministries the new list leaves out
 * dropped (`droppedMinistryRolePaths`).
 */
export function resultingDoc(stored: Omit<StoredMember, "_id" | "_rev">, body: MemberWriteBody): Omit<StoredMember, "_id" | "_rev"> {
  const next: Omit<StoredMember, "_id" | "_rev"> = { ...stored };
  if (typeof body.member_name === "string" && body.member_name.trim()) next.member_name = body.member_name.trim();
  if (typeof body.alias === "string") next.alias = body.alias.trim();
  if (typeof body.email === "string" && body.email.trim()) next.email = body.email.trim().toLowerCase();
  if (body.role) next.role = body.role;
  if (Array.isArray(body.memberType)) next.memberType = body.memberType.filter((t) => (MEMBER_TYPES as readonly string[]).includes(t));
  if (body.instruments !== undefined) next.instruments = body.instruments;
  if (body.singsAndPlays !== undefined) next.singsAndPlays = body.singsAndPlays;
  if (body.ministries !== undefined) next.ministries = body.ministries;
  if (body.managesMinistries !== undefined) next.managesMinistries = body.managesMinistries;
  if (body.ministryRoles !== undefined) next.ministryRoles = body.ministryRoles;
  return next;
}

// ── The chat's edits (D2) ────────────────────────────────────────────────────

export const MEMBER_SET_FIELDS = ["name", "alias", "email", "role"] as const;
export const MEMBER_LIST_FIELDS = ["tipo", "instruments", "ministries", "managesMinistries"] as const;

export type MemberEdit =
  | { op: "set"; field: (typeof MEMBER_SET_FIELDS)[number]; value: string }
  | { op: "singsAndPlays"; value: boolean }
  | { op: "add" | "remove"; field: (typeof MEMBER_LIST_FIELDS)[number]; value: string }
  | { op: "jovenes"; level: MinistryLevel | null; groups?: string[] };

export type ApplyResult = { ok: true; body: MemberWriteBody } | { ok: false; message: string };

const LEVEL_WORD: Record<MinistryLevel, string> = { member: "miembro", leader: "líder", admin: "admin" };

/** A Tipo by its key or its Spanish name («Voz», «Líder Domingo»). */
export function resolveTipo(value: string): string | null {
  const v = fold(value);
  return MEMBER_TYPES.find((t) => fold(t) === v || fold(MEMBER_TYPE_LABEL[t] ?? "") === v) ?? null;
}

/** A ministry by its id or its name («Alabanza», «Oasis Kids», «Kids», «Jóvenes»). */
export function resolveMinistry(value: string): MinistryId | null {
  const v = fold(value);
  for (const id of Object.keys(MINISTRIES) as MinistryId[]) {
    const name = fold(MINISTRIES[id].name);
    if (fold(id) === v || name === v || (id === "kids" && v === "kids")) return id;
  }
  return null;
}

/** A Jóvenes group by its id or its name. */
export function resolveJovenesGroup(value: string): string | null {
  const v = fold(value);
  return MINISTRIES.jovenes.groups.find((g) => fold(g.id) === v || fold(g.name) === v)?.id ?? null;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The chat's edits applied, in order, to the fresh person; the result is the members PATCH body of
 * ONLY the fields whose value changes (D13). Validates what the writer would skip silently (an empty
 * name or email) and what it cannot know (a Tipo, ministry or group by its Spanish name).
 */
export function applyMemberEdits(stored: Omit<StoredMember, "_id" | "_rev">, edits: readonly MemberEdit[]): ApplyResult {
  const before = memberView(stored);
  let name = before.name;
  let alias = before.alias.trim();
  let email = before.email.trim().toLowerCase();
  let role: string = before.role;
  let tipo = [...before.tipo];
  let instruments = [...before.instruments];
  let singsAndPlays = before.singsAndPlays;
  let ministries: string[] = [...before.ministries];
  let manages: string[] = [...before.managesMinistries];
  let jovenes: { level: MinistryLevel; groups: string[] } | null | undefined; // undefined = not edited

  for (const e of edits) {
    switch (e.op) {
      case "set": {
        const v = e.value.normalize("NFC").trim();
        if (e.field === "name") {
          if (!v) return { ok: false, message: "El nombre no puede quedar vacío." };
          name = v;
        } else if (e.field === "alias") {
          alias = v;
        } else if (e.field === "email") {
          const lower = v.toLowerCase();
          if (!lower) return { ok: false, message: "El correo no puede quedar vacío." };
          if (!MEMBER_EMAIL_RE.test(lower)) return { ok: false, message: `«${v}» no es un correo válido.` };
          email = lower;
        } else {
          const r = MEMBER_ROLES.find((x) => x === v || fold(ROLE_LABEL[x]) === fold(v));
          if (!r) return { ok: false, message: `«${v}» no es un rol. Los roles: Miembro, Editor, Admin.` };
          role = r;
        }
        break;
      }
      case "singsAndPlays":
        singsAndPlays = e.value;
        break;
      case "add":
      case "remove": {
        const add = e.op === "add";
        if (e.field === "tipo") {
          const t = resolveTipo(e.value);
          if (!t) return { ok: false, message: `«${e.value}» no es un Tipo. Los Tipos: ${MEMBER_TYPES.map((x) => MEMBER_TYPE_LABEL[x]).join(", ")}.` };
          tipo = add ? (tipo.includes(t) ? tipo : [...tipo, t]) : tipo.filter((x) => x !== t);
        } else if (e.field === "instruments") {
          const parsed = parseMemberInstruments([e.value]);
          if (!parsed.ok) return { ok: false, message: parsed.error };
          const label = parsed.value[0];
          instruments = add ? (instruments.includes(label) ? instruments : [...instruments, label]) : instruments.filter((x) => x !== label);
        } else if (e.field === "ministries") {
          const m = resolveMinistry(e.value);
          if (!m || !ASSIGNABLE_MINISTRY_IDS.includes(m)) {
            return { ok: false, message: `«${e.value}» no es un ministerio. Los ministerios: ${ASSIGNABLE_MINISTRY_IDS.map((id) => MINISTRIES[id].name).join(", ")}.` };
          }
          ministries = add ? (ministries.includes(m) ? ministries : [...ministries, m]) : ministries.filter((x) => x !== m);
        } else {
          const m = resolveMinistry(e.value);
          if (!m || !MANAGEABLE_MINISTRY_IDS.includes(m)) {
            return { ok: false, message: `Solo se puede administrar ${MANAGEABLE_MINISTRY_IDS.map((id) => MINISTRIES[id].name).join(", ")} así; Jóvenes se administra con el nivel admin.` };
          }
          manages = add ? (manages.includes(m) ? manages : [...manages, m]) : manages.filter((x) => x !== m);
        }
        break;
      }
      case "jovenes": {
        if (e.level === null) {
          jovenes = null;
          break;
        }
        if (!(MINISTRY_LEVELS as readonly string[]).includes(e.level)) return { ok: false, message: "Nivel de Jóvenes inválido." };
        const groups: string[] = [];
        for (const g of e.groups ?? []) {
          const id = resolveJovenesGroup(g);
          if (!id) return { ok: false, message: `«${g}» no es un grupo de Jóvenes. Los grupos: ${MINISTRIES.jovenes.groups.map((x) => x.name).join(", ")}.` };
          if (!groups.includes(id)) groups.push(id);
        }
        jovenes = { level: e.level, groups };
        break;
      }
    }
  }

  if (ministries.length === 0) return { ok: false, message: "Tiene que quedar en al menos un ministerio." };
  if (jovenes && !ministries.includes("jovenes")) {
    return { ok: false, message: "Para darle un nivel en Jóvenes tiene que pertenecer a Jóvenes: agrégale el ministerio en la misma revisión." };
  }

  const body: MemberWriteBody = {};
  if (name !== before.name) body.member_name = name;
  if (alias !== before.alias.trim()) body.alias = alias;
  if (email !== before.email.trim().toLowerCase()) body.email = email;
  if (role !== before.role) body.role = role;
  if (!sameList(tipo, before.tipo)) body.memberType = tipo;
  if (!sameList(instruments, before.instruments)) body.instruments = instruments;
  if (singsAndPlays !== before.singsAndPlays) body.singsAndPlays = singsAndPlays;
  if (!sameSet(manages, before.managesMinistries)) body.managesMinistries = manages;
  const ministriesChange = !sameSet(ministries, before.ministries);
  const jovenesChange =
    jovenes !== undefined &&
    !(jovenes === null
      ? before.jovenes === null || (before.jovenes.level === "member" && before.jovenes.groups.length === 0)
      : before.jovenes !== null && before.jovenes.level === jovenes.level && sameSet(jovenes.groups, before.jovenes.groups));
  if (ministriesChange || jovenesChange) body.ministries = ministries;
  // §7.7: a level always travels with `ministries` (`validateMinistryRolesWrite`).
  if (jovenesChange) body.ministryRoles = jovenes ? [{ ministry: "jovenes", level: jovenes.level, groups: jovenes.groups }] : [];
  return { ok: true, body };
}

// ── The before/after lines (D3) ──────────────────────────────────────────────

const quoted = (s: string, empty: string) => (s.trim() ? `«${s.trim()}»` : empty);

function setLine(label: string, before: readonly string[], after: readonly string[], word: (x: string) => string): string | null {
  const added = after.filter((x) => !before.includes(x)).map((x) => `+ ${word(x)}`);
  const removed = before.filter((x) => !after.includes(x)).map((x) => `− ${word(x)}`);
  return added.length || removed.length ? `${label}: ${[...added, ...removed].join(", ")}` : null;
}

function jovenesText(j: MemberView["jovenes"]): string {
  if (!j) return "no es de Jóvenes";
  const groups = j.groups.map((g) => MINISTRIES.jovenes.groups.find((x) => x.id === g)?.name ?? g);
  return `${LEVEL_WORD[j.level]}${groups.length ? ` (${groups.join(", ")})` : ""}`;
}

const plainJovenes = (j: MemberView["jovenes"]) => j !== null && j.level === "member" && j.groups.length === 0;

/** The Spanish before/after of every field that changes, in the form's order. No change, no line. */
export function memberChangeLines(before: MemberView | null, after: MemberView): string[] {
  const b: MemberView = before ?? {
    name: "", alias: "", email: "", role: "member", tipo: [], instruments: [], singsAndPlays: false,
    ministries: [], managesMinistries: [], jovenes: null, disabled: false,
  };
  const out: Array<string | null> = [];
  if (b.name !== after.name) out.push(`Nombre: ${quoted(b.name, "(sin nombre)")} → ${quoted(after.name, "(sin nombre)")}`);
  if (b.alias.trim() !== after.alias.trim()) out.push(`Alias: ${quoted(b.alias, "(sin alias)")} → ${quoted(after.alias, "(sin alias)")}`);
  if (b.email.trim().toLowerCase() !== after.email.trim().toLowerCase()) out.push(`Correo: ${quoted(b.email, "(sin correo)")} → ${quoted(after.email, "(sin correo)")}`);
  if (b.role !== after.role) out.push(`Rol: ${ROLE_LABEL[b.role]} → ${ROLE_LABEL[after.role]}`);
  out.push(setLine("Tipo", b.tipo, after.tipo, (t) => MEMBER_TYPE_LABEL[t] ?? t));
  out.push(setLine("Instrumentos", b.instruments, after.instruments, (x) => x));
  if (b.singsAndPlays !== after.singsAndPlays) out.push(`Canta y toca a la vez: ${b.singsAndPlays ? "sí" : "no"} → ${after.singsAndPlays ? "sí" : "no"}`);
  out.push(setLine("Ministerios", b.ministries, after.ministries, (m) => MINISTRIES[m as MinistryId]?.name ?? m));
  out.push(setLine("Administra", b.managesMinistries, after.managesMinistries, (m) => MINISTRIES[m as MinistryId]?.name ?? m));
  const bj = jovenesText(b.jovenes);
  const aj = jovenesText(after.jovenes);
  // Joining or leaving Jóvenes as a plain member is already the «Ministerios» line.
  const implied = (b.jovenes === null && plainJovenes(after.jovenes)) || (after.jovenes === null && plainJovenes(b.jovenes));
  if (bj !== aj && !implied) out.push(`Jóvenes: ${bj} → ${aj}`);
  return out.filter((x): x is string => x !== null);
}

// ── What the chat may grant, never revoke (§3.1, D8) ─────────────────────────

/** Manages people or services: a worship admin/super-admin, a Kids manager or a Jóvenes admin. */
export function holdsManagement(v: MemberView): boolean {
  return v.role === "admin" || v.role === "super-admin" || v.managesMinistries.length > 0 || v.jovenes?.level === "admin";
}

const IN_THE_PAGE = "hazlo en la página (Super admin → Personas).";

export const CHAT_ACCESS = {
  grantSuperAdmin: `Desde el chat no se da el rol Super Admin; ${IN_THE_PAGE}`,
  changeSuperAdmin: `Desde el chat no se le cambia el rol a un Super Admin; ${IN_THE_PAGE}`,
  lowerAdmin: `Desde el chat no se le quita el rol Admin a nadie; ${IN_THE_PAGE}`,
  dropManages: `Desde el chat no se le quita a nadie la administración de un ministerio; ${IN_THE_PAGE}`,
  dropJovenesAdmin: `Desde el chat no se le quita a nadie el nivel admin de Jóvenes; ${IN_THE_PAGE}`,
  managerEmail: `Desde el chat no se le cambia el correo a quien administra o edita contenido; ${IN_THE_PAGE}`,
  disableManager: `Desde el chat no se deshabilita a quien administra; ${IN_THE_PAGE}`,
  enableSuperAdmin: `Desde el chat no se vuelve a habilitar a un Super Admin; ${IN_THE_PAGE}`,
} as const;

/**
 * §3.1 for a create (`before` null) or a change, judged on the fresh stored person against the person
 * the write would leave. `null` = allowed.
 */
export function chatAccessRefusal(before: MemberView | null, after: MemberView): string | null {
  if (!before) return after.role === "super-admin" ? CHAT_ACCESS.grantSuperAdmin : null;
  if (before.role !== after.role) {
    if (before.role === "super-admin") return CHAT_ACCESS.changeSuperAdmin;
    if (after.role === "super-admin") return CHAT_ACCESS.grantSuperAdmin;
    if (before.role === "admin") return CHAT_ACCESS.lowerAdmin;
  }
  if (before.managesMinistries.some((m) => !after.managesMinistries.includes(m))) return CHAT_ACCESS.dropManages;
  if (before.jovenes?.level === "admin" && after.jovenes?.level !== "admin") return CHAT_ACCESS.dropJovenesAdmin;
  // §7.3: a content-editor's email is not changed from the chat either.
  if (before.email.trim().toLowerCase() !== after.email.trim().toLowerCase() && (holdsManagement(before) || before.role === "content-editor")) {
    return CHAT_ACCESS.managerEmail;
  }
  return null;
}

/** §3.1's `disabled` row: disable only someone who manages nothing; never enable a super-admin. */
export function chatAccessToggleRefusal(stored: MemberView, enable: boolean): string | null {
  if (enable) return stored.role === "super-admin" ? CHAT_ACCESS.enableSuperAdmin : null;
  return holdsManagement(stored) ? CHAT_ACCESS.disableManager : null;
}
