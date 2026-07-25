// app/api/admin/roles/publish/route.ts
import { NextRequest, NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";

// Notifying the whole team can mean dozens of sequential emails; give the
// after() work room to finish past the response.
export const maxDuration = 60;
import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { sendPush } from "@/app/utils/push";
import { sendAssignmentEmailsBatch, type ServiceType } from "@/app/utils/assignmentEmail";
import { computePublishTransitions } from "@/app/utils/publishTransitions";
import { serviceError } from "@/app/utils/serviceMutation";
import { validateRole } from "@/app/utils/serviceReadModel";
import { roleTargetLockId } from "@/app/utils/roleTargetLock";
import {
  parsePublishRequest,
  planOwnedLock,
  prevalidatePublishBatch,
  roleDateField,
  sanityConflictKind,
  storedRoleDate,
} from "@/app/utils/roleWriteRequest";
import {
  bootstrapLegacyLock,
  loadCanonicalRolesByIds,
  loadLocks,
  loadRawRoleDraftIdsForBaseIds,
  nowIso,
  type StoredLock,
  type StoredRole,
} from "@/app/utils/roleWriteOps";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/**
 * Publish / unpublish a batch of service roles (A2 §2).
 *
 * Exact request: `{ roles: [{ id, rev }], published: boolean }`. Any missing,
 * wrong-type, stale, raw-draft, duplicate-target or wrong-owner entry rejects the
 * COMPLETE batch during prevalidation. All publication states then change in one
 * transaction, with every coordination token asserted and heartbeated. A missing
 * `published` field stays grandfathered published, and only a real `false -> true`
 * transition notifies.
 */
export async function POST(req: NextRequest) {
  const session = await requireActiveManager();
  if (!session || session.user.role === "content-editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: ["json"] } }));
  }
  const parsed = parsePublishRequest(body);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const { entries, published } = parsed.value;
  const ids = entries.map((e) => e.id);

  // Only these three stored types may have their publication state changed here.
  const PUBLISHABLE_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;

  const [fetched, rawDraftIds] = await Promise.all([
    loadCanonicalRolesByIds(ids),
    loadRawRoleDraftIdsForBaseIds(ids),
  ]);
  if (rawDraftIds.length) {
    return reject(serviceError("integrity_conflict", { details: { rawDrafts: rawDraftIds } }));
  }

  const usable = fetched.filter((doc) =>
    (PUBLISHABLE_TYPES as readonly string[]).includes(doc._type),
  );
  if (usable.length !== fetched.length) {
    return reject(serviceError("integrity_conflict", { details: { detail: "unexpected_type" } }));
  }
  for (const doc of usable) {
    const validation = validateRole(doc);
    if (!validation.groupable) {
      return reject(
        serviceError("integrity_conflict", {
          details: { id: doc._id, issues: validation.issues },
        }),
      );
    }
  }

  const pre = prevalidatePublishBatch({ entries, fetched: usable });
  if (!pre.ok) {
    const stale = pre.issues.some((i) => i.startsWith("stale:"));
    return reject(
      serviceError(stale ? "stale_revision" : "ambiguous_target", {
        details: { issues: pre.issues },
      }),
    );
  }

  const byId = new Map(usable.map((doc) => [doc._id, doc]));
  const roles: StoredRole[] = pre.roles.map((r) => byId.get(r._id) as StoredRole);

  // ── Coordination tokens: every weekend role must own its own lock ─────────
  const lockIdOf = new Map<string, string>();
  for (const role of roles) {
    const validation = validateRole(role);
    const lockId = validation.targetKey ? roleTargetLockId(validation.targetKey) : null;
    if (lockId) lockIdOf.set(role._id, lockId);
  }
  const locks = await loadLocks([...lockIdOf.values()]);
  let bootstrapped = false;
  const asserted = new Map<string, StoredLock>();
  const roleRevs = new Map<string, string>(roles.map((r) => [r._id, r._rev]));

  for (const role of roles) {
    const lockId = lockIdOf.get(role._id);
    if (!lockId) continue;
    const targetKey = validateRole(role).targetKey as string;
    const plan = planOwnedLock({ lock: locks.get(lockId) ?? null, targetKey, roleId: role._id });
    if (plan.kind === "integrity") {
      return reject(
        serviceError("integrity_conflict", { details: { lockId, detail: plan.detail } }),
      );
    }
    if (plan.kind === "bootstrap") {
      const date = storedRoleDate(role);
      if (!date) {
        return reject(serviceError("integrity_conflict", { details: { id: role._id } }));
      }
      const boot = await bootstrapLegacyLock({
        roleId: role._id,
        roleRev: roleRevs.get(role._id) as string,
        targetKey,
        dateField: roleDateField(role._type),
        date,
      });
      if (!boot.ok || !boot.role || !boot.lock) {
        return reject(
          serviceError(boot.committed ? "bootstrap_completed_reload" : "stale_revision", {
            details: { id: role._id, lockId },
          }),
        );
      }
      bootstrapped = true;
      // Continue ONLY from the revisions the maintenance transaction produced.
      roleRevs.set(role._id, boot.role._rev);
      asserted.set(role._id, boot.lock);
      continue;
    }
    asserted.set(role._id, locks.get(lockId) as StoredLock);
  }

  const { toPatch, toNotify } = computePublishTransitions(
    roles.map((r) => ({ _id: r._id, published: r.published })),
    published,
  );

  if (toPatch.length) {
    const now = nowIso();
    let tx = writeClient.transaction();
    for (const id of toPatch) {
      const rev = roleRevs.get(id) as string;
      tx = tx.patch(id, (p) => p.ifRevisionId(rev).set({ published }));
    }
    // Heartbeat every involved coordination token under its observed revision, so
    // a concurrent writer on any of these targets makes the whole batch refuse.
    for (const [, lock] of asserted) {
      const lockRev = lock._rev;
      tx = tx.patch(lock._id, (p) => p.ifRevisionId(lockRev).set({ updatedAt: now }));
    }
    try {
      await tx.commit();
    } catch (err) {
      if (!sanityConflictKind(err)) throw err;
      return reject(
        serviceError(bootstrapped ? "bootstrap_completed_reload" : "stale_revision", {
          details: { ids: toPatch },
        }),
      );
    }
  }

  // Deferred assignment notification, only for draft -> published transitions.
  // Runs via after() so the (potentially dozens of) team emails reliably
  // complete after the response is sent rather than racing the function exit.
  if (toNotify.length) {
    const notifySet = new Set(toNotify);
    const docs = roles
      .filter((r) => notifySet.has(r._id))
      .map((r) => {
        const v = validateRole(r);
        return {
          _id: r._id,
          _type: r._type as ServiceType,
          date: storedRoleDate(r) ?? "",
          assignees: v.assignedRefs,
          body: seatBody(r),
        };
      });
    after(async () => {
      for (const d of docs) {
        await sendPush(d.assignees, "assignments", {
          title: "Nuevo servicio asignado",
          body: `Te asignaron para el ${d.date}.`,
          path: "/me",
        });
      }
      // One consolidated email per member across all newly-published services.
      await sendAssignmentEmailsBatch(docs.map((d) => ({ type: d._type, date: d.date, body: d.body })));
    });
  }

  // Invalidate member-facing caches so the change is prompt (esp. on unpublish).
  revalidatePath("/"); revalidatePath("/schedule"); revalidatePath("/me");

  const publishedCount = published ? toPatch.length : 0;
  const unpublishedCount = published ? 0 : toPatch.length;
  return NextResponse.json({ ok: true, published: publishedCount, unpublished: unpublishedCount });
}

/**
 * Assignment-notification body from COMMITTED server state, across all five seat
 * paths. Never a client-supplied recipient list.
 */
function seatBody(role: StoredRole) {
  const refs = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .map((item) =>
            item && typeof item === "object" ? (item as { _ref?: unknown })._ref : null,
          )
          .filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];
  const slots = (arr: unknown, labelField: "instrument" | "role") =>
    Array.isArray(arr)
      ? arr
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as { person?: { _ref?: unknown } } & Record<string, unknown>;
            const personId = row.person?._ref;
            const label = row[labelField];
            if (typeof personId !== "string" || typeof label !== "string") return null;
            return { label, personId };
          })
          .filter((v): v is { label: string; personId: string } => !!v)
      : [];
  return {
    leads: refs(role.Lead),
    bgvs: refs(role.BGVs),
    chorus: refs(role.Chorus),
    instruments: slots(role.instruments, "instrument").map((s) => ({
      instrument: s.label,
      personId: s.personId,
    })),
    foh: slots(role.foh_team, "role").map((s) => ({ role: s.label, personId: s.personId })),
  };
}
