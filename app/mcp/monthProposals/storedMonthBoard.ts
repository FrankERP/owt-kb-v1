// A SAVED month as the MCP editor's board (admin parity phase 1, plan T2.2): the month's stored
// roles read the way `/admin`'s grid reads them in stored mode — `joinStoredRoleInventory` over the
// whole roster, `translateStoredRole` per role, `buildStoredGridRows` for the month — so the
// proposal editor's replay, gates and findings (`revise.ts`, `editorBoard.ts`) run on it unchanged.
//
// A service is a column keyed by its role id (the id `get_service` already returns); `editable` is
// the services whose stored admission is `approved` AND that serialize as a PATCH would
// (`serializeStoredColumn`), as the grid's P2 states it. `bootstrapEligible` and `readOnly`
// services are shown and never edited (plan §6: the grid bootstraps a legacy lock on save; the chat
// does not). An incoherent inventory makes every service `readOnly`, as on `/admin`.
//
// A service's TARGET is the PATCH body the grid would send, without `rev`/`lockRev`
// (`StoredRolePatchBody`): the full five sections and the header, in the board's seat order. The
// check answers it and the save writes it, so a repeat of the same save is idempotent (F3).
//
// Neutral and pure: no I/O, nothing from a `"use client"` module (ADR-0028).

import { normalizeLabel, normalizeServiceName } from "@/app/utils/normalizeLabel";
import { compareServiceTime } from "@/app/utils/serviceTime";
import type { RoleDomainSummary } from "@/app/utils/serviceReadSummary";
import type { ServiceRole } from "@/app/components/admin/serviceCardModel";
import { rowAppliesTo, type GridCell, type GridRow } from "@/app/components/admin/plannerModel";
import {
  buildStoredGridRows,
  joinStoredRoleInventory,
  translateStoredRole,
  type StoredGridColumn,
  type StoredGridRow,
  type StoredGridTranslation,
} from "@/app/components/admin/storedRoleReadModel";
import { semanticSnapshot, serializeStoredColumn, type RoleSemanticSnapshot, type StoredRolePatchBody } from "@/app/components/admin/plannerSaveModel";
import { withCells, type EditorBoard } from "./editorBoard";

/** What a save writes to one service: the grid's PATCH body without the revisions it asserts. */
export type ServiceTarget = Omit<StoredRolePatchBody, "rev" | "lockRev">;

export interface StoredMonthBoard extends EditorBoard {
  columns: StoredGridColumn[];
  rows: StoredGridRow[];
  /** Whether the whole inventory joined; `false` = every service read-only. */
  coherent: boolean;
  /** Services of the month the grid could not translate (shown nowhere, never edited). */
  untranslated: number;
}

function sortColumns(a: StoredGridColumn, b: StoredGridColumn): number {
  return a.date.localeCompare(b.date) || compareServiceTime(a.time, b.time) || a.type.localeCompare(b.type) || a.roleId.localeCompare(b.roleId);
}

/** The month's stored services as a board (T2.2). `adminRoles` is the whole roster: coherence is the inventory's. */
export function storedMonthBoard(input: {
  month: string;
  adminRoles: readonly unknown[];
  summary: RoleDomainSummary | null;
  todayIso?: string;
}): StoredMonthBoard {
  const inventory = joinStoredRoleInventory(input.adminRoles, input.summary);
  const inMonth = inventory.roles.filter((o) => o.role.date.slice(0, 7) === input.month);
  const translated = inMonth.map(translateStoredRole);
  const translations = translated.filter((t): t is StoredGridTranslation => t !== null);
  const rows = buildStoredGridRows(translations);
  const cells = translations.flatMap((t) => t.cells);
  const columns = translations.map((t) => t.column).sort(sortColumns);
  const ids = new Map(columns.map((c) => [c.columnId, c.roleId]));
  const editable = new Set(
    columns
      .filter((c) => inventory.coherent && c.admission === "approved" && serializeStoredColumn(c, rows, cells, input.todayIso).ok)
      .map((c) => c.roleId),
  );
  return {
    rows,
    columns,
    cells,
    localIdOf: ids,
    columnIdOf: ids,
    editable,
    moveMode: "stored",
    coherent: inventory.coherent,
    untranslated: translated.length - translations.length,
  };
}

export function storedColumn(board: EditorBoard, roleId: string): StoredGridColumn | null {
  const c = board.columns.find((x) => x.columnId === board.columnIdOf.get(roleId));
  return c && "roleId" in c ? (c as StoredGridColumn) : null;
}

const strip = ({ rev: _rev, lockRev: _lockRev, ...target }: StoredRolePatchBody): ServiceTarget => target;

/** A service's target as the board holds it now, or `null` when it does not serialize. */
export function columnTarget(board: EditorBoard, roleId: string, todayIso?: string): ServiceTarget | null {
  const column = storedColumn(board, roleId);
  if (!column) return null;
  const out = serializeStoredColumn(column, board.rows as StoredGridRow[], board.cells, todayIso);
  return out.ok ? strip(out.body) : null;
}

/** One role row (the admin roles projection) as its stored target — the save's re-read after a refusal. */
export function roleTarget(role: ServiceRole, todayIso?: string): { rev: string; target: ServiceTarget } | null {
  const t = translateStoredRole({ role, target: null, admission: "approved", reasons: [], assignedRefs: [] });
  if (!t) return null;
  const out = serializeStoredColumn(t.column, buildStoredGridRows([t]), t.cells, todayIso);
  return out.ok ? { rev: role._rev, target: strip(out.body) } : null;
}

