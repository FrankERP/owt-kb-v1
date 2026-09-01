/**
 * «Limpiar mes» — the pure half of the stored month editor's bulk delete.
 *
 * The admin's real loop is "generate drafts → get corrections → throw the drafts
 * away → run the solver again". Before this, throwing a month away meant one
 * card-level delete per service. This module decides WHICH stored services the
 * button offers to delete and how the outcome is worded; the deletes themselves
 * go one by one through the existing `DELETE /api/admin/roles/[id]`, so every
 * server-side guard (revision check, weekend token, receipt retirement,
 * dependency refusal, «ya no participas» notices) applies unchanged. There is
 * deliberately no bulk route: a new writer would need its own review, and the
 * per-role route already answers for each service independently.
 */

import type { ServiceRole } from "./serviceCardModel";

/** The subset of a stored role this feature reads. */
export interface ClearableRole {
  _id: string;
  _rev: string;
  _type: ServiceRole["_type"];
  date: string;
  service_name?: string;
  published?: boolean;
}

export interface ClearMonthSelection<R extends ClearableRole = ClearableRole> {
  /** Unpublished services in the month (`published === false`), date order. */
  drafts: R[];
  /**
   * Member-visible services in the month. The worship rule is `published != false`:
   * an ABSENT field means visible, so it counts as published here — never as a
   * draft that a "drafts only" clear would quietly remove.
   */
  published: R[];
  /** What the confirmation will actually delete, date order. */
  selected: R[];
}

const TYPE_ORDER: Record<ClearableRole["_type"], number> = {
  saturday_role: 0,
  sunday_role: 1,
  special_role: 2,
};

function byDateThenType(a: ClearableRole, b: ClearableRole): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const order = (TYPE_ORDER[a._type] ?? 9) - (TYPE_ORDER[b._type] ?? 9);
  if (order !== 0) return order;
  return (a.service_name ?? "").localeCompare(b.service_name ?? "");
}

/** `published === false` is the ONLY draft shape; absent means visible. */
export function isDraftRole(role: Pick<ClearableRole, "published">): boolean {
  return role.published === false;
}

/**
 * Partition a month's stored services into drafts and published, and select
 * the ones a clear would delete. `monthPrefix` is `YYYY-MM`.
 */
export function selectClearMonthRoles<R extends ClearableRole>(
  roles: readonly R[],
  monthPrefix: string,
  includePublished: boolean,
): ClearMonthSelection<R> {
  const inMonth = roles
    .filter((role) => role.date.slice(0, 7) === monthPrefix)
    .slice()
    .sort(byDateThenType);
  const drafts = inMonth.filter(isDraftRole);
  const published = inMonth.filter((role) => !isDraftRole(role));
  return {
    drafts,
    published,
    selected: includePublished ? inMonth : drafts,
  };
}

// ── Outcome summary ──────────────────────────────────────────────────────────

export interface ClearMonthResult {
  role: ClearableRole;
  ok: boolean;
  /** Present when `ok` is false. */
  reason?: string;
}

export interface ClearMonthSummary {
  attempted: number;
  deleted: number;
  /** One line per failure, in attempt order: `<fecha> · <servicio>: <motivo>`. */
  failures: string[];
  /** Ready to show. Never claims a clean sweep when something was refused. */
  message: string;
}

const SERVICE_WORD: Record<ClearableRole["_type"], string> = {
  saturday_role: "Sábado",
  sunday_role: "Domingo",
  special_role: "Especial",
};

/** `dd/mm` — day-first, no year: the month is already the banner's subject. */
function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function describeClearableRole(role: ClearableRole): string {
  const kind = SERVICE_WORD[role._type] ?? role._type;
  const name = role._type === "special_role" && role.service_name ? ` (${role.service_name})` : "";
  return `${shortDate(role.date)} · ${kind}${name}`;
}

export function summarizeClearMonth(
  results: readonly ClearMonthResult[],
  monthLabel: string,
): ClearMonthSummary {
  const attempted = results.length;
  const deleted = results.filter((result) => result.ok).length;
  const failures = results
    .filter((result) => !result.ok)
    .map((result) => `${describeClearableRole(result.role)}: ${result.reason ?? "Error al eliminar."}`);
  const message = failures.length === 0
    ? `${monthLabel}: ${deleted} servicio${deleted !== 1 ? "s" : ""} eliminado${deleted !== 1 ? "s" : ""}.`
    : `${monthLabel}: eliminados ${deleted} de ${attempted}. No se pudieron eliminar ${failures.length}.`;
  return { attempted, deleted, failures, message };
}
