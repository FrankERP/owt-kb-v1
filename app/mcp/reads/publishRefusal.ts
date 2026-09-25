// Would publishing refuse this service, and why? (P1, Decision D2 — spec I4.)
//
// WHY A COPY — ADR-0040 (docs/adr/0040-mcp-reads-mirror-the-readiness-loader-and-publish-check.md).
// `POST /api/admin/roles/publish-ready` decides each service inline
// (`route.ts:173-216`), in a writer route P1 may not modify (the roadmap's
// additive-only rule). This is a second copy of that per-service verdict for READ
// tools, and it is only safe while it is provably the same thing:
// `__tests__/publishRefusalParity.test.ts` runs the REAL route handler, one
// ready-mode POST per fixture service, and demands equality. A change to the
// route's verdict must be mirrored here in the same commit.
//
// THE PARITY IS BEHAVIOURAL, OVER FIXTURES — there is no text pin on the route.
// A refusal the route gains that no fixture service triggers passes the parity
// test untouched. So a new route refusal must be added in TWO places: here, and
// to the fixture matrix (`__tests__/serviceFixtures.ts`) as a service that
// triggers it — plus the code list the parity file's matrix test demands to
// occur, so the new code cannot go unexercised.
//
// HOW IT ENDS. P3 consolidates this with the publish-ready route into one
// predicate, at CRITICAL tier (plan D2) — the route is a production writer. Until
// then, never merge the two in a routine cleanup or a `/improve`
// "deduplication": that edits the writer route without the review it requires.
//
// The route, for each `{ id, rev }` entry of a ready-mode request:
//
//   service = assembleService(sources, id)       → null: `not_found`, nothing else
//   { hard, workflow } = classifyPublishBlockers(service.readiness)
//   hard.length > 0                               → hard_integrity_blocker
//   !observation || observation.unsafe.length > 0 → unusable_observation
//   readiness.publishState !== "draft"            → already_published
//   observation.roleRev !== entry.rev             → stale_revision   (not modelled)
//   workflow.length > 0                           → not_ready
//
// It ACCUMULATES: every reason that applies is reported, in that order; only a
// missing service stops early. `stale_revision` (and override mode's
// `blocker_set_changed`) exist only relative to what a POST asserts, so a read
// cannot report them — P3's writes assert revisions and are refused then.
//
// Two outputs, deliberately separate:
//  - `refusals` — the route's verdict above. Empty means publishing would go
//    through now (`ready`).
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
import {
  classifyPublishBlockers,
  type PublishBlockers,
  type PublishSkipReason,
} from "@/app/components/admin/publishSelection";
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

function refusalCopy(code: PublishRefusalCode): string {
  return code === "already_published" || code === "not_ready"
    ? PUBLISH_SKIP_COPY[code]
    : ROUTE_ONLY_COPY[code];
}

export interface PublishRefusal {
  /** True only when the route would publish this service now: `refusals` is empty. */
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

  const blockers = classifyPublishBlockers(assembled.readiness);
  const refusals: PublishRefusalCode[] = [];
  if (blockers.hard.length > 0) refusals.push("hard_integrity_blocker");
  if (!assembled.observation || assembled.observation.unsafe.length > 0) {
    refusals.push("unusable_observation");
  }
  if (assembled.readiness.publishState !== "draft") refusals.push("already_published");
  if (blockers.workflow.length > 0) refusals.push("not_ready");

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
