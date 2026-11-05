"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";
import CueDialog from "@/app/components/ui/CueDialog";
import Switch from "@/app/components/ui/Switch";
import { useToast } from "@/app/components/ui/Toast";
import { HAIRLINE_INPUT_CLASS, HAIRLINE_LABEL_CLASS } from "@/app/components/ui/hairlineField";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { isServiceTime } from "@/app/utils/serviceTime";
import { eventDayLabel, eventHeading } from "@/app/utils/jovenesEventView";
import {
  SATURDAY_SEATS,
  monthLabel,
  saturdayBody,
  saturdayForm,
  seatNames,
  shiftMonth,
  whatsappRoster,
  type SaturdayForm,
  type SaturdayRow,
} from "@/app/utils/jovenesPlannerModel";
import PersonSelect, { type JovenesPerson } from "./PersonSelect";
import ProgramEditor from "./ProgramEditor";
import { eventUrl, eventsUrl, sendEventWrite } from "./eventWrite";

const MINISTRY = "jovenes";
const SEAT_LABEL = { encargado: "Encargado", apoyo: "Apoyo", comparte: "Quién comparte" } as const;

type Editing = { event: MinistryEventView | null; form: SaturdayForm; token: string };

/**
 * Planear Jóvenes — the Saturday roster as a table by month (Fecha, Encargado, Apoyo, Quién
 * comparte, Notas) and «Copiar para WhatsApp», which replaces the image the team sent. `canEdit`
 * (a Jóvenes admin) only shows the buttons; every write is decided again by the server.
 */
