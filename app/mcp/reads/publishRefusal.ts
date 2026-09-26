// Would publishing refuse this service, and why? (P1, spec I4.)
//
// ONE PREDICATE — ADR-0040, amended by P3 (docs/adr/0040-mcp-reads-mirror-the-readiness-loader-and-publish-check.md).
// The per-service verdict is `publishVerdict` (`app/utils/publishVerdict.ts`),
// the very function the publish writer (`publishReady` in
// `app/utils/publishReadyCommit.ts`, behind `POST /api/admin/roles/publish-ready`)
// calls for each requested entry. This module is a thin READ adapter over it: it
// supplies the arguments a read has, narrows the result to the codes a read can
// observe, and adds Spanish copy. It decides nothing itself — never add a
// refusal here; add it to `publishVerdict`, and both surfaces get it.
//
// Until P3 this was a second copy of the verdict, held equal by
// `__tests__/publishRefusalParity.test.ts`. That test still runs the REAL route
// handler, one ready-mode POST per fixture service, and now proves the WIRING:
// the route, through its writer, still refuses exactly what this adapter
// reports. `app/utils/__tests__/publishVerdictSingleSource.test.ts` fails if
// either side grows its own copy again.
//
// WHAT A READ PASSES. A read has no request revision, so it passes the
// snapshot's own `roleRev` and `mode: "ready"`:
//
//   service = assembleService(sources, id)       → null: `not_found`, nothing else
//   publishVerdict(service, { mode: "ready", rev: observation.roleRev })
//     → hard_integrity_blocker, unusable_observation, already_published, not_ready
//
// `stale_revision` needs an observation whose rev differs from the one passed,
// and `blocker_set_changed` needs `override` mode, so neither can come back
// here. They exist only relative to what a POST asserts; P3's write tools assert
// revisions and are refused then. The narrowing below is compile-time: a reason
// `publishVerdict` gains fails `tsc` here until this adapter says what a read
// shows for it.
//
// THE VERDICT IS NOT THE WHOLE REFUSAL SET. After it, the writer builds the
// revision guard bundle (`buildPublishAssertion` → `planPublishReadyAssertions`,
// then `mergeAssertionOps` and `withPublishedTrue`) and can still refuse
// `integrity_conflict` there. A read sees only the `unsafe` part of that stage,
// as `unusable_observation`, so `ready: true` does not promise that the publish
// succeeds (ADR-0040's amendment).
//
// Its INPUT is still assembled two ways: the writer from
// `loadServiceReadinessSources`, the reads from P1's snapshot mirror
// (`serviceSnapshot.ts`, D1), pinned by `serviceSnapshotMirror.test.ts` and
// `serviceSnapshotParity.test.ts`.
//
// It ACCUMULATES: every reason that applies is reported, in the verdict's
// order; only a missing service stops early.
//
// Two outputs, deliberately separate:
//  - `refusals` — the verdict above. Empty means publishing would go through
//    now (`ready`), up to the guard-bundle stage.
//  - `blockers` — the FULL readiness classification, never cut short by a
//    refusal, so a live service that lost its setlist still shows the gap.
//
// PRECONDITION: pass only CANONICAL role ids to `assembleService`. The route's
// parser refuses a `drafts.*` id before reading anything (`isCanonicalDocumentId`),
// so there is no route verdict for one to agree with — and here a draft-only
// record would read as `already_published`, because it has no canonical
// `published` field and `derivePublishState(undefined)` is "published".
//
// Neutral: no Sanity client, no `server-only`. `AssembledService` is a type-only
// import from the server-only bundle; the caller hands the assembly in.

import type { AssembledService } from "@/app/utils/publishReadyBundle";
import { publishVerdict, type PublishVerdictReason } from "@/app/utils/publishVerdict";
import type { PublishBlockers, PublishSkipReason } from "@/app/components/admin/publishSelection";
import { PUBLISH_SKIP_COPY } from "@/app/components/admin/serviceCardModel";

/** The route's ready-mode refusal codes a read can observe, in the route's order. */
export type PublishRefusalCode =
  | "not_found"
  | "hard_integrity_blocker"
  | "unusable_observation"
  | "already_published"
  | "not_ready";

/**
 * Spanish copy for the route-only codes `PUBLISH_SKIP_COPY` has no entry for.
 * Keyed by exactly the codes it lacks: if the admin's map ever gains one of
 * these, this literal gets an excess key and `tsc` fails — its copy then wins.
 */
const ROUTE_ONLY_COPY: Record<Exclude<PublishRefusalCode, PublishSkipReason>, string> = {
  not_found: "el servicio no existe",
  hard_integrity_blocker: "hay un problema de integridad en los datos del servicio",
  unusable_observation: "no se pudo leer el servicio con seguridad para publicarlo",
};

/**
 * The Spanish text for one refusal code — the admin's own `PUBLISH_SKIP_COPY`
 * where it has one, the route-only copy above otherwise. Exported so a write
 * tool that reports the same code shows the same words as `get_service`; never
 * retype these strings.
 */
export function refusalCopy(code: PublishRefusalCode): string {
  return code === "already_published" || code === "not_ready"
    ? PUBLISH_SKIP_COPY[code]
    : ROUTE_ONLY_COPY[code];
}

/** The verdict codes that exist only relative to what a POST asserts (see the header). */
type RequestOnlyReason = "stale_revision" | "blocker_set_changed";

/**
 * Narrows a verdict reason to what a read can observe. By construction (own
 * `roleRev`, `mode: "ready"`) it never removes anything; it exists so the result
 * TYPES as `PublishRefusalCode`, and so a new verdict reason fails `tsc` below.
 */
function isReadObservable(reason: PublishVerdictReason): reason is Exclude<PublishVerdictReason, RequestOnlyReason> {
  return reason !== "stale_revision" && reason !== "blocker_set_changed";
}

export interface PublishRefusal {
  /** True only when the route would publish this service now: `refusals` is empty — up to the guard-bundle stage (ADR-0040's amendment). */
  ready: boolean;
  /** Why a ready-mode publish would be refused, in the route's own order. */
  refusals: PublishRefusalCode[];
  /** Spanish text for each refusal; `copy[i]` explains `refusals[i]`. */
  copy: string[];
  /**
   * `classifyPublishBlockers(readiness)`, complete. Null only for a service that
   * does not exist — there is no readiness to classify, which is not "no gaps".
   */
  blockers: PublishBlockers | null;
  /** Spanish text for each blocker, parallel to `blockers.hard` / `blockers.workflow`. */
  blockerCopy: { hard: string[]; workflow: string[] } | null;
}

/** The publish-ready route's per-service verdict, for `assembleService(...)`'s result. */
export function publishRefusalFor(assembled: AssembledService | null): PublishRefusal {
  if (!assembled) {
    return {
      ready: false,
      refusals: ["not_found"],
      copy: [refusalCopy("not_found")],
      blockers: null,
      blockerCopy: null,
    };
  }

  const verdict = publishVerdict(assembled, {
    mode: "ready",
    rev: assembled.observation?.roleRev ?? "",
  });
  const refusals: PublishRefusalCode[] = verdict.reasons.filter(isReadObservable);
  const blockers: PublishBlockers = { workflow: verdict.workflow, hard: verdict.hard };

  return {
    ready: refusals.length === 0,
    refusals,
    copy: refusals.map(refusalCopy),
    blockers,
    blockerCopy: {
      hard: blockers.hard.map((code) => PUBLISH_SKIP_COPY[code]),
      workflow: blockers.workflow.map((code) => PUBLISH_SKIP_COPY[code]),
    },
  };
}
