"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";
import Checkbox from "@/app/components/ui/Checkbox";
import Collapse from "@/app/components/ui/Collapse";
import CueDialog from "@/app/components/ui/CueDialog";
import CueDialogStatus from "@/app/components/ui/CueDialogStatus";
import DateField from "@/app/components/ui/DateField";
import Menu, { MenuItem } from "@/app/components/ui/Menu";
import Select from "@/app/components/ui/Select";
import Switch from "@/app/components/ui/Switch";
import { useToast } from "@/app/components/ui/Toast";
import { HAIRLINE_INPUT_CLASS, HAIRLINE_LABEL_CLASS } from "@/app/components/ui/hairlineField";
import { BookIcon, CalendarOffIcon, ChevronDownIcon, NoteIcon, PlusIcon } from "@/app/components/ui/icons";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import type { JovenesPerson } from "@/app/utils/jovenesPeople";
import { dayTitle } from "@/app/utils/agenda";
import { dayWords } from "@/app/utils/jovenesEventView";
import { groupTone } from "@/app/utils/jovenesGroupStyle";
import { monthLabel, JOVENES_GROUPS, type PlannerViewer } from "@/app/utils/jovenesPlannerModel";
import { CORAZON_HELP, LESSON_TRACKS, SHIFT_DONE_WORDS, TRACK_LABEL, type LessonTrack } from "@/app/utils/ministryLesson";
import {
  MAX_NEW_CLASSES,
  bookForm,
  bookProblem,
  bookRows,
  classBody,
  classForm,
  classProblem,
  groupRosters,
  isOpenClass,
  plannableGroups,
  responsable,
  shiftPreview,
  splitRoster,
  swapCandidates,
  type BookForm,
  type ClassForm,
  type ClassView,
  type ResponsablePick,
  type Roster,
} from "@/app/utils/jovenesClassesModel";
import DateTile from "./DateTile";
import MeetingMeta from "./MeetingMeta";
import MeetingState from "./MeetingState";
import PersonAvatar from "./PersonAvatar";
import PersonSelect from "./PersonSelect";
import SectionHead from "./SectionHead";
import { eventUrl, eventsUrl, halfTypedClock, sendEventWrite } from "./eventWrite";

const MINISTRY = "jovenes";

type Dialog =
  | { kind: "class"; event: ClassView | null; form: ClassForm; token: string }
  | { kind: "book"; form: BookForm; tokens: string[] | null; created: number; frozen: boolean }
  | { kind: "shift"; anchor: ClassView; token: string }
  | { kind: "swap"; a: ClassView; b: string };

/**
 * «Clases del grupo» (plan 2026-11-12 §4): each group plans its own class roster here — the Google
 * Sheet's «Rol Clases» in the app. A roster is one book (`lesson.series`); each class is one of the
 * group's meetings, so it inherits who reads it (ADR-0081). A leader sees the groups they lead, an
 * admin every group. «Recorrer» and «Cambiar con…» are one write each, decided by the server.
 */
