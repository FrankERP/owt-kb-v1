import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import {
  MEMBER_DELETE_ERROR,
  MEMBER_HAS_REFERENCES_MESSAGE,
  MEMBER_POOL_CLEANUP_FAILED_MESSAGE,
  isSanityReferentialIntegrityError,
  solverPoolCleanupPatch,
} from "@/app/utils/memberDelete";
import { revalidateServiceViews } from "@/app/utils/revalidate";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { SOLVER_CONFIG_DOC_ID } from "@/app/utils/solverConfigWriteRequest";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { revalidatePath } from "next/cache";
import { NOTIFY_PREF_FIELD, wantsNotification, type NotifyKind } from "@/app/utils/notifyPrefs";
import {
  WORSHIP_ROLE_NEEDS_WORSHIP,
  droppedMinistryRolePaths,
  ministryRolesForStorage,
  normalizeMinistries,
  validateMinistryRolesWrite,
  validateMinistryWrite,
  worshipRoleWithoutWorship,
  type MinistryRole,
} from "@/app/ministries";
import { parseMemberInstruments } from "@/app/components/admin/seatModel";
import { MEMBER_TYPES } from "@/app/utils/memberTypes";

const EMAIL_KINDS = Object.keys(NOTIFY_PREF_FIELD) as NotifyKind[];

const MEMBER_CHANGED_MESSAGE = "Alguien más cambió a esta persona; recarga.";

