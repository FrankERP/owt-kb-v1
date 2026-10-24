// Deleting saved services from the chat (admin parity phase 2:
// docs/superpowers/plans/2026-10-24-owt-mcp-admin-parity-f2-deletes.md; ADR-0072). Three entries:
//
//   check_service_deletes  model-visible, read-only: the services a delete would remove, one line each
//                          («sábado 7 nov · borrador», «domingo 8 nov · publicado: se avisa a hasta 9
//                          personas»), the ones it would NOT and why, and a token over that exact list.
//   delete_services        destructive: deletes exactly the checked list, one service at a time,
//                          through `/admin`'s own DELETE writer (`roleDeleteCommit.ts`, D1).
//   delete_services_app    app-only, destructive: the SAME function, called by the card after its own
//                          confirmation (D8). Only the log label differs.
//
// THE PROMPT IS THE GATE. The Claude app asks permission before a destructive call and shows its
// arguments; the lines ride in them. The token makes the call repeat the preview's list exactly (D2),
// and the save re-renders every line from a fresh read of the same shape and compares (NFC): what the
// prompt shows is what goes. What the server cannot enforce is that Frank READ it: «Siempre permitir»
// removes the prompt, so the descriptions and `docs/MCP.md` say never to choose it here.
//
// THE SAVE. One strict read of the named services (a malformed answer refuses, never «ya no existe»);
// gone → «ya no existe»; `_rev` ≠ `baseRev` → «cambió», refusing the WHOLE call (D3); a past service
// or a changed line refuses all too (D5). Then one delete at a time in date order, with its «Ya no
// participas» notices queued INLINE, under the hard stop and the start cut-off of phase 1 (D6); each
// outcome classified (`classifyDeleteOutcome`, D7). A repeat of the same call finishes the rest.
//
// LOGGING: the timing line and fixed tags only — never an id, a name, a line or a token.

import "server-only";

import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { deleteRole } from "@/app/utils/roleDeleteCommit";
import { loadDependencies, loadAdminRoleIdsForMonth, loadMemberNamesByIds, loadRolesForDelete, type StoredRole } from "@/app/utils/roleWriteOps";
import { parseDeleteRequest } from "@/app/utils/roleWriteRequest";
import type { RoleDependencyInventory } from "@/app/utils/roleDependencies";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { isDraftRole } from "@/app/components/admin/clearMonthModel";
import { V3_CONNECTOR_LINES as L, V3_STORED_EDITOR_LINES } from "@/app/components/admin/v3Copy";
import { runWriteTool, type WriteFailureCopy } from "../writes/runWriteTool";
import { principalOf, type McpPrincipal } from "../monthProposals/principal";
import { memberTokenKey, type MemberTokenKey } from "../monthProposals/memberTokens";
import { canonicalJson, deleteListToken, sameMac } from "../monthProposals/changeSetTokens";
import {
  MAX_DELETES,
  byDatedRole,
  classifyDeleteOutcome,
  datedRole,
  deleteLabel,
  deleteLine,
  finishDeleteSelection,
  noticeAudience,
  sameLine,
  screenDeleteCandidates,
  type DatedRole,
  type DeleteEntry,
} from "../monthProposals/deleteLines";
import { PROPOSAL_CARD_TOOL_META } from "../apps/proposalCard";
import { SAVE_HARD_STOP_MS, SAVE_START_CUTOFF_MS, beforeStop, keepWriteAlive } from "./serviceEditor";

const D = V3_STORED_EDITOR_LINES.delete;

/** Dependency inventories a check reads at once (each is five queries). */
export const CHECK_CONCURRENCY = 4;

// ── Wire schemas ─────────────────────────────────────────────────────────────

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const SERVICE = z.string().min(1).max(128);

