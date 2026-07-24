import "server-only";

import { createClient } from "next-sanity";

import { apiVersion, dataset, projectId } from "../env";

// ── Canonical operational reads ─────────────────────────────────────────────
// The single source of truth for runtime service reads: Sanity's `published`
// perspective, so application drafts (`drafts.*`) are never overlaid onto live
// data. `useCdn: false` because these back ISR pages regenerated after admin
// mutations and must read live. Setting the perspective explicitly is the whole
// point — the default perspective for apiVersion < 2025-02-19 is `raw`, which is
// exactly the draft-leaking behavior A1 exists to remove. The read token is
// optional (public published reads work without it); when present it only
// widens document access, never the perspective.
export const operationalClient = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: false,
  perspective: "published",
  token: process.env.SANITY_API_READ_TOKEN,
});

// ── Raw-integrity reads ─────────────────────────────────────────────────────
// A separately named, tokened client used ONLY to inventory raw drafts as
// integrity evidence (duplicate/dangling/draft-conflicted state). It reads the
// `raw` perspective so `drafts.*` documents are visible, and is never a runtime
// content source. `server-only` (above) keeps this token-bearing client out of
// any client bundle.
export const rawIntegrityClient = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: false,
  perspective: "raw",
  token: process.env.SANITY_API_READ_TOKEN,
});
