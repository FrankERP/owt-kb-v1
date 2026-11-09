"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";
import Checkbox from "@/app/components/ui/Checkbox";
import CueDialog from "@/app/components/ui/CueDialog";
import DateField from "@/app/components/ui/DateField";
import Switch from "@/app/components/ui/Switch";
import { useToast } from "@/app/components/ui/Toast";
import { HAIRLINE_INPUT_CLASS, HAIRLINE_LABEL_CLASS } from "@/app/components/ui/hairlineField";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { isServiceTime } from "@/app/utils/serviceTime";
import { audienceLabel, eventDayLabel, eventHeading } from "@/app/utils/jovenesEventView";
import {
  JOVENES_GROUPS,
  canCreateGroupEvent,
  canEditGroupEvent,
  editLosesAccess,
  groupEventBody,
  groupEventForm,
  groupEventProblem,
  type GroupEventForm,
  type PlannerViewer,
} from "@/app/utils/jovenesPlannerModel";
import { eventUrl, eventsUrl, sendEventWrite } from "./eventWrite";

const MINISTRY = "jovenes";

type Editing = { event: MinistryEventView | null; form: GroupEventForm; token: string };

/**
 * The groups' calendars in Planear Jóvenes (PR D, ADR-0081): the month's meetings of one group or
 * shared by several. A leader creates them for their groups and edits a one-group meeting of a
 * group they lead; a shared one only its creator and the admins edit (Frank, 2026-11-04). The
 * buttons follow those rules from `viewer`, but only to save a refusal: every write is decided
 * again by the server on the stored meeting. The rows come from the editor-mode read, so a leader
 * never receives another group's meetings to begin with.
 */
