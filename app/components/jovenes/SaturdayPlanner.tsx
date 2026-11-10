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
import { SHEET_TITLE } from "@/app/utils/homeHero";
import { DOW_SHORT, dayTitle } from "@/app/utils/agenda";
import { audienceLabel, eventDayLabel, eventName } from "@/app/utils/jovenesEventView";
import {
  SATURDAY_SEATS,
  saturdayBody,
  saturdayForm,
  saturdayProblem,
  seatNames,
  whatsappRoster,
  type SaturdayForm,
  type SaturdayRow,
} from "@/app/utils/jovenesPlannerModel";
import MeetingState from "./MeetingState";
import PersonSelect, { type JovenesPerson } from "./PersonSelect";
import ProgramEditor from "./ProgramEditor";
import { eventUrl, eventsUrl, sendEventWrite } from "./eventWrite";

const MINISTRY = "jovenes";
const SEAT_LABEL = { encargado: "Encargado", apoyo: "Apoyo", comparte: "Quién comparte" } as const;

type Editing = { event: MinistryEventView | null; form: SaturdayForm; token: string };

// One column template for the heads and every row, so they line up: the last column has a FIXED
// width (it used to be `auto`, and each row is its own grid, so «Crear» and «Editar · Programa»
// pushed the names to different places). A leader has no actions and no column for them.
const COLS_EDIT = "md:grid md:grid-cols-[6.5rem_1fr_1fr_1fr_1.4fr_10rem] md:gap-x-4";
const COLS_READ = "md:grid md:grid-cols-[6.5rem_1fr_1fr_1fr_1.4fr] md:gap-x-4";

/** «sáb»: the weekday beside the day number, from the calendar's own abbreviations. */
function dow(date: string): string {
  return DOW_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()].toLowerCase();
}

/** The day number in the display face, as a Calendario row leads with it. */
function DayNumber({ date }: { date: string }) {
  return (
    <span className="font-display text-[30px] font-semibold leading-none tabular-nums text-ink">{Number(date.slice(8))}</span>
  );
}

/**
 * Planear Jóvenes — the Saturday roster as hairline rows by month (Fecha, Encargado, Apoyo, Quién
 * comparte, Notas) and «Copiar para WhatsApp», which replaces the image the team sent. `canEdit`
 * (a Jóvenes admin) only shows the buttons; every write is decided again by the server.
 *
 * The month and its arrows live in the page's title (`/jovenes/admin`); this is the section under
 * it. No card per Saturday: a rule between rows, the day number leading, the state as a dot and a
 * word, and the actions as house buttons (2026-11-10, the «millones» pass of ADR-0070).
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
    const problem = saturdayProblem(form);
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
  const cols = canEdit ? COLS_EDIT : COLS_READ;

  return (
    <section aria-labelledby="jovenes-saturday-roster">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
        <h2 id="jovenes-saturday-roster" className={SHEET_TITLE}>
          Rol del sábado
        </h2>
        <Button variant="secondary" size="sm" onClick={copyRoster}>
          Copiar para WhatsApp
        </Button>
      </header>

      {/* Column heads for wide screens; on a phone each row stacks (no sideways scroll). */}
      <div aria-hidden="true" className={`hidden pb-2 ${cols} ${HAIRLINE_LABEL_CLASS}`}>
        <span>Fecha</span>
        {SATURDAY_SEATS.map((r) => (
          <span key={r}>{SEAT_LABEL[r]}</span>
        ))}
        <span>Notas</span>
      </div>
      <ul className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
        {rows.map((row) =>
          row.events.length === 0 ? (
            <li key={row.date} className={`flex items-center justify-between gap-4 py-4 md:items-center ${cols}`}>
              <p className="flex items-baseline gap-2.5 md:block">
                <DayNumber date={row.date} />
                <span className="font-body text-[13px] text-ink-dim md:mt-1.5 md:block">{dow(row.date)}</span>
              </p>
              <p className="flex-1 font-body text-[15px] italic text-ink-muted md:col-span-4">Sin reunión</p>
              {canEdit && (
                <div className="md:text-right">
                  <Button variant="secondary" size="sm" onClick={() => open(row.date, null)}>
                    Crear
                  </Button>
                </div>
              )}
            </li>
          ) : (
            row.events.map((e) => (
              <li key={e._id} className={`space-y-2.5 py-4 md:items-start md:space-y-0 ${cols}`}>
                <div>
                  <p className="flex items-baseline gap-2.5 md:block">
                    <DayNumber date={e.date} />
                    <span className="font-body text-[13px] leading-snug text-ink-dim md:mt-1.5 md:block">
                      <span className="whitespace-nowrap">{[dow(e.date), e.time].filter(Boolean).join(" · ")}</span>
                      {e.arrival && (
                        <>
                          <span className="md:hidden"> · </span>
                          <span className="whitespace-nowrap md:block">llegada {e.arrival}</span>
                        </>
                      )}
                    </span>
                  </p>
                  {/* A board or a titled meeting names itself; the plain Saturday needs no name. */}
                  {eventName(e) && <p className="mt-1.5 font-body text-[15px] font-semibold leading-snug text-ink">{eventName(e)}</p>}
                  <p className="mt-1.5">
                    <MeetingState published={e.published} />
                  </p>
                </div>
                {/* One paragraph of running text on a phone («Encargado Ana · Apoyo …»); from `md`
                    the paragraph dissolves and each seat is its own cell under the column heads. */}
                <p className="font-body text-[17px] leading-snug md:contents">
                  {SATURDAY_SEATS.map((role, i) => {
                    const list = seatNames(e, role);
                    // A stored seat whose person is gone reads «Sin asignar» too, and looks it.
                    const filled = e.seats.some((s) => s.role === role && s.name);
                    return (
                      <span key={role} className="md:relative md:block md:text-[15px]">
                        {i > 0 && <span className="text-ink-muted md:hidden"> · </span>}
                        {/* Read, not shown, from `md`: the column head above is the visible label. */}
                        <span className="text-ink-dim md:sr-only">{SEAT_LABEL[role]} </span>
                        <span className={filled ? "text-ink" : "italic text-ink-muted"}>
                          {list.length ? list.join(", ") : "Sin asignar"}
                        </span>
                      </span>
                    );
                  })}
                </p>
                <p className={`whitespace-pre-line font-body text-[15px] leading-snug text-ink-muted ${e.notes ? "" : "hidden md:block"}`}>
                  {e.notes ?? ""}
                </p>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 md:justify-end md:pt-0">
                    <Button variant="secondary" size="sm" onClick={() => open(e.date, e)}>
                      Editar
                    </Button>
                    <ProgramEditor event={e} people={people} compact />
                  </div>
                )}
              </li>
            ))
          ),
        )}
      </ul>

      <CueDialog
        open={editing !== null}
        mode="sheet"
        size="lg"
        label={editing ? `Reunión — ${eventDayLabel(editing.form.date)}` : "Reunión"}
        onDismiss={() => !saving && setEditing(null)}
        title={editing?.event ? "Editar reunión" : "Nueva reunión"}
      >
        {editing && (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            {/* What this sheet is about, in the body face under the house title: the date and
                who the meeting is for. (It used to be a second, smaller title in capitals.) */}
            <p className="font-body text-[17px] leading-snug text-ink-dim">
              {dayTitle(editing.form.date)} · <span className="text-ink">{audienceLabel({ kind: "ministry" })}</span>
            </p>
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
            {SATURDAY_SEATS.map((role) => (
              <div key={role}>
                <span className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>{SEAT_LABEL[role]}</span>
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
