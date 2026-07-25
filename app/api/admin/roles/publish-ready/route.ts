// app/api/admin/roles/publish-ready/route.ts
//
// The server-authoritative publish surface for Plan B item 3. Three modes, one
// contract:
//
//   { mode: "ready",    roles: [{ id, rev }] }
//   { mode: "override", roles: [{ id, rev, acknowledgedBlockers: [...] }] }   // exactly one
//   { mode: "recover",  roles: [{ id }], published: boolean }                 // READ ONLY
//
// `ready` and `override` never trust the client's readiness. Both RELOAD the five
// A1 read domains, recompute the SAME shared pure predicate the panel rendered
// from (`deriveServiceReadiness` + `classifyPublishBlockers`), build A2's exact
// revision guard bundle, and commit through A2's guarded publish-ready assertion
// helper in ONE transaction. The batch is atomic: if any selected service is no
// longer ready, or any guard cannot be built, nothing is committed and the answer
// is `409` with per-service reasons.
//
// `override` exists only for WORKFLOW blockers (empty team, availability conflict,
// active proposal, missing/incomplete setlist). The acknowledged set is compared
// against the server's freshly recomputed set and a change rejects the publish.
// Hard integrity blockers — invalid or draft-conflicted records, duplicate
// targets, dangling assignments, unknown/failed sources, A2 cleanup requirements —
// are never override-eligible in either mode.
//
// Unpublishing is NOT here: it is a separate, narrower capability
// (`/api/admin/roles/unpublish`) that must stay available precisely when readiness
// is unsafe.

import { NextRequest, NextResponse } from "next/server";

// Publishing a batch can fan out dozens of emails; give `after()` room to finish.
export const maxDuration = 60;

import { requireActiveManager } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import type { ServiceType } from "@/app/utils/assignmentEmail";
import {
  notifyRolePublished,
  revalidateRolePublication,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceError } from "@/app/utils/serviceMutation";
