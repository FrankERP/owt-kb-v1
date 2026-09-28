// The ONE per-service publish predicate (spec I4; MCP P3, plan D2).
//
// Would `POST /api/admin/roles/publish-ready` publish this service now, and if
// not, why? Two callers ask, and both call THIS function:
//
//  - the publish writer, `publishReady` in `app/utils/publishReadyCommit.ts`,
//    once per requested entry, before it builds the guard bundle;
//  - the MCP reads, through `publishRefusalFor` in
//    `app/mcp/reads/publishRefusal.ts`, so what `get_service` and
//    `list_services` report as blocking a publish is what the writer refuses.
//
// Until P3 the reads kept a pinned COPY of this verdict, because P1 could not
// edit a writer route (ADR-0040, D2). The body below is the route's own loop
// body, moved verbatim; only its inputs arrive as parameters and its result is
// returned. It ACCUMULATES: every reason that applies is reported, in this
// order, and nothing stops early.
//
// The verdict is not the whole refusal set. After it, the writer builds the
// revision guard bundle and can still refuse `integrity_conflict` there
// (`buildPublishAssertion` → `planPublishReadyAssertions`, `mergeAssertionOps`,
// `withPublishedTrue`). A read sees only the `unsafe` part of that stage, as
// `unusable_observation`. See ADR-0040's amendment.
//
// `integrity` is true exactly when the writer's top-level code becomes
// `integrity_conflict`: a hard blocker or an unusable observation.
//
// Neutral: no Sanity client and no `server-only`, so the MCP reads may import
// it. `AssembledService` is a type-only import from the server-only bundle; the
// caller hands the assembly in. Its importers are pinned by
// `serviceCommitCallers.test.ts`, and `publishVerdictSingleSource.test.ts`
// fails if either caller grows its own copy again.

import type { AssembledService } from "@/app/utils/publishReadyBundle";
import {
  classifyPublishBlockers,
  sameBlockerSet,
  type PublishHardBlocker,
  type PublishWorkflowBlocker,
} from "@/app/components/admin/publishSelection";

/** Every reason the verdict can give, in the order it tests them. */
export type PublishVerdictReason =
  | "hard_integrity_blocker"
  | "unusable_observation"
  | "already_published"
  | "stale_revision"
  | "not_ready"
  | "blocker_set_changed";

/**
 * One requested entry, as the writer's parser produced it. `rev` is the role
 * revision the caller observed; an `override` entry names the workflow blockers
 * it acknowledged.
 */
export type PublishVerdictEntry =
  | { rev: string; mode: "ready" }
  | { rev: string; mode: "override"; acknowledgedBlockers: readonly string[] };

export interface PublishVerdict {
  /** Why publishing refuses this service, in the order above. Empty = it passes the verdict. */
  reasons: PublishVerdictReason[];
  /** `classifyPublishBlockers(service.readiness).hard`, complete. */
  hard: PublishHardBlocker[];
  /** `classifyPublishBlockers(service.readiness).workflow`, complete. */
  workflow: PublishWorkflowBlocker[];
  /** True for a hard blocker or an unusable observation: the refusal is `integrity_conflict`. */
  integrity: boolean;
}

export function publishVerdict(service: AssembledService, entry: PublishVerdictEntry): PublishVerdict {
  const { mode } = entry;
  let integrity = false;

  const { hard, workflow } = classifyPublishBlockers(service.readiness);
  const reasons: PublishVerdictReason[] = [];
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

  return { reasons, hard, workflow, integrity };
}
