// app/components/admin/monthPreflight.ts
//
// The global integrity queue exactly as `/admin → Servicios` builds it, lifted out of
// `ServicesPanel`'s memo so the MCP month planner (`app/utils/v3MonthPlan.ts`) runs
// each planned target's `monthTargetPreflight` over the same queue the panel shows.
//
// Its own module, not `serviceIntegrityQueue.ts`: `serviceCardModel.ts` already
// imports that module, so a `serviceCardRefs` call there would close an import
// cycle. Neither of the two modules imports this one.
//
// Neutral: no React, no "use client", nothing that reads a session or the network.

import { serviceCardRefs, type CardSourceSummaries, type ServiceRole } from "./serviceCardModel";
import { buildIntegrityQueue, type IntegrityQueue, type IntegrityQueueInput } from "./serviceIntegrityQueue";

/**
 * The queue over every loaded card (not just the visible ones), built from the SAME
 * three summaries, so a month filter can never push an owned issue into the global
 * `Integridad de datos` list.
 */
export function integrityQueueFor(input: {
  sources: IntegrityQueueInput["sources"];
  roles: readonly ServiceRole[];
  summaries: CardSourceSummaries;
}): IntegrityQueue {
  const { sources, roles, summaries } = input;
  return buildIntegrityQueue({
    sources,
    cards: serviceCardRefs(roles, summaries),
    roles: summaries.roles,
    setlists: summaries.setlists,
    proposals: summaries.proposals,
  });
}
