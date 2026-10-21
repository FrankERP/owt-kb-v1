// MCP tool `get_integrity_queue` (admin parity phase 1, S1): the «Integridad de datos» queue as
// `/admin` → Servicios builds it (`integrityQueueFor` over the three `service-integrity` summaries
// of one service snapshot and the admin roles rows, the same pair the month planner reads), with the
// panel's Spanish labels. A domain that failed to read makes the answer say «inventario incompleto»,
// never «sin problemas». With `month`, the issues attached to that month's services are listed too.
//
// Document ids are shown because the cleanup tool asks for them; member ids never: an entry's
// `relatedIds` (an owner role, a missing member) are left out.

import "server-only";

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { integrityQueueFor } from "@/app/components/admin/monthPreflight";
import type { ServiceRole } from "@/app/components/admin/serviceCardModel";
import {
  INTEGRITY_ACTION_COPY,
  INTEGRITY_INCOMPLETE_NOTE,
  INTEGRITY_KIND_LABEL,
  describeIntegrityReason,
  integrityQueueSummary,
  type IntegrityQueue,
  type IntegrityQueueEntry,
} from "@/app/components/admin/serviceIntegrityQueue";
import { kindOfType, serviceLabel } from "@/app/components/admin/v3Services";
import { adminRolesQuery } from "@/app/utils/serviceReadQueries";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { runReadTool, successResult } from "../reads/errors";
import { loadServiceSnapshot, type ServiceSnapshot } from "../reads/serviceSnapshot";

export const GET_INTEGRITY_QUEUE_INPUT = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() })
  .strict();

export type GetIntegrityQueueArgs = z.infer<typeof GET_INTEGRITY_QUEUE_INPUT>;

export const GET_INTEGRITY_QUEUE_DESCRIPTION =
  "Muestra la cola «Integridad de datos» de /admin → Servicios: documentos de servicios, setlists o propuestas " +
  "con problemas que ningún servicio puede resolver solo (duplicados, borradores sin publicar, bloqueos " +
  "inconsistentes, referencias a miembros que ya no existen), cada uno con su motivo, los ids de los documentos y " +
  "la acción sugerida. Con month (\"YYYY-MM\") también lista los problemas de los servicios de ese mes. Si alguna " +
  "lectura falló, lo dice: nunca responde «sin problemas» sin haberlo comprobado. Solo lee: no cambia nada.";

export interface GetIntegrityQueueDeps {
  roles: () => Promise<ServiceRole[]>;
  snapshot: () => Promise<ServiceSnapshot>;
}

const defaultDeps: GetIntegrityQueueDeps = {
  roles: async () => {
    const q = adminRolesQuery();
    const rows: unknown = await operationalClient.fetch(q.query, q.params);
    if (!Array.isArray(rows)) throw new Error("roles");
    return JSON.parse(JSON.stringify(rows)) as ServiceRole[];
  },
  snapshot: loadServiceSnapshot,
};

function presentEntry(e: IntegrityQueueEntry) {
  return {
    tipo: INTEGRITY_KIND_LABEL[e.kind],
    motivos: e.reasons.map(describeIntegrityReason),
    ids: e.ids,
    bloquea: e.blocking,
    accion: INTEGRITY_ACTION_COPY[e.action],
  };
}

export function presentIntegrityQueue(queue: IntegrityQueue, roles: readonly ServiceRole[], month?: string) {
  const byService = month
    ? roles
        .filter((r) => r.date?.slice(0, 7) === month && (queue.byCard[r._id]?.length ?? 0) > 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((r) => {
          const kind = kindOfType(r._type);
          return {
            servicio: kind ? serviceLabel(kind, r.date, r.service_name) : r.date,
            serviceId: r._id,
            problemas: (queue.byCard[r._id] ?? []).map(presentEntry),
          };
        })
    : undefined;
  return {
    resumen: integrityQueueSummary(queue),
    ...(queue.incomplete ? { nota: INTEGRITY_INCOMPLETE_NOTE } : {}),
    cola: queue.entries.map(presentEntry),
    ...(byService ? { month, porServicio: byService } : {}),
  };
}

export async function getIntegrityQueueResult(args: GetIntegrityQueueArgs, deps: GetIntegrityQueueDeps = defaultDeps): Promise<CallToolResult> {
  return runReadTool("get_integrity_queue", async () => {
    // The roles rows first, the snapshot after (`v3MonthPlanReads.ts`'s order).
    const roles = await deps.roles();
    const snapshot = await deps.snapshot();
    const summaries = {
      roles: snapshot.readiness.roleSummary,
      setlists: snapshot.readiness.setlistSummary,
      proposals: snapshot.readiness.proposalSummary,
    };
    const queue = integrityQueueFor({ sources: snapshot.readiness.sources, roles, summaries });
    return successResult(presentIntegrityQueue(queue, roles, args.month));
  });
}

export function registerGetIntegrityQueue(server: McpServer): void {
  server.registerTool(
    "get_integrity_queue",
    {
      title: "Ver la cola de integridad",
      description: GET_INTEGRITY_QUEUE_DESCRIPTION,
      inputSchema: GET_INTEGRITY_QUEUE_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => getIntegrityQueueResult(args),
  );
}
