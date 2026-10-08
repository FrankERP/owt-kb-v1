// scripts/lib/reconstructDecide.ts
//
// THE one `scripts/lib` module that imports C2's write-request module (solver v3 C4
// R20 b; C2 IF2-23's importer pin lists exactly this file and the CLI file). It
// re-exposes the four pure functions C4 needs for actor `reconstruction` —
// validation (IF2-18), the content hash (IF2-19), the stored-record parser (IF2-20)
// and the write decision (IF2-21) — and the script's fixed `recordedBy` marker.
// It never calls the executor (IF2-22): only `scripts/reconstruct-fairness-months.mjs`
// does (R20 a). Nothing here builds an id, a key, a stamp, a name or a record hash
// (R2): every value below is C2's, computed by C2's functions.

import {
  RECONSTRUCTION_RECORDED_BY,
  contentHashOfStored,
  contentHashOfWrite,
  decideFairnessMonth,
  isIntact,
  parseStoredFairnessMonth,
  validateFairnessMonthWrite,
  type FairnessDecision,
  type FairnessIssue,
} from "../../app/utils/fairnessMonthWriteRequest";
import type { FairnessMonthBody, LogicalRecord } from "../../app/utils/fairnessVocabulary";
import type { ReconstructionBody } from "./reconstructTypes";

/** C2 WR-14's fixed, non-member marker; the executor refuses any other for this actor. */
export const RECORDED_BY = RECONSTRUCTION_RECORDED_BY;

/** IF2-18 with actor `reconstruction` and the run's one CDMX month (spec Interfaces 2). */
export function validateReconstructionBody(
  body: ReconstructionBody,
  currentMonth: string,
): { ok: true } | { ok: false; issues: FairnessIssue[] } {
  const checked = validateFairnessMonthWrite(body, "reconstruction", currentMonth);
  return checked.ok ? { ok: true } : { ok: false, issues: checked.issues };
}

/** IF2-19 of a body — the planned `contentHash` (a body's `expectedRev` never enters it). */
export function hashOfBody(body: FairnessMonthBody): string {
  return contentHashOfWrite(body.month, body);
}

/** IF2-20. A refusal is a malformed read (R3: exit 1, nothing written). */
export function parseRecord(doc: unknown): { ok: true; record: LogicalRecord } | { ok: false; issues: FairnessIssue[] } {
  const parsed = parseStoredFairnessMonth(doc);
  return parsed.ok ? { ok: true, record: parsed.record } : { ok: false, issues: parsed.issues };
}

/** What IF2-21 needs about a stored record, read the way the executor's own re-read reads it (WR-7). */
export interface StoredSummary {
  /** As read — never built (R2). */
  id: string;
  rev: string;
  source: string;
  contentHash: string;
  /** IF2-19's `contentHashOfStored` — computable on a record the parser refuses (R18). */
  recomputedHash: string;
  intact: boolean;
}

export function summarizeStored(doc: Record<string, unknown>): StoredSummary {
  return {
    id: String(doc._id ?? ""),
    rev: String(doc._rev ?? ""),
    source: String(doc.source ?? ""),
    contentHash: String(doc.contentHash ?? ""),
    recomputedHash: contentHashOfStored(doc),
    intact: isIntact(doc),
  };
}

const facts = (stored: StoredSummary | null) =>
  stored
    ? { rev: stored.rev, source: stored.source as LogicalRecord["source"], contentHash: stored.contentHash, intact: stored.intact }
    : null;

/** IF2-21 for a write entry — the very function the executor re-runs at write time (R14). */
export function decideWrite(input: {
  month: string;
  currentMonth: string;
  bodyHash: string;
  stored: StoredSummary | null;
  freezing: number;
}): FairnessDecision {
  return decideFairnessMonth({
    actor: "reconstruction",
    op: "write",
    month: input.month,
    currentMonth: input.currentMonth,
    expectedRev: input.stored ? input.stored.rev : null,
    bodyHash: input.bodyHash,
    stored: facts(input.stored),
    hasFreezingServices: input.freezing > 0,
  });
}

/** IF2-21 for a delete (R18; WR-14 D1–D4). */
export function decideDelete(input: { month: string; currentMonth: string; stored: StoredSummary | null }): FairnessDecision {
  return decideFairnessMonth({
    actor: "reconstruction",
    op: "delete",
    month: input.month,
    currentMonth: input.currentMonth,
    expectedRev: input.stored ? input.stored.rev : null,
    bodyHash: null,
    stored: facts(input.stored),
    hasFreezingServices: false,
  });
}