export default function SaturdayPlanner({
  month,
  rows,
  people,
  canEdit,
}: {
  month: string;
  rows: SaturdayRow[];
  people: JovenesPerson[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(date: string, event: MinistryEventView | null) {
    // The create token is minted when the editor opens, so a double tap or a retry of the same
    // create names the same meeting (W6) instead of making two.
    setEditing({ event, form: saturdayForm(date, event ?? undefined), token: crypto.randomUUID() });
    setConfirmDelete(false);
    setError(null);
  }

  function patchForm(patch: Partial<SaturdayForm>) {
    setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  }

  async function copyRoster() {
    try {
      await navigator.clipboard.writeText(whatsappRoster(month, rows));
      toast({ message: "Rol copiado. Pégalo en WhatsApp.", tone: "ok" });
    } catch {
      toast({ message: "No se pudo copiar. Intenta de nuevo.", tone: "error" });
    }
  }

  async function save() {
    if (!editing || saving) return;
    const { form, event, token } = editing;
    for (const [value, label] of [[form.time, "La hora"], [form.arrival, "La llegada"]] as const) {
      if (value.trim() && !isServiceTime(value.trim())) {
        setError(`${label} debe ser HH:mm (por ejemplo 18:10).`);
        return;
      }
    }
    if (event && !event.rev) {
      setError("Recarga la página para editar esta reunión.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = saturdayBody({ ...form, time: form.time.trim(), arrival: form.arrival.trim() });
      const r = event
        ? await sendEventWrite("PATCH", eventUrl(MINISTRY, event._id), { ...body, _rev: event.rev })
        : await sendEventWrite("POST", eventsUrl(MINISTRY), { ...body, token });
      if (!r.ok) {
        if (r.stale) {
          // A 409 (someone saved first, or this create already landed): close, so the next open
          // starts from the stored meeting and its revision, never from this snapshot.
          setEditing(null);
          toast({ message: `${r.message} Ábrela de nuevo para ver los cambios.`, tone: "error" });
          router.refresh();
          return;
        }
        setError(r.message);
        return;
      }
      setEditing(null);
      toast({ message: event ? "Reunión guardada" : "Reunión creada", tone: "ok" });
      router.refresh();
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const event = editing?.event;
    if (!event || saving) return;
    if (!event.rev) {
      setError("Recarga la página para borrar esta reunión.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await sendEventWrite("DELETE", eventUrl(MINISTRY, event._id), { _rev: event.rev });
      if (!r.ok) {
        if (r.stale) {
          // A 409 (someone saved first, or this create already landed): close, so the next open
          // starts from the stored meeting and its revision, never from this snapshot.
          setEditing(null);
          toast({ message: `${r.message} Ábrela de nuevo para ver los cambios.`, tone: "error" });
          router.refresh();
          return;
        }
        setError(r.message);
        return;
      }
      setEditing(null);
      toast({ message: "Reunión borrada", tone: "ok" });
      router.refresh();
    } catch {
      setError("No se pudo borrar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const names = new Map(editing?.event?.seats.map((s) => [s._key, s.name]) ?? []);

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/jovenes/admin?mes=${shiftMonth(month, -1)}`}
            aria-label="Mes anterior"
            className="rounded-full px-3 py-1 font-label text-sm text-mono-500 hover:text-accent"
          >
            ‹
          </Link>
          <h2 className="font-display text-xl md:text-2xl font-bold capitalize text-ink">{monthLabel(month)}</h2>
          <Link
            href={`/jovenes/admin?mes=${shiftMonth(month, 1)}`}
            aria-label="Mes siguiente"
            className="rounded-full px-3 py-1 font-label text-sm text-mono-500 hover:text-accent"
          >
            ›
          </Link>
        </div>
        <Button variant="secondary" size="md" onClick={copyRoster}>
          Copiar para WhatsApp
        </Button>
      </header>

      <div className="space-y-3">
        {/* Column heads for wide screens; on a phone each row is its own card (no sideways scroll). */}
        <div className="hidden md:grid md:grid-cols-[10rem_1fr_1fr_1fr_1.4fr_auto] md:gap-3 px-4 font-label text-[11px] uppercase tracking-widest text-mono-500">
          <span>Fecha</span>
          {SATURDAY_SEATS.map((r) => <span key={r}>{SEAT_LABEL[r]}</span>)}
          <span>Notas</span>
          <span className="sr-only">Acciones</span>
        </div>
        {rows.map((row) =>
          row.events.length === 0 ? (
            <div key={row.date} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-edge-accent-subtle px-4 py-3">
              <span className="font-body text-sm capitalize text-ink-muted">{eventDayLabel(row.date)}</span>
              <span className="font-label text-[11px] uppercase tracking-widest text-mono-600">Sin reunión</span>
              {canEdit && (
                <Button variant="pill" size="sm" onClick={() => open(row.date, null)}>
                  Crear
                </Button>
              )}
            </div>
          ) : (
            row.events.map((e) => (
              <article
                key={e._id}
                className="grid gap-2 rounded-2xl border border-edge-accent-subtle bg-surface-raised px-4 py-3 md:grid-cols-[10rem_1fr_1fr_1fr_1.4fr_auto] md:items-start md:gap-3"
              >
                <div>
                  <p className="font-body text-sm capitalize text-ink">{eventDayLabel(e.date)}</p>
                  <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                    {[e.time, e.arrival ? `llegada ${e.arrival}` : null].filter(Boolean).join(" · ") || eventHeading(e)}
                  </p>
                  {!e.published && (
                    <span className="mt-1 inline-block rounded-full border border-warning-fg/40 px-2 py-0.5 font-label text-[10px] uppercase tracking-widest text-warning-fg">
                      Borrador
                    </span>
                  )}
                </div>
                {SATURDAY_SEATS.map((role) => {
                  const list = seatNames(e, role);
                  return (
                    <p key={role} className="font-body text-sm">
                      <span className="md:hidden font-label text-[11px] uppercase tracking-widest text-mono-500">{SEAT_LABEL[role]}: </span>
                      <span className={list.length ? "text-ink" : "italic text-mono-600"}>{list.length ? list.join(", ") : "Sin asignar"}</span>
                    </p>
                  );
                })}
                <p className="whitespace-pre-line font-body text-sm text-ink-muted">{e.notes ?? ""}</p>
                {canEdit && (
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <Button variant="pill" size="sm" onClick={() => open(e.date, e)}>
                      Editar
                    </Button>
                    <ProgramEditor event={e} people={people} />
                  </div>
                )}
              </article>
            ))
          ),
        )}
      </div>

      <CueDialog
        open={editing !== null}
        mode="sheet"
        size="lg"
        label={editing ? `Reunión — ${eventDayLabel(editing.form.date)}` : "Reunión"}
        onDismiss={() => !saving && setEditing(null)}
        title={
          <span className="block">
            <span className="block font-display text-base uppercase tracking-wide text-ink">
              {editing?.event ? "Editar reunión" : "Nueva reunión"}
            </span>
            <span className="block font-label text-[11px] uppercase tracking-widest text-mono-500">
              {editing ? eventDayLabel(editing.form.date) : ""}
            </span>
          </span>
        }
      >
        {editing && (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={HAIRLINE_LABEL_CLASS}>Hora</span>
                <input
                  className={HAIRLINE_INPUT_CLASS}
                  inputMode="numeric"
                  placeholder="18:10"
                  value={editing.form.time}
                  onChange={(e) => patchForm({ time: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={HAIRLINE_LABEL_CLASS}>Llegada</span>
                <input
                  className={HAIRLINE_INPUT_CLASS}
                  inputMode="numeric"
                  placeholder="17:30"
                  value={editing.form.arrival}
                  onChange={(e) => patchForm({ arrival: e.target.value })}
                />
              </label>
            </div>
            {SATURDAY_SEATS.map((role) => (
              <div key={role} className="space-y-1">
                <span className={HAIRLINE_LABEL_CLASS}>{SEAT_LABEL[role]}</span>
                <PersonSelect
                  ariaLabel={SEAT_LABEL[role]}
                  value={editing.form.picks[role].member}
                  people={people}
                  storedName={editing.form.picks[role].key ? names.get(editing.form.picks[role].key!) : null}
                  onChange={(member) =>
                    patchForm({ picks: { ...editing.form.picks, [role]: { ...editing.form.picks[role], member } } })
                  }
                />
              </div>
            ))}
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Notas</span>
              <textarea
                className={`${HAIRLINE_INPUT_CLASS} min-h-[5rem] resize-y`}
                maxLength={2000}
                value={editing.form.notes}
                onChange={(e) => patchForm({ notes: e.target.value })}
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <span id="jovenes-published" className="font-body text-sm text-ink">
                Publicada (la ven los pastores)
              </span>
              <Switch
                aria-labelledby="jovenes-published"
                checked={editing.form.published}
                onChange={(published) => patchForm({ published })}
              />
            </div>
            {error && (
              <p role="alert" className="font-body text-sm text-negative-fg">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              {editing.event ? (
                confirmDelete ? (
                  <Button variant="danger" size="lg" onClick={remove} busy={saving} busyLabel="Borrando…">
                    Sí, borrar
                  </Button>
                ) : (
                  <Button variant="ghost" size="lg" onClick={() => setConfirmDelete(true)} disabled={saving}>
                    Borrar reunión
                  </Button>
                )
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="ghost" size="lg" onClick={() => setEditing(null)} disabled={saving}>
                  Cancelar
                </Button>
                <Button variant="primary" size="lg" onClick={save} busy={saving} busyLabel="Guardando…">
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        )}
      </CueDialog>
    </section>
  );
}
