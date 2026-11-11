// The people writer, after authorization (admin parity phase 4, slice M:
// docs/superpowers/plans/2026-11-05-owt-mcp-admin-parity-f4m-members.md). `POST /api/admin/members`,
// `PATCH /api/admin/members/[id]`, `PATCH /api/admin/members/[id]/disable` and `PATCH /api/me` check
// their session and parse JSON, then call this module; the MCP people tools call it too, so every
// surface validates, refuses and writes a person through one code path (ADR-0043, D1).
//
// WHAT EVERY SURFACE GAINED (D5, D6, D12, D13), judged only when the value CHANGES (a present field is
// not a changed one: the /admin form and /me re-send name, alias and email on every save):
//
//   · D5  an email another `teamMembers` document has (drafts and disabled people included; only the
//         person's own `drafts.<id>` excluded) is refused — sign-in takes the FIRST match (`auth.ts`);
//   · D12 a name or alias equal to another member's name or alias is refused — a rule text naming two
//         people resolves to whichever comes first;
//   · D6  a name or alias change renames the solver rules that would stop naming the person, in ONE
//         transaction with the person (both revision-asserted), by a TARGETED set of the renamed person
//         paths only (`memberRuleRename.ts`) — the third targeted rules writer CLAUDE.md allows. A new
//         name equal to a rule text that names nobody is reported («empezaría a aplicarle»).
//
// A person read is now pinned: whenever the commit reads the person (to judge a role, a ministry, a
// name, an alias or an email), the write asserts that read's `_rev` (409 «Alguien más cambió…»).
//
// /me (`patchOwnProfile`) shares the same core, but never shows a member another person's name or a
// rule's text: its refusals are generic (D1, §7.4).
//
// THE CHAT (`checkMemberEdits`, `saveMemberEdits`, `planNewMembers`, `createMembers`,
// `setMemberDisabled` with `chat`) additionally applies §3.1 (`chatAccessRefusal`): it grants, never
// revokes, management. The routes never pass `chat`.
//
// Nobody is notified by a people write; service views and /me are revalidated.

import { revalidatePath } from "next/cache";

import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import {
  WORSHIP_ROLE_NEEDS_WORSHIP,
  droppedMinistryRolePaths,
  ministryRolesForStorage,
  normalizeMinistries,
  normalizeMinistryRoles,
  validateMinistryRolesWrite,
  validateMinistryWrite,
  worshipRoleWithoutWorship,
  type MinistryRole,
  type MinistryRoleWrite,
} from "@/app/ministries";
import { parseMemberInstruments } from "@/app/components/admin/seatModel";
import type { CommitOutcome } from "@/app/utils/commitOutcome";
import { MEMBER_TYPES } from "@/app/utils/memberTypes";
import { NOTIFY_PREF_FIELD, wantsNotification, type NotifyKind } from "@/app/utils/notifyPrefs";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { SOLVER_CONFIG_DOC_ID } from "@/app/utils/solverConfigWriteRequest";
import { displayMemberName } from "@/app/utils/memberRuleNames";
import {
  MEMBER_EMAIL_RE,
  STORED_MEMBER_PROJECTION,
  applyMemberEdits,
  chatAccessRefusal,
  chatAccessToggleRefusal,
  memberChangeLines,
  memberView,
  resultingDoc,
  type MemberEdit,
  type MemberView,
  type MemberWriteBody,
  type StoredMember,
} from "@/app/utils/memberEdits";
import {
  ambiguousRuleNote,
  nameTakenBy,
  namesChanged,
  namesOf,
  orphanRuleWarnings,
  planRuleRename,
  type RosterRow,
} from "@/app/utils/memberRuleRename";

const VALID_ROLES = ["super-admin", "admin", "content-editor", "member"];
const EMAIL_KINDS = Object.keys(NOTIFY_PREF_FIELD) as NotifyKind[];

export const MEMBER_ERROR = {
  notFound: "Miembro no encontrado.",
  changed: "Alguien más cambió a esta persona; recarga.",
  rulesChanged: "Alguien cambió las reglas mientras guardabas; recarga y vuelve a guardar.",
  // /me (D1, §7.4): never another person's name or a rule's text.
  meEmailTaken: "Ese correo ya está en uso.",
  meAliasTaken: "Ese alias ya lo usa otra persona.",
  meAliasUnavailable: "Ese alias no está disponible; elige otro.",
  meAliasRules: "No se pudo guardar tu alias; pídele a un administrador que lo cambie.",
  meChanged: "Alguien más cambió tu perfil; recarga.",
  meBadEmail: "Correo electrónico inválido.",
} as const;

type Refusal = { ok: false; status: number; body: Record<string, unknown> };

function refuse(status: number, error: string, extra: Record<string, unknown> = {}): Refusal {
  return { ok: false, status, body: { error, ...extra } };
}

