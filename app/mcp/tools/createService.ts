// `create_service` (admin parity phase 1, S3: docs/superpowers/plans/2026-10-21-owt-mcp-admin-parity-f1.md;
// ADR-0064): one EMPTY, unpublished service — a weekend service, a special or a «Noche de alabanza» —
// exactly as `/admin`'s «+ Nuevo servicio» in stored mode creates it (`MonthGenerator.handleCreateOne`):
// the same body (`draftCreateBody`, `published: false`, no seats), the same «Cuenta para equidad» rule
// (the Tipo's default unless asked otherwise; the default in a past month, `effectiveCreateCounts`) and
// the same writer (`roleCreateCommit.ts`, the roles POST's — ADR-0043).
//
// IDEMPOTENT BY CONSTRUCTION. The `creationRequestId` is a hash of the call's payload, so a repeat of
// the same call after a lost answer hits the same creation receipt and replays («ya estaba»), never a
// second service. A receipt whose role was later DELETED is retired for good (the commit refuses to
// recreate through it, `idempotency_key_retired`), so the hash carries a generation `n` and the next
// one is tried — bounded, because each generation is one create-then-delete that really happened.
//
// No solver rule judges an empty service, and the commit owns every target check (one weekend
// service per date, one special per date and name), so nothing is read before the write.
//
// LOGGING: fixed tags only — never a date, a name or an id.

import "server-only";

import { createHash } from "node:crypto";
import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { createRole } from "@/app/utils/roleCreateCommit";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
import { normalizeServiceName } from "@/app/utils/normalizeLabel";
import { isServiceTime } from "@/app/utils/serviceTime";
import { WORSHIP_NIGHT_FORMAT } from "@/app/utils/serviceFormat";
import { draftCreateBody } from "@/app/utils/monthDraftCreate";
import { effectiveCreateCounts } from "@/app/components/admin/fairnessToggleModel";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { typeOfKind } from "@/app/components/admin/v3Services";
import { V3_CONNECTOR_LINES as L, V3_STORED_EDITOR_LINES as S } from "@/app/components/admin/v3Copy";
import { runWriteTool, type WriteFailureCopy } from "../writes/runWriteTool";
import { principalOf, type McpPrincipal } from "../monthProposals/principal";
import { canonicalJson } from "../monthProposals/changeSetTokens";
import { draftLabel } from "../monthProposals/labels";
import { SAVE_HARD_STOP_MS, beforeStop, keepWriteAlive } from "./serviceEditor";

/** Generations tried past retired receipts before handing the create to `/admin`. */
export const CREATE_MAX_GENERATIONS = 5;

export const CREATE_SERVICE_INPUT = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(["sunday", "saturday", "special"]),
    /** Specials only. */
    name: z.string().max(80).optional(),
    /** Specials only: `"HH:mm"`. */
    time: z.string().max(5).optional(),
    /** Specials only: a «Noche de alabanza» (set once, at creation — ADR-0036). */
    worshipNight: z.boolean().optional(),
    /** «Cuenta para equidad»; absent = the Tipo's default. A past month always takes the default. */
    countsForFairness: z.boolean().optional(),
  })
  .strict();
export type CreateServiceArgs = z.infer<typeof CREATE_SERVICE_INPUT>;

export const CREATE_SERVICE_DESCRIPTION =
  "Crea en producción un servicio VACÍO y sin publicar, como «+ Nuevo servicio» de /admin. date es YYYY-MM-DD; type es " +
  "sunday (domingo), saturday (sábado) o special (especial). Un especial lleva name y puede llevar time (HH:mm) y " +
  "worshipNight (Noche de alabanza; no se puede cambiar después). countsForFairness es «Cuenta para equidad» (si no se " +
  "manda, el valor normal del tipo). Después se llena con check_service_edits y se publica con publish_service. Si dice " +
  "«sin confirmar», repite exactamente la misma llamada: no crea un segundo servicio.";

const CREATE_COPY: WriteFailureCopy = {
  pre: "No se pudo preparar el servicio; vuelve a intentarlo. No se escribió nada.",
  domain: S.create.unknown,
};

export interface CreateServiceDeps {
  createRole: typeof createRole;
  /** Keeps a create that outlived the call's hard stop running after the answer (`after()`). */
  keepAlive: (p: Promise<unknown>) => void;
  nowMs: () => number;
  todayIso: () => string;
}

export const defaultCreateServiceDeps = (): CreateServiceDeps => ({ createRole, keepAlive: keepWriteAlive, nowMs: () => Date.now(), todayIso: serviceTodayIso });

function answer(isError: boolean, lines: readonly string[], content: Record<string, unknown>): CallToolResult {
  return { ...(isError ? { isError: true } : {}), content: [{ type: "text", text: lines.join("\n") }], structuredContent: content };
}
const refusal = (line: string, detail: string) => answer(true, [line], { refused: true, code: "invalid_request", detail });

/**
 * Whether a replayed receipt's role is still the service this call asks for. A receipt keeps
 * pointing at its role after `/admin` renames or moves it; «ya estaba» would then name a service
 * that is no longer there, so a role that drifted counts as gone and the next generation creates.
 */
