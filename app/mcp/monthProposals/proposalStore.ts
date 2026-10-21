import "server-only";

// The month-proposal store (P4 on solver v3, D6/D12): the only code that reads or writes
// `mcpProposal` documents. `server-only` because it imports `writeClient` (a write token).
//
// Nothing here throws: every outcome is a typed result, and an unexpected Sanity failure is
// `{ ok: false, reason: "server_error", cause }` for the caller to log by a fixed tag. This
// module logs nothing.
//
// No lease (D6). Every domain write an apply makes is replay-safe on its own, so the only shared
// mutable data is `state`, a set of facts that only grow. `writeState` patches it under
// `ifRevisionId`; on a revision conflict it re-reads, merges (`mergeState`: OR and union) and
// retries, so two concurrent applies of one proposal can never lose each other's facts.
//
// A REVISION (the editor's save, plan T2.2) is a new record plus the base's `supersededBy`, both
// in ONE transaction (`saveRevision`): a child never exists without its base marked, and a base
// is never marked without its child.

import { writeClient } from "@/sanity/lib/serverClient";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { MCP_PROPOSAL_TYPE, PROPOSAL_FIELDS } from "./documentTypes";
import { isProposalHandle, isProposalId, proposalIdOf } from "./handle";
import {
  mergeState,
  parseProposal,
  stateText,
  type NewProposalDocument,
  type ProposalState,
  type StoredProposal,
} from "./proposalDocument";

export type ProposalStoreFailure = { ok: false; reason: "server_error"; cause: unknown };

/** Retries after the first attempt of a `state` write (D6). */
export const STATE_WRITE_RETRIES = 3;
/** D12: a record is swept only this long after it expired, so a sweep never races an apply's load. */
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;
/** D12: at most this many records per sweep. */
export const SWEEP_LIMIT = 25;

const PROPOSAL_QUERY = `*[_type == $type && _id == $id][0]{ _id, _type, _rev, ${PROPOSAL_FIELDS.join(", ")} }`;
const EXPIRED_QUERY = `*[_type == $type && expiresAt < $cutoff] | order(expiresAt asc) [0...${SWEEP_LIMIT}]._id`;

/** `create`, never `createOrReplace`: a handle collision fails instead of overwriting a record. */
export async function createProposal(doc: NewProposalDocument): Promise<{ ok: true } | ProposalStoreFailure> {
  try {
    await writeClient.create(doc);
    return { ok: true };
  } catch (cause) {
    return { ok: false, reason: "server_error", cause };
  }
}

export type ProposalLookup =
  | { ok: true; proposal: StoredProposal }
  /** Not a handle, no such record, or a record that does not parse — all the same to a caller (D10). */
  | { ok: false; reason: "not_found" }
  | ProposalStoreFailure;

const NOT_FOUND = Object.freeze({ ok: false, reason: "not_found" } as const);
const handleOf = (id: string): string => id.slice(id.indexOf(".") + 1);

export async function loadProposal(handle: string): Promise<ProposalLookup> {
  if (!isProposalHandle(handle)) return NOT_FOUND;
  let raw: unknown;
  try {
    raw = await writeClient.fetch<unknown>(PROPOSAL_QUERY, { type: MCP_PROPOSAL_TYPE, id: proposalIdOf(handle) });
  } catch (cause) {
    return { ok: false, reason: "server_error", cause };
  }
  const proposal = parseProposal(raw);
  return proposal ? { ok: true, proposal } : NOT_FOUND;
}

export type WriteStateResult =
  | { ok: true; state: ProposalState }
  /**
   * `conflict`: every attempt lost the revision race; `gone`: the record vanished or no longer
   * parses. Either way `state` is the union of everything known, for the caller to report —
   * nothing this call learned is dropped from its answer.
   */
  | { ok: false; reason: "conflict" | "gone"; state: ProposalState }
  | (ProposalStoreFailure & { state: ProposalState });

/**
 * Add `next`'s facts to the record's `state`, observed at `rev`. On a revision conflict:
 * re-read, merge with what is stored, retry — at most {@link STATE_WRITE_RETRIES} times.
 */
