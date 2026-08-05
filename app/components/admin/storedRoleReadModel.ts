import { normalizeLabel, normalizeServiceName } from "@/app/utils/normalizeLabel";
import { isValidServiceDate } from "@/app/utils/serviceReadModel";
import type {
  RoleDomainSummary,
  RoleTarget,
  RoleTargetRecord,
} from "@/app/utils/serviceReadSummary";
import type { ServiceRole, ServiceType } from "./serviceCardModel";
import {
  buildRows,
  type GridCell,
  type GridColumn,
  type GridRow,
} from "./plannerModel";

export type StoredRoleAdmission = "approved" | "bootstrapEligible" | "readOnly";

export interface StoredRoleObservation {
  role: ServiceRole;
  target: RoleTarget | null;
  admission: StoredRoleAdmission;
  reasons: string[];
  assignedRefs: string[];
}

export interface StoredRoleInventory {
  coherent: boolean;
  reasons: string[];
  roles: StoredRoleObservation[];
}

export interface StoredGridColumn extends GridColumn {
  roleId: string;
  rev: string;
  lockRev?: string;
  published: boolean;
  admission: StoredRoleAdmission;
}

export interface StoredGridRow extends GridRow {
  /** Exact storage label after shared NFC/whitespace normalization. */
  writeLabel?: string;
}

export interface StoredGridTranslation {
  column: StoredGridColumn;
  cells: GridCell[];
}

const ROLE_TYPES: readonly ServiceType[] = ["sunday_role", "saturday_role", "special_role"];

function isObj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function memberId(value: unknown): string | null {
  return isObj(value) && nonEmptyString(value._id) ? value._id : null;
}

function keyedMembers(value: unknown): { valid: boolean; refs: string[] } {
  if (!Array.isArray(value)) return { valid: false, refs: [] };
  const keys = new Set<string>();
  const refs: string[] = [];
  for (const item of value) {
    if (!isObj(item) || !nonEmptyString(item._key) || keys.has(item._key)) {
      return { valid: false, refs: [] };
    }
    const id = memberId(item);
    if (!id) return { valid: false, refs: [] };
    keys.add(item._key);
    refs.push(id);
  }
  return { valid: true, refs };
}

function keyedSlots(
  value: unknown,
  labelField: "instrument" | "role",
): { valid: boolean; refs: string[] } {
  if (!Array.isArray(value)) return { valid: false, refs: [] };
  const keys = new Set<string>();
  const refs: string[] = [];
  for (const item of value) {
    if (
      !isObj(item) ||
      !nonEmptyString(item._key) ||
      keys.has(item._key) ||
      !normalizeLabel(item[labelField])
    ) {
      return { valid: false, refs: [] };
    }
    const id = memberId(item.person);
    if (!id) return { valid: false, refs: [] };
    keys.add(item._key);
    refs.push(id);
  }
  return { valid: true, refs };
}

function occupant(item: { _id: string; _key?: string }) {
  return { memberId: item._id, ...(item._key ? { itemKey: item._key } : {}) };
}

/** Translate only a fully admitted observation; refusal never becomes empty cells. */
export function translateStoredRole(
  observation: StoredRoleObservation,
): StoredGridTranslation | null {
  const { role } = observation;
  const column: StoredGridColumn = {
    columnId: role._id,
    roleId: role._id,
    rev: role._rev,
    ...(observation.target?.lock?.rev ? { lockRev: observation.target.lock.rev } : {}),
    type: role._type,
    date: role.date,
    published: role.published !== false,
    admission: observation.admission,
    ...(role._type === "special_role" ? { serviceName: normalizeServiceName(role.service_name) } : {}),
  };
  const cells: GridCell[] = [
    { columnId: role._id, rowId: "lead", occupants: role.leads.map(occupant), origin: "manual" },
    { columnId: role._id, rowId: "bgv", occupants: role.bgvs.map(occupant), origin: "manual" },
    { columnId: role._id, rowId: "coro", occupants: role.chorus.map(occupant), origin: "manual" },
  ];

  const grouped = new Map<string, { rowId: string; occupants: GridCell["occupants"] }>();
  for (const item of role.instruments) {
    const writeLabel = normalizeLabel(item.instrument);
    if (!writeLabel || !item.person) return null;
    const rowId = `instrumento:${writeLabel}`;
    const group = grouped.get(rowId) ?? { rowId, occupants: [] };
    group.occupants.push({ memberId: item.person._id, ...(item._key ? { itemKey: item._key } : {}) });
    grouped.set(rowId, group);
  }
  for (const item of role.foh) {
    const writeLabel = normalizeLabel(item.role);
    if (!writeLabel || !item.person) return null;
    const rowId = `foh:${writeLabel}`;
    const group = grouped.get(rowId) ?? { rowId, occupants: [] };
    group.occupants.push({ memberId: item.person._id, ...(item._key ? { itemKey: item._key } : {}) });
    grouped.set(rowId, group);
  }
  for (const group of grouped.values()) {
    cells.push({ columnId: role._id, ...group, origin: "manual" });
  }
  return { column, cells };
}