export const CHECK_SERVICE_DELETES_INPUT = z
  .object({
    month: MONTH,
    /** `"drafts"` (default, as «Limpiar mes») or `"all"` (published too). Ignored with `services`. */
    include: z.enum(["drafts", "all"]).optional(),
    /** Services by id (from list_services or get_service); a published one named here is selected. */
    services: z.array(SERVICE).min(1).max(MAX_DELETES).optional(),
  })
  .strict();

const DELETE = z.object({ service: SERVICE, baseRev: z.string().min(1).max(64), line: z.string().min(1).max(200) }).strict();

export const DELETE_SERVICES_INPUT = z
  .object({ month: MONTH, deletes: z.array(DELETE).min(1).max(MAX_DELETES), token: z.string().max(64) })
  .strict();

export type CheckServiceDeletesArgs = z.infer<typeof CHECK_SERVICE_DELETES_INPUT>;
export type DeleteServicesArgs = z.infer<typeof DELETE_SERVICES_INPUT>;

const DELETE_COPY: WriteFailureCopy = {
  pre: "No se pudo revisar el mes; vuelve a intentarlo. No se borró nada.",
  domain: "No pude confirmar qué se borró. Repite exactamente la misma llamada: lo que ya se borró contesta «ya no existe».",
};

export const CHECK_SERVICE_DELETES_DESCRIPTION =
  "Revisa qué servicios GUARDADOS de un mes se borrarían, sin borrar nada (como «Limpiar mes» de /admin). month es " +
  "YYYY-MM; include es \"drafts\" (solo borradores, lo normal) o \"all\" (también los publicados, que avisan por correo a " +
  "su equipo «Ya no participas»). Para uno o pocos servicios manda services con sus ids (los de list_services o " +
  "get_service). La respuesta trae una línea por servicio que se borraría, los que no se borran y por qué (los pasados " +
  "solo se borran en /admin; un servicio con setlist o propuesta no se borra), y al final los argumentos listos para " +
  "delete_services, que se pasan tal cual.";

export const DELETE_SERVICES_DESCRIPTION =
  "Borra en producción los servicios que check_service_deletes ya revisó. Pasa los argumentos de su línea «Argumentos " +
  "para delete_services» tal cual (month, deletes con service, baseRev y line de cada uno, y token): si la lista no es " +
  "exactamente la revisada, o algo cambió desde la revisión, no borra nada y pide revisar de nuevo. Antes, enséñale la " +
  "lista a la persona; cuando la app pida permiso, que lo apruebe solo esta vez (nunca «Siempre permitir» para borrar). " +
  "Borra uno a la vez con las mismas reglas y avisos que /admin. Un borrado no se deshace desde el chat. La respuesta " +
  "dice siempre qué sigue.";

// ── Deps ─────────────────────────────────────────────────────────────────────

export interface ServiceDeleteDeps {
  tokenKey: () => MemberTokenKey;
  nowMs: () => number;
  todayIso: () => string;
  /** The month's service ids as `/admin` lists them. Throws on a failed read. */
  monthIds: (month: string) => Promise<string[]>;
  /** The ONE read lines are rendered from (canonical by id + raw overlays). Throws on a failed read. */
  readRoles: typeof loadRolesForDelete;
  dependencies: (role: StoredRole) => Promise<RoleDependencyInventory>;
  /** Display names by member id. Throws on a failed read. */
  memberNames: (ids: string[]) => Promise<Map<string, string>>;
  deleteRole: typeof deleteRole;
  /** Keeps a delete that outlived the hard stop running after the answer, notices included. */
  keepAlive: (p: Promise<unknown>) => void;
}

export function defaultServiceDeleteDeps(): ServiceDeleteDeps {
  return {
    tokenKey: () => memberTokenKey(process.env),
    nowMs: () => Date.now(),
    todayIso: serviceTodayIso,
    monthIds: loadAdminRoleIdsForMonth,
    readRoles: loadRolesForDelete,
    dependencies: (role) => loadDependencies({ operation: "delete", role }),
    memberNames: loadMemberNamesByIds,
    deleteRole,
    keepAlive: keepWriteAlive,
  };
}