export default function GroupCalendar({
  events,
  viewer,
  defaultDate,
}: {
  events: MinistryEventView[];
  viewer: PlannerViewer;
  /** Where a new meeting starts: today in the current month, else the month's first day. */
  defaultDate: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(event: MinistryEventView | null) {
    // The create token is minted when the editor opens, so a double tap or a retry names the
    // same meeting (W6) instead of making two.
    setEditing({ event, form: groupEventForm(defaultDate, viewer, event ?? undefined), token: crypto.randomUUID() });
    setConfirmDelete(false);
    setError(null);
  }

  function patchForm(patch: Partial<GroupEventForm>) {
    setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  }

  function toggleGroup(id: string, on: boolean) {
    setEditing((e) => {
      if (!e) return e;
      const groups = on ? [...new Set([...e.form.groups, id])] : e.form.groups.filter((g) => g !== id);
      return { ...e, form: { ...e.form, groups } };
    });
  }

  /** A 409 (someone saved first, or this create already landed): close, re-read, say so. */
  function closeStale(message: string) {
    setEditing(null);
    toast({ message: `${message} Ábrela de nuevo para ver los cambios.`, tone: "error" });
    router.refresh();
  }

  async function save() {
    if (!editing || saving) return;
    const { form, event, token } = editing;
    const problem = groupEventProblem(form, viewer);
    if (problem) {
      setError(problem);
      return;
    }
    if (form.time.trim() && !isServiceTime(form.time.trim())) {
      setError("La hora debe ser HH:mm (por ejemplo 19:30).");
      return;
    }
    if (event && !event.rev) {
      setError("Recarga la página para editar esta reunión.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = groupEventBody({ ...form, time: form.time.trim() });
      const r = event
        ? await sendEventWrite("PATCH", eventUrl(MINISTRY, event._id), { ...body, _rev: event.rev })
        : await sendEventWrite("POST", eventsUrl(MINISTRY), { ...body, token });
      if (!r.ok) {
        if (r.stale) return closeStale(r.message);
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
        if (r.stale) return closeStale(r.message);
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

  const losing = editing ? editLosesAccess(editing.event, editing.form, viewer) : false;

  return (
    <section className="space-y-4" aria-labelledby="jovenes-group-calendar">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="jovenes-group-calendar" className="font-display text-xl md:text-2xl font-bold text-ink">
          Calendario de grupos
        </h2>
        {canCreateGroupEvent(viewer) && (
          <Button variant="secondary" size="md" onClick={() => open(null)}>
            Nueva reunión de grupo
          </Button>
        )}
      </header>

      {events.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-edge-accent-subtle px-4 py-5 font-body text-sm text-mono-500">
          No hay reuniones de grupo este mes.
        </p>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => {
            const joint = e.audience?.kind === "groups" && e.audience.groups.length > 1;
            return (
              <li
                key={e._id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-edge-accent-subtle bg-surface-raised px-4 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                    <span className="capitalize">{eventDayLabel(e.date)}</span>
                    {e.time && <> · {e.time}</>}
                  </p>
                  <p className="font-body text-base text-ink">{eventHeading(e)}</p>
                  <p className="font-body text-sm text-ink-muted">{audienceLabel(e.audience)}</p>
                  {joint && (
                    <p className="font-body text-xs text-mono-500">
                      Creada por {e.createdByName ?? "alguien que ya no está"}
                    </p>
                  )}
                  {e.notes && <p className="whitespace-pre-line pt-1 font-body text-sm text-ink-muted">{e.notes}</p>}
                  {!e.published && (
                    <span className="mt-1 inline-block rounded-full border border-warning-fg/40 px-2 py-0.5 font-label text-[10px] uppercase tracking-widest text-warning-fg">
                      Borrador
                    </span>
                  )}
                </div>
                {canEditGroupEvent(e, viewer) && (
                  <Button variant="pill" size="sm" onClick={() => open(e)}>
                    Editar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CueDialog
        open={editing !== null}
        mode="sheet"
        size="lg"
        label={editing?.event ? "Editar reunión de grupo" : "Nueva reunión de grupo"}
        onDismiss={() => !saving && setEditing(null)}
        title={
          <span className="block font-display text-base uppercase tracking-wide text-ink">
            {editing?.event ? "Editar reunión de grupo" : "Nueva reunión de grupo"}
          </span>
        }
      >
        {editing && (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="grid grid-cols-2 gap-4">
              <DateField
                kind="date"
                id="jovenes-group-date"
                label="Fecha"
                value={editing.form.date}
                onChange={(e) => patchForm({ date: e.target.value })}
              />
              <label className="block">
                <span className={HAIRLINE_LABEL_CLASS}>Hora</span>
                <input
                  className={HAIRLINE_INPUT_CLASS}
                  inputMode="numeric"
                  placeholder="19:30"
                  value={editing.form.time}
                  onChange={(e) => patchForm({ time: e.target.value })}
                />
              </label>
            </div>
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Qué</span>
              <input
                className={HAIRLINE_INPUT_CLASS}
                maxLength={80}
                placeholder="Reunión de grupo"
                value={editing.form.title}
                onChange={(e) => patchForm({ title: e.target.value })}
              />
            </label>
            <fieldset className="space-y-2">
              <legend className={HAIRLINE_LABEL_CLASS}>Grupos</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {JOVENES_GROUPS.map((g) => (
                  <Checkbox
                    key={g.id}
                    checked={editing.form.groups.includes(g.id)}
                    onChange={(e) => toggleGroup(g.id, e.target.checked)}
                  >
                    <span className="font-body text-sm text-ink">{g.name}</span>
                  </Checkbox>
                ))}
              </div>
              {editing.form.groups.length > 1 && (
                <p className="font-body text-xs text-mono-500">
                  Una reunión compartida la ven completa los grupos que participan. Solo quien la creó y los admins pueden cambiarla.
                </p>
              )}
            </fieldset>
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
              <span id="jovenes-group-published" className="font-body text-sm text-ink">
                Publicada (la ven sus grupos)
              </span>
              <Switch
                aria-labelledby="jovenes-group-published"
                checked={editing.form.published}
                onChange={(published) => patchForm({ published })}
              />
            </div>
            {losing && (
              <p role="status" className="font-body text-sm text-warning-fg">
                Al compartirla con otro grupo, ya no podrás editarla: solo quien la creó y los admins.
              </p>
            )}
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