/** Same membership, read through the storage contract (absent = worship), as SETS. */
function sameMinistries(a: unknown, b: unknown): boolean {
  const x = new Set(normalizeMinistries(a));
  const y = new Set(normalizeMinistries(b));
  return x.size === y.size && [...x].every((m) => y.has(m));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // PATCH is super-admin only
  if (session.user.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as {
    member_name?: string;
    alias?: string;
    email?: string;
    role?: string;
    memberType?: string[];
    instruments?: string[];
    singsAndPlays?: boolean;
    ministries?: string[];
    managesMinistries?: string[];
    ministryRoles?: unknown;
    // Legacy fallback field. No UI writes it any more (§5 of the notification
    // design takes it out of both panels); it stays accepted because it is what
    // an unset per-type field falls back to.
    notifEmail?: boolean;
    emailAssigned?: boolean;
    emailRemoved?: boolean;
    emailRoleChanged?: boolean;
    emailSetlist?: boolean;
    emailProposals?: boolean;
  };

  const VALID_ROLES = ["super-admin", "admin", "content-editor", "member"];

  if (body.role !== undefined && !VALID_ROLES.includes(body.role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.member_name?.trim()) patch.member_name = body.member_name.trim();
  if (typeof body.alias === "string") patch.alias = body.alias.trim();
  if (body.email?.trim()) patch.email = body.email.trim().toLowerCase();
  if (body.role) patch.role = body.role;
  // Keep only recognised member types (drops unknown values rather than storing them).
  // `MEMBER_TYPES` is the canonical six values, shared with `MeHeader`'s chips and
  // `/admin`'s `TYPE_ABBR` — see `app/utils/memberTypes.ts`.
  if (Array.isArray(body.memberType)) {
    const valid: readonly string[] = MEMBER_TYPES;
    patch.memberType = body.memberType.filter(t => valid.includes(t));
  }

  // Declared instruments (spec 2026-09-09 §4.2). `!== undefined` guard like
  // `ministries`: an absent field is untouched, so the form's touched-field
  // discipline holds and the backfill's "no stored field" predicate stays true.
  // `[]` IS stored — "declares nothing" is a legitimate value (D6).
  if (body.instruments !== undefined) {
    const parsed = parseMemberInstruments(body.instruments);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    patch.instruments = parsed.value;
  }

  // «Canta y toca a la vez» (ADR-0078): absent = untouched, like `instruments`;
  // only a boolean is stored.
  if (body.singsAndPlays !== undefined) {
    if (typeof body.singsAndPlays !== "boolean") {
      return NextResponse.json({ error: "singsAndPlays must be a boolean" }, { status: 400 });
    }
    patch.singsAndPlays = body.singsAndPlays;
  }

  // Ministry membership/management. The guard is `!== undefined`, so a body that
  // never mentions a field leaves the stored value ALONE — the form sends only
  // what the admin touched, and an unconditional write here would let an
  // unrelated typo fix hand a kids-only volunteer the whole worship catalog
  // (`ministries: []` reads back as `["worship"]`) and wipe a Kids leader's
  // management. Must stay ABOVE the "Nothing to update" check, or a
  // ministries-only PATCH 400s as an empty update.
  for (const field of ["ministries", "managesMinistries"] as const) {
    if (body[field] === undefined) continue;
    const error = validateMinistryWrite(field, body[field]);
    if (error) return NextResponse.json({ error }, { status: 400 });
    patch[field] = body[field];
  }

  // Levels in a leveled ministry (Jóvenes, ADR-0075), validated against THIS
  // request's `ministries`. With them the whole array is SET; without them, a
  // `ministries` that leaves a leveled ministry out UNSETS its stale level. One
  // or the other, so no patch both sets and unsets the same path.
  let unsetPaths: string[] = [];
  if (body.ministryRoles !== undefined) {
    const error = validateMinistryRolesWrite(body.ministryRoles, body.ministries);
    if (error) return NextResponse.json({ error }, { status: 400 });
    patch.ministryRoles = ministryRolesForStorage(body.ministryRoles as MinistryRole[]);
  } else if (body.ministries !== undefined) {
    unsetPaths = droppedMinistryRolePaths(body.ministries);
  }

  // A worship management role needs worship, judged on the RESULTING state
  // (access plan §3.4): `requireActiveManager` reads `role` alone, so a Jóvenes
  // admin saved as `admin` would be a worship admin. Refused only when the
  // request CHANGES role or ministries — the form always re-sends `role`, and
  // refusing an unchanged one would lock an already-inconsistent person out of
  // every other edit. The verdict rests on the stored state, so the write is
  // pinned to the revision it read: a concurrent change answers 409, never a
  // silent read-then-write on a permission field.
  let readRevision: string | undefined;
  if (body.role || body.ministries !== undefined) {
    const stored = await serverClient.fetch<{ _rev?: string; role?: string | null; ministries?: unknown } | null>(
      `*[_type == "teamMembers" && _id == $id][0]{ _rev, role, ministries }`,
      { id },
    );
    if (!stored || typeof stored._rev !== "string") {
      return NextResponse.json({ error: "Miembro no encontrado." }, { status: 404 });
    }
    const changesRole = !!body.role && body.role !== stored.role;
    const changesMinistries = body.ministries !== undefined && !sameMinistries(body.ministries, stored.ministries);
    const nextRole = body.role || stored.role;
    const nextMinistries = body.ministries ?? stored.ministries;
    if ((changesRole || changesMinistries) && worshipRoleWithoutWorship(nextRole, nextMinistries)) {
      return NextResponse.json({ error: WORSHIP_ROLE_NEEDS_WORSHIP }, { status: 400 });
    }
    readRevision = stored._rev;
  }

  // The five per-type email toggles, keyed off the same map every sender uses.
  const notifPatch: Record<string, unknown> = {};
  if (typeof body.notifEmail === "boolean") notifPatch["notifPrefs.email"] = body.notifEmail;
  for (const kind of EMAIL_KINDS) {
    const field = NOTIFY_PREF_FIELD[kind];
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === "boolean") notifPatch[`notifPrefs.${field}`] = value;
  }

  if (Object.keys(patch).length === 0 && Object.keys(notifPatch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  let mutation = writeClient.patch(id);
  if (readRevision) mutation = mutation.ifRevisionId(readRevision);
  mutation = mutation.set(patch);
  if (unsetPaths.length > 0) mutation = mutation.unset(unsetPaths);
  if (Object.keys(notifPatch).length > 0) {
    mutation = mutation.setIfMissing({ notifPrefs: {} }).set(notifPatch);
  }
  let doc;
  try {
    doc = await mutation.commit();
  } catch (err) {
    if (readRevision && sanityConflictKind(err)) {
      return NextResponse.json({ error: MEMBER_CHANGED_MESSAGE }, { status: 409 });
    }
    throw err;
  }
  // A renamed member's name/alias surfaces on ISR schedule/home/me views.
  revalidateServiceViews();
  revalidatePath("/me");
  // `emailPrefs` is RESOLVED through the shared resolver, never the raw fields:
  // with no data migration the five are unset for anyone who opted out of the
  // legacy `email`, and an unset boolean would render as its `true` default —
  // five switches ON for a member receiving nothing.
  const p = (doc as { notifPrefs?: Record<string, unknown> }).notifPrefs ?? {};
  const emailPrefs = Object.fromEntries(
    EMAIL_KINDS.map((kind) => [NOTIFY_PREF_FIELD[kind], wantsNotification(p, kind)]),
  );
  return NextResponse.json({ ...doc, emailPrefs });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveManager();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // DELETE is super-admin only
  if (session.user.role !== "super-admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await writeClient.delete(id);
  } catch (err) {
    if (isSanityReferentialIntegrityError(err)) {
      return NextResponse.json(
        {
          error: MEMBER_DELETE_ERROR.HAS_REFERENCES,
          message: MEMBER_HAS_REFERENCES_MESSAGE,
          offerRetire: true,
        },
        { status: 409 },
      );
    }
    throw err;
  }

  const stored = await operationalClient.fetch<{
    _rev?: string;
    sundayLeads?: unknown;
    saturdayLeads?: unknown;
    support?: unknown;
  } | null>(
    `*[_id == $docId][0]{ _rev, sundayLeads, saturdayLeads, support }`,
    { docId: SOLVER_CONFIG_DOC_ID },
  );

  if (!stored || typeof stored._rev !== "string") {
    revalidateServiceViews();
    revalidatePath("/me");
    return NextResponse.json({ ok: true });
  }

  const patch = solverPoolCleanupPatch(stored, id);
  if (!patch) {
    revalidateServiceViews();
    revalidatePath("/me");
    return NextResponse.json({ ok: true });
  }

  try {
    await writeClient
      .patch(SOLVER_CONFIG_DOC_ID)
      .ifRevisionId(stored._rev)
      .set(patch)
      .commit();
  } catch (err) {
    const body = {
      error: MEMBER_DELETE_ERROR.POOL_CLEANUP_FAILED,
      message: MEMBER_POOL_CLEANUP_FAILED_MESSAGE,
      deleted: true as const,
      ...(sanityConflictKind(err) ? { kind: "stale_revision" as const } : {}),
    };
    return NextResponse.json(body, { status: 409 });
  }

  revalidateServiceViews();
  revalidatePath("/me");
  return NextResponse.json({ ok: true });
}
