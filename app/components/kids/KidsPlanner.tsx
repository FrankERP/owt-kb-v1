"use client";

import { useCallback, useMemo, useState } from "react";
import { buildPlannerView, type PlannerView } from "@/app/utils/kidsPlannerView";
import {
  KIDS_SEAT_LABELS,
  type KidsAssignment,
  type KidsRoom,
  type KidsSeat,
  type RotationDiagnostic,
  type RotationPair,
  type RotationResult,
  type RotationWarning,
} from "@/app/utils/kidsTypes";
import { useTransientValue } from "@/app/utils/useTransientValue";
import { KidsRotationBoard, type DragSource } from "./KidsRotationBoard";
import { KidsSundayCards } from "./KidsSundayCards";
import { SeatPicker } from "./SeatPicker";
import { canPlace, HISTORY_MONTHS } from "./kidsPlannerLabels";
import type { KidsSundayState } from "./kidsBoardProps";

// ─── Shapes the page hands down (mirrors what /api/kids/* answers) ────────────

export interface PlannerPair {
  id: string;
  name: string;
  room: KidsRoom;
  active: boolean;
  memberIds: string[];
}

export interface PlannerMember {
  _id: string;
  member_name: string;
  alias?: string;
  unavailableDates: string[];
}

export interface PlannerSchedule {
  date: string;
  seats: Partial<Record<KidsSeat, string>>;
  published: boolean;
}

interface Props {
  initialMonth: string; // YYYY-MM, already resolved in America/Mexico_City
  initialPairs: PlannerPair[];
  initialMembers: PlannerMember[];
  initialSchedules: PlannerSchedule[];
  /**
   * Sundays BEFORE the visible month. Not decoration: every "hace 3 semanas" and
   * every "le toca" is measured from it, so without it the board opens claiming
   * that all twelve pairs have never served.
   */
  initialHistory?: PlannerSchedule[];
}

// ─── Pure helpers (exported for the unit tests) ───────────────────────────────

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * The Sundays of a month, via the UTC-noon anchor the generate route and the home
 * page's weekend helpers use: a date pinned to 12:00 UTC has no local-midnight
 * edge to fall off, so `getUTCDay()` answers for the calendar day the string
 * names whatever the browser's timezone is. `new Date("2026-09-06")` would not.
 */
export function sundaysOfMonth(month: string): string[] {
  const [year, monthIndex] = month.split("-").map(Number);
  const sundays: string[] = [];
  for (let day = 1; day <= 31; day++) {
    const anchor = new Date(Date.UTC(year, monthIndex - 1, day, 12));
    if (anchor.getUTCMonth() !== monthIndex - 1) break; // rolled into the next month
    if (anchor.getUTCDay() === 0) sundays.push(anchor.toISOString().slice(0, 10));
  }
  return sundays;
}

/** Month arithmetic on the string, so no `Date` can flip a day underneath it. */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const zeroBased = year * 12 + (monthIndex - 1) + delta;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = zeroBased - nextYear * 12 + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return `${MONTHS_ES[monthIndex - 1]} ${year}`;
}

