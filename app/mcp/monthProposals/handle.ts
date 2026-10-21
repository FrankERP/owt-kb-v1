// The proposal handle (D9): 26 lowercase Crockford base32 characters, each drawn from its own
// random byte (5 bits of 8, so every character is uniform: 130 bits). Short enough for a model
// to copy, unguessable, and validated before any read.

import { PROPOSAL_ID_PREFIX } from "./documentTypes";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const HANDLE_RE = /^[0-9a-hjkmnp-tv-z]{26}$/;

export function newProposalHandle(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export function isProposalHandle(value: unknown): value is string {
  return typeof value === "string" && HANDLE_RE.test(value);
}

export function proposalIdOf(handle: string): string {
  return PROPOSAL_ID_PREFIX + handle;
}

/** Exactly the ids `proposalIdOf` mints — the only ids the store reads, patches or deletes. */
export function isProposalId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(PROPOSAL_ID_PREFIX) && isProposalHandle(id.slice(PROPOSAL_ID_PREFIX.length));
}
