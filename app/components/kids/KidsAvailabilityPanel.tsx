"use client";

import { useState } from "react";
import { useTransientValue } from "@/app/utils/useTransientValue";

export interface AvailabilityMember {
  _id: string;
  /** The revision this snapshot was read at — the save's `ifRevisionId` guard. */
  _rev: string;
  member_name: string;
  alias?: string;
  unavailableDates: string[];
  unavailabilityNotes?: { date: string; note: string }[];
}

interface Props {
  initialMembers: AvailabilityMember[];
}

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DAYS_ES = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

type Toast = { kind: "ok" | "error"; text: string } | null;

/** What the PATCH reports as the member's stored state — on 200 and on 409 alike. */
interface ServerState {
  _rev: string | null;
  unavailableDates: string[];
  unavailabilityNotes: { date: string; note: string }[];
}

const errText = (err: unknown) => (err instanceof Error ? err.message : "error desconocido");

const displayName = (member: AvailabilityMember) => member.alias?.trim() || member.member_name;

const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/**
 * A month grid, Monday-first, with leading blanks. Built from local `Date`s the
 * same way `AvailabilityCalendar` does — the cell VALUES are composed as strings
 * (never `toISOString`), so no cell can drift a day.
 */
export function monthCells(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (string | null)[] = Array((firstDay + 6) % 7).fill(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(iso(year, month, day));
  return cells;
}

/** `YYYY-MM` shifted by whole months, on the string — no `Date` in the path. */
export function shiftYearMonth(year: number, month: number, delta: number) {
  const zeroBased = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(zeroBased / 12);
  return { year: nextYear, month: zeroBased - nextYear * 12 + 1 };
}

/**
 * A Kids manager records a volunteer's absences on their behalf — the volunteer's
 * own `/me` panel writes the same two fields and is untouched by this one.
 *
 * The PATCH replaces BOTH arrays wholesale, so the editor holds the member's
 * ENTIRE set of dates (not just the visible month) and sends all of it. Sending
 * only the month on screen would silently delete every absence outside it.
 *
 * That is also why every save carries the `_rev` this snapshot was read at. The
 * panel opens once and can sit open for hours while the member marks their own
 * absences at `/me`; a wholesale write from a stale snapshot would delete them
 * with a success toast. On the resulting 409 the panel adopts the server's
 * arrays — it does NOT keep the pending edits and retry, because retrying the
 * same stale set against a fresh revision is the very deletion the guard just
 * stopped. The manager redoes the toggle against real state, which is why the
 * conflict message is HELD rather than flashed: it reports a write that did not
 * land, and it must outlive the five seconds a toast gets.
 */
export default function KidsAvailabilityPanel({ initialMembers }: Props) {
  const [members, setMembers] = useState<AvailabilityMember[]>(initialMembers);
  const [selectedId, setSelectedId] = useState<string>(initialMembers[0]?._id ?? "");
  const [dates, setDates] = useState<Set<string>>(
    () => new Set(initialMembers[0]?.unavailableDates ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, showToast, , holdToast] = useTransientValue<Toast>(null, 5000);

  // "Today" is Mexico City's day, not the device's — the calendar opens on the
  // month the team is living in even from a browser an ocean away.
  const todayIso = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const [cursor, setCursor] = useState(() => ({
    year: Number(todayIso.slice(0, 4)),
    month: Number(todayIso.slice(5, 7)),
  }));

  const selected = members.find((member) => member._id === selectedId) ?? null;

  function selectMember(id: string) {
    const member = members.find((m) => m._id === id);
    setSelectedId(id);
    setDates(new Set(member?.unavailableDates ?? []));
    setDirty(false);
  }

  function toggleDate(date: string) {
    setDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    setDirty(true);
  }

  /** Adopt the server's state for one member — the save's reply or a 409's. */
  function adopt(id: string, server: ServerState) {
    setMembers((prev) =>
      prev.map((member) =>
        member._id === id
          ? {
              ...member,
              _rev: server._rev ?? member._rev,
              unavailableDates: server.unavailableDates,
              unavailabilityNotes: server.unavailabilityNotes,
            }
          : member,
      ),
    );
    setDates(new Set(server.unavailableDates));
    setDirty(false);
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const kept = Array.from(dates).sort();
      const keptSet = new Set(kept);
      const notes = (selected.unavailabilityNotes ?? []).filter((note) => keptSet.has(note.date));
      const res = await fetch(`/api/kids/members/${selected._id}/availability`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _rev: selected._rev,
          unavailableDates: kept,
          unavailabilityNotes: notes,
        }),
      });
      if (res.status === 409) {
        const current = (await res.json()) as ServerState;
        adopt(selected._id, current);
        holdToast({
          kind: "error",
          text: `La disponibilidad de ${displayName(selected)} cambió mientras editabas — tus cambios NO se guardaron. La lista ya muestra las fechas actuales: vuelve a marcarlas y guarda otra vez.`,
        });
        return;
      }
      if (!res.ok) throw new Error(`respuesta ${res.status}`);
      adopt(selected._id, (await res.json()) as ServerState);
      showToast({ kind: "ok", text: `Disponibilidad de ${displayName(selected)} guardada.` });
    } catch (err) {
      // `dirty` stays true on failure: the edits are still unsaved and the
      // button must keep saying so.
      showToast({ kind: "error", text: `No se pudo guardar — ${errText(err)}` });
    } finally {
      setSaving(false);
    }
  }

  if (members.length === 0) {
    return (
      <p className="font-body text-sm text-mono-500">
        Todavía no hay miembros de Oasis Kids.
      </p>
    );
  }

  const cells = monthCells(cursor.year, cursor.month);
  const upcoming = Array.from(dates)
    .filter((date) => date >= todayIso)
    .sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <label
            htmlFor="kids-availability-member"
            className="block font-label text-[11px] uppercase tracking-widest text-mono-500"
          >
            Miembro
          </label>
          <select
            id="kids-availability-member"
            value={selectedId}
            onChange={(e) => selectMember(e.target.value)}
            disabled={saving}
            className="rounded-lg border border-surface-accent-l40-d20 bg-surface-lift/5 px-3 py-2 font-body text-sm text-ink focus:border-accent/50 focus:outline-none disabled:opacity-40 dark:focus:border-surface-accent-l40-d20"
          >
            {members.map((member) => (
              <option key={member._id} value={member._id} className="bg-surface-base">
                {displayName(member)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="min-h-[44px] rounded-lg bg-surface-accent-solid px-4 font-label text-xs uppercase tracking-widest text-on-fill transition-colors disabled:opacity-40"
        >
          {saving ? "Guardando…" : dirty ? "Guardar •" : "Guardar"}
        </button>
      </div>

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

      {dirty && !saving && (
        <p className="font-label text-[11px] uppercase tracking-widest text-warning-strong">
          Cambios sin guardar
        </p>
      )}

      <div className="rounded-xl border border-accent/15 bg-surface-accent-wash p-4">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCursor((c) => shiftYearMonth(c.year, c.month, -1))}
            aria-label="Mes anterior"
            className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-[11px] uppercase tracking-widest text-mono-500 transition-colors hover:text-accent"
          >
            ←
          </button>
          <span className="font-label text-[11px] uppercase tracking-widest text-accent">
            {MONTHS_ES[cursor.month - 1]} {cursor.year}
          </span>
          <button
            type="button"
            onClick={() => setCursor((c) => shiftYearMonth(c.year, c.month, 1))}
            aria-label="Mes siguiente"
            className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-[11px] uppercase tracking-widest text-mono-500 transition-colors hover:text-accent"
          >
            →
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7 gap-0.5">
          {DAYS_ES.map((day) => (
            <div
              key={day}
              className="py-0.5 text-center font-label text-[10px] uppercase tracking-widest text-mono-400"
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((date, index) => {
            if (!date) return <div key={`blank-${index}`} />;
            const marked = dates.has(date);
            const dayNumber = Number(date.slice(8, 10));
            return (
              <button
                key={date}
                type="button"
                onClick={() => toggleDate(date)}
                disabled={saving}
                aria-pressed={marked}
                className={`min-h-[44px] rounded text-center font-body text-xs transition-colors sm:min-h-0 sm:py-1 ${
                  marked
                    ? "border border-availability-fg/50 bg-availability-fg/30 text-availability-soft"
                    : "text-mono-300 hover:bg-accent/10 hover:text-accent"
                }`}
              >
                {dayNumber}
              </button>
            );
          })}
        </div>
      </div>

      <p className="font-body text-xs text-mono-500">
        {upcoming.length === 0
          ? "Sin fechas próximas marcadas como no disponible."
          : `${upcoming.length} fecha(s) próxima(s) marcada(s) como no disponible.`}
      </p>
    </div>
  );
}
