// The maximum length of any free-text field a lead or admin writes on a
// proposal — the two legacy note fields, and every message in the thread that
// replaces them.
//
// Pure and dependency-free ON PURPOSE, following `normalizeLabel.ts`. The
// definition used to live in `proposalWriteRequest.ts`, which imports
// `node:crypto` for the approval digests. `ProposalThread` is a CLIENT
// component and needs this number for the composer's cap, so importing it from
// there would drag `node:crypto` into the browser bundle — the exact hazard
// `normalizeLabel.ts:17-24` was extracted to avoid. So the constant lives here,
// importable from both sides, and the server module imports it rather than
// re-stating it.
export const PROPOSAL_NOTES_MAX = 4000;
