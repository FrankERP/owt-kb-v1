// The stored planner rule set (`solverConfig`), read raw — moved verbatim out of
// `app/api/admin/solver-config/route.ts` so the MCP month planner reads the rules
// exactly as the route's GET and its POST's revision check do (MCP P4 step 4). The
// route imports it back; nothing about the read changed.
//
// Answers the stored document or `null` (absent). A failed read THROWS: the caller
// must never turn it into "absent", which would solve with the defaults.
//
// No `import "server-only"` of its own: `operationalClient` carries that guard, and a
// second marker here would make the route's own tests (which mock the client) unable
// to load the route unchanged.

import { operationalClient } from "@/sanity/lib/operationalClient";
import { rulePeopleRosterQuery } from "@/app/utils/serviceReadQueries";
import {
  SOLVER_CONFIG_DOC_ID,
  SOLVER_CONFIG_VERSION,
  rulePeopleToNames,
  type RulePeopleRosterMember,
} from "@/app/utils/solverConfigWriteRequest";

export interface StoredSolverConfigDoc {
  _id?: string;
  _rev?: string;
}

export async function loadStoredSolverConfig(): Promise<(StoredSolverConfigDoc & Record<string, unknown>) | null> {
  const doc = await operationalClient.fetch<Record<string, unknown> | null>(
    `*[_id == $id][0]`,
    { id: SOLVER_CONFIG_DOC_ID },
  );
  return doc ?? null;
}

/**
 * The roster the rule-person translation reads (ADR-0092): every published member, any
 * ministry. A failed read THROWS, like the document's: a GET without it could not turn ids into
 * names, and a save without it could not turn names into ids.
 */
export async function loadRulePeopleRoster(): Promise<RulePeopleRosterMember[]> {
  const q = rulePeopleRosterQuery();
  const rows: unknown = await operationalClient.fetch(q.query, q.params);
  if (!Array.isArray(rows)) throw new Error("rule people roster read failed");
  return rows as RulePeopleRosterMember[];
}

/** The stored document and the roster, read together: what every rules reader needs. */
export async function loadSolverConfigWithRoster(): Promise<{
  doc: (StoredSolverConfigDoc & Record<string, unknown>) | null;
  roster: RulePeopleRosterMember[];
}> {
  const [doc, roster] = await Promise.all([loadStoredSolverConfig(), loadRulePeopleRoster()]);
  return { doc, roster };
}

/**
 * The body `GET /api/admin/solver-config` answers for a stored document (or its
 * absence). The route sends it; the MCP month planner hands the same body, through a
 * JSON round trip, to the browser's own `sourceFromGet`, so both surfaces derive the
 * rule set the same way. The config is always NAMES (`rulePeopleToNames`, ADR-0092): no member
 * id leaves this function. `configVersion` on every answer, absent included: a client
 * that speaks another version disables its own save on reading it (C3 §6.2).
 */
export function solverConfigGetBody(
  doc: (StoredSolverConfigDoc & Record<string, unknown>) | null,
  roster: readonly RulePeopleRosterMember[],
) {
  if (!doc) {
    return { present: false, rev: null, config: null, configVersion: SOLVER_CONFIG_VERSION };
  }
  return {
    present: true,
    rev: typeof doc._rev === "string" ? doc._rev : null,
    // Names, in both modes (ADR-0092): an id-keyed document is read through the roster.
    config: rulePeopleToNames(doc, roster).config,
    configVersion: SOLVER_CONFIG_VERSION,
  };
}
