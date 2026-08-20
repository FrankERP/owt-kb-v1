"use client";

import { useCallback, useState } from "react";
import { pairUnavailable } from "@/app/utils/kidsRotation";
import {
  KIDS_SEATS,
  KIDS_SEAT_LABELS,
  type KidsRoom,
  type KidsSeat,
  type RotationDiagnostic,
  type RotationPair,
  type RotationResult,
  type RotationWarning,
} from "@/app/utils/kidsTypes";
import { useTransientValue } from "@/app/utils/useTransientValue";

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

const asRotationPair = (pair: PlannerPair): RotationPair => ({
  id: pair.id,
  name: pair.name,
  room: pair.room,
  memberIds: [pair.memberIds[0], pair.memberIds[1]],
});

export interface SeatOption {
  id: string;
  label: string;
  disabled: boolean;
}

/**
 * The options one seat offers on one Sunday.
 *
 * The pool is the seat's own (every active pair for enseñanza, that room's pairs
 * for a room seat), and an option is DISABLED rather than hidden when the pair is
 * unavailable or already sitting in another seat that Sunday — the planner should
 * show why a pair is not pickable, and the server refuses both cases anyway.
 * Availability is judged by `pairUnavailable`, the same function the rotation
 * engine uses; a second copy of "either member is out" would drift from it.
 *
 * A pair that is stored in the seat but no longer belongs to the pool (retired,
 * moved room, or left with a single member) is kept as an option so the select
 * cannot silently drop what Sanity holds.
 */
export function seatOptions(args: {
  seat: KidsSeat;
  pairs: PlannerPair[];
  date: string;
  unavailable: Record<string, string[]>;
  seats: Partial<Record<KidsSeat, string>>;
}): SeatOption[] {
  const { seat, pairs, date, unavailable, seats } = args;
  const current = seats[seat];

  const pool = pairs.filter(
    (pair) =>
      pair.active &&
      pair.memberIds.length === 2 &&
      (seat === "ensenanza" || pair.room === seat),
  );

  const options = pool.map((pair) => {
    const out = pairUnavailable(asRotationPair(pair), date, unavailable);
    const elsewhere = KIDS_SEATS.some((other) => other !== seat && seats[other] === pair.id);
    const suffix = out
      ? " — no disponible"
      : elsewhere
        ? " — ya asignada este domingo"
        : "";
    return { id: pair.id, label: `${pair.name}${suffix}`, disabled: out || elsewhere };
  });

  if (current && !options.some((option) => option.id === current)) {
    const stored = pairs.find((pair) => pair.id === current);
    options.unshift({
      id: current,
      label: `${stored?.name ?? "Pareja"} — fuera de la rotación`,
      disabled: false,
    });
  }

  return options;
}

// ─── Component ────────────────────────────────────────────────────────────────

type Toast = { kind: "ok" | "error"; text: string } | null;

const errText = (err: unknown) => (err instanceof Error ? err.message : "error desconocido");

const displayName = (member: PlannerMember) => member.alias?.trim() || member.member_name;

const asMap = (rows: PlannerSchedule[]): Record<string, PlannerSchedule> =>
  Object.fromEntries(rows.map((row) => [row.date, row]));

