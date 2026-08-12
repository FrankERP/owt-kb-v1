"use client";

// The five per-type email switches, shared by ProfilePanel (a member editing
// their own) and AdminPanel (a super-admin editing someone else's) so the copy
// and — more importantly — the RESOLUTION cannot drift between the two.
//
// One row is hidden rather than shown-and-inert: both emails "Propuestas" gates
// are addressed to `role in ["super-admin","admin"]`, so for a plain member that
// switch could never change anything they receive. The stored field is untouched
// — it is still resolved and still honoured — only the row is hidden.
//
// The switches must show the resolved preference, never the raw field. There was
// no data migration: a member who opted out of the legacy `notifPrefs.email`
// has all five fields unset, and an unset boolean renders as its `true` default.
// Since the legacy toggle is gone from both panels, rendering raw would show
// five switches ON to someone receiving nothing. `resolveEmailPrefs` runs the
// same `wantsNotification` every sender does.

import { NOTIFY_PREF_FIELD, wantsNotification, type NotifyKind } from "@/app/utils/notifyPrefs";

export interface EmailPrefRow {
  kind: NotifyKind;
  field: (typeof NOTIFY_PREF_FIELD)[NotifyKind];
  label: string;
  hint: string;
  /**
   * The row gates emails that only ever go to an admin audience, so it is hidden
   * from anyone else. Both proposal emails resolve their recipients with
   * `role in ["super-admin","admin"]` (`proposalNotify.ts`, and
   * `ADMIN_RECIPIENTS_QUERY` in `outboxSweep.ts`), so a plain member was being
   * shown a switch that could never change anything they receive.
   */
  adminOnly?: boolean;
}

/** The roles the proposal emails are actually addressed to. */
const ADMIN_ROLES = new Set(["super-admin", "admin"]);

export const EMAIL_PREF_ROWS: EmailPrefRow[] = [
  {
    kind: "assigned",
    field: NOTIFY_PREF_FIELD.assigned,
    label: "Nuevas asignaciones",
    hint: "Cuando te asignan a un servicio.",
  },
  {
    kind: "removed",
    field: NOTIFY_PREF_FIELD.removed,
    label: "Avisos de baja",
    hint: "Cuando ya no participas en un servicio.",
  },
  {
    kind: "roleChanged",
    field: NOTIFY_PREF_FIELD.roleChanged,
    label: "Cambios de rol",
    hint: "Cuando cambia tu rol dentro de un servicio.",
  },
  {
    kind: "setlist",
    field: NOTIFY_PREF_FIELD.setlist,
    label: "Setlist",
    hint: "Cuando el setlist queda listo o cambia.",
  },
  {
    kind: "proposals",
    field: NOTIFY_PREF_FIELD.proposals,
    label: "Propuestas",
    hint: "Notas del líder y propuestas nuevas.",
    adminOnly: true,
  },
];

/**
 * The rows a member of this role may actually act on.
 *
 * `EMAIL_PREF_ROWS` stays the complete list — it is what `resolveEmailPrefs`
 * and `EmailPrefValues` are built from, and every one of the five fields is
 * still stored, resolved and honoured by the senders for every member. This
 * filters the RENDERED rows only.
 */
export function visibleEmailPrefRows(role: string | undefined): EmailPrefRow[] {
  return EMAIL_PREF_ROWS.filter((row) => !row.adminOnly || ADMIN_ROLES.has(role ?? ""));
}

// A complete map, one entry per row — deliberately NOT `Record<string, boolean>`.
// A partial bag is a type error here, not a silent default: the whole point of
// this module is that "absent" is resolved exactly once, in `wantsNotification`,
// before the value ever reaches a component.
export type EmailPrefValues = Record<(typeof EMAIL_PREF_ROWS)[number]["field"], boolean>;

/** Resolved value per field — the same fallback the senders apply. */
export function resolveEmailPrefs(prefs: unknown): EmailPrefValues {
  const out = {} as EmailPrefValues;
  for (const row of EMAIL_PREF_ROWS) out[row.field] = wantsNotification(prefs, row.kind);
  return out;
}

export default function EmailPrefToggles({
  values,
  onToggle,
  memberRole,
  showHints = true,
  busyField = null,
  disabled = false,
}: {
  values: EmailPrefValues;
  onToggle: (field: string, next: boolean) => void;
  /**
   * The role of the member these switches belong to — required, so no caller can
   * forget it and silently show an admin-only row to everybody. In `AdminPanel`
   * it is the role currently selected in the form, so promoting someone to admin
   * reveals the row immediately.
   */
  memberRole: string;
  /** Second-person hint copy — on for the member's own panel, off when an admin edits someone else. */
  showHints?: boolean;
  /** Field whose save is in flight (that one switch is disabled). */
  busyField?: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {visibleEmailPrefRows(memberRole).map((row) => {
        // No fallback here: `values` is a complete EmailPrefValues, resolved once
        // by `wantsNotification` before it ever reaches this component.
        const on = values[row.field];
        return (
          <div key={row.field} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-body text-sm">{row.label}</p>
              {showHints && <p className="font-body text-xs text-mono-500 mt-0.5">{row.hint}</p>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={row.label}
              disabled={disabled || busyField === row.field}
              onClick={() => onToggle(row.field, !on)}
              className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-accent" : "bg-mono-500/70"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
