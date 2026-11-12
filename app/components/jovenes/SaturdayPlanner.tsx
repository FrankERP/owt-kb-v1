"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";
import CueDialog from "@/app/components/ui/CueDialog";
import CueDialogStatus from "@/app/components/ui/CueDialogStatus";
import DateField from "@/app/components/ui/DateField";
import Switch from "@/app/components/ui/Switch";
import { useToast } from "@/app/components/ui/Toast";
import { HAIRLINE_INPUT_CLASS, HAIRLINE_LABEL_CLASS } from "@/app/components/ui/hairlineField";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { dayTitle } from "@/app/utils/agenda";
import { audienceLabel, dayWords, eventDayLabel, eventHeading, seatRoleLabel } from "@/app/utils/jovenesEventView";
import { MINISTRY_TONE } from "@/app/utils/jovenesGroupStyle";
import {
  SATURDAY_SEATS,
  isIsoDay,
  saturdayBody,
  saturdayForm,
  saturdayProblem,
  seatNames,
  whatsappRoster,
  type SaturdayForm,
  type SaturdayRow,
  type SaturdaySeat,
  type SeatPick,
} from "@/app/utils/jovenesPlannerModel";
import { CalendarIcon, CopyIcon, NoteIcon, PlusIcon } from "@/app/components/ui/icons";
import AudienceRail from "./AudienceRail";
import DateTile from "./DateTile";
import MeetingMeta from "./MeetingMeta";
import MeetingState from "./MeetingState";
import PersonAvatar from "./PersonAvatar";
import SectionHead from "./SectionHead";
import PersonSelect, { type JovenesPerson } from "./PersonSelect";
import ProgramEditor from "./ProgramEditor";
import { eventUrl, eventsUrl, halfTypedClock, sendEventWrite } from "./eventWrite";

const MINISTRY = "jovenes";
const SEAT_LABEL = { encargado: "Encargado", apoyo: "Apoyo", comparte: "Quién comparte" } as const;

type Editing = { event: MinistryEventView | null; form: SaturdayForm; token: string };

/**
 * Planear Jóvenes — the roster of whole-ministry meetings by month, a card per meeting (the date
 * as a leaf, Encargado, Apoyo and Quién comparte as faces, Lugar, Notas), and «Copiar para
 * WhatsApp», which replaces the image the team sent. Every Saturday has a card; «Nueva reunión»
 * creates one on any date (a Friday study), which then has its own. A seat holds a pastor or a
 * typed name (someone without an account, or the hosting group). `canEdit` (a Jóvenes admin) only
 * shows the buttons; every write is decided again by the server.
 *
 * The month and its arrows live in the page's title (`/jovenes/admin`); this is the section under
 * it. Cards since 2026-11-12 (ADR-0086): as hairline rows under column heads the month read as a
 * table of text, and the two sections of the page ran into each other.
 */
