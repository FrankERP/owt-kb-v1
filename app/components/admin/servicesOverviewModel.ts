// «Pantalla completa» on the Servicios board: the services the month filter is
// showing, laid out as the month editor's grid (dates across, seats down), READ
// ONLY. This module decides the shape; `ServicesOverview.tsx` only paints it.
//
// Why a separate read model rather than `PlannerGrid` in a read-only mode:
// `PlannerGrid` is the month EDITOR — controlled by `MonthGenerator`, one month
// per mount, and every cell is a write affordance. The board's filter spans any
// number of months, and this view must not be able to write anything at all.
// What it does share with the editor is the part that has to agree: the seat
// rows (`buildRows`, `instrumentSeatDef`/`fohSeatDef`) and which rows a service
// type has at all (`rowAppliesTo` — a Saturday has no Coro).

import { compareServiceTime } from "@/app/utils/serviceTime";
import { isWorshipNight } from "@/app/utils/serviceFormat";
import { displayMemberName } from "@/app/utils/memberRuleNames";
import { buildRows, rowAppliesTo, type GridRow } from "./plannerModel";
import { fohSeatDef, instrumentSeatDef } from "./seatModel";
import { SERVICE_LABEL, type ServiceRole, type ServiceType } from "./serviceCardModel";

export interface OverviewColumn {
  id: string;
  /** `YYYY-MM-DD` — render at local noon, never `new Date(date)`. */
  date: string;
  type: ServiceType;
  /** «Domingo» / «Sábado» / «Especial» / «Noche de alabanza». */
  typeLabel: string;
  /** Specials only. */
  serviceName?: string;
  /** Specials only, `HH:mm` — display and order, never identity. */
  time?: string;
  /** `published === false` — the board's «Borrador». */
  draft: boolean;
}

export interface OverviewMonth {
  /** `YYYY-MM` */
  month: string;
  /** How many consecutive columns belong to it. */
  span: number;
}

export interface ServicesOverviewModel {
  columns: OverviewColumn[];
  rows: GridRow[];
  months: OverviewMonth[];
  /** Names seated in one cell, in stored order; `null` = the row does not exist on that service type. */
  names: (columnId: string, rowId: string) => string[] | null;
}

const TYPE_ORDER: Record<ServiceType, number> = { saturday_role: 0, sunday_role: 1, special_role: 2 };

function compareRoles(a: ServiceRole, b: ServiceRole): number {
  return (
    a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)) ||
    TYPE_ORDER[a._type] - TYPE_ORDER[b._type] ||
    compareServiceTime(a.time, b.time) ||
    (a.service_name ?? "").localeCompare(b.service_name ?? "") ||
    a._id.localeCompare(b._id)
  );
}

const key = (columnId: string, rowId: string) => `${columnId}|${rowId}`;

export function buildServicesOverview(roles: readonly ServiceRole[]): ServicesOverviewModel {
  const sorted = [...roles].sort(compareRoles);
  const rows: GridRow[] = buildRows();
  const rowIds = new Set(rows.map((row) => row.id));
  const cells = new Map<string, string[]>();

  const seat = (columnId: string, rowId: string, name: string) => {
    if (!name) return;
    const list = cells.get(key(columnId, rowId)) ?? [];
    list.push(name);
    cells.set(key(columnId, rowId), list);
  };
  // A stored instrument/FOH label the default rows do not carry (a "Sax", a
  // second console role) gets its own row, exactly as the month editor adds it.
  const extraRow = (def: { id: string; label: string; category: GridRow["category"] }) => {
    if (rowIds.has(def.id)) return;
    rows.push({ id: def.id, label: def.label, category: def.category, target: 1 });
    rowIds.add(def.id);
  };

  const columns: OverviewColumn[] = sorted.map((role) => {
    const id = role._id;
    for (const m of role.leads ?? []) seat(id, "lead", displayMemberName(m));
    for (const m of role.bgvs ?? []) seat(id, "bgv", displayMemberName(m));
    for (const m of role.chorus ?? []) seat(id, "coro", displayMemberName(m));
    for (const item of role.instruments ?? []) {
      if (!item.person || !item.instrument?.trim()) continue;
      const def = instrumentSeatDef(item.instrument);
      extraRow(def);
      seat(id, def.id, displayMemberName(item.person));
    }
    for (const item of role.foh ?? []) {
      if (!item.person || !item.role?.trim()) continue;
      const def = fohSeatDef(item.role);
      extraRow(def);
      seat(id, def.id, displayMemberName(item.person));
    }
    const special = role._type === "special_role";
    return {
      id,
      date: role.date.slice(0, 10),
      type: role._type,
      typeLabel: isWorshipNight(role) ? "Noche de alabanza" : SERVICE_LABEL[role._type],
      ...(special && role.service_name?.trim() ? { serviceName: role.service_name.trim() } : {}),
      ...(special && role.time ? { time: role.time } : {}),
      draft: role.published === false,
    };
  });

  const months: OverviewMonth[] = [];
  for (const column of columns) {
    const month = column.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.month === month) last.span += 1;
    else months.push({ month, span: 1 });
  }

  const typeById = new Map(columns.map((c) => [c.id, c.type]));
  return {
    columns,
    rows,
    months,
    names: (columnId, rowId) => {
      const type = typeById.get(columnId);
      const row = rows.find((r) => r.id === rowId);
      if (!type || !row || !rowAppliesTo(row, { type })) return null;
      return cells.get(key(columnId, rowId)) ?? [];
    },
  };
}