/** Union defaults with exact stored labels without case/accent folding. */
export function buildStoredGridRows(translations: readonly StoredGridTranslation[]): StoredGridRow[] {
  const rows: StoredGridRow[] = buildRows();
  const ids = new Set(rows.map((row) => row.id));
  for (const { cells } of translations) {
    for (const cell of cells) {
      const separator = cell.rowId.indexOf(":");
      if (separator === -1 || ids.has(cell.rowId)) continue;
      const prefix = cell.rowId.slice(0, separator);
      const writeLabel = cell.rowId.slice(separator + 1);
      if (prefix !== "instrumento" && prefix !== "foh") continue;
      rows.push({
        id: cell.rowId,
        label: writeLabel,
        writeLabel,
        category: prefix,
        target: 1,
      });
      ids.add(cell.rowId);
    }
  }
  return rows;
}

function parseRole(value: unknown): { role: ServiceRole; assignedRefs: string[] } | null {
  if (!isObj(value)) return null;
  if (
    !nonEmptyString(value._id) ||
    !nonEmptyString(value._rev) ||
    !ROLE_TYPES.includes(value._type as ServiceType) ||
    !isValidServiceDate(value.date)
  ) {
    return null;
  }
  if (value.published !== undefined && typeof value.published !== "boolean") return null;
  if (value._type === "special_role" && !normalizeServiceName(value.service_name)) return null;

  const leads = keyedMembers(value.leads);
  const bgvs = keyedMembers(value.bgvs);
  const chorus = keyedMembers(value.chorus);
  const instruments = keyedSlots(value.instruments, "instrument");
  const foh = keyedSlots(value.foh, "role");
  if (![leads, bgvs, chorus, instruments, foh].every((seat) => seat.valid)) return null;

  return {
    role: value as unknown as ServiceRole,
    assignedRefs: [...new Set([
      ...leads.refs,
      ...bgvs.refs,
      ...chorus.refs,
      ...instruments.refs,
      ...foh.refs,
    ])],
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const aa = new Set(a);
  const bb = new Set(b);
  return aa.size === bb.size && [...aa].every((value) => bb.has(value));
}

function targetRecordMap(summary: RoleDomainSummary): {
  records: Map<string, { record: RoleTargetRecord; target: RoleTarget }>;
  duplicateIds: Set<string>;
} {
  const records = new Map<string, { record: RoleTargetRecord; target: RoleTarget }>();
  const duplicateIds = new Set<string>();
  for (const target of summary.targets) {
    for (const record of target.records) {
      if (records.has(record.id)) duplicateIds.add(record.id);
      else records.set(record.id, { record, target });
    }
  }
  return { records, duplicateIds };
}

function weekendKey(role: ServiceRole): string | null {
  return role._type === "special_role" ? null : `${role._type}|${role.date}`;
}

function specialKey(role: ServiceRole): string | null {
  return role._type === "special_role"
    ? `${role.date}|${normalizeServiceName(role.service_name)}`
    : null;
}

/**
 * Fail-closed reconciliation of the independently loaded roles GET and integrity
 * observations. No caller may translate a role to mutable grid state unless the
 * entire inventory is coherent and the returned per-role admission allows it.
 */
export function joinStoredRoleInventory(
  rows: readonly unknown[],
  summary: RoleDomainSummary | null,
): StoredRoleInventory {
  const parsed = rows.map(parseRole);
  const validRows = parsed.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const reasons = new Set<string>();
  if (!summary) reasons.add("integrity_unavailable");
  if (validRows.length !== rows.length) reasons.add("invalid_roles_response");

  const roleIds = new Set<string>();
  for (const { role } of validRows) {
    if (roleIds.has(role._id)) reasons.add("duplicate_role_id");
    roleIds.add(role._id);
  }

  const recordIndex = summary ? targetRecordMap(summary) : { records: new Map(), duplicateIds: new Set<string>() };
  if (summary?.recordIssues.length) reasons.add("record_issues");
  if (summary?.targets.some((target) => target.draftIds.length > 0)) reasons.add("raw_drafts");
  if (recordIndex.duplicateIds.size) reasons.add("duplicate_integrity_id");
  if (recordIndex.records.size !== validRows.length) reasons.add("inventory_cardinality");

  for (const { role } of validRows) {
    const joined = recordIndex.records.get(role._id);
    if (
      !joined ||
      joined.record.rev !== role._rev ||
      joined.record.type !== role._type ||
      joined.record.serviceDate !== role.date ||
      joined.record.published !== (role.published !== false)
    ) {
      reasons.add("inventory_mismatch");
    }
  }
  for (const id of recordIndex.records.keys()) {
    if (!roleIds.has(id)) reasons.add("inventory_mismatch");
  }

  const weekendCounts = new Map<string, number>();
  const specialCounts = new Map<string, number>();
  for (const { role } of validRows) {
    const wk = weekendKey(role);
    const sk = specialKey(role);
    if (wk) weekendCounts.set(wk, (weekendCounts.get(wk) ?? 0) + 1);
    if (sk) specialCounts.set(sk, (specialCounts.get(sk) ?? 0) + 1);
  }

  const coherent = reasons.size === 0;
  const observations = validRows.map(({ role, assignedRefs }): StoredRoleObservation => {
    const joined = recordIndex.records.get(role._id);
    const target = joined?.target ?? null;
    const roleReasons = new Set<string>();
    if (!coherent) roleReasons.add("inventory_incoherent");
    if (!joined) roleReasons.add("missing_integrity_record");

    const wk = weekendKey(role);
    const sk = specialKey(role);
    if (wk && weekendCounts.get(wk) !== 1) roleReasons.add("duplicate_weekend_target");
    if (sk && specialCounts.get(sk) !== 1) roleReasons.add("duplicate_special_identity");
    if (role._type === "special_role" && !normalizeServiceName(role.service_name)) {
      roleReasons.add("invalid_special_name");
    }

    if (joined) {
      const { record } = joined;
      if (target?.canonicalState !== "single" || target.publicState !== "single") {
        roleReasons.add("ambiguous_target");
      }
      if (record.danglingRefs.length || !sameSet(assignedRefs, record.assignedRefs)) {
        roleReasons.add("assignment_mismatch");
      }
      if (role._type === "saturday_role" && role.chorus.length > 0) {
        roleReasons.add("hidden_saturday_chorus");
      }
    }

    let admission: StoredRoleAdmission = "readOnly";
    if (roleReasons.size === 0 && target) {
      if (!target.expectsLock) {
        admission = "approved";
      } else if (
        target.lockIssues.length === 1 &&
        target.lockIssues[0]?.kind === "missing_lock"
      ) {
        admission = "bootstrapEligible";
      } else if (
        target.lockIssues.length === 0 &&
        target.lock?.state === "claimed" &&
        target.lock.roleId === role._id
      ) {
        admission = "approved";
      } else {
        roleReasons.add("invalid_lock");
      }
    }

    return { role, target, admission, reasons: [...roleReasons], assignedRefs };
  });

  return { coherent, reasons: [...reasons], roles: observations };
}