import { validateRole } from "@/app/utils/serviceReadModel";
import { normalizeStoredSeats, sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { classifyPublishBlockers, sameBlockerSet } from "@/app/components/admin/publishSelection";
import {
  applyPublishReadyAssertions,
  type AssertionOp,
  type GuardedTransaction,
} from "@/app/utils/publishReadyTransaction";
import {
  allObservedIn,
  assembleService,
  buildPublishAssertion,
  loadServiceReadinessSources,
  mergeAssertionOps,
  parsePublishReadyRequest,
  withPublishedTrue,
  type AssembledService,
  type ObservedPublication,
} from "@/app/utils/publishReadyBundle";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

type SanityTransaction = ReturnType<typeof writeClient.transaction>;

/**
 * Adapter from Sanity's `Transaction` to A2's minimal `GuardedTransaction` shape.
 * A2's helper is deliberately typed against the smallest surface it needs so it
 * stays mockable; this bridges the two without widening either.
 */
interface GuardedTx extends GuardedTransaction<GuardedTx> {
  readonly tx: SanityTransaction;
}

function guarded(tx: SanityTransaction): GuardedTx {
  return {
    tx,
    patch(id, fn) {
      return guarded(tx.patch(id, (p) => fn(p) as typeof p));
    },
  };
}

interface ServiceRejection {
  id: string;
  reasons: string[];
  hardBlockers: string[];
  workflowBlockers: string[];
  publishState: string;
  storedRev?: string;
  observedRev?: string;
}

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
  const parsed = parsePublishReadyRequest(body);
  if (!parsed.ok) {
    return reject(serviceError("invalid_request", { details: { issues: parsed.issues } }));
  }
  const { mode, entries, requestedState } = parsed.value;

  // Only these three stored types ever have their publication state changed here.
  const PUBLISHABLE_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;

  const sources = await loadServiceReadinessSources();

  // ── Recovery for a lost/unknown outcome: refetch, never replay ─────────────
  if (mode === "recover") {
    if (sources.failedSources.length > 0) {
      // A failed recovery refetch stays `unknown`. Not success, not failure.
      return NextResponse.json(
        {
          error: "unknown_outcome",
          outcome: "unknown",
          message: "No se pudo confirmar el resultado. Vuelve a intentar la verificación.",
          failedSources: sources.failedSources,
        },
        { status: 503 },
      );
    }
    const states: ObservedPublication[] = entries.map((entry) => {
      const assembled = assembleService(sources, entry.id);
      return {
        id: entry.id,
        publishState: assembled ? assembled.readiness.publishState : "missing",
        rawDrafts: [],
      };
    });
    if (allObservedIn(states, requestedState)) {
      // Every submitted role is already in the requested state: recovered success,
      // with no second mutation of any kind.
      return NextResponse.json({ ok: true, mode, outcome: "recovered", services: states });
    }
    return reject(
      serviceError("stale_revision", {
        message: "El resultado no coincide con lo solicitado. Recarga y vuelve a intentar.",
        details: { outcome: "not_in_requested_state", requestedState, services: states },
      }),
    );
  }

  // ── Server-authoritative recomputation ────────────────────────────────────
  const assembled = new Map<string, AssembledService>();
  const rejections: ServiceRejection[] = [];
  const missing: string[] = [];
  let integrity = false;

  for (const entry of entries) {
    const service = assembleService(sources, entry.id);
    if (!service) {
      missing.push(entry.id);
      continue;
    }
    assembled.set(entry.id, service);

    const { hard, workflow } = classifyPublishBlockers(service.readiness);
    const reasons: string[] = [];
    if (hard.length > 0) {
      // Never override-eligible, in either mode.
      reasons.push("hard_integrity_blocker");
      integrity = true;
    }
    if (!service.observation || service.observation.unsafe.length > 0) {
      reasons.push("unusable_observation");
      integrity = true;
    }
    if (service.readiness.publishState !== "draft") reasons.push("already_published");
    if (service.observation && service.observation.roleRev !== entry.rev) {
      reasons.push("stale_revision");
    }
    if (mode === "ready") {
      if (workflow.length > 0) reasons.push("not_ready");
    } else if (!sameBlockerSet(workflow, entry.acknowledgedBlockers)) {
      reasons.push("blocker_set_changed");
    }
    if (reasons.length > 0) {
      rejections.push({
        id: entry.id,
        reasons,
        hardBlockers: hard,
        workflowBlockers: workflow,
        publishState: service.readiness.publishState,
        ...(service.observation ? { storedRev: service.observation.roleRev } : {}),
        observedRev: entry.rev,
      });
    }
  }

  if (missing.length === entries.length) {
    return reject(serviceError("not_found", { details: { ids: missing } }));
  }
  if (missing.length > 0 || rejections.length > 0) {
    // Atomic: one unready or conflicted service publishes NONE of them.
    return reject(
      serviceError(integrity ? "integrity_conflict" : "stale_revision", {
        details: {
          mode,
          services: [
            ...rejections,
            ...missing.map((id) => ({ id, reasons: ["not_found"] })),
          ],
        },
      }),
    );
  }

  // ── Exact revision guard bundle ───────────────────────────────────────────
  const ops: AssertionOp[] = [];
  const assertionIssues: Record<string, string[]> = {};
  for (const entry of entries) {
    const observation = assembled.get(entry.id)?.observation;
    if (!observation) {
      assertionIssues[entry.id] = ["observation"];
      continue;
    }
    if (!(PUBLISHABLE_TYPES as readonly string[]).includes(observation.roleType)) {
      assertionIssues[entry.id] = ["unexpected_type"];
      continue;
    }
    const plan = buildPublishAssertion(observation);
    if (!plan.ok) {
      assertionIssues[entry.id] = plan.issues;
      continue;
    }
    ops.push(...plan.ops);
  }
  if (Object.keys(assertionIssues).length > 0) {
    return reject(serviceError("integrity_conflict", { details: { assertionIssues } }));
  }

  const merged = mergeAssertionOps(ops);
  if (!merged.ok) {
    return reject(serviceError("integrity_conflict", { details: { mergeIssues: merged.issues } }));
  }
  const flagged = withPublishedTrue(merged.ops, entries.map((e) => e.id));
  if (!flagged.ok) {
    return reject(serviceError("integrity_conflict", { details: { planIssues: flagged.issues } }));
  }

  // ONE transaction. Every op is revision-guarded, so any concurrent edit to a
  // role, its lock, its setlist, its proposal, or ANY assigned member's document
  // rolls the whole batch back — a publish can never land on state that moved
  // after readiness was computed.
  try {
    await applyPublishReadyAssertions(guarded(writeClient.transaction()), flagged.ops).tx.commit();
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    return reject(
      serviceError("stale_revision", {
        details: { mode, ids: entries.map((e) => e.id), guard: "publish_ready_assertions" },
      }),
    );
  }

  // ── Post-commit side effects: A2's shared transition path, unchanged ───────
  // Every selected service was an explicit draft, so each is a real `false -> true`
  // transition and every CURRENT assignee hears about it — derived from committed
  // server state across all five seat paths. Plan B adds no new idempotency or
  // duplicate-notification guarantee.
  notifyRolePublished(
    entries
      .map((entry) => {
        const observation = assembled.get(entry.id)?.observation;
        if (!observation) return null;
        return {
          recipients: validateRole(observation.role).assignedRefs,
          type: observation.roleType as ServiceType,
          date: observation.serviceDate,
          body: normalizeStoredSeats(observation.role),
        };
      })
      .filter(
        (notice): notice is NonNullable<typeof notice> => !!notice && notice.recipients.length > 0,
      ),
  );
  revalidateRolePublication();

  return NextResponse.json({
    ok: true,
    mode,
    published: entries.length,
    services: entries.map((e) => ({ id: e.id })),
  });
}