export default function SaturdayPlanner({
  month,
  rows,
  people,
  canEdit,
  defaultDate,
}: {
  month: string;
  rows: SaturdayRow[];
  people: JovenesPerson[];
  canEdit: boolean;
  /** Where «Nueva reunión» starts: today in the current month, else the month's first day. */
  defaultDate: string;
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

  /** One seat column, from the latest state (a typed-mode switch sets member and name in two calls). */
  function patchPick(role: SaturdaySeat, patch: Partial<SeatPick>) {
    setEditing((e) =>
      e ? { ...e, form: { ...e.form, picks: { ...e.form.picks, [role]: { ...e.form.picks[role], ...patch } } } } : e,
    );
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
    // The date first: with no date there is nothing to save, whatever the clocks say.
    const problem = isIsoDay(form.date)
      ? (halfTypedClock(["jovenes-saturday-time", "jovenes-saturday-arrival"]) ?? saturdayProblem(form))
      : saturdayProblem(form);
    if (problem) {
      setError(problem);
      return;
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
      const elsewhere = form.date.slice(0, 7) !== month;
      // A meeting saved into another month would vanish from this one: go to its month, and say
      // the date, so nobody presses «Nueva reunión» again for a duplicate.
      toast({
        message: `${event ? "Reunión guardada" : "Reunión creada"}${elsewhere ? ` para el ${dayWords(form.date)}` : ""}`,
        tone: "ok",
      });
      if (elsewhere) router.push(`/jovenes/admin?mes=${form.date.slice(0, 7)}`);
      else router.refresh();
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
    <section aria-labelledby="jovenes-saturday-roster">
      <SectionHead
        id="jovenes-saturday-roster"
        icon={<CalendarIcon size={20} />}
        title="Rol del sábado"
        note="Las reuniones de todo Jóvenes."
      >
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={() => open(defaultDate, null)}>
            <PlusIcon size={13} />
            Nueva reunión
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={copyRoster}>
          <CopyIcon size={13} />
          Copiar para WhatsApp
        </Button>
      </SectionHead>

      {/* A card per meeting (ADR-0086): the date as a leaf, the three seats as faces under their
          role, the state as a pill. A Saturday with nothing yet is an outline that asks for it. */}
      <ul className="space-y-3">
        {rows.map((row) =>
          row.events.length === 0 ? (
            <li
              key={row.date}
              className="flex items-center gap-3.5 rounded-[var(--brand-radius-panel)] border border-dashed border-ink/[0.16] py-3 pl-5 pr-4"
            >
              <DateTile date={row.date} tone={MINISTRY_TONE} empty />
              <p className="min-w-0 flex-1 font-body text-[15px] italic text-ink-muted">Sin reunión</p>
              {canEdit && (
                <Button variant="secondary" size="sm" onClick={() => open(row.date, null)}>
                  <PlusIcon size={13} />
                  Crear
                </Button>
              )}
            </li>
          ) : (
            row.events.map((e) => (
              <li key={e._id} className="brand-surface relative overflow-hidden rounded-[var(--brand-radius-panel)]">
                <AudienceRail audience={e.audience} muted={!e.published} />
                {/* On a phone the leaf and the title share the first line and everything else runs
                    the card's full width under them; from `md` the leaf is a column of its own and
                    the actions another, so the seats line up from card to card. */}
                <div className="py-4 pl-5 pr-4 md:grid md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-x-4">
                  <div className="flex gap-3.5 md:contents">
                    <DateTile date={e.date} tone={MINISTRY_TONE} className="md:row-span-2" decorative />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <h3 className="min-w-0 break-words pt-0.5 font-display text-[22px] font-semibold uppercase leading-none tracking-[0.02em] text-ink md:text-2xl">
                          {eventHeading(e)}
                          <span className="sr-only">, {dayTitle(e.date)}</span>
                        </h3>
                        <MeetingState published={e.published} />
                      </div>
                      <MeetingMeta time={e.time} arrival={e.arrival} place={e.place} />
                    </div>
                  </div>
                  <div className="min-w-0 space-y-3 pt-3.5 md:col-start-2">
                    <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                      {SATURDAY_SEATS.map((role) => {
                        const list = seatNames(e, role);
                        // A stored seat whose person is gone reads «Sin asignar» too, and looks it.
                        // The face is the first seat WITH a name: `seatNames` spells a nameless
                        // one as «Sin asignar», which must never become the initials «SI».
                        const face = e.seats.find((s) => s.role === role && s.name)?.name ?? null;
                        const filled = face !== null;
                        return (
                          <li key={role} className="flex min-w-0 items-center gap-2.5">
                            <PersonAvatar name={face} />
                            <div className="min-w-0">
                              {/* The short word («Comparte»), as `/jovenes` says it; the sheet's field asks «Quién comparte». */}
                              <p className="font-label text-[10px] uppercase tracking-[0.16em] text-ink-dim">{seatRoleLabel(role)}</p>
                              <p className={`break-words font-body text-[16px] leading-tight ${filled ? "font-semibold text-ink" : "italic text-ink-muted"}`}>
                                {list.length ? list.join(", ") : "Sin asignar"}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {e.notes && (
                      <p className="flex gap-2.5 rounded-xl bg-ink/[0.05] px-3.5 py-2.5 font-body text-[15px] leading-snug text-ink-muted">
                        <NoteIcon size={15} className="mt-[3px] shrink-0 text-ink-dim" />
                        <span className="min-w-0 whitespace-pre-line break-words">{e.notes}</span>
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-2 pt-3.5 md:col-start-3 md:row-span-2 md:row-start-1 md:flex-col md:items-stretch md:pt-0">
                      <Button variant="secondary" size="sm" onClick={() => open(e.date, e)}>
                        Editar
                      </Button>
                      <ProgramEditor event={e} people={people} compact />
                    </div>
                  )}
                </div>
              </li>
            ))
          ),
        )}
      </ul>

      <CueDialog
        open={editing !== null}
        mode="sheet"
        size="lg"
        label={editing && isIsoDay(editing.form.date) ? `Reunión — ${eventDayLabel(editing.form.date)}` : "Reunión"}
        onDismiss={() => !saving && setEditing(null)}
        title={editing?.event ? "Editar reunión" : "Nueva reunión"}
      >
        {editing && (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            {/* What this sheet is about, in the body face under the house title: the date and
                who the meeting is for. (It used to be a second, smaller title in capitals.) */}
            <p className="font-body text-[17px] leading-snug text-ink-dim">
              {isIsoDay(editing.form.date) && <>{dayTitle(editing.form.date)} · </>}
              <span className="text-ink">{audienceLabel({ kind: "ministry" })}</span>
            </p>
            <div>
              <label htmlFor="jovenes-saturday-date" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>
                Fecha
              </label>
              <DateField
                kind="date"
                size="lg"
                id="jovenes-saturday-date"
                value={editing.form.date}
                onChange={(e) => patchForm({ date: e.target.value })}
              />
              {/* «Nueva reunión» opens on today: on a day that already has a meeting, the row's
                  «Editar» is usually what was meant. Said, not refused (two meetings a day is allowed). */}
              {!editing.event && rows.some((r) => r.date === editing.form.date && r.events.length > 0) && (
                <span className="mt-1.5 block font-body text-[13px] text-warning-fg">
                  Ya hay una reunión ese día. Para cambiarla, usa «Editar» en su fila.
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="jovenes-saturday-time" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>
                  Hora
                </label>
                <DateField
                  kind="time"
                  size="lg"
                  id="jovenes-saturday-time"
                  value={editing.form.time}
                  onChange={(e) => patchForm({ time: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="jovenes-saturday-arrival" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>
                  Llegada
                </label>
                <DateField
                  kind="time"
                  size="lg"
                  id="jovenes-saturday-arrival"
                  value={editing.form.arrival}
                  onChange={(e) => patchForm({ arrival: e.target.value })}
                />
              </div>
            </div>
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Qué</span>
              <input
                className={HAIRLINE_INPUT_CLASS}
                maxLength={80}
                placeholder="Por ejemplo Estudio «Daniel», Gotcha, Posada"
                value={editing.form.title}
                onChange={(e) => patchForm({ title: e.target.value })}
              />
            </label>
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Lugar</span>
              <input
                className={HAIRLINE_INPUT_CLASS}
                maxLength={120}
                placeholder="Por ejemplo Oasis Tlalpan"
                value={editing.form.place}
                onChange={(e) => patchForm({ place: e.target.value.replace(/[\r\n\u2028\u2029]/g, " ") })}
              />
            </label>
            {SATURDAY_SEATS.map((role) => (
              <div key={role}>
                <span className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>{SEAT_LABEL[role]}</span>
                <PersonSelect
                  ariaLabel={SEAT_LABEL[role]}
                  value={editing.form.picks[role].member}
                  people={people}
                  storedName={editing.form.picks[role].key ? names.get(editing.form.picks[role].key!) : null}
                  onChange={(member) => patchPick(role, { member })}
                  typedName={editing.form.picks[role].name}
                  onTypedName={(name) => patchPick(role, { name })}
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
            <div className="flex items-center justify-between gap-4 border-t border-ink/[0.10] pt-4">
              <span id="jovenes-published" className="min-w-0">
                <span className="block font-body text-[17px] text-ink">Publicada</span>
                <span className="block font-body text-[13px] text-ink-muted">La ven todos los pastores</span>
              </span>
              <Switch
                aria-labelledby="jovenes-published"
                checked={editing.form.published}
                onChange={(published) => patchForm({ published })}
              />
            </div>
            {error && <CueDialogStatus tone="error">{error}</CueDialogStatus>}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
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
