// The server-authoritative publish writer (Plan B item 3) — the domain body of
// `POST /api/admin/roles/publish-ready`, moved here VERBATIM so the MCP
// `publish_service` tool calls the very same code path. The admin route keeps
// only its authorization prefix and JSON parse; it cannot export this function
// itself, because Next type-checks a route module's export set against a fixed
// list.
//
// Three modes, one contract:
//
//   { mode: "ready",    roles: [{ id, rev }] }
//   { mode: "override", roles: [{ id, rev, acknowledgedBlockers: [...] }] }   // batch
//   { mode: "recover",  roles: [{ id }], published: boolean }                 // READ ONLY
//
// `ready` and `override` never trust the client's readiness. Both RELOAD the five
// A1 read domains, recompute the per-service verdict with `publishVerdict`
// (`app/utils/publishVerdict.ts` — the ONE publish predicate, which the MCP reads
// call too), build A2's exact revision guard bundle, and commit through A2's
// guarded publish-ready assertion helper in ONE transaction. The batch is atomic:
// if any selected service is no longer ready, or any guard cannot be built,
// nothing is committed and the answer is `409` with per-service reasons.
//
// `override` exists only for WORKFLOW blockers; hard integrity blockers are never
// override-eligible in either mode. `recover` refetches and never replays.
//
// Boundary, and nothing else, differs from the route it came from: each
// refusal RETURNS `{ ok: false, status, body }` instead of sending it (the
// recovery `503` included, with no `effects`), success returns the same JSON as
// `body` plus `effects` (the recovered `200` carries an explicit empty one), the
// per-service verdict is one `publishVerdict` call, and the two post-commit
// helpers' return values (their descriptors) are captured at their existing
// call sites. A commit that fails for any reason other than a revision conflict
// still THROWS, exactly as the route's 500 did.
//
// This module is a registered protected writer (`PROTECTED_RUNTIME_WRITERS`,
// `app/utils/publishReadyCommit.ts#module`), its callers are pinned by
// `serviceCommitCallers.test.ts`, and it is a delivery-capable import for the
// SR-verification run-context scan. Adding a caller means touching that pin.
// Why the writers live here and not in their routes: ADR-0043. Why the verdict
// is shared with the reads: ADR-0040's amendment.

import "server-only";

import { writeClient } from "@/sanity/lib/serverClient";
import type { ServiceType } from "@/app/utils/assignmentEmail";
import {
  notifyRolePublished,
  queuePublishedSetlistNotices,
  revalidateRolePublication,
  serviceParticipants,
  type PublishedSetlistNoticesDescriptor,
  type RolePublishedDescriptor,
  type RoleTypeName,
} from "@/app/utils/serviceMutationSideEffects";
import { serviceError } from "@/app/utils/serviceMutation";
import { validateRole } from "@/app/utils/serviceReadModel";
import { normalizeStoredSeats, sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { publishVerdict } from "@/app/utils/publishVerdict";
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
  type ServiceObservation,
} from "@/app/utils/publishReadyBundle";
import type { CommitOutcome } from "@/app/utils/commitOutcome";

/**
 * What a publish already held, for a caller that must report the write. Nothing
 * here is re-read after the commit.
 */