export function replayMatches(role: Record<string, unknown>, intent: { date: string; service_name?: string; time?: string; format?: string }): boolean {
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return (
    (text(role.date) ?? "").slice(0, 10) === intent.date &&
    normalizeServiceName(text(role.service_name) ?? "") === (intent.service_name ?? "") &&
    text(role.time) === (intent.time ?? null) &&
    text(role.format) === (intent.format ?? null)
  );
}

/** `[A-Za-z0-9._:-]`, 8–128 characters (`parseCreateRequest`); the same payload and generation, the same id. */
export function createRequestId(payload: unknown, generation: number): string {
  const digest = createHash("sha256").update(`mcp-service-create|${canonicalJson(payload)}|${generation}`).digest("hex");
  return `mcp-create.${digest.slice(0, 32)}`;
}

const REASON: Record<string, string> = {
  invalid_request: "la petición no es válida",
  integrity_conflict: "los datos de esa fecha no cuadran (revisa la cola de integridad)",
  dependency_conflict: "otro documento de esa fecha lo impide",
  forbidden: "no está permitido",
};

export async function createServiceResult(
  args: CreateServiceArgs,
  principal: McpPrincipal | null,
  deps: CreateServiceDeps = defaultCreateServiceDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "create_service",
    async ({ callDomain }) => {
      const startedAt = deps.nowMs();
      if (!principal) return answer(true, [L.noPrincipal], { refused: true, code: "forbidden", detail: "no_principal" });
      const special = args.type === "special";
      const noon = new Date(`${args.date}T12:00:00`);
      const roundTrip = `${noon.getFullYear()}-${String(noon.getMonth() + 1).padStart(2, "0")}-${String(noon.getDate()).padStart(2, "0")}`;
      if (Number.isNaN(noon.getTime()) || roundTrip !== args.date) return refusal(S.create.badDate, "date");
      if (args.type !== "special" && noon.getDay() !== (args.type === "sunday" ? 0 : 6)) return refusal(S.create.badWeekday(args.type), "weekday");
      if (!special && (args.name !== undefined || args.time !== undefined || args.worshipNight !== undefined)) return refusal(S.create.onlySpecial, "only_special");
      const name = special ? normalizeServiceName(args.name ?? "") : null;
      if (special && !name) return refusal(S.create.needsName, "name");
      const time = special && args.time ? args.time : null;
      if (time && !isServiceTime(time)) return refusal(S.create.badTime, "time");

      const _type = typeOfKind(args.type);
      const todayIso = deps.todayIso();
      // The composer's value, decided NOW (C1 §6.0/§6.5): the Tipo's default unless asked, and in a
      // past month the default whatever was asked.
      const countsForFairness = effectiveCreateCounts(_type, args.date, args.countsForFairness ?? countsForFairnessDefault(_type), todayIso);
      const intent = {
        _type,
        date: args.date,
        ...(special ? { service_name: name! } : {}),
        ...(time ? { time } : {}),
        ...(special && args.worshipNight ? { format: WORSHIP_NIGHT_FORMAT } : {}),
        countsForFairness,
      };
      const label = draftLabel({ _type, date: args.date, service_name: name ?? undefined });

      for (let generation = 0; generation < CREATE_MAX_GENERATIONS; generation++) {
        const requestId = createRequestId(intent, generation);
        // The receipt fingerprints the parsed JSON, so the body crosses JSON once, as the route's does.
        const body: unknown = JSON.parse(
          JSON.stringify(
            draftCreateBody({ localId: requestId, creationRequestId: requestId, ...intent, leads: [], bgvs: [], chorus: [], instruments: [], foh: [] }, false, todayIso),
          ),
        );
        let out: Awaited<ReturnType<typeof deps.createRole>> | null = null;
        try {
          const raced = await callDomain(() => {
            const write = deps.createRole(body);
            deps.keepAlive(write);
            return beforeStop(write, SAVE_HARD_STOP_MS - (deps.nowMs() - startedAt));
          });
          if (!raced.late) out = raced.value;
        } catch {
          console.error("[mcp-create-service] create threw");
        }
        if (!out || (!out.ok && out.status >= 500)) {
          return answer(true, [S.create.unknown], { ok: false, status: "unknown", next: "repeat_same_call" });
        }
        if (out.ok) {
          const replay = out.effects.kind === "replay";
          if (replay && !replayMatches(out.body as Record<string, unknown>, intent)) continue;
          return answer(false, [replay ? S.create.already(label) : S.create.created(label)], {
            ok: true,
            status: replay ? "already" : "created",
            ...(out.effects.roleId ? { service: out.effects.roleId } : {}),
          });
        }
        const code = typeof out.body.error === "string" ? out.body.error : "";
        if (code === "idempotency_key_retired") continue;
        if (code === "ambiguous_target") return answer(true, [S.create.exists(label)], { refused: true, code, detail: "exists" });
        return answer(true, [S.create.refused(REASON[code] ?? REASON.invalid_request)], { refused: true, code: code || "invalid_request" });
      }
      return answer(true, [S.create.retired], { refused: true, code: "idempotency_key_retired" });
    },
    CREATE_COPY,
  );
}

export function registerCreateService(server: McpServer): void {
  server.registerTool(
    "create_service",
    {
      title: "Crear servicio",
      description: CREATE_SERVICE_DESCRIPTION,
      inputSchema: CREATE_SERVICE_INPUT,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args, ctx: ServerContext) => createServiceResult(args, principalOf(ctx)),
  );
}
