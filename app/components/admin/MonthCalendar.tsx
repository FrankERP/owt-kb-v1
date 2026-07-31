"use client";

import { useState } from "react";

/**
 * The month generator's date picker (E1/E2). Replaces the two Domingos/Sábados
 * checkboxes and the Saturday pill row: every Sunday and Saturday of the month
 * starts selected and can be tapped off individually, and any other day can
 * become a NAMED special service (`special_role`).
 *
 * **It renders on the setup step only** (P3, work item 14). `handlePreview`'s
 * `setCells([])` is the one thing keeping a stale cell off a column whose TYPE
 * changed (`cellsByDate` is keyed by date alone), so the picker must never sit
 * live beside the grid.
 *
 * **E21 — what this component does NOT decide.** Sunday selection here feeds
 * `buildColumns` and nothing else. The solver's week spine stays the full
 * month's Sunday list; `MonthGenerator` owns that split, and this component is
 * deliberately given no idea a solver exists.
 *
 * Every refusal is STATED (E3/P2): an attempt that cannot be honoured sets the
 * `notice` line below the grid, never silently no-ops.
 */

export interface CalendarSpecial {
  date: string;
  name: string;
}

/** The subset of a Sanity role this picker reads (fact: `date` may be a datetime). */
export interface CalendarExistingRole {
  _type: string;
  date: string;
  service_name?: string;
}

export interface MonthCalendarProps {
  year: number;
  /** 1-based, as everywhere else in `MonthGenerator`. */
  month: number;
  /** The Sundays that will produce a column — NOT the month's full spine. */
  selectedSundays: string[];
  selectedSaturdays: string[];
  specials: CalendarSpecial[];
  existingRoles: CalendarExistingRole[];
  /** Toggle one weekend date on/off. Refused here when it holds a special (E3). */
  onToggleWeekend: (date: string) => void;
  onAddSpecial: (date: string, name: string) => void;
  onRemoveSpecial: (date: string) => void;
}

const WEEKDAY_HEADERS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Local noon, never a bare `new Date(iso)` — a bare parse is UTC and day-flips
 * in America/Mexico_City, which here would put days in the wrong calendar cell.
 */
const noon = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00");

/** Every `YYYY-MM-DD` in the month, in order. */
export function monthDays(year: number, month: number): string[] {
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
}

export function dayOfWeek(iso: string): number {
  return noon(iso).getDay();
}

/** "12 de agosto" — every user-facing refusal names the date this way. */
export function longDate(iso: string): string {
  return noon(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

/** "mié 12 de agosto" — the composer's date options, where the weekday matters. */
function optionLabel(iso: string): string {
  return noon(iso).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "long" });
}

const EXISTING_LABEL: Record<string, string> = {
  sunday_role: "Domingo",
  saturday_role: "Sábado",
  special_role: "Especial",
};

const weekendNoun = (iso: string) => (dayOfWeek(iso) === 0 ? "domingo" : "sábado");

/**
 * Why this date may not receive a special — or `null` when it may.
 *
 * Pure and exported so the refusals can be pinned directly, and so the same
 * predicate answers both the message and the decision (a second, drifting copy
 * of the condition is exactly how a "silent drop" gets reintroduced).
 *
 * Order is fixed for determinism, not significance:
 *  1. **E3** — the date already generates a weekend column. One column per date
 *     of any kind; a *deselected* weekend date is fine and falls through.
 *  2. this month's own picks already hold a special on that date.
 *  3. **P2** — a `special_role` already exists in Sanity on that date. The
 *     generator's preflight for a special is name-BLIND (`special_role:<date>`),
 *     so a second special on the same date is refused at the picker rather than
 *     drafted against an observation that cannot tell the two apart.
 */
export function refuseSpecialOn(input: {
  date: string;
  weekendSelected: boolean;
  specials: CalendarSpecial[];
  existingRoles: CalendarExistingRole[];
}): string | null {
  const { date, weekendSelected, specials, existingRoles } = input;
  if (weekendSelected) {
    return `El ${longDate(date)} ya genera un servicio de ${weekendNoun(date)}. Quítalo del calendario antes de crear un servicio especial en esa fecha.`;
  }
  const already = specials.find((s) => s.date === date);
  if (already) {
    return `El ${longDate(date)} ya tiene un servicio especial en este mes: «${already.name}». Quítalo de la lista para cambiarlo.`;
  }
  const stored = existingRoles.find(
    (r) => r._type === "special_role" && r.date.slice(0, 10) === date,
  );
  if (stored) {
    const name = stored.service_name?.trim();
    return `El ${longDate(date)} ya tiene un servicio especial guardado${name ? `: «${name}»` : ""}. No se puede crear otro en la misma fecha.`;
  }
  return null;
}

