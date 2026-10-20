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
import {
  SOLVER_CONFIG_DOC_ID,
  SOLVER_CONFIG_VERSION,
  solverConfigFromDocument,
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
 * The body `GET /api/admin/solver-config` answers for a stored document (or its
 * absence). The route sends it; the MCP month planner hands the same body, through a
 * JSON round trip, to the browser's own `sourceFromGet`, so both surfaces derive the
 * rule set the same way. `configVersion` on every answer, absent included: a client
 * that speaks another version disables its own save on reading it (C3 §6.2).
 */
export function solverConfigGetBody(doc: (StoredSolverConfigDoc & Record<string, unknown>) | null) {
  if (!doc) {
    return { present: false, rev: null, config: null, configVersion: SOLVER_CONFIG_VERSION };
  }
  return {
    present: true,
    rev: typeof doc._rev === "string" ? doc._rev : null,
    config: solverConfigFromDocument(doc),
    configVersion: SOLVER_CONFIG_VERSION,
  };
}