export default function KidsPlanner({
  initialMonth,
  initialPairs,
  initialMembers,
  initialSchedules,
}: Props) {
  const [month, setMonth] = useState(initialMonth);
  const [pairs, setPairs] = useState<PlannerPair[]>(initialPairs);
  const [members, setMembers] = useState<PlannerMember[]>(initialMembers);
  const [schedules, setSchedules] = useState<Record<string, PlannerSchedule>>(() =>
    asMap(initialSchedules),
  );
  // Which Sundays already exist as documents — an untouched, seatless Sunday must
  // not be created in Sanity just because "Guardar borradores" swept the month.
  const [stored, setStored] = useState<Set<string>>(
    () => new Set(initialSchedules.map((row) => row.date)),
  );

  const [warnings, setWarnings] = useState<RotationWarning[]>([]);
  const [diagnostics, setDiagnostics] = useState<RotationDiagnostic[]>([]);
  const [dirty, setDirty] = useState(false);

  const [loadingMonth, setLoadingMonth] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyDate, setBusyDate] = useState<string | null>(null);

  const [toast, showToast] = useTransientValue<Toast>(null, 5000);

  const sundays = sundaysOfMonth(month);
  const unavailable: Record<string, string[]> = {};
  for (const member of members) unavailable[member._id] = member.unavailableDates ?? [];
  const memberName = (id: string) => {
    const member = members.find((m) => m._id === id);
    return member ? displayName(member) : "Alguien de la pareja";
  };
  const pairName = (id: string) => pairs.find((pair) => pair.id === id)?.name ?? "Pareja";

  const loadMonth = useCallback(
    async (next: string) => {
      setLoadingMonth(true);
      try {
        const [schedRes, pairsRes, membersRes] = await Promise.all([
          fetch(`/api/kids/schedules?month=${next}`),
          fetch("/api/kids/pairs"),
          fetch("/api/kids/members"),
        ]);
        if (!schedRes.ok || !pairsRes.ok || !membersRes.ok) {
          throw new Error(`respuesta ${schedRes.status}/${pairsRes.status}/${membersRes.status}`);
        }
        const rows = (await schedRes.json()) as PlannerSchedule[];
        setPairs((await pairsRes.json()) as PlannerPair[]);
        setMembers((await membersRes.json()) as PlannerMember[]);
        setSchedules(asMap(rows));
        setStored(new Set(rows.map((row) => row.date)));
        setWarnings([]);
        setDiagnostics([]);
        setDirty(false);
        setMonth(next);
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

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/kids/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      if (!res.ok) throw new Error(`respuesta ${res.status}`);
      const result = (await res.json()) as RotationResult;
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
      showToast({ kind: "ok", text: "Propuesta lista. Revísala y guarda los borradores." });
    } catch (err) {
      showToast({ kind: "error", text: `No se pudo generar el mes — ${errText(err)}` });
    } finally {
      setGenerating(false);
    }
  }

  function chooseSeat(date: string, seat: KidsSeat, pairId: string) {
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
            className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest text-mono-500 transition-colors hover:text-accent disabled:opacity-40"
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
            className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest text-mono-500 transition-colors hover:text-accent disabled:opacity-40"
          >
            →
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="min-h-[44px] rounded-lg border border-accent/30 px-4 font-label text-xs uppercase tracking-widest text-accent transition-colors hover:border-accent disabled:opacity-40"
          >
            {generating ? "Generando…" : "Generar mes"}
          </button>
          <button
            type="button"
            onClick={saveDrafts}
            disabled={busy || !dirty}
            className="min-h-[44px] rounded-lg bg-surface-accent-solid px-4 font-label text-xs uppercase tracking-widest text-on-fill transition-colors disabled:opacity-40"
          >
            {saving ? "Guardando…" : "Guardar borradores"}
          </button>
        </div>
      </div>

      <p className="font-body text-xs text-mono-500">
        «Generar mes» solo propone: reemplaza lo que ves en pantalla y nada llega a Sanity hasta que
        guardas o publicas. Publicar un domingo también guarda sus parejas.
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

      {/* Sundays */}
      {loadingMonth ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-surface-accent-wash" />
          ))}
        </div>
      ) : sundays.length === 0 ? (
        <p className="py-10 text-center font-body text-sm text-mono-500">
          Este mes no tiene domingos que planear.
        </p>
      ) : (
        <div className="space-y-4">
          {sundays.map((date) => {
            const row = schedules[date];
            const seats = row?.seats ?? {};
            const published = row?.published ?? false;
            const dayWarnings = warnings.filter((w) => w.date === date);
            const filled = Object.keys(seats).length;

            return (
              <div
                key={date}
                className="space-y-3 rounded-xl border border-accent/15 bg-surface-accent-wash p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-display text-base uppercase tracking-wide text-ink">
                      {formatSunday(date)}
                    </p>
                    <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                      {filled} de {KIDS_SEATS.length} lugares asignados
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 font-label text-[11px] uppercase tracking-widest ${
                        published
                          ? "bg-positive-deep/10 text-positive-strong"
                          : "bg-surface-sunken text-mono-500"
                      }`}
                    >
                      {published ? "Publicado" : "Borrador"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPublished(date, !published)}
                      disabled={busy || (!published && filled === 0)}
                      title={
                        !published && filled === 0
                          ? "Asigna al menos una pareja antes de publicar"
                          : undefined
                      }
                      className="min-h-[44px] rounded-lg border border-accent/25 px-3 font-label text-xs uppercase tracking-widest text-accent transition-colors hover:border-accent disabled:opacity-40"
                    >
                      {busyDate === date ? "…" : published ? "Despublicar" : "Publicar"}
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {KIDS_SEATS.map((seat) => {
                    const options = seatOptions({ seat, pairs, date, unavailable, seats });
                    const diagnostic = diagnostics.find(
                      (d) => d.date === date && d.seat === seat,
                    );
                    const id = `kids-seat-${date}-${seat}`;
                    return (
                      <div key={seat} className="space-y-1">
                        <label
                          htmlFor={id}
                          className="block font-label text-[11px] uppercase tracking-widest text-mono-500"
                        >
                          {KIDS_SEAT_LABELS[seat]}
                        </label>
                        <select
                          id={id}
                          value={seats[seat] ?? ""}
                          onChange={(e) => chooseSeat(date, seat, e.target.value)}
                          disabled={busy}
                          className="w-full rounded-lg border border-surface-accent-l40-d20 bg-surface-lift/5 px-3 py-2 font-body text-sm text-ink focus:border-accent/50 focus:outline-none dark:focus:border-surface-accent-l40-d20"
                        >
                          <option value="" className="bg-surface-base">
                            — Sin asignar —
                          </option>
                          {options.map((option) => (
                            <option
                              key={option.id}
                              value={option.id}
                              disabled={option.disabled}
                              className="bg-surface-base"
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {diagnostic && (
                          // The engine's `reason` interpolates the raw ISO date, which
                          // this row already renders in Spanish — so the seat says only
                          // what the seat needs to say.
                          <p className="font-body text-xs text-negative-fg">
                            Sin parejas disponibles para este lugar.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {dayWarnings.length > 0 && (
                  <ul className="space-y-1 rounded-lg border border-warning-fg/30 bg-warning-fg/10 px-3 py-2">
                    {dayWarnings.map((warning) => (
                      <li
                        key={`${warning.seat}-${warning.pairId}-${warning.memberId}`}
                        className="font-body text-xs text-warning-soft"
                      >
                        {KIDS_SEAT_LABELS[warning.seat]}: {memberName(warning.memberId)} (
                        {pairName(warning.pairId)}) también sirve en alabanza ese domingo.
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