/** Local noon, per the repo's timezone invariant — never a bare `new Date(iso)`. */
export function formatSunday(iso: string): string {
  const label = new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The months whose saved Sundays feed the wait clocks, most recent first. */
export function historyMonthsFor(month: string): string[] {
  return Array.from({ length: HISTORY_MONTHS }, (_, i) => shiftMonth(month, -(i + 1)));
}

// ─── Component ────────────────────────────────────────────────────────────────

type Toast = { kind: "ok" | "error"; text: string } | null;

const errText = (err: unknown) => (err instanceof Error ? err.message : "error desconocido");

const displayName = (member: PlannerMember) => member.alias?.trim() || member.member_name;

const asMap = (rows: PlannerSchedule[]): Record<string, PlannerSchedule> =>
  Object.fromEntries(rows.map((row) => [row.date, row]));

/**
 * The Kids planner.
 *
 * WHAT CHANGED, AND WHY IT IS NOT COSMETIC. This surface used to be a `<select>`
 * per seat — sixteen dropdowns for a four-Sunday month. A dropdown lists names in
 * arbitrary order and can show exactly one fact: the name. The three facts a
 * rotation tool exists for — who is overdue, who is away that Sunday and why,
 * which Sunday nobody can cover — were all invisible, which is another way of
 * saying the tool was worth about as much as a shell script.
 *
 * So the reads all come from `buildPlannerView` (pure, tested, and the ONLY place
 * any of it is derived), and this component spends its budget on showing them:
 * a drag-and-drop board on desktop, tappable Sunday cards on the phone, and a
 * bench per room ordered longest-waiting first.
 *
 * The WRITES are untouched — same endpoints, same debounce-free "nothing reaches
 * Sanity until Guardar or Publicar" contract, same per-Sunday publish.
 */
export default function KidsPlanner({
  initialMonth,
  initialPairs,
  initialMembers,
  initialSchedules,
  initialHistory = [],
}: Props) {
  const [month, setMonth] = useState(initialMonth);
  const [pairs, setPairs] = useState<PlannerPair[]>(initialPairs);
  const [members, setMembers] = useState<PlannerMember[]>(initialMembers);
  const [schedules, setSchedules] = useState<Record<string, PlannerSchedule>>(() =>
    asMap(initialSchedules),
  );
  const [history, setHistory] = useState<PlannerSchedule[]>(initialHistory);
  // Which Sundays already exist as documents — an untouched, seatless Sunday must
  // not be created in Sanity just because "Guardar borradores" swept the month.
  const [stored, setStored] = useState<Set<string>>(
    () => new Set(initialSchedules.map((row) => row.date)),
  );

  const [warnings, setWarnings] = useState<RotationWarning[]>([]);
  const [diagnostics, setDiagnostics] = useState<RotationDiagnostic[]>([]);

  // "Otra opción" state. The engine is deterministic on purpose, so a second
  // proposal has to be ASKED for by seed; `rejected` carries the fingerprints of
  // every month already shown for this month so the server can skip past them
  // instead of cycling back to one the admin just turned down.
  const [option, setOption] = useState(0); // 0 = nothing proposed yet
  const [nextSeed, setNextSeed] = useState(1);
  const [rejected, setRejected] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  const [loadingMonth, setLoadingMonth] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ date: string; seat: KidsSeat } | null>(null);

  const [toast, showToast] = useTransientValue<Toast>(null, 5000);

  const sundays = useMemo(() => sundaysOfMonth(month), [month]);

  const view: PlannerView = useMemo(() => {
    const unavailable: Record<string, string[]> = {};
    for (const member of members) unavailable[member._id] = member.unavailableDates ?? [];

    const memberNames: Record<string, string> = {};
    for (const member of members) memberNames[member._id] = displayName(member);

    // A pair that is not exactly two people cannot be seated by the engine and has
    // no meaningful availability — it is dropped from the POOL here, exactly as the
    // old dropdown dropped it, while `pairName` below still resolves its name so a
    // seat already holding it never renders blank.
    const viewPairs: (RotationPair & { active: boolean })[] = pairs
      .filter((pair) => pair.memberIds.length === 2)
      .map((pair) => ({
        id: pair.id,
        name: pair.name,
        room: pair.room,
        memberIds: [pair.memberIds[0], pair.memberIds[1]],
        active: pair.active,
      }));

    const assignments: KidsAssignment[] = sundays.map((date) => ({
      date,
      seats: schedules[date]?.seats ?? {},
    }));

    // The generator's worship warnings ARE the overlap facts, one row per member,
    // so they fold straight back into the view's input rather than being rendered
    // as a second list underneath the board. Before "Generar mes" there are none,
    // and the board simply shows no amber marks — which is honest: nothing has
    // been checked yet.
    const worshipAssignments: Record<string, string[]> = {};
    for (const warning of warnings) {
      (worshipAssignments[warning.date] ??= []).push(warning.memberId);
    }

    return buildPlannerView({
      sundays,
      pairs: viewPairs,
      assignments,
      unavailable,
      memberNames,
      history: history
        .filter((row) => row.date < `${month}-01`)
        .map((row) => ({ date: row.date, seats: row.seats }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      worshipAssignments,
    });
  }, [members, pairs, sundays, schedules, history, month, warnings]);

  const seatIndex = useMemo(() => {
    const index = new Map<string, (typeof view.seats)[number]>();
    for (const seatView of view.seats) index.set(`${seatView.date}::${seatView.seat}`, seatView);
    return index;
  }, [view]);

  const seatOf = useCallback(
    (date: string, seat: KidsSeat) => seatIndex.get(`${date}::${seat}`)!,
    [seatIndex],
  );

  const pairName = useCallback(
    (id: string) => pairs.find((pair) => pair.id === id)?.name ?? "Pareja",
    [pairs],
  );

  const noteFor = useCallback(
    (date: string, seat: KidsSeat): string | null => {
      const seatView = seatOf(date, seat);
      if (seatView?.unfillableReason) return seatView.unfillableReason;
      // The engine's own `reason` interpolates the raw ISO date, which the column
      // header already renders in Spanish — so the seat says only what it must.
      const diagnostic = diagnostics.find((d) => d.date === date && d.seat === seat);
      return diagnostic ? "El generador no pudo llenar este lugar." : null;
    },
    [diagnostics, seatOf],
  );

  const sundayStates: KidsSundayState[] = useMemo(
    () =>
      sundays.map((date) => ({
        date,
        label: formatSunday(date),
        published: schedules[date]?.published ?? false,
        filled: Object.keys(schedules[date]?.seats ?? {}).length,
        publishing: busyDate === date,
      })),
    [sundays, schedules, busyDate],
  );

  const loadMonth = useCallback(
    async (next: string) => {
      setLoadingMonth(true);
      try {
        // The three preceding months ride along on the SAME endpoint the month
        // itself uses — no new API surface, and the wait clocks are real from the
        // first paint rather than after a second round trip.
        const [schedRes, pairsRes, membersRes, ...historyRes] = await Promise.all([
          fetch(`/api/kids/schedules?month=${next}`),
          fetch("/api/kids/pairs"),
          fetch("/api/kids/members"),
          ...historyMonthsFor(next).map((m) => fetch(`/api/kids/schedules?month=${m}`)),
        ]);
        if (!schedRes.ok || !pairsRes.ok || !membersRes.ok) {
          throw new Error(`respuesta ${schedRes.status}/${pairsRes.status}/${membersRes.status}`);
        }
        const rows = (await schedRes.json()) as PlannerSchedule[];
        setPairs((await pairsRes.json()) as PlannerPair[]);
        setMembers((await membersRes.json()) as PlannerMember[]);

        const past: PlannerSchedule[] = [];
        for (const res of historyRes) {
          if (!res.ok) continue;
          past.push(...((await res.json()) as PlannerSchedule[]));
        }
        setHistory(past);

        setSchedules(asMap(rows));
        setStored(new Set(rows.map((row) => row.date)));
        setWarnings([]);
        setDiagnostics([]);
        setDirty(false);
        setMonth(next);

        // Options belong to the month that produced them: carrying a rejected
        // fingerprint across would make the new month's first alternative skip a
        // plan nobody has seen.
        setOption(0);
        setNextSeed(1);
        setRejected([]);

        // A failed history read is NOT a failed month: the board is correct, only
        // the clocks are blind, and they would read "nunca" — a confident wrong
        // answer. So it is said out loud rather than swallowed.
        if (historyRes.some((res) => !res.ok)) {
          showToast({
            kind: "error",
            text: "El mes se cargó, pero no su historial: las esperas pueden leerse como «nunca».",
          });
        }
      } catch (err) {
        // The month stays where it was: moving the label while the data below it
        // belongs to another month is the one failure mode worth avoiding here.
        showToast({ kind: "error", text: `No se pudo cargar el mes — ${errText(err)}` });
      } finally {
        setLoadingMonth(false);
      }
    },
    [showToast],
  );

  /**
   * `mode: "fresh"` is «Generar mes» — always seed 0, the strictly fairest
   * arrangement, and it forgets what came before. `mode: "alternative"` is «Otra
   * opción»: it asks the server to search past every plan already shown for this
   * month, so clicking twice cannot land on the same board.
   */
  async function generate(mode: "fresh" | "alternative" = "fresh") {
    setGenerating(true);
    try {
      const res = await fetch("/api/kids/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "fresh"
            ? { month, seed: 0, exclude: [] }
            : { month, seed: nextSeed, exclude: rejected },
        ),
      });
      if (!res.ok) throw new Error(`respuesta ${res.status}`);
      const result = (await res.json()) as RotationResult & {
        seed: number;
        fingerprint: string | null;
        exhausted: boolean;
      };

      // Nothing new to show. Leave the board exactly as it is — redrawing it with
      // a month already rejected is indistinguishable from the button not working.
      if (result.exhausted) {
        // Adopt the resume point so a second ask searches PAST the exhausted
        // window rather than re-testing it — otherwise one exhausted answer
        // kills the button for the rest of the session.
        if (Number.isFinite(result.seed)) setNextSeed(result.seed);
        showToast({
          kind: "error",
          text: "No hay más opciones distintas por ahora. Mueve una pareja a mano, cambia disponibilidades o inténtalo otra vez.",
        });
        return;
      }

      setSchedules((prev) => {
        const next = { ...prev };
        for (const assignment of result.proposal) {
          next[assignment.date] = {
            date: assignment.date,
            seats: assignment.seats,
            // The proposal never publishes: an already-published Sunday keeps its
            // flag, and nothing reaches Sanity until Guardar or Publicar.
            published: prev[assignment.date]?.published ?? false,
          };
        }
        return next;
      });
      setWarnings(result.warnings);
      setDiagnostics(result.diagnostics);
      setDirty(true);

      // Functional form, matching `setRejected` below: the two must agree about
      // how many options have been shown, or two different boards both read
      // «Opción 2».
      setOption((prev) => (mode === "fresh" ? 1 : prev + 1));
      // The server may have skipped several seeds to find something new; resume
      // from the one it landed on so the next ask does not retrace them. A
      // response without a usable seed must not poison the cursor with NaN —
      // that serialises as `null`, reads back as seed 0, and would redraw the
      // fairest month while announcing a new option.
      if (Number.isFinite(result.seed)) setNextSeed(result.seed + 1);
      setRejected((prev) => {
        const base = mode === "fresh" ? [] : prev;
        return result.fingerprint ? [...base, result.fingerprint] : base;
      });

      showToast({
        kind: "ok",
        text:
          mode === "fresh"
            ? "Propuesta lista. Revísala y guarda los borradores."
            : "Otra opción lista. Si no te convence, pide una más.",
      });
    } catch (err) {
      showToast({ kind: "error", text: `No se pudo generar el mes — ${errText(err)}` });
    } finally {
      setGenerating(false);
    }
  }

  /** Set or clear ONE seat. The picker's only write, on both layouts. */
  function chooseSeat(date: string, seat: KidsSeat, pairId: string | null) {
    setSchedules((prev) => {
      const row = prev[date] ?? { date, seats: {}, published: false };
      const seats = { ...row.seats };
      if (pairId) seats[seat] = pairId;
      else delete seats[seat];
      return { ...prev, [date]: { ...row, seats } };
    });
    // The diagnostic for this seat described the generated proposal, not the
    // admin's override — leaving it up would accuse a filled seat of being empty.
    setDiagnostics((prev) => prev.filter((d) => !(d.date === date && d.seat === seat)));
    setDirty(true);
  }

  /**
   * A drag that landed. Refused rather than silently corrected when the target
   * blocks the pair — the server refuses it too, and bouncing off a 400 is how
   * the old surface taught its rules.
   *
   * Dropping onto an OCCUPIED cell replaces the occupant, which is safe here in a
   * way it would not be on the worship grid: a Kids pair's home is the bench, so
   * a displaced pair is not lost, it is simply back in the pool it came from.
   */
  function movePair(source: DragSource, to: { date: string; seat: KidsSeat }) {
    if (source.from && source.from.date === to.date && source.from.seat === to.seat) return;

    const verdict = canPlace(seatOf(to.date, to.seat), source.pairId, source.from);
    if (!verdict.ok) {
      showToast({
        kind: "error",
        text: `${pairName(source.pairId)} no puede tomar ${KIDS_SEAT_LABELS[to.seat]}: ${verdict.reason.toLowerCase()}.`,
      });
      return;
    }

    const from = source.from;
    setSchedules((prev) => {
      const next = { ...prev };
      const edit = (date: string, mutate: (seats: Partial<Record<KidsSeat, string>>) => void) => {
        const row = next[date] ?? { date, seats: {}, published: false };
        const seats = { ...row.seats };
        mutate(seats);
        next[date] = { ...row, seats };
      };
      if (from) edit(from.date, (seats) => delete seats[from.seat]);
      edit(to.date, (seats) => {
        seats[to.seat] = source.pairId;
      });
      return next;
    });
    setDiagnostics((prev) =>
      prev.filter(
        (d) =>
          !(d.date === to.date && d.seat === to.seat) &&
          !(from !== null && d.date === from.date && d.seat === from.seat),
      ),
    );
    setDirty(true);
  }

  async function saveDrafts() {
    setSaving(true);
    const failed: string[] = [];
    const saved: string[] = [];
    try {
      for (const date of sundays) {
        const seats = schedules[date]?.seats ?? {};
        // Nothing to say about this Sunday and no document to correct: skip it
        // rather than mint an empty `kidsSchedule`.
        if (Object.keys(seats).length === 0 && !stored.has(date)) continue;
        try {
          const res = await fetch("/api/kids/schedules", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date, seats }),
          });
          if (!res.ok) failed.push(date);
          else saved.push(date);
        } catch {
          failed.push(date);
        }
      }
      if (saved.length > 0) setStored((prev) => new Set([...prev, ...saved]));
      if (failed.length > 0) {
        showToast({
          kind: "error",
          text: `No se guardaron ${failed.length} domingo(s): ${failed.map(formatSunday).join(", ")}.`,
        });
      } else {
        setDirty(false);
        showToast({ kind: "ok", text: `Borradores guardados (${saved.length} domingo(s)).` });
      }
    } finally {
      setSaving(false);
    }
  }

  async function setPublished(date: string, next: boolean) {
    setBusyDate(date);
    try {
      const seats = schedules[date]?.seats ?? {};
      const res = await fetch("/api/kids/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, seats, published: next }),
      });
      if (!res.ok) throw new Error(`respuesta ${res.status}`);
      setSchedules((prev) => ({
        ...prev,
        [date]: { date, seats, published: next },
      }));
      setStored((prev) => new Set([...prev, date]));
      showToast({
        kind: "ok",
        text: next ? "Domingo publicado — ya es visible en /kids." : "Domingo vuelto a borrador.",
      });
    } catch (err) {
      showToast({
        kind: "error",
        text: `No se pudo ${next ? "publicar" : "despublicar"} — ${errText(err)}`,
      });
    } finally {
      setBusyDate(null);
    }
  }

  const busy = loadingMonth || generating || saving || busyDate !== null;

  const boardProps = {
    sundays: sundayStates,
    seatOf,
    pairName,
    monthLoad: view.monthLoad,
    noteFor,
    busy,
    onOpenSeat: (date: string, seat: KidsSeat) => setPicking({ date, seat }),
    onTogglePublish: setPublished,
  };

  const pickingView = picking ? seatOf(picking.date, picking.seat) : null;

  return (
    <div className="space-y-5">
      {/* Month picker + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadMonth(shiftMonth(month, -1))}
            disabled={busy}
            aria-label="Mes anterior"
            className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest text-mono-500 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            ←
          </button>
          <span className="min-w-[160px] text-center font-display text-lg uppercase tracking-wide text-ink">
            {monthLabel(month)}
          </span>
          <button
            type="button"
            onClick={() => loadMonth(shiftMonth(month, 1))}
            disabled={busy}
            aria-label="Mes siguiente"
            className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest text-mono-500 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            →
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => generate("fresh")}
            disabled={busy}
            className="min-h-[44px] rounded-lg border border-accent/30 px-4 font-label text-xs uppercase tracking-widest text-accent transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            {generating ? "Generando…" : "Generar mes"}
          </button>
          {option > 0 && (
            <button
              type="button"
              onClick={() => generate("alternative")}
              disabled={busy}
              className="min-h-[44px] rounded-lg border border-mono-300 px-4 font-label text-xs uppercase tracking-widest text-ink-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            >
              Otra opción
            </button>
          )}
          {option > 0 && (
            <span className="font-label text-[11px] uppercase tracking-widest text-ink-muted">
              Opción {option}
            </span>
          )}
          <button
            type="button"
            onClick={saveDrafts}
            disabled={busy || !dirty}
            className="min-h-[44px] rounded-lg bg-surface-accent-solid px-4 font-label text-xs uppercase tracking-widest text-on-fill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            {saving ? "Guardando…" : "Guardar borradores"}
          </button>
        </div>
      </div>

      <p className="font-body text-xs text-mono-500">
        «Generar mes» y «Otra opción» solo proponen: <strong>ambas reemplazan todo lo que ves en
        pantalla</strong>, incluidos los cambios que hayas hecho a mano, y nada llega a Sanity hasta
        que guardas o publicas. Publicar un domingo también guarda sus parejas. «Generar mes» siempre
        da el reparto más justo; «Otra opción» acomoda distinto a las parejas que llevan un descanso
        parecido, y solo repite a la que sirvió el domingo pasado cuando no queda nadie más
        disponible en esa sala.
      </p>

      {dirty && !saving && (
        <p className="font-label text-[11px] uppercase tracking-widest text-warning-strong">
          Cambios sin guardar
        </p>
      )}

      {toast && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-2 font-body text-sm ${
            toast.kind === "ok"
              ? "border-positive-deep/25 bg-positive-deep/5 text-positive-strong"
              : "border-negative-strong/25 bg-negative-strong/5 text-negative-fg"
          }`}
        >
          {toast.text}
        </p>
      )}

      {loadingMonth ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl bg-surface-accent-wash motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : sundays.length === 0 ? (
        <p className="py-10 text-center font-body text-sm text-mono-500">
          Este mes no tiene domingos que planear.
        </p>
      ) : (
        <>
          <KidsRotationBoard
            {...boardProps}
            bench={view.bench}
            onMove={movePair}
          />
          <KidsSundayCards {...boardProps} />
        </>
      )}

      {picking && pickingView && (
        <SeatPicker
          seatView={pickingView}
          seatLabel={KIDS_SEAT_LABELS[picking.seat]}
          dateLabel={formatSunday(picking.date)}
          monthLoad={view.monthLoad}
          assignedName={pickingView.assignedPairId ? pairName(pickingView.assignedPairId) : null}
          onChoose={(pairId) => {
            chooseSeat(picking.date, picking.seat, pairId);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
