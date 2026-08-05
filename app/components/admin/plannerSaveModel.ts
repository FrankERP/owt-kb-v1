import { normalizeLabel, normalizeServiceName } from "@/app/utils/normalizeLabel";
import type { GridCell } from "./plannerModel";
import type { StoredGridColumn, StoredGridRow } from "./storedRoleReadModel";

export interface RoleSemanticSnapshot {
  type: StoredGridColumn["type"];
  date: string;
  serviceName: string | null;
  leads: string[];
  bgvs: string[];
  chorus: string[];
  instruments: { label: string; memberId: string }[];
  foh: { label: string; memberId: string }[];
}

export interface StoredRolePatchBody {
  rev: string;
  lockRev?: string;
  _type: StoredGridColumn["type"];
  date: string;
  service_name?: string;
  leads: string[];
  bgvs: string[];
  chorus: string[];
  instruments: { instrument: string; personId: string }[];
  foh: { role: string; personId: string }[];
}

export type StoredColumnSerialization =
  | { ok: true; body: StoredRolePatchBody; snapshot: RoleSemanticSnapshot }
  | { ok: false; reasons: string[] };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function sortedAssignments<T extends { label: string; memberId: string }>(values: readonly T[]): T[] {
  return [...values].sort((a, b) =>
    a.label.localeCompare(b.label) || a.memberId.localeCompare(b.memberId),
  );
}

function cellsForColumn(cells: readonly GridCell[], columnId: string): GridCell[] {
  return cells.filter((cell) => cell.columnId === columnId);
}

/** Complete full-array PATCH serializer. It never emits only dirty rows. */
export function serializeStoredColumn(
  column: StoredGridColumn,
  rows: readonly StoredGridRow[],
  cells: readonly GridCell[],
): StoredColumnSerialization {
  const reasons = new Set<string>();
  if (column.admission === "readOnly") reasons.add("column_not_mutable");
  // A legacy role with no coordination lock is intentionally serializable:
  // its first PATCH performs maintenance only and returns
  // `bootstrap_completed_reload`. The client retains the exact local intent,
  // reloads the new lock/revision, and requires a second explicit save.
  const ownCells = cellsForColumn(cells, column.columnId);
  const byRow = new Map(ownCells.map((cell) => [cell.rowId, cell]));
  for (const voice of ["lead", "bgv", "coro"]) {
    if (!byRow.has(voice)) reasons.add(`missing_${voice}`);
  }
  if (column.type === "saturday_role" && (byRow.get("coro")?.occupants.length ?? 0) > 0) {
    reasons.add("hidden_saturday_chorus");
  }
  if (column.type === "special_role" && !normalizeServiceName(column.serviceName)) {
    reasons.add("invalid_special_name");
  }

  const memberIds = (rowId: string): string[] => {
    const occupants = byRow.get(rowId)?.occupants ?? [];
    if (occupants.some((occupant) => !occupant.memberId)) reasons.add("invalid_occupant");
    return occupants.map((occupant) => occupant.memberId);
  };
  const leads = memberIds("lead");
  const bgvs = memberIds("bgv");
  const chorus = column.type === "saturday_role" ? [] : memberIds("coro");
  const instruments: StoredRolePatchBody["instruments"] = [];
  const foh: StoredRolePatchBody["foh"] = [];

  for (const row of rows) {
    if (row.category === "voz") continue;
    const cell = byRow.get(row.id);
    if (!cell?.occupants.length) continue;
    const label = normalizeLabel(row.writeLabel ?? row.label);
    if (!label) {
      reasons.add("invalid_write_label");
      continue;
    }
    for (const occupant of cell.occupants) {
      if (!occupant.memberId) {
        reasons.add("invalid_occupant");
        continue;
      }
      if (row.category === "instrumento") {
        instruments.push({ instrument: label, personId: occupant.memberId });
      } else {
        foh.push({ role: label, personId: occupant.memberId });
      }
    }
  }

  if (reasons.size) return { ok: false, reasons: [...reasons] };
  const body: StoredRolePatchBody = {
    rev: column.rev,
    ...(column.lockRev ? { lockRev: column.lockRev } : {}),
    _type: column.type,
    date: column.date,
    ...(column.type === "special_role" ? { service_name: normalizeServiceName(column.serviceName) } : {}),
    leads,
    bgvs,
    chorus,
    instruments,
    foh,
  };
  return { ok: true, body, snapshot: semanticSnapshot(body) };
}

