"use client";

// The five per-type email switches, shared by ProfilePanel (a member editing
// their own) and AdminPanel (a super-admin editing someone else's) so the copy
// and — more importantly — the RESOLUTION cannot drift between the two.
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
  field: string;
  label: string;
  hint: string;
}

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
  },
];

export type EmailPrefValues = Record<string, boolean>;

/** Resolved value per field — the same fallback the senders apply. */
export function resolveEmailPrefs(prefs: unknown): EmailPrefValues {
  const out: EmailPrefValues = {};
  for (const row of EMAIL_PREF_ROWS) out[row.field] = wantsNotification(prefs, row.kind);
  return out;
}

export default function EmailPrefToggles({
  values,
  onToggle,
  showHints = true,
  busyField = null,
  disabled = false,
}: {
  values: EmailPrefValues;
  onToggle: (field: string, next: boolean) => void;
  /** Second-person hint copy — on for the member's own panel, off when an admin edits someone else. */
  showHints?: boolean;
  /** Field whose save is in flight (that one switch is disabled). */
  busyField?: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {EMAIL_PREF_ROWS.map((row) => {
        const on = values[row.field] !== false;
        return (
          <div key={row.field} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-body text-sm">{row.label}</p>
              {showHints && <p className="font-body text-xs text-gray-500 mt-0.5">{row.hint}</p>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={row.label}
              disabled={disabled || busyField === row.field}
              onClick={() => onToggle(row.field, !on)}
              className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[#00bfff]" : "bg-gray-500/40"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