// ── Answers ──────────────────────────────────────────────────────────────────

function answer(isError: boolean, lines: readonly string[], content: Record<string, unknown>): CallToolResult {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text", text: lines.filter(Boolean).join("\n") }],
    structuredContent: content,
  };
}

const refusal = (lines: readonly string[], content: Record<string, unknown>) => answer(true, lines, { refused: true, ...content });

function admitted(principal: McpPrincipal | null, deps: ServiceDeleteDeps): { ok: true; key: Uint8Array } | { ok: false; result: CallToolResult } {
  if (!principal) return { ok: false, result: refusal([L.noPrincipal], { code: "forbidden", detail: "no_principal" }) };
  const key = deps.tokenKey();
  if (!key.ok) {
    console.error("[mcp-service-deletes] token secret unavailable");
    return { ok: false, result: refusal([D.readFailed], { code: "integrity_conflict", detail: "no_secret" }) };
  }
  return { ok: true, key: key.key };
}

/** `fn` over `items`, at most `limit` at a time, results in input order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── The check ────────────────────────────────────────────────────────────────

export async function checkServiceDeletesResult(
  args: CheckServiceDeletesArgs,
  principal: McpPrincipal | null,
  deps: ServiceDeleteDeps = defaultServiceDeleteDeps(),
): Promise<CallToolResult> {
  return runWriteTool(
    "check_service_deletes",
    async () => {
      const ok = admitted(principal, deps);
      if (!ok.ok) return ok.result;
      const todayIso = deps.todayIso();
      const explicit = !!args.services;
      const work = async () => {
        const ids = args.services ? [...new Set(args.services)] : await deps.monthIds(args.month);
        const read = await deps.readRoles(ids);
        const screen = screenDeleteCandidates({
          ids,
          roles: read.roles,
          overlayIds: read.overlayIds,
          month: args.month,
          todayIso,
          include: args.include ?? "drafts",
          explicit,
        });
        const inventories = await mapLimited(screen.candidates, CHECK_CONCURRENCY, async (d): Promise<[string, RoleDependencyInventory | "failed"]> => {
          try {
            return [d.role._id, await deps.dependencies(d.role)];
          } catch {
            console.error("[mcp-service-deletes] dependency read failed");
            return [d.role._id, "failed"];
          }
        });
        return finishDeleteSelection(screen, new Map(inventories));
      };
      let raced: { late: false; value: Awaited<ReturnType<typeof work>> } | { late: true };
      try {
        raced = await beforeStop(work(), SAVE_HARD_STOP_MS);
      } catch {
        console.error("[mcp-service-deletes] check read failed");
        return refusal([D.readFailed], { code: "integrity_conflict", detail: "read", retry: true });
      }
      if (raced.late) return refusal([D.checkLate], { code: "integrity_conflict", detail: "late", retry: true });
      const sel = raced.value;
      const token = sel.deletable.length ? deleteListToken(ok.key, args.month, sel.deletable) : null;
      const lines = [
        sel.deletable.length ? D.checkHead(sel.deletable.length) : D.nothing,
        ...sel.deletable.map((d) => `- ${d.line}`),
        ...(sel.kept.length ? [D.keptHead, ...sel.kept.map((k) => `- ${D.keptLine(k.label, k.reason)}`)] : []),
        ...(sel.publishedSkipped ? [D.publishedSkipped(sel.publishedSkipped)] : []),
        ...(sel.overflow ? [D.overflow(sel.overflow)] : []),
        ...(token ? [D.callHint, D.args(canonicalJson({ month: args.month, deletes: sel.deletable, token }))] : []),
      ];
      return answer(false, lines, {
        ok: true,
        month: args.month,
        deletes: sel.deletable,
        ...(token ? { token } : {}),
        kept: sel.kept,
        publishedSkipped: sel.publishedSkipped,
        overflow: sel.overflow,
      });
    },
    DELETE_COPY,
  );
}

// ── The delete ───────────────────────────────────────────────────────────────

type DeleteStatus =
  | { kind: "gone" }
  | { kind: "deleted"; published: boolean; notified: boolean | null }
  | { kind: "unknown" }
  | { kind: "pending" }
  | { kind: "notDeleted"; code: string }
  | { kind: "notDeletedRepeat" }
  | { kind: "notDeletedRecheck"; code: string };

interface ToDelete {
  entry: DeleteEntry;
  dated: DatedRole;
  label: string;
  published: boolean;
  /** The notice audience at `baseRev`, captured before any delete (names for a failed notice). */
  audience: string[];
}

