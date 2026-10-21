// What the proposal editor's screen and the model see of a board (plan T1.3, A5): services by
// their label and `localId`, seats by row, people by display name and an opaque member TOKEN —
// never a member id, a rule key or the rules revision (KH-1, `monthToolHygiene.test.ts`). A rule
// crosses only as its sentence and its kind and ordinal in the bound config (`restriction[i]…`,
// `conflict[i]`), which name nobody.

import { columnShowsRowId } from "@/app/components/admin/plannerModel";
import type { EditorBoard, Finding } from "./editorBoard";
import type { FindingKey, Waiver } from "./proposalDocument";
import { draftLabel } from "./labels";

export interface PersonView {
  token: string;
  name: string;
}

export interface SeatView {
  row: string;
  label: string;
  target: number | null;
  members: Array<PersonView & { unavailable: boolean }>;
}

export interface ServiceView {
  service: string;
  label: string;
  date: string;
  type: string;
  /** Only the drafts apply creates are editable (R10). */
  editable: boolean;
  seats: SeatView[];
}

export interface Namer {
  tokenOf(memberId: string): string;
  nameOf(memberId: string): string;
  unavailableOn(memberId: string, date: string): boolean;
}

export function serviceLabelOf(board: EditorBoard, localId: string): string {
  const column = board.columns.find((c) => c.columnId === board.columnIdOf.get(localId));
  return column ? draftLabel({ _type: column.type, date: column.date, service_name: column.serviceName }) : "servicio";
}

export function boardView(board: EditorBoard, namer: Namer): ServiceView[] {
  return board.columns.map((column) => {
    const localId = board.localIdOf.get(column.columnId)!;
    return {
      service: localId,
      label: draftLabel({ _type: column.type, date: column.date, service_name: column.serviceName }),
      date: column.date,
      type: column.type,
      editable: board.editable.has(localId),
      seats: board.rows.filter((r) => columnShowsRowId(column.type, r.id)).map((row) => ({
        row: row.id,
        label: row.label,
        target: row.target,
        members: (board.cells.find((c) => c.columnId === column.columnId && c.rowId === row.id)?.occupants ?? []).map((o) => ({
          token: namer.tokenOf(o.memberId),
          name: namer.nameOf(o.memberId),
          unavailable: namer.unavailableOn(o.memberId, column.date),
        })),
      })),
    };
  });
}

/** A finding key with its members as tokens — the form `confirms` takes back (A5). */
export interface KeyView {
  kind: FindingKey["kind"];
  rule: string;
  service: string;
  row: string | null;
  members: string[];
}

export interface FindingView extends KeyView {
  /** «domingo 8 nov · Lead» (a per-seat rule) or «domingo 8 nov» (a pair). */
  where: string;
  names: string[];
  sentence: string;
}

export function keyView(k: FindingKey, namer: Namer): KeyView {
  return { kind: k.kind, rule: k.rule, service: k.service, row: k.row, members: k.members.map((m) => namer.tokenOf(m)) };
}

export function whereOf(board: EditorBoard, k: FindingKey): string {
  const service = serviceLabelOf(board, k.service);
  const row = k.row === null ? null : board.rows.find((r) => r.id === k.row)?.label ?? null;
  return row ? `${service} · ${row}` : service;
}

export function findingView(board: EditorBoard, f: Finding | Waiver, namer: Namer): FindingView {
  return {
    ...keyView(f.key, namer),
    where: whereOf(board, f.key),
    names: f.key.members.map((m) => namer.nameOf(m)),
    sentence: f.sentence,
  };
}

/**
 * What `apply_schedule`'s `waivers` must repeat (Q1): one item per stored waiver, the rule's
 * sentence as bound in the payload, the place and the names as TODAY's read renders them — so the
 * save's answer, the screen's «Cargar» and apply's refusal all list the same items.
 */
export interface WaiverItem {
  service: string;
  members: string[];
  rule: string;
}

export function waiverItems(board: EditorBoard, waivers: readonly Waiver[], nameOf: (memberId: string) => string): WaiverItem[] {
  return waivers.map((w) => ({ service: whereOf(board, w.key), members: w.key.members.map(nameOf), rule: w.sentence }));
}

/** Items compared as apply compares them: a multiset after Unicode NFC, nothing else normalized. */
export function waiverItemText(item: WaiverItem): string {
  return JSON.stringify([item.service, item.members, item.rule]).normalize("NFC");
}

export function sameWaiverItems(given: readonly WaiverItem[], expected: readonly WaiverItem[]): boolean {
  if (given.length !== expected.length) return false;
  const counts = new Map<string, number>();
  for (const e of expected) counts.set(waiverItemText(e), (counts.get(waiverItemText(e)) ?? 0) + 1);
  for (const g of given) {
    const k = waiverItemText(g);
    const n = counts.get(k) ?? 0;
    if (n === 0) return false;
    counts.set(k, n - 1);
  }
  return true;
}