function fields(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

const lowerTrim = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

// ── Reads ────────────────────────────────────────────────────────────────────

/** The person, by exact id (the raw perspective: a draft id is its own document). */
async function readStored(id: string): Promise<StoredMember | null> {
  const stored = await serverClient.fetch<StoredMember | null>(
    `*[_type == "teamMembers" && _id == $id][0]${STORED_MEMBER_PROJECTION}`,
    { id },
  );
  return stored && typeof stored._rev === "string" ? stored : null;
}

/** Every published person's names (D6, D12). Disabled people are people: a rule may name them. */
async function readRoster(): Promise<RosterRow[]> {
  const rows: unknown = await serverClient.fetch(
    `*[_type == "teamMembers" && !(_id in path("drafts.**"))]{ _id, member_name, alias }`,
    {},
  );
  if (!Array.isArray(rows)) throw new Error("member roster read failed");
  return rows as RosterRow[];
}

/** The raw rules document (D6 patches its paths), or null when it does not exist. */
async function readRulesDoc(): Promise<(Record<string, unknown> & { _rev: string }) | null> {
  const doc: unknown = await serverClient.fetch(`*[_id == $id][0]`, { id: SOLVER_CONFIG_DOC_ID });
  if (doc === null || doc === undefined) return null;
  if (typeof doc !== "object" || typeof (doc as { _rev?: unknown })._rev !== "string") throw new Error("rules read failed");
  return doc as Record<string, unknown> & { _rev: string };
}

/**
 * D5: who else has this email, case-insensitively, under the raw perspective sign-in reads (drafts and
 * disabled people included). Only the person's own Studio draft is excluded.
 */
async function emailOwners(emails: readonly string[], selfId: string | null): Promise<Array<RosterRow & { email?: unknown }>> {
  const rows: unknown = await serverClient.fetch(
    `*[_type == "teamMembers" && lower(email) in $emails && !(_id in $self)]{ _id, member_name, alias, email }`,
    { emails: [...emails], self: selfId ? [selfId, `drafts.${selfId}`] : [] },
  );
  if (!Array.isArray(rows)) throw new Error("email owner read failed");
  return rows as Array<RosterRow & { email?: unknown }>;
}

const nameOfRow = (row: RosterRow) => displayMemberName(namesOf(row)) || "otra persona";

// ── The members PATCH's own body validation (unchanged from the route) ───────

interface ValidPatch {
  patch: Record<string, unknown>;
  unsetPaths: string[];
  notifPatch: Record<string, unknown>;
  touchesRoleOrMinistries: boolean;
  /** The request's validated `ministryRoles`, or null. `planPatch` stores them through K1, after its read. */
  ministryRoles: MinistryRoleWrite[] | null;
}

// ── K1: a leader's stored `leaderOf` (PR 1 only; PR 2 deletes it) ────────────

/** The 409 when a request would empty the groups a stored leader leads (plan §7 K1, §11 N7). */
export const LEADER_OF_KEPT =
  "Los grupos que lidera esta persona no se pueden cambiar desde aquí. Quítale el nivel de líder, guarda, y vuelve a dárselo.";

const sameGroups = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((g) => b.includes(g));

/**
 * K1 (plan `2026-11-11-jovenes-per-group-leadership.md` §7, §11 N7; ADR-0085). PR 1's requests carry
 * `{ ministry, level, groups }` with no `leaderOf`; this decides the `leaderOf` each item is STORED
 * with, from the stored person (`null` = a create). It keeps, narrows or refuses a stored subset and
 * never widens one, so PR 1 code — production while PR 2 is on `preview`, or after a rollback of
 * PR 2 — cannot hand a narrowed leader back every group:
 *   · not a leader → no `leaderOf` (I2);
 *   · the stored item is a leader whose `leaderOf` is PRESENT (not absent, `null` or `undefined`) and
 *     does not name exactly its kept stored groups (as a set) → a stored narrowing: its normalized
 *     value ∩ the request's groups (a non-array normalizes to `[]`); empty → `null` (the caller's 409);
 *   · otherwise (a create, not a leader before, a legacy item, or a stored `leaderOf` equal to the
 *     stored groups, which says «leads all» as a legacy item does) → the request's groups.
 * PR 1's `memberView` does not show `leaderOf`, so a narrowing here is not in the chat's lines: fail
 * closed by construction (it only keeps, narrows or refuses).
 */
export function keepLeaderOf(
  items: readonly MinistryRoleWrite[],
  stored: Pick<StoredMember, "ministries" | "ministryRoles"> | null,
): MinistryRole[] | null {
  const read = stored ? normalizeMinistryRoles(stored.ministryRoles, normalizeMinistries(stored.ministries)) : [];
  const rawItems = stored && Array.isArray(stored.ministryRoles)
    ? stored.ministryRoles.filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    : [];
  const out: MinistryRole[] = [];
  for (const item of items) {
    if (item.level !== "leader") {
      out.push({ ...item, leaderOf: [] });
      continue;
    }
    const before = read.find((r) => r.ministry === item.ministry);
    const raw = rawItems.filter((r) => r.ministry === item.ministry);
    if (!before) {
      // The read dropped the stored item (the ministry is not in `ministries`, e.g. unticked in Studio,
      // or two items name it), yet a stored `leaderOf` may still say «leads only these». Never widen
      // past it: intersect with every present one that does not name exactly its own stored groups.
      let led = [...item.groups];
      for (const r of raw) {
        if (r.leaderOf === undefined || r.leaderOf === null) continue;
        const storedLed = Array.isArray(r.leaderOf) ? r.leaderOf.filter((g): g is string => typeof g === "string") : [];
        const storedGroups = Array.isArray(r.groups) ? r.groups.filter((g): g is string => typeof g === "string") : [];
        if (r.level === "leader" && sameGroups(storedLed, storedGroups)) continue;
        led = led.filter((g) => storedLed.includes(g));
      }
      if (led.length === 0) return null;
      out.push({ ...item, leaderOf: led });
      continue;
    }
    const storedLeader = before?.level === "leader" && raw.length === 1 && raw[0].leaderOf !== undefined && raw[0].leaderOf !== null;
    if (!storedLeader || sameGroups(before.leaderOf, before.groups)) {
      out.push({ ...item, leaderOf: [...item.groups] });
      continue;
    }
    const narrowed = item.groups.filter((g) => before.leaderOf.includes(g));
    if (narrowed.length === 0) return null;
    out.push({ ...item, leaderOf: narrowed });
  }
  return out;
}

function validatePatchBody(body: Record<string, unknown>): { ok: true; value: ValidPatch } | Refusal {
  if (body.role !== undefined && !VALID_ROLES.includes(body.role as string)) return refuse(400, "Invalid role");

  const patch: Record<string, unknown> = {};
  // NFC, as the rules reader (`normalizeLabel`) reads names: an NFD name would otherwise never match its rule text.
  if (typeof body.member_name === "string" && body.member_name.trim()) patch.member_name = body.member_name.trim().normalize("NFC");
  if (typeof body.alias === "string") patch.alias = body.alias.trim().normalize("NFC");
  if (typeof body.email === "string" && body.email.trim()) patch.email = body.email.trim().toLowerCase();
  if (body.role) patch.role = body.role;
  // Keep only recognised member types (drops unknown values rather than storing them).
  if (Array.isArray(body.memberType)) {
    const valid: readonly string[] = MEMBER_TYPES;
    patch.memberType = body.memberType.filter((t) => valid.includes(t));
  }
  // Declared instruments: absent = untouched; `[]` IS stored («declares nothing»).
  if (body.instruments !== undefined) {
    const parsed = parseMemberInstruments(body.instruments);
    if (!parsed.ok) return refuse(400, parsed.error);
    patch.instruments = parsed.value;
  }
  // «Canta y toca a la vez» (ADR-0078): absent = untouched; only a boolean is stored.
  if (body.singsAndPlays !== undefined) {
    if (typeof body.singsAndPlays !== "boolean") return refuse(400, "singsAndPlays must be a boolean");
    patch.singsAndPlays = body.singsAndPlays;
  }
  // Ministry membership/management: absent = untouched (an unconditional write would hand a kids-only
  // volunteer the whole worship catalog). Above the «Nothing to update» check on purpose.
  for (const field of ["ministries", "managesMinistries"] as const) {
    if (body[field] === undefined) continue;
    const error = validateMinistryWrite(field, body[field]);
    if (error) return refuse(400, error);
    patch[field] = body[field];
  }
  // Levels in a leveled ministry (Jóvenes, ADR-0075), validated against THIS request's `ministries`:
  // set whole, or a `ministries` that leaves a leveled ministry out unsets its stale level.
  // The stored `leaderOf` is decided by `planPatch` from the stored person (K1), never here.
  let unsetPaths: string[] = [];
  let ministryRoles: MinistryRoleWrite[] | null = null;
  if (body.ministryRoles !== undefined) {
    const error = validateMinistryRolesWrite(body.ministryRoles, body.ministries);
    if (error) return refuse(400, error);
    ministryRoles = body.ministryRoles as MinistryRoleWrite[];
  } else if (body.ministries !== undefined) {
    unsetPaths = droppedMinistryRolePaths(body.ministries as string[]);
  }
  // The five per-type email toggles, keyed off the same map every sender uses.
  const notifPatch: Record<string, unknown> = {};
  if (typeof body.notifEmail === "boolean") notifPatch["notifPrefs.email"] = body.notifEmail;
  for (const kind of EMAIL_KINDS) {
    const field = NOTIFY_PREF_FIELD[kind];
    if (typeof body[field] === "boolean") notifPatch[`notifPrefs.${field}`] = body[field];
  }
  return { ok: true, value: { patch, unsetPaths, notifPatch, touchesRoleOrMinistries: !!body.role || body.ministries !== undefined, ministryRoles } };
}

/** Same membership, read through the storage contract (absent = worship), as SETS. */
function sameMinistries(a: unknown, b: unknown): boolean {
  const x = new Set(normalizeMinistries(a));
  const y = new Set(normalizeMinistries(b));
  return x.size === y.size && [...x].every((m) => y.has(m));
}

// ── Planning a person change ─────────────────────────────────────────────────

type Surface = "admin" | "me" | "chat";

interface PatchPlan {
  id: string;
  stored: StoredMember | null;
  valid: ValidPatch;
  before: MemberView | null;
  after: MemberView | null;
  /** D6's targeted rules patch, and the rules revision it asserts. */
  ruleSets: Record<string, unknown>;
  rulesRev: string | null;
  ruleLines: string[];
  /** D12's orphaned-rule warnings and D6's ambiguous-text note. */
  notes: string[];
  /** Field before/after + rule lines + notes: what the chat shows and its token binds (D3). */
  lines: string[];
}

/**
 * Validates and judges one person change, reading what the judgment needs. `stored` may be passed in
 * (the chat applies its edits to the same read). Refusals carry the surface's own words.
 */
async function planPatch(id: string, body: Record<string, unknown>, surface: Surface, given?: StoredMember): Promise<{ ok: true; plan: PatchPlan } | Refusal> {
  const v = validatePatchBody(body);
  if (!v.ok) return v;
  const { patch } = v.value;
  const touchesIdentity = "member_name" in patch || "alias" in patch || "email" in patch;
  // A level always travels with `ministries` (so `touchesRoleOrMinistries`); named on its own anyway:
  // K1 judges the stored item, and the write must be pinned to the read it judged.
  const needsRead = surface !== "admin" || v.value.touchesRoleOrMinistries || touchesIdentity || v.value.ministryRoles !== null;

  const plan: PatchPlan = { id, stored: null, valid: v.value, before: null, after: null, ruleSets: {}, rulesRev: null, ruleLines: [], notes: [], lines: [] };

  // /admin's «Nothing to update» answers before any read, as the route always did.
  if (surface === "admin" && Object.keys(v.value.patch).length === 0 && Object.keys(v.value.notifPatch).length === 0) {
    return refuse(400, "Nothing to update");
  }

  // The type-pinned read runs on EVERY patch (W9, ADR-0081): an id that is not a `teamMembers` answers
  // 404, so this writer never patches another type (a Jóvenes event included). Only a patch that is
  // judged against the stored person (`needsRead`) pins the write to this read's revision.
  const stored = given ?? (await readStored(id));
  if (!stored) return refuse(404, MEMBER_ERROR.notFound);
  if (!needsRead) return { ok: true, plan };
  plan.stored = stored;

  // A worship management role needs worship, judged on the RESULTING state; refused only when the
  // request CHANGES role or ministries (the form always re-sends `role`).
  const changesRole = !!body.role && body.role !== stored.role;
  const changesMinistries = body.ministries !== undefined && !sameMinistries(body.ministries, stored.ministries);
  const nextRole = body.role || stored.role;
  const nextMinistries = body.ministries ?? stored.ministries;
  if ((changesRole || changesMinistries) && worshipRoleWithoutWorship(nextRole, nextMinistries)) {
    return refuse(400, WORSHIP_ROLE_NEEDS_WORSHIP);
  }

  // K1: the `leaderOf` each level item is stored with, from the person just read (PR 1 only).
  if (v.value.ministryRoles) {
    const kept = keepLeaderOf(v.value.ministryRoles, stored);
    if (!kept) return refuse(409, LEADER_OF_KEPT, { code: "leader_of_kept" });
    patch.ministryRoles = ministryRolesForStorage(kept);
  }

  const afterDoc = resultingDoc(stored, patch as MemberWriteBody);
  plan.before = memberView(stored);
  plan.after = memberView(afterDoc);
  if (surface === "chat") {
    const denied = chatAccessRefusal(plan.before, plan.after);
    if (denied) return refuse(403, denied, { code: "chat_access" });
  }

  // D5 (D13: only a changed email).
  const newEmail = lowerTrim(afterDoc.email);
  if (newEmail && newEmail !== lowerTrim(stored.email)) {
    if (!MEMBER_EMAIL_RE.test(newEmail)) return refuse(400, surface === "me" ? MEMBER_ERROR.meBadEmail : `«${newEmail}» no es un correo válido.`);
    const owners = await emailOwners([newEmail], id);
    if (owners.length) {
      return refuse(409, surface === "me" ? MEMBER_ERROR.meEmailTaken : `Ese correo ya lo tiene ${nameOfRow(owners[0])}.`, { code: "email_taken" });
    }
  }

  // D12 + D6 (D13: only a name or alias that changes as the rule matcher sees it).
  const beforeNames = namesOf(stored);
  const afterNames = namesOf(afterDoc);
  if (namesChanged(beforeNames, afterNames)) {
    const [roster, rulesDoc] = await Promise.all([readRoster(), readRulesDoc()]);
    const changedTexts = [
      ...(beforeNames.member_name.toLowerCase().trim() !== afterNames.member_name.toLowerCase().trim() ? [afterNames.member_name] : []),
      ...((beforeNames.alias ?? "").toLowerCase().trim() !== (afterNames.alias ?? "").toLowerCase().trim() ? [afterNames.alias ?? ""] : []),
    ];
    const taken = nameTakenBy(roster, id, changedTexts);
    if (taken) {
      return refuse(409, surface === "me" ? MEMBER_ERROR.meAliasTaken : `«${taken.text}» ya es el nombre o alias de ${nameOfRow(taken.other)}.`, { code: "name_taken" });
    }
    const rosterAsStored = [...roster.filter((r) => r._id !== id), { _id: id, ...beforeNames }];
    const rename = planRuleRename({ rulesDoc, roster: rosterAsStored, selfId: id, before: beforeNames, after: afterNames });
    if (!rename.ok) return refuse(409, surface === "me" ? MEMBER_ERROR.meAliasRules : rename.message, { code: "rules_" + rename.reason });
    const orphans = orphanRuleWarnings(rulesDoc, rosterAsStored.map(namesOf), [afterNames]);
    if (surface === "me" && (orphans.length || rename.ambiguous.length)) {
      return refuse(409, orphans.length ? MEMBER_ERROR.meAliasUnavailable : MEMBER_ERROR.meAliasRules, { code: "name_rules" });
    }
    plan.ruleSets = rename.sets;
    plan.rulesRev = rulesDoc && Object.keys(rename.sets).length ? rulesDoc._rev : null;
    plan.ruleLines = rename.lines;
    const ambiguous = ambiguousRuleNote(rename.ambiguous);
    plan.notes = [...orphans, ...(ambiguous ? [ambiguous] : [])];
  }

  plan.lines = [...memberChangeLines(plan.before, plan.after), ...plan.ruleLines, ...plan.notes];
  return { ok: true, plan };
}

export interface MemberPatchEffects {
  /** The renamed rules, as lines (D6). */
  ruleLines: string[];
  notes: string[];
}

/** Writes a plan: one transaction when rules move (D6), else the person's own patch, pinned to the read. */
async function commitPlan(plan: PatchPlan, actorId: string): Promise<{ ok: true; doc: Record<string, unknown> } | Refusal> {
  const { patch, unsetPaths, notifPatch } = plan.valid;
  const stored = plan.stored;
  const apply = <T extends { set(v: Record<string, unknown>): T; unset(p: string[]): T; setIfMissing(v: Record<string, unknown>): T }>(p: T): T => {
    let chain = p.set(patch);
    if (unsetPaths.length > 0) chain = chain.unset(unsetPaths);
    if (Object.keys(notifPatch).length > 0) chain = chain.setIfMissing({ notifPrefs: {} }).set(notifPatch);
    return chain;
  };
  try {
    if (plan.rulesRev && stored) {
      await writeClient
        .transaction()
        .patch(plan.id, (p) => apply(p.ifRevisionId(stored._rev)))
        .patch(SOLVER_CONFIG_DOC_ID, (p) =>
          p.ifRevisionId(plan.rulesRev as string).set({ ...plan.ruleSets, updatedAt: new Date().toISOString(), updatedBy: actorId }),
        )
        .commit();
      const doc = await serverClient.fetch<Record<string, unknown> | null>(`*[_type == "teamMembers" && _id == $id][0]`, { id: plan.id });
      return { ok: true, doc: doc ?? { _id: plan.id } };
    }
    let mutation = writeClient.patch(plan.id);
    if (stored) mutation = mutation.ifRevisionId(stored._rev);
    const doc = await apply(mutation).commit();
    return { ok: true, doc: doc as unknown as Record<string, unknown> };
  } catch (err) {
    if (!stored || !sanityConflictKind(err)) throw err;
    if (plan.rulesRev) {
      // Which document moved? Re-read both revisions (D6).
      const [memberRev, rulesRev] = await Promise.all([
        serverClient.fetch<string | null>(`*[_id == $id][0]._rev`, { id: plan.id }),
        serverClient.fetch<string | null>(`*[_id == $id][0]._rev`, { id: SOLVER_CONFIG_DOC_ID }),
      ]);
      if (memberRev === stored._rev && rulesRev !== plan.rulesRev) return refuse(409, MEMBER_ERROR.rulesChanged);
    }
    return refuse(409, MEMBER_ERROR.changed);
  }
}

function revalidatePeople() {
  // A renamed member's name/alias surfaces on ISR schedule/home/me views.
  revalidateServiceViews();
  revalidatePath("/me");
}

// ── /admin: PATCH /api/admin/members/[id] ────────────────────────────────────

/**
 * Edit a person from /admin (super-admin, checked by the route). Answers `{...doc, emailPrefs}` as
 * before, plus `renamedRules` / `ruleLines` / `ruleNotes` when D6 or D12 had something to say.
 */
export async function patchMember(id: string, raw: unknown, actorId: string): Promise<CommitOutcome<MemberPatchEffects>> {
  const body = fields(raw);
  const planned = await planPatch(id, body, "admin");
  if (!planned.ok) return planned;
  const { plan } = planned;
  const written = await commitPlan(plan, actorId);
  if (!written.ok) return written;
  revalidatePeople();
  // `emailPrefs` is RESOLVED through the shared resolver, never the raw fields: an unset boolean
  // would render as its `true` default for a member receiving nothing.
  const p = (written.doc as { notifPrefs?: Record<string, unknown> }).notifPrefs ?? {};
  const emailPrefs = Object.fromEntries(EMAIL_KINDS.map((kind) => [NOTIFY_PREF_FIELD[kind], wantsNotification(p, kind)]));
  return {
    ok: true,
    status: 200,
    body: {
      ...written.doc,
      emailPrefs,
      ...(plan.ruleLines.length ? { renamedRules: plan.ruleLines.length, ruleLines: plan.ruleLines } : {}),
      ...(plan.notes.length ? { ruleNotes: plan.notes } : {}),
    },
    effects: { ruleLines: plan.ruleLines, notes: plan.notes },
  };
}

// ── /me: PATCH /api/me ───────────────────────────────────────────────────────

/** A member editing their OWN alias and email (D1). Same checks; generic refusals; one retry (§7.4). */
export async function patchOwnProfile(sessionId: string, raw: unknown): Promise<CommitOutcome<MemberPatchEffects>> {
  const input = fields(raw);
  const body: Record<string, unknown> = {};
  // Guard against a non-string alias (null/number) so .trim() can't throw a 500.
  if (typeof input.alias === "string") body.alias = input.alias.normalize("NFC");
  if (typeof input.email === "string" && input.email.trim()) {
    const email = input.email.trim().toLowerCase();
    // Never store an email that would silently break the assignment-email pipeline.
    if (!MEMBER_EMAIL_RE.test(email)) return refuse(400, MEMBER_ERROR.meBadEmail);
    body.email = email;
  }
  if (Object.keys(body).length === 0) return refuse(400, "Nothing to update");

  let firstSeen: { alias: string; email: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const planned = await planPatch(sessionId, body, "me");
    if (!planned.ok) return planned;
    const { plan } = planned;
    const seen = { alias: String(plan.stored?.alias ?? ""), email: String(plan.stored?.email ?? "") };
    // A retry only when what changed meanwhile is outside alias and email (the member's own `lastSeen`).
    if (firstSeen && (firstSeen.alias !== seen.alias || firstSeen.email !== seen.email)) return refuse(409, MEMBER_ERROR.meChanged);
    firstSeen = seen;
    const written = await commitPlan(plan, sessionId);
    if (written.ok) {
      revalidatePeople();
      return { ok: true, status: 200, body: written.doc, effects: { ruleLines: plan.ruleLines, notes: plan.notes } };
    }
    if (written.status !== 409) return written;
  }
  return refuse(409, MEMBER_ERROR.meChanged);
}

// ── The chat: check_member_changes / save_member_changes ─────────────────────

export type MemberEditsPlan =
  | { ok: true; name: string; lines: string[]; hasDraft: boolean }
  | Refusal;

async function hasDraft(id: string): Promise<boolean> {
  const n = await serverClient.fetch<number>(`count(*[_id == $draft])`, { draft: `drafts.${id}` });
  return typeof n === "number" && n > 0;
}

async function planEdits(id: string, edits: readonly MemberEdit[]): Promise<{ ok: true; plan: PatchPlan; stored: StoredMember } | Refusal> {
  const stored = await readStored(id);
  if (!stored) return refuse(404, MEMBER_ERROR.notFound, { code: "not_found" });
  const applied = applyMemberEdits(stored, edits);
  if (!applied.ok) return refuse(400, applied.message, { code: "invalid_edit" });
  const planned = await planPatch(id, applied.body as Record<string, unknown>, "chat", stored);
  if (!planned.ok) return planned;
  return { ok: true, plan: planned.plan, stored };
}

/** The chat's check: the fresh person with the edits applied, judged as the save will judge it. Writes nothing. */
export async function checkMemberEdits(id: string, edits: readonly MemberEdit[]): Promise<MemberEditsPlan> {
  const planned = await planEdits(id, edits);
  if (!planned.ok) return planned;
  return { ok: true, name: displayMemberName(namesOf(planned.stored)) || "(sin nombre)", lines: planned.plan.lines, hasDraft: await hasDraft(id) };
}

export interface MemberSaveEffects {
  unchanged: boolean;
  lines: string[];
  name: string;
}

/**
 * The chat's save: re-reads, re-applies, re-renders; `verify(lines)` is the token's check over the
 * fresh lines (D3) — `null`, or the refusal to answer — and runs before anything is written; the write asserts THIS read's revision.
 * A fresh person that already equals the result answers `unchanged` and writes nothing (the caller
 * verified the token's MAC and age before calling, §7.6).
 */
export async function saveMemberEdits(
  id: string,
  edits: readonly MemberEdit[],
  opts: { actorId: string; verify: (lines: readonly string[]) => string | null },
): Promise<CommitOutcome<MemberSaveEffects>> {
  const planned = await planEdits(id, edits);
  if (!planned.ok) return planned;
  const { plan, stored } = planned;
  const name = displayMemberName(namesOf(stored)) || "(sin nombre)";
  if (plan.lines.length === 0) return { ok: true, status: 200, body: { unchanged: true }, effects: { unchanged: true, lines: [], name } };
  const notChecked = opts.verify(plan.lines);
  if (notChecked) return refuse(409, notChecked, { code: "not_the_checked" });
  const written = await commitPlan(plan, opts.actorId);
  if (!written.ok) return written;
  revalidatePeople();
  return { ok: true, status: 200, body: { saved: true }, effects: { unchanged: false, lines: plan.lines, name } };
}

// ── Create ───────────────────────────────────────────────────────────────────

/** Validates one create body exactly as the members POST always has; returns the document to write. */
function buildCreateDoc(body: Record<string, unknown>): { ok: true; doc: Record<string, unknown> } | Refusal {
  const member_name = typeof body.member_name === "string" ? body.member_name : undefined;
  const email = typeof body.email === "string" ? body.email : undefined;
  const alias = typeof body.alias === "string" ? body.alias : undefined;
  const role = body.role as string | undefined;
  if (!member_name?.trim() || !email?.trim()) return refuse(400, "name and email required");
  // The same four roles PATCH accepts, so the worship-role rule below judges a role the app knows.
  if (role !== undefined && !VALID_ROLES.includes(role)) return refuse(400, "Invalid role");
  // The SAME validator PATCH uses: an explicitly empty `ministries` is rejected, an absent one stays absent.
  for (const field of ["ministries", "managesMinistries"] as const) {
    if (body[field] === undefined) continue;
    const error = validateMinistryWrite(field, body[field]);
    if (error) return refuse(400, error);
  }
  if (body.ministryRoles !== undefined) {
    const error = validateMinistryRolesWrite(body.ministryRoles, body.ministries);
    if (error) return refuse(400, error);
  }
  // A worship management role needs worship (absent ministries = worship); a create changes both.
  if (worshipRoleWithoutWorship(role ?? "member", body.ministries)) return refuse(400, WORSHIP_ROLE_NEEDS_WORSHIP);
  let instruments: string[] | undefined;
  if (body.instruments !== undefined) {
    const parsed = parseMemberInstruments(body.instruments);
    if (!parsed.ok) return refuse(400, parsed.error);
    instruments = parsed.value;
  }
  // «Canta y toca a la vez» (ADR-0078): a boolean or nothing.
  if (body.singsAndPlays !== undefined && typeof body.singsAndPlays !== "boolean") return refuse(400, "singsAndPlays must be a boolean");

  const slug = member_name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return {
    ok: true,
    doc: {
      _type: "teamMembers",
      member_name: member_name.trim().normalize("NFC"),
      ...(alias?.trim() ? { alias: alias.trim().normalize("NFC") } : {}),
      email: email.trim().toLowerCase(),
      role: role ?? "member",
      memberType: body.memberType ?? [],
      ...(instruments !== undefined ? { instruments } : {}),
      ...(body.singsAndPlays === true ? { singsAndPlays: true } : {}),
      ...(body.ministries !== undefined ? { ministries: body.ministries } : {}),
      ...(body.managesMinistries !== undefined ? { managesMinistries: body.managesMinistries } : {}),
      // A create has no stored person: K1 stores a leader as leading every group given.
      ...(body.ministryRoles !== undefined
        ? { ministryRoles: ministryRolesForStorage(keepLeaderOf(body.ministryRoles as MinistryRoleWrite[], null) ?? []) }
        : {}),
      slug: { _type: "slug", current: slug },
    },
  };
}

export interface NewMembersPlan {
  docs: Array<Record<string, unknown>>;
  /** Per person «Persona N: …» blocks plus D12 warnings: what the chat shows and its token binds (D7). */
  lines: string[];
}

/**
 * Validates a batch of new people against each other and the fresh roster: D5 (an email someone has,
 * or that the batch repeats), D12 (a name or alias someone has, or that the batch repeats) and, for
 * the chat, §3.1 (never a super-admin). Writes nothing.
 */
export async function planNewMembers(batch: readonly unknown[], surface: "admin" | "chat"): Promise<{ ok: true; plan: NewMembersPlan } | Refusal> {
  const docs: Array<Record<string, unknown>> = [];
  const who = (i: number) => (batch.length > 1 ? `Persona ${i + 1}: ` : "");
  // The route's single create answers its validation refusals exactly as it always has.
  const at = (i: number) => (batch.length > 1 ? { index: i } : {});
  for (let i = 0; i < batch.length; i++) {
    const built = buildCreateDoc(fields(batch[i]));
    if (!built.ok) return refuse(built.status, `${who(i)}${String(built.body.error)}`, at(i));
    if (!MEMBER_EMAIL_RE.test(built.doc.email as string)) return refuse(400, `${who(i)}«${built.doc.email}» no es un correo válido.`, at(i));
    if (surface === "chat") {
      const denied = chatAccessRefusal(null, memberView(built.doc));
      if (denied) return refuse(403, `${who(i)}${denied}`, { ...at(i), code: "chat_access" });
    }
    docs.push(built.doc);
  }

  // D5 within the batch, then against everyone (drafts and disabled people included).
  const emails = docs.map((d) => d.email as string);
  const repeated = emails.findIndex((e, i) => emails.indexOf(e) !== i);
  if (repeated >= 0) return refuse(409, `${who(repeated)}el correo ${emails[repeated]} se repite en la lista.`, { index: repeated, code: "email_taken" });
  const owners = await emailOwners(emails, null);
  if (owners.length) {
    const i = emails.indexOf(lowerTrim(owners[0].email));
    return refuse(409, `${who(Math.max(i, 0))}ese correo ya lo tiene ${nameOfRow(owners[0])}.`, { index: i, code: "email_taken" });
  }

  // D12 within the batch, then against the roster.
  const [roster, rulesDoc] = await Promise.all([readRoster(), readRulesDoc()]);
  const batchRows: RosterRow[] = docs.map((d, i) => ({ _id: `#new-${i}`, member_name: d.member_name, alias: d.alias }));
  for (let i = 0; i < docs.length; i++) {
    const texts = [docs[i].member_name as string, ...(typeof docs[i].alias === "string" ? [docs[i].alias as string] : [])];
    const taken = nameTakenBy([...roster, ...batchRows], `#new-${i}`, texts);
    if (taken) {
      const other = taken.other._id.startsWith("#new-") ? `la persona ${Number(taken.other._id.slice(5)) + 1} de la lista` : nameOfRow(taken.other);
      return refuse(409, `${who(i)}«${taken.text}» ya es el nombre o alias de ${other}.`, { index: i, code: "name_taken" });
    }
  }

  const lines: string[] = [];
  const rosterNames = roster.map(namesOf);
  docs.forEach((d, i) => {
    const view = memberView(d);
    lines.push(`${batch.length > 1 ? `Persona ${i + 1}` : "Persona nueva"}:`, ...memberChangeLines(null, view).map((l) => `  ${l}`));
    for (const w of orphanRuleWarnings(rulesDoc, rosterNames, [namesOf(d)])) lines.push(`  ${w}`);
  });
  return { ok: true, plan: { docs, lines } };
}

/** POST /api/admin/members: one person, a random id (as always), plus D5 and D12. */
export async function createMember(raw: unknown): Promise<CommitOutcome<{ id: string }, 201>> {
  const planned = await planNewMembers([raw], "admin");
  if (!planned.ok) return planned;
  const doc = await writeClient.create(planned.plan.docs[0] as { _type: string });
  return { ok: true, status: 201, body: doc as unknown as Record<string, unknown>, effects: { id: (doc as { _id: string })._id } };
}

/**
 * The chat's create (D7): the batch re-planned on the fresh roster, its lines verified against the
 * token, then ONE transaction of `createIfNotExists` at the token's ids, so a retry never makes a
 * second account and a batch never lands half-way.
 */
export async function createMembers(
  batch: readonly unknown[],
  opts: { ids: readonly string[]; verify: (lines: readonly string[]) => string | null },
): Promise<CommitOutcome<{ ids: string[]; lines: string[] }>> {
  if (opts.ids.length !== batch.length) throw new Error("createMembers: one id per person");
  const planned = await planNewMembers(batch, "chat");
  if (!planned.ok) return planned;
  const notChecked = opts.verify(planned.plan.lines);
  if (notChecked) return refuse(409, notChecked, { code: "not_the_checked" });
  let tx = writeClient.transaction();
  planned.plan.docs.forEach((doc, i) => {
    tx = tx.createIfNotExists({ ...doc, _id: opts.ids[i] } as { _id: string; _type: string });
  });
  await tx.commit();
  revalidatePeople();
  return { ok: true, status: 200, body: { created: opts.ids.length }, effects: { ids: [...opts.ids], lines: planned.plan.lines } };
}

// ── Access: PATCH /api/admin/members/[id]/disable and set_member_access ──────

interface SuperAdminRow {
  _id: string;
  _rev: string;
  disabled?: boolean | null;
}

type TargetRow = StoredMember;

function writeBackDisabled(observed: boolean | null | undefined): { set: Record<string, unknown>; unset: string[] } {
  if (observed === true) return { set: { disabled: true }, unset: [] };
  if (observed === false) return { set: { disabled: false }, unset: [] };
  return { set: {}, unset: ["disabled"] };
}

async function commitDisable(targetId: string, targetRev: string, others: SuperAdminRow[]): Promise<unknown> {
  let tx = writeClient.transaction().patch(targetId, (p) => p.ifRevisionId(targetRev).set({ disabled: true }));
  for (const other of others) {
    const { set, unset } = writeBackDisabled(other.disabled);
    tx = tx.patch(other._id, (p) => {
      let chain = p.ifRevisionId(other._rev).set(set) as typeof p;
      if (unset.length) chain = chain.unset(unset) as typeof p;
      return chain;
    });
  }
  return tx.commit();
}

const TARGET_QUERY = `*[_type == "teamMembers" && _id == $id][0]${STORED_MEMBER_PROJECTION}`;

/** The route's answer for someone already disabled: the three fields it always answered, never the projection. */
function disabledBody(row: TargetRow): Record<string, unknown> {
  return { _id: row._id, _rev: row._rev, disabled: row.disabled };
}

const SELF_DISABLE = "No puedes deshabilitar tu propia cuenta mientras administras.";
const LAST_SUPER_ADMIN = "Debe quedar al menos un super-admin habilitado.";

/**
 * Disable or re-enable a person's access. Refuses the operator's own account and leaving no enabled
 * super-admin; one transaction asserts every other enabled super-admin's revision; one conservative
 * retry after a 409. With `chat`, §3.1's `disabled` row is judged on the target's fresh read, on the
 * first attempt AND on the retry.
 */
export async function setMemberDisabled(
  id: string,
  disabled: boolean,
  opts: { operatorIds: ReadonlySet<string>; chat?: boolean },
): Promise<CommitOutcome<{ changed: boolean }>> {
  const chatRefusal = (target: TargetRow): Refusal | null => {
    if (!opts.chat) return null;
    const denied = chatAccessToggleRefusal(memberView(target), !disabled);
    return denied ? refuse(403, denied, { code: "chat_access" }) : null;
  };

  if (!disabled) {
    const target = await serverClient.fetch<TargetRow | null>(TARGET_QUERY, { id });
    if (!target?._rev) return refuse(404, "Not found");
    const denied = chatRefusal(target);
    if (denied) return denied;
    const doc = await writeClient.patch(id).ifRevisionId(target._rev).set({ disabled: false }).commit();
    revalidatePeople();
    return { ok: true, status: 200, body: doc as unknown as Record<string, unknown>, effects: { changed: target.disabled === true } };
  }

  if (opts.operatorIds.has(id)) return refuse(409, SELF_DISABLE);

  const enabledSuperAdmins = await serverClient.fetch<SuperAdminRow[]>(
    `*[_type == "teamMembers" && role == "super-admin" && disabled != true]{ _id, _rev, disabled }`,
  );
  const othersEnabled = (enabledSuperAdmins ?? []).filter((m) => m._id !== id);
  if (othersEnabled.length === 0) return refuse(409, LAST_SUPER_ADMIN);

  const target = await serverClient.fetch<TargetRow | null>(TARGET_QUERY, { id });
  if (!target?._rev) return refuse(404, "Not found");
  const denied = chatRefusal(target);
  if (denied) return denied;
  if (target.disabled === true) return { ok: true, status: 200, body: disabledBody(target), effects: { changed: false } };

  try {
    const doc = await commitDisable(id, target._rev, othersEnabled);
    revalidatePeople();
    return { ok: true, status: 200, body: doc as Record<string, unknown>, effects: { changed: true } };
  } catch {
    // Conservative retry after a concurrent write (e.g. a `lastSeen` ping → 409), re-judged.
    const freshTarget = await serverClient.fetch<TargetRow | null>(TARGET_QUERY, { id });
    if (!freshTarget?._rev) return refuse(404, "Not found");
    const deniedAgain = chatRefusal(freshTarget);
    if (deniedAgain) return deniedAgain;
    if (freshTarget.disabled === true) return { ok: true, status: 200, body: disabledBody(freshTarget), effects: { changed: false } };
    const freshOthers = await serverClient.fetch<SuperAdminRow[]>(
      `*[_type == "teamMembers" && role == "super-admin" && disabled != true && _id != $id]{ _id, _rev, disabled }`,
      { id },
    );
    if ((freshOthers ?? []).length === 0) return refuse(409, LAST_SUPER_ADMIN);
    try {
      const doc = await commitDisable(id, freshTarget._rev, freshOthers ?? []);
      revalidatePeople();
      return { ok: true, status: 200, body: doc as Record<string, unknown>, effects: { changed: true } };
    } catch {
      return refuse(409, "Conflicto al deshabilitar — reintenta en un momento.");
    }
  }
}
