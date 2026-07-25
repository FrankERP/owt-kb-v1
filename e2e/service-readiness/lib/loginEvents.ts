// Service Readiness A3 §4 — the harness's run-owned `loginEvent` access.
//
// Deliberately its OWN module, separate from `dataset.ts`: the only login-event
// removal in this repository lives in `scripts/lib/sr-verification-runtime.mjs`, and
// `scripts/lib/__tests__/sr-verification-login-events.test.mjs` enforces that by
// failing any file that mentions login events next to a client removal call. Keeping
// the login-event path here — where it only DELEGATES, and issues no removal call of
// its own — keeps that detector meaningful, instead of needing an exception for a file
// whose removal call is really about deterministic fixtures.
//
// The predicate, the full-tuple validation, the revision-guarded removal and the
// zero-remaining re-query are ALL the shared runtime module's; nothing is re-decided
// here.

import {
  deleteRunOwnedLoginEvents,
  fetchRunOwnedLoginEvents,
  verifyRunOwnedLoginEventsGone,
} from "../../../scripts/lib/sr-verification-runtime.mjs";

import { datasetClient } from "./dataset";
import type { RunIdentity } from "./runIdentity";

export interface RunOwnedLoginEvent {
  _id: string;
  _rev?: string;
  runId?: string;
  attemptId?: string;
  candidateSha?: string;
  deploymentId?: string;
}

/**
 * The ONE permitted login-event query: the exact run + deployment ownership
 * predicate. There is no `*[_type == "loginEvent"]` path, no email/member path and no
 * timestamp-range path anywhere in this harness.
 */
export async function fetchOwnedLoginEvents(identity: RunIdentity): Promise<RunOwnedLoginEvent[]> {
  return (await fetchRunOwnedLoginEvents(datasetClient(), identity)) as RunOwnedLoginEvent[];
}

export interface LoginEventCleanup {
  deletedIds: string[];
  refused: Array<{ id: string | null; reason: string }>;
  remaining: RunOwnedLoginEvent[];
  ok: boolean;
}

/**
 * Capture any LATE event with the same exact predicate, validate every returned
 * document's full ownership tuple, remove only that explicit `_id` set under each
 * document's revision, then re-query the same predicate and require zero remaining.
 */
export async function cleanupOwnedLoginEvents(identity: RunIdentity): Promise<LoginEventCleanup> {
  const client = datasetClient();
  const events = await fetchOwnedLoginEvents(identity);
  const { deletedIds, refused } = (await deleteRunOwnedLoginEvents(client, events, identity)) as {
    deletedIds: string[];
    refused: Array<{ id: string | null; reason: string }>;
  };
  const { remaining, verdict } = (await verifyRunOwnedLoginEventsGone(client, identity)) as {
    remaining: RunOwnedLoginEvent[];
    verdict: { ok: boolean };
  };
  return { deletedIds, refused, remaining, ok: verdict.ok && refused.length === 0 };
}
