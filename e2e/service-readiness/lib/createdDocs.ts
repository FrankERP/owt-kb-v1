// Documents this run created THROUGH the deployed routes.
//
// The deterministic fixtures have deterministic ids, so the reset's closed allowlist
// covers them. A role created through `POST /api/admin/roles`, by contrast, gets a
// SERVER-GENERATED random id — it is a run side effect exactly like a `loginEvent`,
// and it must be cleaned up with the same discipline: by EXACT id, recorded at the
// moment it was created, never by a discovery query and never by a type/date pattern.
//
// So every spec that creates a document through a route records its id here. The
// ledger is append-only and file-backed inside the gitignored output directory, so it
// survives across Playwright workers and is still readable by the global teardown
// after the last worker has exited.
//
// The guard below is what makes the ledger safe to feed straight into a delete: an id
// that is a deterministic fixture (owned by the fixture reset) or an infrastructure
// document (the marker, the lease) is REFUSED, so neither can ever be deleted through
// this path.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { INFRASTRUCTURE_IDS, fixtureIds } from "../../../scripts/lib/sr-verification.mjs";

/** Inside the gitignored `test-results/` directory. */
export const CREATED_LEDGER_FILE = "test-results/sr-verification-created.log";

/** A conservative document-id shape. Nothing path-shaped or query-shaped. */
const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

export type RecordRefusal =
  | "malformed_id"
  | "deterministic_fixture"
  | "infrastructure_document"
  | "draft_id";

export interface RecordDecision {
  ok: boolean;
  reason: RecordRefusal | null;
}

/**
 * Decide whether an id may enter the run-created ledger. Pure, so the rules are
 * unit-testable without touching the filesystem.
 */
export function evaluateCreatedId(id: unknown): RecordDecision {
  if (typeof id !== "string" || !DOCUMENT_ID.test(id)) {
    return { ok: false, reason: "malformed_id" };
  }
  // A `drafts.` id is never something this harness creates, and deleting one would
  // be destroying draft evidence an integrity scenario may depend on.
  if (id.startsWith("drafts.")) return { ok: false, reason: "draft_id" };
  if ((INFRASTRUCTURE_IDS as readonly string[]).includes(id)) {
    return { ok: false, reason: "infrastructure_document" };
  }
  if ((fixtureIds() as string[]).includes(id)) {
    return { ok: false, reason: "deterministic_fixture" };
  }
  return { ok: true, reason: null };
}

function ledgerPath(): string {
  return resolve(process.cwd(), CREATED_LEDGER_FILE);
}

/**
 * Record one id the run created through a deployed route. Throws on a refused id
 * rather than silently dropping it: an unrecorded created document is an uncleanable
 * one, and silence is how a dataset accumulates orphans.
 */
export function recordCreatedDocument(id: string, context = "unspecified"): void {
  const decision = evaluateCreatedId(id);
  if (!decision.ok) {
    throw new Error(
      `Refusing to record created document "${id}" (${context}): ${decision.reason}. ` +
        `Deterministic fixtures and infrastructure documents are owned by the fixture reset, not by this ledger.`,
    );
  }
  const path = ledgerPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ id, context, at: new Date().toISOString() })}\n`, "utf8");
}

/** Every distinct id the run recorded, re-validated on the way out. */
export function readCreatedDocuments(): string[] {
  const path = ledgerPath();
  if (!existsSync(path)) return [];
  const ids = new Set<string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { id?: unknown };
      // Re-validated on read too, so a hand-edited ledger cannot widen the delete set.
      if (evaluateCreatedId(parsed.id).ok) ids.add(parsed.id as string);
    } catch {
      continue;
    }
  }
  return [...ids].sort();
}
