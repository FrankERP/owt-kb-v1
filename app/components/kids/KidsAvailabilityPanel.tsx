"use client";

import { useEffect, useRef, useState } from "react";
import Select from "@/app/components/ui/Select";
import Button from "@/app/components/ui/Button";
import DateField from "@/app/components/ui/DateField";
import { useToast } from "@/app/components/ui/Toast";

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

const DAYS_ES = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

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
 * same way `AvailabilityGrid` does — the cell VALUES are composed as strings
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
  const { toast, dismiss } = useToast();
  // The 409 conflict message is `hold: true` (see `save`'s doc comment below) —
  // `Toast.tsx` only auto-replaces a toast carrying the SAME message text, so a
  // held conflict from a previous attempt would otherwise sit on screen forever,
  // including beside a later save's own success toast. Track its id and dismiss
  // it explicitly: at the start of the next save (a fresh attempt supersedes the
  // warning about the last one) and on unmount (a navigation away must not leave
  // it parked in the stack).
  const heldConflictId = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (heldConflictId.current) dismiss(heldConflictId.current);
    };
  }, [dismiss]);

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
    if (heldConflictId.current) {
      dismiss(heldConflictId.current);
      heldConflictId.current = null;
    }
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
        heldConflictId.current = toast({
          message: `La disponibilidad de ${displayName(selected)} cambió mientras editabas — tus cambios NO se guardaron. La lista ya muestra las fechas actuales: vuelve a marcarlas y guarda otra vez.`,
          tone: "error",
          hold: true,
        });
        return;
      }
      if (!res.ok) throw new Error(`respuesta ${res.status}`);
      adopt(selected._id, (await res.json()) as ServerState);
      toast({ message: `Disponibilidad de ${displayName(selected)} guardada.`, tone: "ok" });
    } catch (err) {
      // `dirty` stays true on failure: the edits are still unsaved and the
      // button must keep saying so.
      toast({ message: `No se pudo guardar — ${errText(err)}`, tone: "error" });
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
          <Select
            id="kids-availability-member"
            label="Miembro"
            value={selectedId}
            onChange={(e) => selectMember(e.target.value)}
            disabled={saving}
          >
            {members.map((member) => (
              <option key={member._id} value={member._id} className="bg-surface-base">
                {displayName(member)}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="primary"
          size="lg"
          onClick={save}
          disabled={saving || !dirty}
          busy={saving}
          busyLabel="Guardando…"
        >
          {dirty ? "Guardar •" : "Guardar"}
        </Button>
      </div>

      {dirty && !saving && (
        <p className="font-label text-[11px] uppercase tracking-widest text-warning-strong">
          Cambios sin guardar
        </p>
      )}

      <div className="rounded-xl border border-accent/15 bg-surface-accent-wash p-4">
        <div className="mb-3 flex items-center justify-center">
          <DateField
            kind="month"
            aria-label="Mes"
            disabled={saving}
            value={`${cursor.year}-${String(cursor.month).padStart(2, "0")}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              if (y && m) setCursor({ year: y, month: m });
            }}
            onStep={(d) => setCursor((c) => shiftYearMonth(c.year, c.month, d))}
          />
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
              <Button
                key={date}
                variant="pill"
                tone="availability"
                size="sm"
                active={marked}
                disabled={saving}
                onClick={() => toggleDate(date)}
                className="min-h-[44px] w-full justify-center sm:min-h-0"
              >
                {dayNumber}
              </Button>
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
