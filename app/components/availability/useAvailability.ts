"use client";

import { useEffect, useState } from "react";
import { useTransientValue } from "@/app/utils/useTransientValue";

interface Options {
  /** The revision the page was rendered at — the save's `ifRevisionId` guard. */
  initialRev: string;
  initialDates: string[];
  initialNotes?: { date: string; note: string }[];
  /**
   * Called when a conflict replaces the local edits with the server's arrays.
   *
   * A consumer may have UI pinned to a single date — the grid's note popover —
   * which is now pointing at an entry that can be gone. The hook cannot close
   * that itself, and it must happen in the SAME update as the adoption: closing
   * it from an effect on adopted state leaves one frame where the popover still
   * renders over a dropped date.
   */
  onAdopt?: () => void;
}

/** What the PATCH reports as the member's stored state — on 200 and on 409 alike. */
interface ServerState {
  _rev: string | null;
  unavailableDates: string[];
  unavailabilityNotes: { date: string; note: string }[];
}

export const CONFLICT_MSG =
  "Tu disponibilidad cambió mientras esta página estaba abierta — tus cambios NO se guardaron. " +
  "El calendario ya muestra las fechas actuales: vuelve a marcarlas y guarda otra vez.";

// Stable fingerprint of the saved state, to detect unsaved changes.
function snapshot(dates: Set<string>, notes: Map<string, string>): string {
  const ds = Array.from(dates).sort();
  const ns = Array.from(notes.entries())
    .filter(([d, n]) => dates.has(d) && n.trim())
    .map(([d, n]) => [d, n.trim()] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify([ds, ns]);
}

export interface Availability {
  dates: Set<string>;
  notes: Map<string, string>;
  todayIso: string;
  upcomingCount: number;
  /** Mark the date if it is not marked yet; a no-op (and no `saved` reset) if it is. */
  mark: (iso: string) => void;
  /** Unmark the date and drop its note with it. */
  remove: (iso: string) => void;
  toggle: (iso: string) => void;
  setNote: (iso: string, text: string) => void;
  /** Expand a weekday pattern over the next 12 months and mark (or clear) the run. */
  applyRecurring: (dow: number, interval: number, add: boolean) => void;
  save: () => Promise<void>;
  saving: boolean;
  saved: boolean;
  dirty: boolean;
  saveError: string | null;
  conflict: string | null;
}

/**
 * The member's availability: the edits, the dirty fingerprint, and the
 * revision-guarded save.
 *
 * Lifted out of `AvailabilityCalendar` so a second surface can read and write
 * the same state without a calendar — the grid keeps only its own popover,
 * paging and recurring-panel state.
 */
export function useAvailability({ initialRev, initialDates, initialNotes = [], onAdopt }: Options): Availability {
  const [dates, setDates] = useState<Set<string>>(new Set(initialDates));
  const [notes, setNotes] = useState<Map<string, string>>(
    () => new Map(initialNotes.map(n => [n.date, n.note]))
  );
  const [saving, setSaving] = useState(false);
  const [saved, flashSaved, clearSaved] = useTransientValue(false, 2500);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The conflict notice is HELD, never flashed: it reports a write that did NOT
  // land, and it must outlive the seconds a toast gets.
  const [conflict, , clearConflict, holdConflict] = useTransientValue<string | null>(null, 2500);
  // The revision every save is written against; refreshed from each reply.
  const [rev, setRev] = useState(initialRev);

  // Saved-state snapshot `dirty` compares against; reset after each successful save.
  const [initialSnap, setInitialSnap] = useState(() => snapshot(new Set(initialDates), new Map(initialNotes.map(n => [n.date, n.note]))));
  const dirty = snapshot(dates, notes) !== initialSnap;

  const todayIso = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });

  const upcomingCount = Array.from(dates).filter(d => d >= todayIso).length;

  // Warn before leaving (tab close / refresh / external nav) with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function mark(iso: string) {
    if (dates.has(iso)) return;
    setDates(prev => { const n = new Set(prev); n.add(iso); return n; });
    clearSaved();
  }

  function remove(iso: string) {
    setDates(prev => { const n = new Set(prev); n.delete(iso); return n; });
    setNotes(prev => { const m = new Map(prev); m.delete(iso); return m; });
    clearSaved();
  }

  function toggle(iso: string) {
    if (dates.has(iso)) remove(iso);
    else mark(iso);
  }

  function setNote(iso: string, text: string) {
    setNotes(prev => {
      const m = new Map(prev);
      if (text) m.set(iso, text);
      else m.delete(iso);
      return m;
    });
    clearSaved();
  }

  // Expand a recurring weekday pattern into concrete future dates (next 12 months),
  // then either mark (add) the whole run or clear (remove) it.
  function applyRecurring(dow: number, interval: number, add: boolean) {
    const cur = new Date();
    cur.setHours(12, 0, 0, 0);
    while (cur.getDay() !== dow) cur.setDate(cur.getDate() + 1);
    const end = new Date();
    end.setDate(end.getDate() + 365);

    const series: string[] = [];
    while (cur <= end) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (iso >= todayIso) series.push(iso);
      cur.setDate(cur.getDate() + 7 * interval);
    }
    setDates(prev => { const n = new Set(prev); series.forEach(d => (add ? n.add(d) : n.delete(d))); return n; });
    if (!add) setNotes(prev => { const m = new Map(prev); series.forEach(d => m.delete(d)); return m; });
    clearSaved();
  }

  /** Adopt the server's arrays, dropping the pending edits with them. */
  function adopt(server: ServerState) {
    const serverDates = new Set(server.unavailableDates ?? []);
    const serverNotes = new Map((server.unavailabilityNotes ?? []).map(n => [n.date, n.note]));
    setDates(serverDates);
    setNotes(serverNotes);
    setInitialSnap(snapshot(serverDates, serverNotes));
    if (server._rev) setRev(server._rev);
    onAdopt?.();
    clearSaved();
  }

  /**
   * The PATCH replaces BOTH arrays wholesale from a snapshot this page took when
   * it loaded, so it carries the revision it read at and the server refuses a
   * stale one. On that 409 the pending edits are DISCARDED, not retried:
   * re-sending a stale set against a fresh revision is the very deletion the
   * guard just stopped — the member re-marks the dates against real state.
   *
   * The one exception is a conflict where the server's availability is
   * BYTE-IDENTICAL to the base these edits were built on. That is not the race;
   * it is a sibling write to the same `teamMembers` document — `ProfilePanel`
   * sits on this same page and saves alias, email, photo, password and
   * notification prefs. Re-issuing the edits against the fresh revision then
   * cannot delete anything, so it happens once, silently, instead of throwing
   * the member's work away for a field they changed themselves seconds ago.
   */
  async function save() {
    setSaving(true);
    setSaveError(null);
    clearConflict();
    try {
      const notesPayload = Array.from(notes.entries())
        .filter(([d, n]) => dates.has(d) && n.trim())
        .map(([date, note]) => ({ date, note: note.trim() }));
      const baseSnap = initialSnap;

      let attemptRev = rev;
      // At most two attempts: the second can only be the sibling-write rebase,
      // and its own conflict is treated as a real one.
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch("/api/me/availability", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            _rev: attemptRev,
            unavailableDates: Array.from(dates),
            unavailabilityNotes: notesPayload,
          }),
        });

        if (res.ok) {
          const server = (await res.json()) as ServerState;
          // Only the revision is adopted, not the arrays: the reply echoes what
          // was just sent, and overwriting local state here would delete a date
          // toggled while the request was in flight.
          if (server._rev) setRev(server._rev);
          setInitialSnap(snapshot(dates, notes));
          flashSaved(true);
          return;
        }
        if (res.status !== 409) throw new Error(`Server returned ${res.status}`);

        const server = (await res.json()) as ServerState;
        const serverSnap = snapshot(
          new Set(server.unavailableDates ?? []),
          new Map((server.unavailabilityNotes ?? []).map(n => [n.date, n.note])),
        );
        if (attempt === 0 && server._rev && serverSnap === baseSnap) {
          attemptRev = server._rev;
          continue;
        }
        adopt(server);
        holdConflict(CONFLICT_MSG);
        return;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return {
    dates, notes, todayIso, upcomingCount,
    mark, remove, toggle, setNote, applyRecurring,
    save, saving, saved, dirty, saveError, conflict,
  };
}