/**
 * Why this weekend date may not be selected — the OTHER ordering of E3. Adding
 * the special first and then re-selecting its Saturday must refuse just as
 * loudly as the reverse; `buildColumns`' weekend-wins dedupe would otherwise
 * drop the special with only a `console.warn` the admin never sees.
 */
export function refuseWeekendOn(input: { date: string; specials: CalendarSpecial[] }): string | null {
  const special = input.specials.find((s) => s.date === input.date);
  if (!special) return null;
  return `El ${longDate(input.date)} ya tiene un servicio especial («${special.name}»). Quítalo antes de activar ese ${weekendNoun(input.date)}.`;
}

const CELL_BASE =
  "min-h-[44px] w-full rounded-lg border px-1 py-1 text-center transition-colors flex flex-col items-center justify-center gap-0.5";

export default function MonthCalendar({
  year,
  month,
  selectedSundays,
  selectedSaturdays,
  specials,
  existingRoles,
  onToggleWeekend,
  onAddSpecial,
  onRemoveSpecial,
}: MonthCalendarProps) {
  const [composerDate, setComposerDate] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const days = monthDays(year, month);
  const leadingBlanks = dayOfWeek(days[0]);
  const sundaySel = new Set(selectedSundays);
  const saturdaySel = new Set(selectedSaturdays);
  const specialByDate = new Map(specials.map((s) => [s.date, s]));
  const existingByDate = new Map<string, CalendarExistingRole>();
  for (const r of existingRoles) {
    const key = r.date.slice(0, 10);
    if (!existingByDate.has(key)) existingByDate.set(key, r);
  }

  // A composer left open across a month change would offer a date that is no
  // longer in `days` (the same out-of-month hazard the parent's reset closes
  // from the other side). `MonthGenerator` also remounts this component per
  // month, so this is belt and braces, not the only guard.
  const openDate = composerDate && days.includes(composerDate) ? composerDate : null;

  const weekendSelected = (date: string) => {
    const dow = dayOfWeek(date);
    if (dow === 0) return sundaySel.has(date);
    if (dow === 6) return saturdaySel.has(date);
    return false;
  };

  // Where the composer starts when it is opened from the button rather than
  // from a day cell. Day 1 would be a guaranteed E3 refusal in any month
  // starting on a weekend, so it starts on the first date that could actually
  // take a special; `days[0]` only when every date is already claimed (and then
  // the refusal is the honest answer).
  const firstFreeDate =
    days.find(
      (d) =>
        !refuseSpecialOn({ date: d, weekendSelected: weekendSelected(d), specials, existingRoles }),
    ) ?? days[0];

  function openComposer(date: string) {
    setNotice(null);
    setDraftName("");
    setComposerDate(date);
  }

  function handleDayClick(date: string) {
    const dow = dayOfWeek(date);
    if (dow === 0 || dow === 6) {
      const refusal = weekendSelected(date) ? null : refuseWeekendOn({ date, specials });
      if (refusal) {
        setNotice(refusal);
        return;
      }
      setNotice(null);
      onToggleWeekend(date);
      return;
    }
    const held = specialByDate.get(date);
    if (held) {
      setNotice(
        `El ${longDate(date)} ya tiene un servicio especial («${held.name}»). Quítalo de la lista para cambiarlo.`,
      );
      return;
    }
    openComposer(date);
  }

  function submitSpecial() {
    if (!openDate) return;
    const name = draftName.trim();
    if (!name) {
      setNotice("Escribe un nombre para el servicio especial.");
      return;
    }
    const refusal = refuseSpecialOn({
      date: openDate,
      weekendSelected: weekendSelected(openDate),
      specials,
      existingRoles,
    });
    if (refusal) {
      setNotice(refusal);
      return;
    }
    onAddSpecial(openDate, name);
    setComposerDate(null);
    setDraftName("");
    setNotice(null);
  }

  return (
    <div className="space-y-2">
      <label className="font-label text-xs uppercase tracking-widest text-gray-500">Fechas</label>
      <p className="font-body text-xs text-gray-500">
        Domingos y sábados se generan por defecto: toca una fecha para quitarla. Toca cualquier otro
        día para crear un servicio especial.
      </p>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_HEADERS.map((h) => (
          <span
            key={h}
            className="font-label text-[10px] uppercase tracking-widest text-gray-500 text-center py-1"
          >
            {h}
          </span>
        ))}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden="true" />
        ))}
        {days.map((date) => {
          const dow = dayOfWeek(date);
          const isWeekend = dow === 0 || dow === 6;
          const kind = dow === 0 ? "sunday" : dow === 6 ? "saturday" : "weekday";
          const selected = weekendSelected(date);
          const special = specialByDate.get(date);
          const existing = existingByDate.get(date);
          const tone = selected
            ? dow === 0
              ? "border-[#00bfff]/50 bg-[#00bfff]/10 text-[#00bfff]"
              : "border-yellow-400/50 bg-yellow-400/10 text-yellow-400"
            : special
              ? "border-[#a78bfa]/50 bg-[#a78bfa]/10 text-[#a78bfa]"
              : "border-[#00bfff]/15 text-gray-500 hover:border-[#00bfff]/40 hover:text-[#C8D8EB]";
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              data-day-kind={kind}
              data-selected={selected ? "true" : "false"}
              {...(special ? { "data-special": special.name } : {})}
              {...(existing ? { "data-existing": existing._type } : {})}
              aria-pressed={isWeekend ? selected : undefined}
              // Named for screen readers: the visible cell is a bare number.
              // Deliberately NOT containing the phrase "servicio especial" —
              // that is the composer button's accessible name.
              aria-label={special ? `${optionLabel(date)} — ${special.name}` : optionLabel(date)}
              title={
                existing
                  ? `Ya existe un servicio (${EXISTING_LABEL[existing._type] ?? existing._type}${
                      existing.service_name ? `: ${existing.service_name}` : ""
                    })`
                  : undefined
              }
              onClick={() => handleDayClick(date)}
              className={`${CELL_BASE} ${tone}`}
            >
              <span className="font-display text-sm leading-none">{noon(date).getDate()}</span>
              {special && (
                <span className="font-label text-[8px] uppercase tracking-widest leading-tight break-words">
                  {special.name}
                </span>
              )}
              {existing && (
                <span
                  className="font-label text-[8px] uppercase tracking-widest text-amber-400 leading-none"
                  aria-label={`Ya existe un servicio el ${longDate(date)}`}
                >
                  ya existe
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => openComposer(openDate ?? firstFreeDate)}
        className="min-h-[44px] w-full rounded-lg border border-[#a78bfa]/30 px-3 font-label text-[11px] uppercase tracking-widest text-[#a78bfa] hover:bg-[#a78bfa]/10 transition-colors"
      >
        + Servicio especial
      </button>

      {openDate && (
        <div className="space-y-2 rounded-lg border border-[#a78bfa]/30 bg-[#a78bfa]/5 px-3 py-2.5">
          <p className="font-label text-[11px] uppercase tracking-widest text-[#a78bfa]">
            Nuevo servicio especial
          </p>
          <select
            aria-label="Fecha del servicio especial"
            value={openDate}
            onChange={(e) => {
              setNotice(null);
              setComposerDate(e.target.value);
            }}
            className="min-h-[44px] w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-[#0a1929] font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors"
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {optionLabel(d)}
              </option>
            ))}
          </select>
          <input
            aria-label="Nombre del servicio especial"
            placeholder="Nombre (p. ej. Bautizos)"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="min-h-[44px] w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitSpecial}
              className="min-h-[44px] flex-1 rounded-lg bg-[#a78bfa]/20 px-3 font-label text-[11px] uppercase tracking-widest text-[#a78bfa]"
            >
              Agregar
            </button>
            <button
              type="button"
              onClick={() => {
                setComposerDate(null);
                setDraftName("");
                setNotice(null);
              }}
              className="min-h-[44px] flex-1 rounded-lg border border-[#00bfff]/20 px-3 font-label text-[11px] uppercase tracking-widest"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {specials.length > 0 && (
        <ul className="space-y-1" aria-label="Servicios especiales">
          {[...specials]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((s) => (
              <li
                key={s.date}
                className="flex items-center justify-between gap-2 rounded-lg border border-[#a78bfa]/25 px-3 py-1.5"
              >
                <span className="font-body text-xs text-[#C8D8EB]">
                  <span className="text-[#a78bfa]">{s.name}</span> — {longDate(s.date)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    onRemoveSpecial(s.date);
                  }}
                  aria-label={`Quitar servicio especial del ${longDate(s.date)}`}
                  className="min-h-[44px] rounded-lg border border-[#00bfff]/20 px-3 font-label text-[10px] uppercase tracking-widest text-gray-400 hover:border-red-400/50 hover:text-red-400 transition-colors"
                >
                  Quitar
                </button>
              </li>
            ))}
        </ul>
      )}

      {notice && (
        <p role="status" className="font-body text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
          {notice}
        </p>
      )}
    </div>
  );
}
