// Request parsing and message construction for the private lead ↔ admin thread
// on a `setlistProposal` (Release 2 §4).
//
// Pure, like `proposalWriteRequest`: no Sanity client, no I/O, no framework
// types, so every validation and shape rule is unit-testable in memory. The
// routes that append these objects live elsewhere and own the guards, the
// canonical-proposal resolution and the `setIfMissing` + `append` patch.

import { PROPOSAL_NOTES_MAX } from "./proposalWriteRequest";
import type { ParseResult } from "./roleWriteRequest";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function fail(issues: string[]): { ok: false; issues: string[] } {
  return { ok: false, issues };
}

/**
 * WHAT kind of speech act a message is — distinct from WHO spoke
 * (`PROPOSAL_AUTHOR_ROLES`). `pastor_note` and `system` are reserved from day
 * one so that routing pastor or transition notes into this thread later is a
 * write-path change with no schema migration. Nothing mints them yet.
 */
export const PROPOSAL_MESSAGE_KINDS = [
  "lead_note",
  "admin_change_request",
  "pastor_note",
  "system",
] as const;
export type ProposalMessageKind = (typeof PROPOSAL_MESSAGE_KINDS)[number];

/**
 * WHO spoke, snapshotted at post time rather than joined at read time: if an
 * admin later becomes a `member`, their historical change-request must not
 * retroactively re-render as a lead note.
 */
export const PROPOSAL_AUTHOR_ROLES = ["lead", "admin", "pastor", "system"] as const;
export type ProposalAuthorRole = (typeof PROPOSAL_AUTHOR_ROLES)[number];

/**
 * Runaway-growth bound on one thread, NOT a security boundary. It is checked
 * against the loaded document before an append, which makes it racy by
 * construction — two concurrent posts at 199 both pass and both land, leaving
 * 201. That is accepted: the alternative is a revision precondition, which
 * would 409 one of two people typing at the same time in a channel whose whole
 * promise is that nothing is lost.
 */
export const PROPOSAL_MESSAGES_MAX = 200;

export interface ParsedProposalMessageRequest {
  body: string;
}

/**
 * Parse `{ body }` for the two standalone message routes.
 *
 * Empty / whitespace-only bodies are rejected here — a blank bubble is noise in
 * a thread. The admin TRANSITION path is deliberately the opposite: `reopen`
 * accepts an empty note and must simply append no message, so it must not reuse
 * this parser's emptiness rule.
 *
 * The stored body keeps its interior formatting (the UI renders it
 * `whitespace-pre-wrap`); only the outer whitespace is trimmed. The length cap
 * and its `notes_length` issue code are the same ones
 * `parseProposalSaveRequest` / `parseProposalTransitionRequest` already use, so
 * one limit governs every free-text field on this document.
 */
export function parseProposalMessageRequest(
  body: unknown,
): ParseResult<ParsedProposalMessageRequest> {
  if (!isObj(body)) return fail(["payload"]);
  if (typeof body.body !== "string") return fail(["body"]);
  if (body.body.length > PROPOSAL_NOTES_MAX) return fail(["notes_length"]);
  const trimmed = body.body.trim();
  if (!trimmed) return fail(["body"]);
  return { ok: true, value: { body: trimmed } };
}

/** One stored item of `setlistProposal.messages[]`. */
export interface ProposalMessage {
  _key: string;
  /**
   * OPTIONAL: migrated admin notes with no attributable author are minted
   * without one and render as "Admin". A fabricated attribution in an
   * audit-adjacent history is worse than an absent one.
   */
  author?: { _ref: string; _type: "reference" };
  author_role: ProposalAuthorRole;
  kind: ProposalMessageKind;
  body: string;
  at: string;
}

/**
 * Build the object a route appends. `now` and `key` are injected rather than
 * read from the clock and `randomUUID` here, so the shape stays pure and every
 * caller mints its `_key` with the repo's one generator (`nextKey()`) —
 * CLAUDE.md's array-of-object invariant.
 *
 * Returns null rather than a half-formed message: a message with no body, no
 * timestamp or no `_key` is not something to store and then discover later.
 */
export function buildProposalMessage(input: {
  authorId?: string | null;
  authorRole: ProposalAuthorRole;
  kind: ProposalMessageKind;
  body: string;
  now: string;
  key: string;
}): ProposalMessage | null {
  if (!input.key) return null;
  if (!input.now) return null;
  if (!(PROPOSAL_AUTHOR_ROLES as readonly string[]).includes(input.authorRole)) return null;
  if (!(PROPOSAL_MESSAGE_KINDS as readonly string[]).includes(input.kind)) return null;
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return null;
  if (body.length > PROPOSAL_NOTES_MAX) return null;
  return {
    _key: input.key,
    ...(typeof input.authorId === "string" && input.authorId
      ? { author: { _ref: input.authorId, _type: "reference" as const } }
      : {}),
    author_role: input.authorRole,
    kind: input.kind,
    body,
    at: input.now,
  };
}