export const targetSnapshot = (t: ServiceTarget): RoleSemanticSnapshot => semanticSnapshot({ ...t, rev: "" });

/** Equal as `/admin` compares a save with what is stored (`sameRoleSemantics`: order-free). */
export { sameRoleSemantics } from "@/app/components/admin/plannerSaveModel";

// ── Seats ────────────────────────────────────────────────────────────────────

export interface TargetSeat {
  rowId: string;
  members: string[];
}

/**
 * The board row a target's section or label is written from: a voice section's own row, and for an
 * instrument or FOH label the row whose WRITE label is that label (`serializeStoredColumn`'s
 * inverse). `null` = no such row on the board (phase 1 edits existing rows only).
 */
export function rowFor(rows: readonly GridRow[], category: "instrumento" | "foh", label: string): string | null {
  const want = normalizeLabel(label);
  if (!want) return null;
  const row = rows.find((r) => r.category === category && normalizeLabel((r as StoredGridRow).writeLabel ?? r.label) === want);
  return row?.id ?? null;
}

/** A target's seats by board row, in the target's order; `null` when a label has no row. */
export function targetSeats(rows: readonly GridRow[], t: ServiceTarget): TargetSeat[] | null {
  const seats = new Map<string, string[]>([["lead", [...t.leads]], ["bgv", [...t.bgvs]], ["coro", [...t.chorus]]]);
  const add = (category: "instrumento" | "foh", label: string, memberId: string) => {
    const rowId = rowFor(rows, category, label);
    if (!rowId) return false;
    seats.set(rowId, [...(seats.get(rowId) ?? []), memberId]);
    return true;
  };
  for (const i of t.instruments) if (!add("instrumento", i.instrument, i.personId)) return null;
  for (const f of t.foh) if (!add("foh", f.role, f.personId)) return null;
  return [...seats].map(([rowId, members]) => ({ rowId, members }));
}

/**
 * The board with one service set to `target`: its header (name, time, «Cuenta para equidad») and
 * every one of its cells. `null` when a seat has no row or a row does not apply to the service.
 */
export function withTarget(board: EditorBoard, roleId: string, target: ServiceTarget): EditorBoard | null {
  const column = storedColumn(board, roleId);
  const seats = targetSeats(board.rows, target);
  if (!column || !seats) return null;
  const byRow = new Map(seats.map((s) => [s.rowId, s.members]));
  // An EMPTY section is not a seat (a Saturday's target always carries `chorus: []`).
  for (const [rowId, members] of byRow) {
    if (members.length === 0) continue;
    const row = board.rows.find((r) => r.id === rowId);
    if (!row || !rowAppliesTo(row, column)) return null;
  }
  const others = board.cells.filter((c) => c.columnId !== column.columnId);
  const own: GridCell[] = board.rows
    .filter((r) => rowAppliesTo(r, column) && (r.category === "voz" || (byRow.get(r.id)?.length ?? 0) > 0))
    .map((r) => ({ columnId: column.columnId, rowId: r.id, occupants: (byRow.get(r.id) ?? []).map((memberId) => ({ memberId })), origin: "manual" as const }));
  const header: StoredGridColumn = {
    ...column,
    countsForFairness: target.countsForFairness,
    ...(column.type === "special_role" ? { serviceName: normalizeServiceName(target.service_name) } : {}),
  };
  if (column.type === "special_role") {
    if (target.time) header.time = target.time;
    else delete header.time;
  }
  const next = withCells(board, [...others, ...own]);
  return { ...next, columns: board.columns.map((c) => (c.columnId === column.columnId ? header : c)) };
}

/** The board with one service's header changed (the grid's header editor); seats untouched. */
export function withHeader(
  board: EditorBoard,
  roleId: string,
  header: { serviceName?: string; time?: string | null; countsForFairness?: boolean },
): EditorBoard {
  return {
    ...board,
    columns: board.columns.map((c) => {
      if (c.columnId !== board.columnIdOf.get(roleId)) return c;
      const next = { ...c };
      if (header.serviceName !== undefined) next.serviceName = header.serviceName;
      if (header.time !== undefined) {
        if (header.time) next.time = header.time;
        else delete next.time;
      }
      if (header.countsForFairness !== undefined) next.countsForFairness = header.countsForFairness;
      return next;
    }),
  };
}

// ── Diff ─────────────────────────────────────────────────────────────────────

export interface SeatChange {
  row: string;
  member: string;
}

export interface ServiceDiff {
  removed: SeatChange[];
  added: SeatChange[];
}

/** Who leaves and who enters each row, as multisets, rows in board order. `null` when a label has no row. */
export function diffTargets(rows: readonly GridRow[], before: ServiceTarget, after: ServiceTarget): ServiceDiff | null {
  const a = targetSeats(rows, before);
  const b = targetSeats(rows, after);
  if (!a || !b) return null;
  const was = new Map(a.map((s) => [s.rowId, s.members]));
  const now = new Map(b.map((s) => [s.rowId, s.members]));
  const removed: SeatChange[] = [];
  const added: SeatChange[] = [];
  const minus = (x: readonly string[], y: readonly string[]) => {
    const left = [...y];
    return x.filter((m) => {
      const i = left.indexOf(m);
      if (i === -1) return true;
      left.splice(i, 1);
      return false;
    });
  };
  for (const row of rows) {
    const before_ = was.get(row.id) ?? [];
    const after_ = now.get(row.id) ?? [];
    for (const m of minus(before_, after_)) removed.push({ row: row.id, member: m });
    for (const m of minus(after_, before_)) added.push({ row: row.id, member: m });
  }
  return { removed, added };
}