export default function GroupClasses({
  events,
  viewer,
  people,
  today,
}: {
  /** The planner's editor-mode read of the roster window (no upper bound, plan L3). */
  events: MinistryEventView[];
  viewer: PlannerViewer;
  people: JovenesPerson[];
  today: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const groups = plannableGroups(JOVENES_GROUPS, viewer);
  const [group, setGroup] = useState<string>(groups[0]?.id ?? "");
  const rosters = useMemo(() => groupRosters(events, group, today), [events, group, today]);
  const [picked, setPicked] = useState<string | null>(null);
  const roster: Roster | null = rosters.find((r) => r.series === picked) ?? rosters[0] ?? null;
  const [showPast, setShowPast] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticking, setTicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (groups.length === 0) return null;
  const tone = groupTone(group);
  const groupName = JOVENES_GROUPS.find((g) => g.id === group)?.name ?? group;
  const members = people.filter((p) => p.groups.includes(group));
  const groupMeetings = events.filter((e) => e.audience?.kind === "groups" && e.audience.groups.includes(group));
  const split = roster ? splitRoster(roster, today) : null;

  function close() {
    if (busy) return;
    // A «Nuevo libro» that stopped part way already created some classes: show them, so nobody
    // starts the book again with fresh tokens and duplicates it.
    if (dialog?.kind === "book" && dialog.created > 0) {
      setPicked(dialog.form.series.trim());
      router.refresh();
    }
    setDialog(null);
  }
  function stale(message: string) {
    setDialog(null);
    toast({ message: `${message} Ábrela de nuevo para ver los cambios.`, tone: "error" });
    router.refresh();
  }

  function openClass(event: ClassView | null) {
    setError(null);
    setDialog({ kind: "class", event, form: classForm(group, today, roster?.series ?? "", event ?? undefined), token: crypto.randomUUID() });
  }
  function patchClass(patch: Partial<ClassForm>) {
    setDialog((d) => (d?.kind === "class" ? { ...d, form: { ...d.form, ...patch } } : d));
  }

  async function saveClass() {
    if (dialog?.kind !== "class" || busy) return;
    const { form, event, token } = dialog;
    const problem = classProblem(form) ?? halfTypedClock(["jovenes-class-time"]);
    if (problem) return setError(problem);
    if (event && !event.rev) return setError("Recarga la página para editar esta clase.");
    setBusy(true);
    setError(null);
    try {
      const body = classBody(form, event ? (responsable(event)?._key ?? null) : null);
      const r = event
        ? await sendEventWrite("PATCH", eventUrl(MINISTRY, event._id), { ...body, _rev: event.rev })
        : await sendEventWrite("POST", eventsUrl(MINISTRY), { ...body, token });
      if (!r.ok) {
        if (r.stale) return stale(r.message);
        return setError(r.message);
      }
      setDialog(null);
      toast({ message: event ? "Clase guardada" : "Clase creada", tone: "ok" });
      router.refresh();
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function removeClass() {
    if (dialog?.kind !== "class" || !dialog.event || busy) return;
    const event = dialog.event;
    if (!event.rev) return setError("Recarga la página para borrar esta clase.");
    setBusy(true);
    setError(null);
    try {
      const r = await sendEventWrite("DELETE", eventUrl(MINISTRY, event._id), { _rev: event.rev });
      if (!r.ok) {
        if (r.stale) return stale(r.message);
        return setError(r.message);
      }
      setDialog(null);
      toast({ message: "Clase borrada", tone: "ok" });
      router.refresh();
    } catch {
      setError("No se pudo borrar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDone(c: ClassView) {
    if (ticking || !c.rev) return;
    setTicking(c._id);
    try {
      const r = await sendEventWrite("PATCH", eventUrl(MINISTRY, c._id), { _rev: c.rev, lesson: { ...c.lesson, done: !c.lesson.done } });
      if (!r.ok) {
        toast({ message: r.message, tone: "error" });
        if (r.stale) router.refresh();
        return;
      }
      router.refresh();
    } catch {
      toast({ message: "No se pudo guardar. Intenta de nuevo.", tone: "error" });
    } finally {
      setTicking(null);
    }
  }

  // ── «Nuevo libro» ──
  function openBook() {
    setError(null);
    setDialog({ kind: "book", form: bookForm(group, today), tokens: null, created: 0, frozen: false });
  }
  function patchBook(patch: Partial<BookForm>) {
    setDialog((d) => (d?.kind === "book" && !d.frozen ? { ...d, form: { ...d.form, ...patch } } : d));
  }
  async function createBook() {
    if (dialog?.kind !== "book" || busy) return;
    const problem = bookProblem(dialog.form) ?? halfTypedClock(["jovenes-book-time"]);
    if (problem) return setError(problem);
    const rows = bookRows(dialog.form);
    // One token per row, minted ONCE: after the first POST the form is frozen, so a retry names the
    // same classes and never duplicates one (W6). A 409 «already created» is that row, done.
    const tokens = dialog.tokens ?? rows.map(() => crypto.randomUUID());
    let created = dialog.created;
    setDialog({ ...dialog, tokens, frozen: true });
    setBusy(true);
    setError(null);
    try {
      for (let i = created; i < rows.length; i++) {
        const r = await sendEventWrite("POST", eventsUrl(MINISTRY), { ...classBody(rows[i]), token: tokens[i] });
        if (!r.ok && !(r.stale && r.message === "Esta reunión ya estaba creada.")) {
          setDialog((d) => (d?.kind === "book" ? { ...d, created } : d));
          return setError(`Se crearon ${created} de ${rows.length}. ${r.message}`);
        }
        created = i + 1;
      }
      setDialog(null);
      setPicked(dialog.form.series.trim());
      toast({ message: `${rows.length} clases creadas`, tone: "ok" });
      router.refresh();
    } catch {
      setDialog((d) => (d?.kind === "book" ? { ...d, created } : d));
      setError(`Se crearon ${created} de ${rows.length}. Intenta de nuevo.`);
    } finally {
      setBusy(false);
    }
  }

  // ── «Recorrer» and «Cambiar con…» ──
  async function confirmShift() {
    if (dialog?.kind !== "shift" || busy || !roster) return;
    const { anchor, token } = dialog;
    if (!anchor.rev) return setError("Recarga la página para recorrer el rol.");
    setBusy(true);
    setError(null);
    try {
      const { ids } = shiftPreview(roster, anchor, groupMeetings);
      const r = await sendEventWrite("POST", `${eventUrl(MINISTRY, anchor._id)}/shift`, { _rev: anchor.rev, token, ids });
      if (!r.ok) {
        // A held later class is a 409 a reload does not fix: say it here, keep the dialog.
        if (r.stale && r.message !== SHIFT_DONE_WORDS) return stale(r.message);
        return setError(r.message);
      }
      setDialog(null);
      toast({ message: "Rol recorrido una semana", tone: "ok" });
      router.refresh();
    } catch {
      setError("No se pudo recorrer. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSwap() {
    if (dialog?.kind !== "swap" || busy || !roster) return;
    const b = roster.classes.find((c) => c._id === dialog.b);
    if (!b) return setError("Elige con qué clase cambiar.");
    if (!dialog.a.rev || !b.rev) return setError("Recarga la página para cambiar estas clases.");
    setBusy(true);
    setError(null);
    try {
      const r = await sendEventWrite("POST", `${eventUrl(MINISTRY, dialog.a._id)}/swap`, {
        _rev: dialog.a.rev,
        with: { token: b._id.slice(b._id.indexOf(".") + 1), _rev: b.rev },
      });
      if (!r.ok) {
        if (r.stale) return stale(r.message);
        return setError(r.message);
      }
      setDialog(null);
      toast({ message: "Clases cambiadas", tone: "ok" });
      router.refresh();
    } catch {
      setError("No se pudo cambiar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function card(c: ClassView) {
    const seat = responsable(c);
    const gap = c.lesson.track === "sin_clase";
    return (
      <li key={c._id} className={`brand-surface relative overflow-hidden rounded-[var(--brand-radius-panel)] ${gap ? "opacity-70" : ""}`}>
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${tone.solid} ${c.published ? "" : "opacity-50"}`} />
        <div className="flex items-start gap-3.5 py-3.5 pl-5 pr-3 sm:pr-4">
          <DateTile date={c.date} tone={tone} decorative />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h3 className="min-w-0 break-words font-display text-[20px] font-semibold uppercase leading-none tracking-[0.02em] text-ink md:text-[22px]">
                {c.title ?? TRACK_LABEL[c.lesson.track]}
                <span className="sr-only">, {dayTitle(c.date)}</span>
              </h3>
              {!gap && (
                <span className={`rounded-full border px-2 py-[2px] font-body text-[12px] font-semibold leading-tight ${c.lesson.track === "corazon" ? tone.chip : "border-ink/15 bg-ink/[0.05] text-ink-muted"}`}>
                  {TRACK_LABEL[c.lesson.track]}
                </span>
              )}
              {!c.published && <MeetingState published={false} />}
            </div>
            {!gap && (
              <p className="flex items-center gap-2 font-body text-[15px] text-ink">
                <PersonAvatar name={seat?.name ?? null} mine={seat?.mine ?? false} size="sm" />
                <span className={seat?.name ? "" : "text-ink-dim"}>{seat?.name ?? "Sin responsable"}</span>
              </p>
            )}
            {!gap && <MeetingMeta time={c.time} arrival={null} place={c.place} />}
            {c.notes && (
              <p className="flex gap-2 font-body text-[14px] leading-snug text-ink-muted">
                <NoteIcon size={14} className="mt-[3px] shrink-0 text-ink-dim" />
                <span className="min-w-0 whitespace-pre-line break-words">{c.notes}</span>
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {!gap && (
              <Checkbox
                checked={c.lesson.done}
                disabled={ticking !== null}
                onChange={() => toggleDone(c)}
                aria-label={`Hecho: ${c.title ?? TRACK_LABEL[c.lesson.track]}, ${dayWords(c.date)}`}
              >
                <span className="font-body text-[14px] text-ink-muted">Hecho</span>
              </Checkbox>
            )}
            <Menu
              label={`Opciones de ${c.title ?? "la clase"}`}
              trigger={
                <Button variant="ghost" size="sm" aria-label={`Opciones de ${c.title ?? "la clase"}, ${dayWords(c.date)}`}>
                  Opciones
                  <ChevronDownIcon size={13} />
                </Button>
              }
            >
              <MenuItem onSelect={() => openClass(c)}>Editar</MenuItem>
              {isOpenClass(c) && (
                <MenuItem onSelect={() => { setError(null); setDialog({ kind: "shift", anchor: c, token: crypto.randomUUID() }); }}>
                  No hubo clase: recorrer
                </MenuItem>
              )}
              {isOpenClass(c) && roster && swapCandidates(roster, c).length > 0 && (
                <MenuItem onSelect={() => { setError(null); setDialog({ kind: "swap", a: c, b: "" }); }}>Cambiar con…</MenuItem>
              )}
            </Menu>
          </div>
        </div>
      </li>
    );
  }

  const preview = dialog?.kind === "shift" && roster ? shiftPreview(roster, dialog.anchor, groupMeetings) : null;

  return (
    <section aria-labelledby="jovenes-group-classes">
      <SectionHead
        id="jovenes-group-classes"
        icon={<BookIcon size={20} />}
        title="Clases del grupo"
        note="El rol de clases de cada grupo, por libro."
      >
        <Button variant="secondary" size="sm" onClick={() => openClass(null)}>
          <PlusIcon size={13} />
          Nueva clase
        </Button>
        <Button variant="primary" size="sm" onClick={openBook}>
          <BookIcon size={13} />
          Nuevo libro
        </Button>
      </SectionHead>

      {groups.length > 1 && (
        <div role="group" aria-label="Grupo" className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
          {groups.map((g) => (
            <Button
              key={g.id}
              variant="pill"
              size="sm"
              active={g.id === group}
              onClick={() => { setGroup(g.id); setPicked(null); setShowPast(false); }}
              className="shrink-0 whitespace-nowrap py-1.5"
            >
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${groupTone(g.id).solid}`} />
              {g.name}
            </Button>
          ))}
        </div>
      )}

      {!roster || !split ? (
        <p className="flex flex-col items-center gap-3 rounded-[var(--brand-radius-panel)] border border-dashed border-ink/[0.16] px-6 py-10 text-center font-body text-[15px] text-ink-muted">
          <CalendarOffIcon size={24} className="text-ink-dim" />
          {groupName} todavía no tiene clases. Empieza con «Nuevo libro».
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className={`font-label text-[11px] uppercase tracking-[0.14em] ${tone.ink}`}>{groupName}</p>
              <h3 className="font-display text-[24px] font-semibold uppercase leading-tight tracking-[0.02em] text-ink md:text-[28px]">{roster.series}</h3>
              <p className="font-body text-[14px] text-ink-dim">
                {roster.held} de {roster.total} {roster.total === 1 ? "clase hecha" : "clases hechas"}
              </p>
            </div>
            {rosters.length > 1 && (
              <Select aria-label="Rol" size="md" value={roster.series} onChange={(e) => { setPicked(e.target.value); setShowPast(false); }}>
                {rosters.map((r) => (
                  <option key={r.series} value={r.series}>{r.series}</option>
                ))}
              </Select>
            )}
          </div>

          {split.past.length > 0 && (
            <div>
              <Button variant="ghost" size="sm" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)} className="-ml-3">
                <ChevronDownIcon size={13} className={showPast ? "rotate-180" : ""} />
                Anteriores ({split.past.length})
              </Button>
              <Collapse open={showPast} className="pt-2">
                <ul className="space-y-2.5">{split.past.map(card)}</ul>
              </Collapse>
            </div>
          )}

          {split.months.length === 0 ? (
            <p className="font-body text-[15px] text-ink-muted">No hay clases por venir en este rol.</p>
          ) : (
            split.months.map((m) => (
              <div key={m.month}>
                <h4 className="mb-2.5 font-label text-[12px] uppercase tracking-[0.14em] text-ink-dim">{monthLabel(m.month)}</h4>
                <ul className="space-y-2.5">{m.classes.map(card)}</ul>
              </div>
            ))
          )}
        </div>
      )}

      {/* One class: create or edit. */}
      <CueDialog
        open={dialog?.kind === "class"}
        mode="sheet"
        size="lg"
        label={dialog?.kind === "class" && dialog.event ? "Editar clase" : "Nueva clase"}
        title={dialog?.kind === "class" && dialog.event ? "Editar clase" : `Nueva clase · ${groupName}`}
        onDismiss={close}
      >
        {dialog?.kind === "class" && (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Rol (libro)</span>
              <input
                className={HAIRLINE_INPUT_CLASS}
                maxLength={80}
                list="jovenes-class-series"
                placeholder="Por ejemplo, El Caos Dentro de Mi"
                value={dialog.form.series}
                onChange={(e) => patchClass({ series: e.target.value.replace(/[\r\n\u2028\u2029]/g, " ") })}
              />
              <datalist id="jovenes-class-series">
                {rosters.map((r) => <option key={r.series} value={r.series} />)}
              </datalist>
            </label>
            <TrackPicker value={dialog.form.track} onChange={(track) => patchClass({ track })} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="jovenes-class-date" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>Fecha</label>
                <DateField kind="date" size="lg" id="jovenes-class-date" value={dialog.form.date} onChange={(e) => patchClass({ date: e.target.value })} />
              </div>
              <div>
                <label htmlFor="jovenes-class-time" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>Hora</label>
                <DateField kind="time" size="lg" id="jovenes-class-time" value={dialog.form.time} onChange={(e) => patchClass({ time: e.target.value })} />
              </div>
            </div>
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Título</span>
              <input
                className={HAIRLINE_INPUT_CLASS}
                maxLength={80}
                placeholder={dialog.form.track === "sin_clase" ? "No hubo clase" : "Por ejemplo, Cap 5"}
                value={dialog.form.title}
                onChange={(e) => patchClass({ title: e.target.value })}
              />
            </label>
            {dialog.form.track !== "sin_clase" && (
              <div>
                <span className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>Responsable</span>
                <ResponsableSelect
                  value={dialog.form.responsable}
                  onChange={(responsable) => patchClass({ responsable })}
                  people={members}
                  storedName={dialog.event ? (responsable(dialog.event)?.name ?? null) : null}
                  ariaLabel="Responsable"
                />
              </div>
            )}
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Lugar</span>
              <input
                className={HAIRLINE_INPUT_CLASS}
                maxLength={120}
                value={dialog.form.place}
                onChange={(e) => patchClass({ place: e.target.value.replace(/[\r\n\u2028\u2029]/g, " ") })}
              />
            </label>
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Notas</span>
              <textarea
                className={`${HAIRLINE_INPUT_CLASS} min-h-[4rem] resize-y`}
                maxLength={2000}
                value={dialog.form.notes}
                onChange={(e) => patchClass({ notes: e.target.value })}
              />
            </label>
            <PublishedSwitch id="jovenes-class-published" checked={dialog.form.published} onChange={(published) => patchClass({ published })} />
            {error && <CueDialogStatus tone="error">{error}</CueDialogStatus>}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {dialog.event ? (
                <Button variant="ghost" size="lg" onClick={removeClass} disabled={busy}>Borrar clase</Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="ghost" size="lg" onClick={close} disabled={busy}>Cancelar</Button>
                <Button variant="primary" size="lg" onClick={saveClass} busy={busy} busyLabel="Guardando…">Guardar</Button>
              </div>
            </div>
          </div>
        )}
      </CueDialog>

      {/* «Nuevo libro»: a whole roster at once. */}
      <CueDialog open={dialog?.kind === "book"} mode="sheet" size="lg" label="Nuevo libro" title={`Nuevo libro · ${groupName}`} onDismiss={close}>
        {dialog?.kind === "book" && (
          <BookEditor
            dialog={dialog}
            members={members}
            error={error}
            busy={busy}
            onPatch={patchBook}
            onCreate={createBook}
            onClose={close}
          />
        )}
      </CueDialog>

      {/* «Recorrer». */}
      <CueDialog open={dialog?.kind === "shift"} mode="modal" size="md" label="Recorrer el rol" title="No hubo clase: recorrer el rol" onDismiss={close}>
        {dialog?.kind === "shift" && preview && (
          <div className="space-y-4 px-5 pb-5 pt-3 sm:px-6">
            <p className="font-body text-[15px] leading-snug text-ink">
              El {dayWords(dialog.anchor.date)} queda como «No hubo clase» (solo lo ven los líderes), y{" "}
              {preview.moves.length === 1 ? "esta clase se mueve" : `estas ${preview.moves.length} clases se mueven`} una semana, cada una con su responsable:
            </p>
            <ul className="max-h-60 space-y-1.5 overflow-y-auto font-body text-[14px] text-ink-muted">
              {preview.moves.map((m) => (
                <li key={m.id}>
                  <span className="text-ink">{m.title ?? "Clase"}</span>: {dayWords(m.from)} → {dayWords(m.to)}
                </li>
              ))}
            </ul>
            {preview.collisions.length > 0 && (
              <p role="status" className="border-l-2 border-warning-fg/60 py-1 pl-4 font-body text-[14px] leading-snug text-warning-soft">
                Ojo: {preview.collisions.map(dayWords).join(", ")} ya {preview.collisions.length === 1 ? "tiene" : "tienen"} otra reunión del grupo.
              </p>
            )}
            <p className="font-body text-[13px] text-ink-dim">No se puede deshacer de un toque; para regresarlo hay que mover las fechas a mano.</p>
            {error && <CueDialogStatus tone="error">{error}</CueDialogStatus>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="lg" onClick={close} disabled={busy}>Cancelar</Button>
              <Button variant="primary" size="lg" onClick={confirmShift} busy={busy} busyLabel="Recorriendo…">Recorrer</Button>
            </div>
          </div>
        )}
      </CueDialog>

      {/* «Cambiar con…». */}
      <CueDialog open={dialog?.kind === "swap"} mode="modal" size="md" label="Cambiar clase" title="Cambiar con…" onDismiss={close}>
        {dialog?.kind === "swap" && roster && (
          <div className="space-y-4 px-5 pb-5 pt-3 sm:px-6">
            <p className="font-body text-[15px] leading-snug text-ink">
              {responsable(dialog.a)?.name ?? "Sin responsable"} da {dialog.a.title ?? "la clase"} el {dayWords(dialog.a.date)}. ¿Con quién cambia? Cada quien toma el día y el capítulo del otro.
            </p>
            <Select aria-label="Clase con la que cambia" size="lg" className="w-full" value={dialog.b} onChange={(e) => setDialog({ ...dialog, b: e.target.value })}>
              <option value="">Elige una clase</option>
              {swapCandidates(roster, dialog.a).map((c) => (
                <option key={c._id} value={c._id}>
                  {dayWords(c.date)} · {c.title ?? TRACK_LABEL[c.lesson.track]} · {responsable(c)?.name ?? "Sin responsable"}
                </option>
              ))}
            </Select>
            {error && <CueDialogStatus tone="error">{error}</CueDialogStatus>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="lg" onClick={close} disabled={busy}>Cancelar</Button>
              <Button variant="primary" size="lg" onClick={confirmSwap} busy={busy} busyLabel="Cambiando…" disabled={!dialog.b}>Cambiar</Button>
            </div>
          </div>
        )}
      </CueDialog>
    </section>
  );
}

function TrackPicker({ value, onChange }: { value: LessonTrack; onChange: (t: LessonTrack) => void }) {
  return (
    <fieldset>
      <legend className={`${HAIRLINE_LABEL_CLASS} mb-2`}>Tipo</legend>
      <div className="flex flex-wrap gap-2">
        {LESSON_TRACKS.map((t) => (
          <Button key={t} variant="pill" size="sm" active={value === t} onClick={() => onChange(t)}>
            {TRACK_LABEL[t]}
          </Button>
        ))}
      </div>
      {value === "corazon" && <p className="mt-2 font-body text-[13px] leading-snug text-ink-muted">{CORAZON_HELP}</p>}
    </fieldset>
  );
}

function PublishedSwitch({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-ink/[0.10] pt-4">
      <span id={id} className="min-w-0">
        <span className="block font-body text-[17px] text-ink">Publicada</span>
        <span className="block font-body text-[13px] text-ink-muted">La ven los pastores del grupo</span>
      </span>
      <Switch aria-labelledby={id} checked={checked} onChange={onChange} />
    </div>
  );
}

/** A responsable: a member of the group, or a typed name such as «Todos». */
function ResponsableSelect({
  value,
  onChange,
  people,
  storedName = null,
  ariaLabel,
}: {
  value: ResponsablePick;
  onChange: (p: ResponsablePick) => void;
  people: JovenesPerson[];
  storedName?: string | null;
  ariaLabel: string;
}) {
  return (
    <PersonSelect
      ariaLabel={ariaLabel}
      people={people}
      value={value.member}
      storedName={storedName}
      onChange={(member) => onChange({ member, name: null })}
      typedName={value.name}
      onTypedName={(name) => onChange({ member: null, name })}
    />
  );
}

function BookEditor({
  dialog,
  members,
  error,
  busy,
  onPatch,
  onCreate,
  onClose,
}: {
  dialog: Extract<Dialog, { kind: "book" }>;
  members: JovenesPerson[];
  error: string | null;
  busy: boolean;
  onPatch: (p: Partial<BookForm>) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const f = dialog.form;
  const rows = bookProblem(f) ? [] : bookRows(f);
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const setRotation = (i: number, p: ResponsablePick) => onPatch({ rotation: f.rotation.map((x, j) => (j === i ? p : x)) });
  return (
    <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
      <fieldset disabled={dialog.frozen} className="space-y-5">
        <label className="block">
          <span className={HAIRLINE_LABEL_CLASS}>Libro</span>
          <input
            className={HAIRLINE_INPUT_CLASS}
            maxLength={80}
            placeholder="Por ejemplo, El Caos Dentro de Mi"
            value={f.series}
            onChange={(e) => onPatch({ series: e.target.value.replace(/[\r\n\u2028\u2029]/g, " ") })}
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className={HAIRLINE_LABEL_CLASS}>Desde el capítulo</span>
            <input className={HAIRLINE_INPUT_CLASS} inputMode="numeric" value={f.firstChapter || ""} onChange={(e) => onPatch({ firstChapter: num(e.target.value.replace(/\D/g, "")) })} />
          </label>
          <label className="block">
            <span className={HAIRLINE_LABEL_CLASS}>Cuántas clases</span>
            <input className={HAIRLINE_INPUT_CLASS} inputMode="numeric" value={f.count || ""} onChange={(e) => onPatch({ count: num(e.target.value.replace(/\D/g, "")) })} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="jovenes-book-date" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>Primera clase</label>
            <DateField kind="date" size="lg" id="jovenes-book-date" value={f.firstDate} onChange={(e) => onPatch({ firstDate: e.target.value })} />
          </div>
          <label className="block">
            <span className={HAIRLINE_LABEL_CLASS}>Cada cuántos días</span>
            <input className={HAIRLINE_INPUT_CLASS} inputMode="numeric" value={f.everyDays || ""} onChange={(e) => onPatch({ everyDays: num(e.target.value.replace(/\D/g, "")) })} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="jovenes-book-time" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>Hora</label>
            <DateField kind="time" size="lg" id="jovenes-book-time" value={f.time} onChange={(e) => onPatch({ time: e.target.value })} />
          </div>
          <label className="block">
            <span className={HAIRLINE_LABEL_CLASS}>Lugar</span>
            <input className={HAIRLINE_INPUT_CLASS} maxLength={120} value={f.place} onChange={(e) => onPatch({ place: e.target.value.replace(/[\r\n\u2028\u2029]/g, " ") })} />
          </label>
        </div>
        <div className="space-y-3">
          <span className={`${HAIRLINE_LABEL_CLASS} block`}>Responsables, en el orden en que rotan</span>
          {f.rotation.map((p, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-6 pt-3 text-right font-body text-[14px] text-ink-dim">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <ResponsableSelect value={p} onChange={(v) => setRotation(i, v)} people={members} ariaLabel={`Responsable ${i + 1}`} />
              </div>
              {f.rotation.length > 1 && (
                <Button variant="ghost" size="sm" className="mt-1.5" aria-label={`Quitar responsable ${i + 1}`} onClick={() => onPatch({ rotation: f.rotation.filter((_, j) => j !== i) })}>
                  Quitar
                </Button>
              )}
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => onPatch({ rotation: [...f.rotation, { member: null, name: null }] })}>
            <PlusIcon size={13} />
            Agregar responsable
          </Button>
        </div>
        <PublishedSwitch id="jovenes-book-published" checked={f.published} onChange={(published) => onPatch({ published })} />
      </fieldset>
      {rows.length > 0 && (
        <div>
          <span className={`${HAIRLINE_LABEL_CLASS} mb-2 block`}>
            Se crearán {rows.length} {rows.length === 1 ? "clase" : "clases"} (máximo {MAX_NEW_CLASSES})
          </span>
          <ol className="max-h-48 space-y-1 overflow-y-auto font-body text-[14px] text-ink-muted">
            {rows.map((r, i) => (
              <li key={i} className={i < dialog.created ? "text-positive-strong" : ""}>
                {dayWords(r.date)} · <span className="text-ink">{r.title}</span> · {r.responsable.name ?? members.find((m) => m.id === r.responsable.member)?.name ?? "Sin responsable"}
              </li>
            ))}
          </ol>
        </div>
      )}
      {error && <CueDialogStatus tone="error">{error}</CueDialogStatus>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="lg" onClick={onClose} disabled={busy}>{dialog.frozen ? "Cerrar" : "Cancelar"}</Button>
        <Button variant="primary" size="lg" onClick={onCreate} busy={busy} busyLabel="Creando…">
          {dialog.frozen ? "Reintentar" : "Crear clases"}
        </Button>
      </div>
    </div>
  );
}
