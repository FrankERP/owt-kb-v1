// app/components/admin/v3SolveResponse.ts
//
// Solver v3 C6 U8 / AD-1–AD-6 — the v3 adapter. v2's handshake, violation parser, unfilled mapper,
// `applySolveResponse`, `solverRefusalMessage` and the trailing retry never read a v3 body, and this
// module never reads a v2 one (the caller dispatches on the engine prop before reading the body).
//
// Classification, in AD-3's order: 409 `solver_version_mismatch` → reload; an abort, a throw, any
// non-JSON body, any status other than 200/422/409, or a body with `transport_error` → transport; an
// `ok` body without `contract: 3` and `engine: "v3"` → transport (`contract_echo`); a 422 coded
// failure → that code's copy; `ok: true` → the handshake (AD-4), then apply (AD-5).
// Retry (AD-6): offered exactly after the `timeout` code and a timeout or connection transport.

import { reconcileOccupants, type GridCell, type GridRow } from "./plannerModel";
import { V3_ROUTE_COPY, V3_UNFILLED_MARKER, refusalLine, transportLine } from "./v3Copy";
import type { V3Pin, V3Role, V3SolveRequest, V3Success, V3TransportReason } from "./v3Wire";

export type V3Answer = { kind: "aborted" } | { kind: "threw" } | { kind: "http"; status: number; text: string };

export type V3Outcome =
  | { kind: "version_mismatch" }
  | { kind: "transport"; reason: V3TransportReason | "unknown_service" }
  | { kind: "refusal"; code: string; params: Record<string, unknown> }
  | { kind: "handshake_failed" }
  | { kind: "success"; response: V3Success };

const TRANSPORT_REASONS: readonly string[] = ["timeout", "unreachable", "http_status", "not_json", "not_configured", "contract_echo"];

export function classifyV3Answer(answer: V3Answer): V3Outcome {
  if (answer.kind === "aborted") return { kind: "transport", reason: "timeout" };
  if (answer.kind === "threw") return { kind: "transport", reason: "unreachable" };
  let json: unknown;
  let parsed = true;
  try { json = JSON.parse(answer.text); } catch { parsed = false; }
  const o = parsed && typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (answer.status === 409 && o?.error === "solver_version_mismatch") return { kind: "version_mismatch" };
  if (!o) return { kind: "transport", reason: answer.status === 504 ? "timeout" : "not_json" };
  if (answer.status !== 200 && answer.status !== 422) return { kind: "transport", reason: answer.status === 504 ? "timeout" : "http_status" };
  if (o.transport_error === true) {
    const r = typeof o.transport === "string" && TRANSPORT_REASONS.includes(o.transport) ? (o.transport as V3TransportReason) : "http_status";
    return { kind: "transport", reason: r };
  }
  if (o.ok === true) {
    return o.contract === 3 && o.engine === "v3" ? { kind: "success", response: o as unknown as V3Success } : { kind: "transport", reason: "contract_echo" };
  }
  if (answer.status === 422 && o.ok === false && o.contract === 3 && o.engine === "v3" && typeof o.code === "string") {
    return { kind: "refusal", code: o.code, params: (typeof o.params === "object" && o.params !== null ? o.params : {}) as Record<string, unknown> };
  }
  return { kind: "transport", reason: "http_status" };
}

/** AD-6: a retry can heal a timeout or a connection fault — never a configuration fault or a refusal. */
export function v3RetryOffered(o: V3Outcome): boolean {
  if (o.kind === "refusal") return o.code === "timeout";
  if (o.kind === "transport") return o.reason === "timeout" || o.reason === "unreachable" || o.reason === "http_status" || o.reason === "not_json";
  return false;
}

export function v3OutcomeLine(o: Exclude<V3Outcome, { kind: "success" }>): string {
  if (o.kind === "version_mismatch") return V3_ROUTE_COPY.versionMismatch;
  if (o.kind === "handshake_failed") return V3_ROUTE_COPY.handshake;
  if (o.kind === "transport") return transportLine(o.reason);
  return refusalLine(o.code, o.params);
}

/** AD-4: the echo equals the (distinct) pins sent, and every pin sits under its service and role. */
export function v3HandshakeHolds(response: V3Success, pins: readonly V3Pin[]): boolean {
  const distinct = [...new Map(pins.map((p) => [`${p.service}\u0000${p.role}\u0000${p.person}`, p])).values()];
  if (response.pins?.requested !== distinct.length || response.pins?.honored !== distinct.length) return false;
  return distinct.every((p) => (response.assignments[p.service]?.[p.role] ?? []).includes(p.person));
}

const ROW_OF: Record<V3Role, string> = { Lead: "lead", BGV: "bgv", Choir: "coro" };

/**
 * AD-5: assignments map by service id to PLANNED (non-fixed) columns only; a board-pinned cell keeps
 * its origin, every other planned voice cell is replaced with `origin: "auto"`; a fixed service's
 * cells are never written. An assignment for an id the request did not send applies nothing.
 */
export function applyV3Assignments(input: {
  response: V3Success;
  request: V3SolveRequest;
  cells: readonly GridCell[];
  rows: readonly GridRow[];
  pinnedCellKeys: ReadonlySet<string>;
}): { ok: true; cells: GridCell[]; unfilled: Array<{ columnId: string; rowId: string; reason: string }> } | { ok: false } {
  const sent = new Map(input.request.services.map((s) => [s.id, s]));
  for (const id of Object.keys(input.response.assignments)) if (!sent.has(id)) return { ok: false };
  let cells = [...input.cells];
  for (const [id, byRole] of Object.entries(input.response.assignments)) {
    const service = sent.get(id)!;
    if (service.fixed) continue;
    for (const role of ["Lead", "BGV", "Choir"] as const) {
      const rowId = ROW_OF[role];
      if (!input.rows.some((r) => r.id === rowId)) continue;
      if (role === "Choir" && service.kind === "saturday") continue;
      const ids = byRole[role] ?? [];
      const at = cells.findIndex((c) => c.columnId === id && c.rowId === rowId);
      const pinned = input.pinnedCellKeys.has(`${id}|${rowId}`);
      const previous = at === -1 ? undefined : cells[at];
      const next: GridCell = {
        ...(previous ?? { columnId: id, rowId }),
        columnId: id,
        rowId,
        occupants: reconcileOccupants(previous?.occupants ?? [], ids),
        origin: pinned && previous ? previous.origin : "auto",
      };
      cells = at === -1 ? [...cells, next] : [...cells.slice(0, at), next, ...cells.slice(at + 1)];
    }
  }
  const unfilled = input.response.unfilled
    .filter((u) => sent.get(u.service)?.fixed === false)
    .flatMap((u) => Array.from({ length: u.count }, () => ({ columnId: u.service, rowId: ROW_OF[u.role], reason: V3_UNFILLED_MARKER(u.reason) })));
  return { ok: true, cells, unfilled };
}