export function semanticSnapshot(body: StoredRolePatchBody): RoleSemanticSnapshot {
  return {
    type: body._type,
    date: body.date,
    serviceName: body._type === "special_role" ? normalizeServiceName(body.service_name) : null,
    leads: sortedStrings(body.leads),
    bgvs: sortedStrings(body.bgvs),
    chorus: sortedStrings(body.chorus),
    instruments: sortedAssignments(body.instruments.map((item) => ({
      label: normalizeLabel(item.instrument) ?? "",
      memberId: item.personId,
    }))),
    foh: sortedAssignments(body.foh.map((item) => ({
      label: normalizeLabel(item.role) ?? "",
      memberId: item.personId,
    }))),
  };
}

export function sameRoleSemantics(a: RoleSemanticSnapshot, b: RoleSemanticSnapshot): boolean {
  return stableJson(a) === stableJson(b);
}

export interface FrozenSaveAttempt {
  attemptId: string;
  roleId: string;
  observedRev: string;
  exactPayload: StoredRolePatchBody;
  exactBodyBytes: string;
  intendedSnapshot: RoleSemanticSnapshot;
}

export function freezeSaveAttempt(
  attemptId: string,
  column: StoredGridColumn,
  serialized: Extract<StoredColumnSerialization, { ok: true }>,
): FrozenSaveAttempt {
  return {
    attemptId,
    roleId: column.roleId,
    observedRev: column.rev,
    exactPayload: serialized.body,
    exactBodyBytes: stableJson(serialized.body),
    intendedSnapshot: serialized.snapshot,
  };
}

export type PatchTransportOutcome =
  | { kind: "knownCommitted" }
  | { kind: "knownFailure"; code: string }
  | { kind: "maintenanceReload" }
  | { kind: "unknown"; code?: string };

const PROVEN_PREWRITE_FAILURES = new Set([
  "invalid_request",
  "forbidden",
  "not_found",
  "integrity_conflict",
  "ambiguous_target",
  "dependency_conflict",
  "stale_revision",
]);

function responseCode(body: unknown): string | null {
  return body !== null && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : null;
}

export function classifyPatchOutcome(input: {
  status?: number;
  body?: unknown;
  transportError?: boolean;
}): PatchTransportOutcome {
  if (input.transportError || input.status === undefined) return { kind: "unknown" };
  if (input.status >= 200 && input.status < 300) return { kind: "knownCommitted" };
  const code = responseCode(input.body);
  if (code === "bootstrap_completed_reload") return { kind: "maintenanceReload" };
  if (code === "bootstrap_outcome_unknown") return { kind: "unknown", code };
  if (input.status >= 500 || !code) return { kind: "unknown", ...(code ? { code } : {}) };
  if (PROVEN_PREWRITE_FAILURES.has(code)) return { kind: "knownFailure", code };
  return { kind: "unknown", code };
}

export type SaveReconciliation =
  | { kind: "applied"; rev: string; snapshot: RoleSemanticSnapshot }
  | { kind: "committedThenSuperseded"; intended: RoleSemanticSnapshot; observed: RoleSemanticSnapshot }
  | { kind: "unknownConflict"; intended: RoleSemanticSnapshot; observed: RoleSemanticSnapshot }
  | { kind: "unresolved"; intended: RoleSemanticSnapshot };

export function reconcileSaveAttempt(input: {
  attempt: FrozenSaveAttempt;
  transport: PatchTransportOutcome;
  observed: { rev: string; snapshot: RoleSemanticSnapshot } | null;
}): SaveReconciliation {
  if (!input.observed) return { kind: "unresolved", intended: input.attempt.intendedSnapshot };
  if (sameRoleSemantics(input.attempt.intendedSnapshot, input.observed.snapshot)) {
    return { kind: "applied", rev: input.observed.rev, snapshot: input.observed.snapshot };
  }
  if (input.transport.kind === "knownCommitted") {
    return {
      kind: "committedThenSuperseded",
      intended: input.attempt.intendedSnapshot,
      observed: input.observed.snapshot,
    };
  }
  return {
    kind: "unknownConflict",
    intended: input.attempt.intendedSnapshot,
    observed: input.observed.snapshot,
  };
}