export interface PublishReadyEffects {
  /**
   * True only for a `recover` request that found every role already in the
   * requested state. That answer wrote nothing and ran no helper, so the other
   * fields are empty and null.
   */
  recovered: boolean;
  /**
   * The observation of every service this transaction published, in request
   * order — the exact values the two helpers below were built from. Each is a
   * deep COPY: `queuePublishedSetlistNotices` hands `observation.role` BY
   * REFERENCE into its deferred block, which reads a special's `songs` there to
   * decide whether «Setlist listo» is minted. A caller editing its report must
   * never change that decision.
   */
  observations: ServiceObservation[];
  /**
   * `notifyRolePublished`'s descriptor: one push per published service with an
   * assignee, plus the consolidated email batch. Null when no published service
   * had an assignee (the helper then registers nothing).
   */
  push: RolePublishedDescriptor | null;
  /**
   * `queuePublishedSetlistNotices`' descriptor: every subject offered to the
   * deferred «Setlist listo» block. Null when it skipped silently or swallowed
   * a failure.
   */
  notice: PublishedSetlistNoticesDescriptor | null;
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

export async function publishReady(body: unknown): Promise<CommitOutcome<PublishReadyEffects>> {
  const parsed = parsePublishReadyRequest(body);
  if (!parsed.ok) {
    return { ok: false, ...serviceError("invalid_request", { details: { issues: parsed.issues } }) };
  }
  const { mode, entries, requestedState } = parsed.value;

  // Only these three stored types ever have their publication state changed here.
  const PUBLISHABLE_TYPES = ["sunday_role", "saturday_role", "special_role"] as const;

  const sources = await loadServiceReadinessSources();

  // ── Recovery for a lost/unknown outcome: refetch, never replay ─────────────
  if (mode === "recover") {
    if (sources.failedSources.length > 0) {
      // A failed recovery refetch stays `unknown`. Not success, not failure.
      return {
        ok: false,
        status: 503,
        body: {
          error: "unknown_outcome",
          outcome: "unknown",
          message: "No se pudo confirmar el resultado. Vuelve a intentar la verificación.",
          failedSources: sources.failedSources,
        },
      };
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
      return {
        ok: true,
        status: 200,
        body: { ok: true, mode, outcome: "recovered", services: states },
        effects: { recovered: true, observations: [], push: null, notice: null },
      };
    }
    return {
      ok: false,
      ...serviceError("stale_revision", {
        message: "El resultado no coincide con lo solicitado. Recarga y vuelve a intentar.",
        details: { outcome: "not_in_requested_state", requestedState, services: states },
      }),
    };
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

    const verdict = publishVerdict(
      service,
      mode === "ready"
        ? { rev: entry.rev, mode }
        : { rev: entry.rev, mode, acknowledgedBlockers: entry.acknowledgedBlockers },
    );
    const { reasons, hard, workflow } = verdict;
    if (verdict.integrity) integrity = true;
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
    return { ok: false, ...serviceError("not_found", { details: { ids: missing } }) };
  }
  if (missing.length > 0 || rejections.length > 0) {
    // Atomic: one unready or conflicted service publishes NONE of them.
    return {
      ok: false,
      ...serviceError(integrity ? "integrity_conflict" : "stale_revision", {
        details: {
          mode,
          services: [
            ...rejections,
            ...missing.map((id) => ({ id, reasons: ["not_found"] })),
          ],
        },
      }),
    };
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
    return { ok: false, ...serviceError("integrity_conflict", { details: { assertionIssues } }) };
  }

  const merged = mergeAssertionOps(ops);
  if (!merged.ok) {
    return { ok: false, ...serviceError("integrity_conflict", { details: { mergeIssues: merged.issues } }) };
  }
  const flagged = withPublishedTrue(merged.ops, entries.map((e) => e.id));
  if (!flagged.ok) {
    return { ok: false, ...serviceError("integrity_conflict", { details: { planIssues: flagged.issues } }) };
  }

  // ONE transaction. Every op is revision-guarded, so any concurrent edit to a
  // role, its lock, its setlist, its proposal, or ANY assigned member's document
  // rolls the whole batch back — a publish can never land on state that moved
  // after readiness was computed.
  try {
    await applyPublishReadyAssertions(guarded(writeClient.transaction()), flagged.ops).tx.commit();
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    return {
      ok: false,
      ...serviceError("stale_revision", {
        details: { mode, ids: entries.map((e) => e.id), guard: "publish_ready_assertions" },
      }),
    };
  }

  // ── Post-commit side effects: A2's shared transition path, unchanged ───────
  // Every selected service was an explicit draft, so each is a real `false -> true`
  // transition and every CURRENT assignee hears about it — derived from committed
  // server state across all five seat paths. Plan B adds no new idempotency or
  // duplicate-notification guarantee.
  const observations = entries
    .map((entry) => assembled.get(entry.id)?.observation)
    .filter((o): o is NonNullable<typeof o> => !!o);
  const pushDescriptor = notifyRolePublished(
    observations
      .map((observation) => ({
        recipients: validateRole(observation.role).assignedRefs,
        type: observation.roleType as ServiceType,
        date: observation.serviceDate,
        body: normalizeStoredSeats(observation.role),
      }))
      .filter((notice) => notice.recipients.length > 0),
  );
  // The SAME publish rule as `/api/admin/roles/publish` (§2), through the same
  // helper so the two publish surfaces cannot drift: every `false -> true`
  // transition queues one `setlist` notice with an EMPTY before-snapshot, and a
  // service published with no songs queues nothing.
  const noticeDescriptor = queuePublishedSetlistNotices(
    observations.map((observation) => ({
      roleId: observation.roleId,
      roleType: observation.roleType as RoleTypeName,
      serviceDate: observation.serviceDate,
      role: observation.role,
      knownRecipients: serviceParticipants(observation.role),
    })),
  );
  revalidateRolePublication();

  // A deep copy per observation: `observation.role` is still held by the
  // deferred «Setlist listo» block above (see `PublishReadyEffects`). Every
  // observation is plain data decoded from Sanity's JSON, so `structuredClone`
  // cannot throw here, after the commit.
  const effects: PublishReadyEffects = {
    recovered: false,
    observations: observations.map((observation) => structuredClone(observation)),
    push: pushDescriptor,
    notice: noticeDescriptor,
  };

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      mode,
      published: entries.length,
      services: entries.map((e) => ({ id: e.id })),
    },
    effects,
  };
}