export async function deleteServicesResult(
  args: DeleteServicesArgs,
  principal: McpPrincipal | null,
  deps: ServiceDeleteDeps = defaultServiceDeleteDeps(),
  tool: "delete_services" | "delete_services_app" = "delete_services",
): Promise<CallToolResult> {
  return runWriteTool(
    tool,
    async ({ callDomain }) => {
      const startedAt = deps.nowMs();
      const elapsed = () => deps.nowMs() - startedAt;
      const ok = admitted(principal, deps);
      if (!ok.ok) return ok.result;

      // (1) Admission: each service once, and the list the check minted the token for.
      const ids = args.deletes.map((d) => d.service);
      if (new Set(ids).size !== ids.length) return refusal([D.duplicate], { code: "invalid_request", detail: "duplicate" });
      if (!sameMac(args.token, deleteListToken(ok.key, args.month, args.deletes))) {
        return refusal([D.notTheChecked], { code: "invalid_request", detail: "not_the_checked" });
      }

      // (2) One strict read; sort: gone, changed, to delete.
      let read: Awaited<ReturnType<typeof deps.readRoles>>;
      try {
        const raced = await beforeStop(deps.readRoles(ids), SAVE_HARD_STOP_MS - elapsed());
        if (raced.late) return refusal([D.readFailed], { code: "integrity_conflict", detail: "read", retry: true });
        read = raced.value;
      } catch {
        console.error("[mcp-service-deletes] read failed");
        return refusal([D.readFailed], { code: "integrity_conflict", detail: "read", retry: true });
      }
      const todayIso = deps.todayIso();
      const status = new Map<string, DeleteStatus>();
      const labels = new Map<string, string>();
      const changed: string[] = [];
      const past: string[] = [];
      const toDelete: ToDelete[] = [];
      for (const entry of args.deletes) {
        const rows = read.roles.filter((r) => r._id === entry.service);
        if (!rows.length) {
          // Gone: named by the check's own line (the token proves it is the server's), up to « · ».
          labels.set(entry.service, entry.line.split(" · ")[0] || D.unknownService);
          status.set(entry.service, { kind: "gone" });
          continue;
        }
        const dated = datedRole(rows[0]);
        const label = dated ? deleteLabel(dated) : D.unknownService;
        labels.set(entry.service, label);
        if (!dated || dated.date.slice(0, 7) !== args.month) return refusal([D.notInMonth(label)], { code: "invalid_request", detail: "not_in_month" });
        if (rows.length > 1) return refusal([D.ambiguous(label)], { code: "ambiguous_target", detail: "duplicate" });
        if (dated.role._rev !== entry.baseRev) {
          changed.push(label);
          continue;
        }
        if (dated.date < todayIso) {
          past.push(label);
          continue;
        }
        const line = deleteLine(dated.role);
        if (!line || !sameLine(entry.line, line)) return refusal([D.lineChanged(label)], { code: "invalid_request", detail: "line" });
        toDelete.push({ entry, dated, label, published: !isDraftRole(dated.role), audience: noticeAudience(dated.role) });
      }
      if (changed.length) return refusal([D.changed(changed)], { code: "stale_revision", detail: "changed" });
      if (past.length) return refusal([D.past(past)], { code: "invalid_request", detail: "past" });
      if (!toDelete.length) {
        return answer(false, [D.allGone], { ok: true, month: args.month, services: ids.map((service) => ({ service, status: "gone" })) });
      }
      toDelete.sort((a, b) => byDatedRole(a.dated, b.dated));

      // Who each published delete would tell, named BEFORE any delete: once the role is gone, nothing
      // can answer for who served on it, and a failed notice can never be queued again (D7).
      const audienceIds = [...new Set(toDelete.filter((t) => t.published).flatMap((t) => t.audience))];
      let names: Map<string, string> | null = null;
      if (audienceIds.length) {
        try {
          const raced = await beforeStop(deps.memberNames(audienceIds), SAVE_HARD_STOP_MS - elapsed());
          if (!raced.late) names = raced.value;
        } catch {
          console.error("[mcp-service-deletes] member names read failed");
        }
      }
      const who = (t: ToDelete) => {
        const named = names ? t.audience.map((id) => names!.get(id)).filter((n): n is string => !!n) : [];
        return names && named.length === t.audience.length ? D.people(named) : D.peopleCount(t.audience.length);
      };

      // A strict re-read of one service: gone, its revision, or unreadable.
      const reread = async (id: string): Promise<"gone" | { rev: string } | "failed"> => {
        try {
          const raced = await beforeStop(deps.readRoles([id]), SAVE_HARD_STOP_MS - elapsed());
          if (raced.late) return "failed";
          const rows = raced.value.roles.filter((r) => r._id === id);
          if (!rows.length) return "gone";
          return rows.length === 1 ? { rev: rows[0]._rev } : "failed";
        } catch {
          console.error("[mcp-service-deletes] re-read failed");
          return "failed";
        }
      };

      // (3) The deletes, one at a time, date order (D6), each outcome classified (D7).
      let stopped = false;
      for (const t of toDelete) {
        const id = t.entry.service;
        if (stopped || elapsed() >= SAVE_START_CUTOFF_MS) {
          status.set(id, { kind: "pending" });
          continue;
        }
        const parsed = parseDeleteRequest({ rev: t.entry.baseRev });
        if (!parsed.ok) throw new Error("parse");
        let outcome: Awaited<ReturnType<typeof deps.deleteRole>> | null = null;
        try {
          const raced = await callDomain(() => {
            const write = deps.deleteRole(id, parsed.value, { notices: "inline" });
            deps.keepAlive(write);
            return beforeStop(write, SAVE_HARD_STOP_MS - elapsed());
          });
          if (!raced.late) outcome = raced.value;
        } catch {
          console.error("[mcp-service-deletes] delete threw");
        }
        const kind = classifyDeleteOutcome(outcome);
        if (kind.kind === "deleted") {
          const notified = outcome?.ok ? outcome.effects.noticesQueued : null;
          status.set(id, { kind: "deleted", published: t.published, notified: t.published && t.audience.length ? notified : null });
          continue;
        }
        if (kind.kind === "unknown") {
          status.set(id, { kind: "unknown" });
          stopped = true;
          continue;
        }
        if (kind.kind === "notFound") {
          // «ya no existe» wins over every refusal, but only on a strict read that proves it.
          const now = await reread(id);
          if (now === "gone") status.set(id, { kind: "gone" });
          else {
            status.set(id, { kind: "unknown" });
            stopped = true;
          }
          continue;
        }
        if (kind.code === "stale_revision") {
          const now = await reread(id);
          if (now === "gone") status.set(id, { kind: "gone" });
          else if (now !== "failed" && now.rev === t.entry.baseRev) status.set(id, { kind: "notDeletedRepeat" });
          else status.set(id, { kind: "notDeletedRecheck", code: kind.code });
          continue;
        }
        // The maintenance write moved the service: a fresh check is the only way on.
        if (kind.code === "bootstrap_completed_reload") status.set(id, { kind: "notDeletedRecheck", code: kind.code });
        else status.set(id, { kind: "notDeleted", code: kind.code });
      }

      // (4) Every service with its status, and the next step.
      const all = [...status.values()];
      const recheck = all.some((s) => s.kind === "notDeletedRecheck");
      const repeat = !recheck && all.some((s) => s.kind === "pending" || s.kind === "unknown" || s.kind === "notDeletedRepeat");
      const byId = new Map(toDelete.map((t) => [t.entry.service, t]));
      const text = (id: string, s: DeleteStatus): string => {
        const t = byId.get(id);
        switch (s.kind) {
          case "gone": return D.status.gone;
          case "deleted":
            if (!s.published || s.notified === null) return D.status.deleted;
            return s.notified ? D.status.deletedNotified : D.status.deletedNotNotified(t ? who(t) : D.peopleCount(0));
          case "unknown": return t && t.published && t.audience.length ? D.status.unknownNotify(who(t)) : D.status.unknown;
          case "pending": return D.status.pending;
          case "notDeleted": return D.status.notDeleted(D.reason[s.code] ?? D.reason.invalid_request);
          case "notDeletedRepeat": return D.status.notDeletedRepeat;
          case "notDeletedRecheck": return D.status.notDeletedRecheck(D.reason[s.code] ?? D.reason.invalid_request);
        }
      };
      const ordered = [...ids.filter((id) => !byId.has(id)), ...toDelete.map((t) => t.entry.service)];
      const anyDeleted = all.some((s) => s.kind === "deleted");
      const lines = [
        D.head,
        ...ordered.map((id) => D.line(labels.get(id) ?? byId.get(id)?.label ?? D.unknownService, text(id, status.get(id) ?? { kind: "pending" }))),
        ...(repeat ? [D.repeatSame] : []),
        ...(recheck ? [D.recheck] : []),
        ...(anyDeleted ? [D.undo] : []),
      ];
      const failed = all.some((s) => s.kind !== "deleted" && s.kind !== "gone");
      return answer(failed, lines, {
        ok: !failed,
        month: args.month,
        services: ordered.map((id) => ({ service: id, status: status.get(id)?.kind ?? "pending" })),
        ...(repeat ? { next: "repeat_same_call" } : recheck ? { next: "check_again" } : {}),
      });
    },
    DELETE_COPY,
  );
}