export async function writeState(proposal: StoredProposal, next: ProposalState): Promise<WriteStateResult> {
  let rev = proposal.rev;
  let merged = mergeState(proposal.state, next);
  for (let attempt = 0; attempt <= STATE_WRITE_RETRIES; attempt++) {
    try {
      await writeClient.patch(proposal.id).ifRevisionId(rev).set({ state: stateText(merged) }).commit();
      return { ok: true, state: merged };
    } catch (cause) {
      if (sanityConflictKind(cause) === null) return { ok: false, reason: "server_error", cause, state: merged };
    }
    const reread = await loadProposal(handleOf(proposal.id));
    if (!reread.ok) {
      return reread.reason === "not_found"
        ? { ok: false, reason: "gone", state: merged }
        : { ok: false, reason: "server_error", cause: reread.cause, state: merged };
    }
    rev = reread.proposal.rev;
    merged = mergeState(reread.proposal.state, merged);
  }
  return { ok: false, reason: "conflict", state: merged };
}

export type SaveRevisionResult<R> =
  | { ok: true }
  /** The base was superseded meanwhile, by another revision (E3 (a)): `by` names it. */
  | { ok: false; reason: "superseded"; by: string }
  /** The caller's re-judgement of the fresh base refused the save (E3 (b): it started applying). */
  | { ok: false; reason: "refused"; refusal: R }
  /** `conflict`: every attempt lost the revision race; `gone`: the base vanished or no longer parses. */
  | { ok: false; reason: "conflict" | "gone" }
  | ProposalStoreFailure;

/**
 * T2.2's save: ONE transaction that creates `child` and sets the base's `state.supersededBy` to
 * it, the base's patch under `ifRevisionId` of the read that passed E3, so the two land together
 * or not at all. The base's other facts are kept as read (`mergeState`).
 *
 * On a revision conflict it re-reads the base: superseded by THIS child is our own earlier commit
 * whose answer was lost (success); superseded by another is refused naming it; otherwise
 * `recheck` (the caller's E3 over the fresh base — whether it started applying) may refuse, and a
 * base that passes is retried at its new revision, at most {@link STATE_WRITE_RETRIES} times.
 * A base already superseded when called is refused without writing.
 */
export async function saveRevision<R>(
  base: StoredProposal,
  child: NewProposalDocument,
  recheck: (fresh: StoredProposal) => Promise<R | null>,
): Promise<SaveRevisionResult<R>> {
  const childHandle = handleOf(child._id);
  let current = base;
  for (let attempt = 0; attempt <= STATE_WRITE_RETRIES; attempt++) {
    const by = current.state.supersededBy;
    if (by !== undefined) return by === childHandle ? { ok: true } : { ok: false, reason: "superseded", by };
    const state = stateText(mergeState(current.state, { recordsDone: false, created: {}, supersededBy: childHandle }));
    const rev = current.rev;
    try {
      await writeClient
        .transaction()
        .create(child)
        .patch(current.id, (p) => p.ifRevisionId(rev).set({ state }))
        .commit();
      return { ok: true };
    } catch (cause) {
      if (sanityConflictKind(cause) === null) return { ok: false, reason: "server_error", cause };
    }
    const reread = await loadProposal(handleOf(base.id));
    if (!reread.ok) {
      return reread.reason === "not_found" ? { ok: false, reason: "gone" } : { ok: false, reason: "server_error", cause: reread.cause };
    }
    current = reread.proposal;
    if (current.state.supersededBy !== undefined) continue;
    let refusal: R | null;
    try {
      refusal = await recheck(current);
    } catch (cause) {
      return { ok: false, reason: "server_error", cause };
    }
    if (refusal !== null) return { ok: false, reason: "refused", refusal };
  }
  const by = current.state.supersededBy;
  if (by !== undefined) return by === childHandle ? { ok: true } : { ok: false, reason: "superseded", by };
  return { ok: false, reason: "conflict" };
}

/**
 * D12: delete up to {@link SWEEP_LIMIT} records whose `expiresAt` is more than
 * {@link SWEEP_GRACE_MS} past. Only ids `proposalIdOf` mints are ever deleted.
 */
export async function sweepExpired(nowMs: number): Promise<{ ok: true; deleted: number } | ProposalStoreFailure> {
  try {
    const cutoff = new Date(nowMs - SWEEP_GRACE_MS).toISOString();
    const ids: unknown = await writeClient.fetch<unknown>(EXPIRED_QUERY, { type: MCP_PROPOSAL_TYPE, cutoff });
    const doomed = (Array.isArray(ids) ? ids : []).filter(isProposalId).slice(0, SWEEP_LIMIT);
    if (doomed.length === 0) return { ok: true, deleted: 0 };
    await doomed.reduce((tx, id) => tx.delete(id), writeClient.transaction()).commit();
    return { ok: true, deleted: doomed.length };
  } catch (cause) {
    return { ok: false, reason: "server_error", cause };
  }
}