// ── Registration ─────────────────────────────────────────────────────────────

/** MCP Apps: a tool only the card may call; a host that honours it hides it from the model (ADR-0062 Q1 (1)). */
const APP_ONLY_META = { ui: { resourceUri: PROPOSAL_CARD_TOOL_META.ui.resourceUri, visibility: ["app"] } } as const;

export function registerServiceDeletes(server: McpServer): void {
  server.registerTool(
    "check_service_deletes",
    {
      title: "Revisar qué servicios se borrarían",
      description: CHECK_SERVICE_DELETES_DESCRIPTION,
      inputSchema: CHECK_SERVICE_DELETES_INPUT,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args, ctx: ServerContext) => checkServiceDeletesResult(args, principalOf(ctx)),
  );
  server.registerTool(
    "delete_services",
    {
      title: "Borrar servicios",
      description: DELETE_SERVICES_DESCRIPTION,
      inputSchema: DELETE_SERVICES_INPUT,
      // A repeat of the same call is safe (deleted services answer «ya no existe»), but every write
      // declares `idempotentHint: false`, as the other writes do (I14).
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args, ctx: ServerContext) => deleteServicesResult(args, principalOf(ctx)),
  );
  server.registerTool(
    "delete_services_app",
    {
      title: "Borrar servicios (tarjeta)",
      description: "Solo para la tarjeta del mes guardado: borra los servicios que la tarjeta revisó y la persona confirmó.",
      inputSchema: DELETE_SERVICES_INPUT,
      // The same delete as `delete_services` (one function): every check runs whoever calls it. The card
      // asks the person first (D8); a host that honours MCP Apps hides it from the model.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      _meta: APP_ONLY_META,
    },
    async (args, ctx: ServerContext) => deleteServicesResult(args, principalOf(ctx), undefined, "delete_services_app"),
  );
}
