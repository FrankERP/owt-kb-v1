"use client";

import { useState } from "react";

import {
  dayOfWeek,
  longDate,
  monthDays,
  noon,
  refuseSpecialOn,
  refuseWeekendOn,
  type CalendarExistingRole,
  type CalendarSpecial,
} from "./plannerCalendar";
import { horizonTitle } from "./v3Copy";
import Select from "@/app/components/ui/Select";
import { WarningIcon } from "@/app/components/ui/icons";
import { FairnessEngineNote, FairnessSwitch } from "./FairnessSwitch";
import type { SolverEngine } from "./solverEngine";
import {
  FAIRNESS_LABEL,
  FAIRNESS_SPECIAL_HELP,
  effectiveCreateCounts,
  isPastServiceMonth,
} from "./fairnessToggleModel";

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

// Moved to the neutral `plannerCalendar.ts` (MCP P4); re-exported so every caller
// and test keeps importing them from here.
export { dayOfWeek, longDate, monthDays, refuseSpecialOn, refuseWeekendOn };
export type { CalendarExistingRole, CalendarSpecial };

export interface MonthCalendarProps {
  year: number;
  /** 1-based, as everywhere else in `MonthGenerator`. */
  month: number;
  /** The Sundays that will produce a column — NOT the month's full spine. */
  selectedSundays: string[];
  selectedSaturdays: string[];
  specials: CalendarSpecial[];
  existingRoles: CalendarExistingRole[];
  /**
   * **P2, second surface.** `MonthGenerator`'s session-local created-set —
   * `draftTargetKey` (`type__date`) for every target THIS dialog instance has
   * confirmed-created. Read-only here, and optional so the calendar keeps
   * standing alone (its own tests, and any future caller with no create step).
   *
   * Without it the composer accepts a special on a date this session already
   * created and the refusal only appears one screen later, in the grid, as
   * "Crear 0 borradores" — the multi-surface disagreement E17 exists to
   * eliminate. Nothing wrong reaches Sanity either way; the grid gate holds.
   * What this closes is the composer telling the admin something the next
   * screen contradicts.
   */
  createdTargets?: ReadonlySet<string>;
  /** Toggle one weekend date on/off. Refused here when it holds a special (E3). */
  onToggleWeekend: (date: string) => void;
  /**
   * `countsForFairness` is the composer's «Cuenta para equidad» (solver v3 C1 §6.3) —
   * off by default each time the composer opens, the type default in a past month —
   * and becomes the special column's initial value.
   */
  onAddSpecial: (date: string, name: string, countsForFairness: boolean) => void;
  onRemoveSpecial: (date: string) => void;
  /** The server-resolved engine (C6 ENG-3); gates C1's note in the special composer. */
  engine?: SolverEngine;
}

const WEEKDAY_HEADERS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "mié 12 de agosto" — the composer's date options, where the weekday matters. */
function optionLabel(iso: string): string {
  return noon(iso).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "long" });
}

const EXISTING_LABEL: Record<string, string> = {
  sunday_role: "Domingo",
  saturday_role: "Sábado",
  special_role: "Especial",
};

const CELL_BASE =
  "min-h-[44px] w-full rounded-lg border px-1 py-1 text-center transition-colors flex flex-col items-center justify-center gap-0.5";

export default function MonthCalendar({
  year,
  month,
  selectedSundays,
  selectedSaturdays,
  specials,
  existingRoles,
  createdTargets,
  onToggleWeekend,
  onAddSpecial,
  onRemoveSpecial,
  engine = "v2",
}: MonthCalendarProps) {
  const [composerDate, setComposerDate] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCounts, setDraftCounts] = useState(false);
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
        !refuseSpecialOn({
          date: d,
          weekendSelected: weekendSelected(d),
          specials,
          existingRoles,
          createdTargets,
        }),
    ) ?? days[0];

  function openComposer(date: string) {
    setNotice(null);
    setDraftName("");
    setDraftCounts(false);
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
      createdTargets,
    });
    if (refusal) {
      setNotice(refusal);
      return;
    }
    // §6.0: decided now — in a past month the special's type default, whatever was chosen.
    onAddSpecial(openDate, name, effectiveCreateCounts("special_role", openDate, draftCounts));
    setComposerDate(null);
    setDraftName("");
    setDraftCounts(false);
    setNotice(null);
  }

  return (
    <div className="space-y-2">
      {/*
        Each calendar names its own month: a two-month horizon stacks two of them, and two
        identical «Fechas» headings left the admin counting rows to tell November from December.
        The section label and its instructions are the planner's, said once above the stack.
      */}
      <h3 className="font-label text-xs uppercase tracking-widest text-accent">
        {horizonTitle([`${year}-${String(month).padStart(2, "0")}`])}
      </h3>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_HEADERS.map((h) => (
          <span
            key={h}
            className="font-label text-[10px] uppercase tracking-widest text-mono-500 text-center py-1"
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
              ? "border-accent/50 bg-accent/10 text-accent"
              : "border-recency-strong/50 bg-recency-strong/10 text-recency-strong"
            : special
              ? "border-info-fg/50 bg-info-fg/10 text-info-fg"
              : "border-accent/15 text-mono-500 hover:border-accent/40 hover:text-ink-muted";
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
              {/* The name used to sit inside the cell at 8 px — unreadable on a
                  phone. The cell keeps a dot (its tone already says «especial»,
                  the accessible name carries the words) and the «Servicios
                  especiales» list below the grid names it (bloque 5). */}
              {special && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-info-fg" />}
              {existing && (
                <span
                  className="text-warning-strong leading-none"
                  aria-label={`Ya existe un servicio el ${longDate(date)}`}
                >
                  <WarningIcon size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => openComposer(openDate ?? firstFreeDate)}
        className="min-h-[44px] w-full rounded-lg border border-info-fg/30 px-3 font-label text-[11px] uppercase tracking-widest text-info-fg hover:bg-info-fg/10 transition-colors"
      >
        + Servicio especial
      </button>

      {openDate && (
        <div className="space-y-2 rounded-lg border border-info-fg/30 bg-info-fg/5 px-3 py-2.5">
          <p className="font-label text-[11px] uppercase tracking-widest text-info-fg">
            Nuevo servicio especial
          </p>
          <Select
            aria-label="Fecha del servicio especial"
            size="lg"
            className="w-full"
            value={openDate}
            onChange={(e) => {
              setNotice(null);
              setComposerDate(e.target.value);
            }}
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {optionLabel(d)}
              </option>
            ))}
          </Select>
          <input
            aria-label="Nombre del servicio especial"
            placeholder="Nombre (p. ej. Bautizos)"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="min-h-[44px] w-full px-3 py-2 rounded-lg border border-accent/20 bg-transparent font-body text-[16px] sm:text-sm focus:outline-none focus:border-accent transition-colors"
          />
          <FairnessSwitch
            checked={effectiveCreateCounts("special_role", openDate, draftCounts)}
            onChange={setDraftCounts}
            past={isPastServiceMonth(openDate)}
            ariaLabel={FAIRNESS_LABEL}
            help={FAIRNESS_SPECIAL_HELP}
          />
          <FairnessEngineNote engine={engine} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitSpecial}
              className="min-h-[44px] flex-1 rounded-lg bg-info-fg/20 px-3 font-label text-[11px] uppercase tracking-widest text-info-fg"
            >
              Agregar
            </button>
            <button
              type="button"
              onClick={() => {
                setComposerDate(null);
                setDraftName("");
                setDraftCounts(false);
                setNotice(null);
              }}
              className="min-h-[44px] flex-1 rounded-lg border border-accent/20 px-3 font-label text-[11px] uppercase tracking-widest"
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
                className="flex items-center justify-between gap-2 rounded-lg border border-info-fg/25 px-3 py-1.5"
              >
                <span className="font-body text-xs text-ink-muted">
                  <span className="text-info-fg">{s.name}</span> — {longDate(s.date)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    onRemoveSpecial(s.date);
                  }}
                  aria-label={`Quitar servicio especial del ${longDate(s.date)}`}
                  className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-[10px] uppercase tracking-widest text-mono-400 hover:border-negative-fg/50 hover:text-negative-fg transition-colors"
                >
                  Quitar
                </button>
              </li>
            ))}
        </ul>
      )}

      {notice && (
        <p role="status" className="font-body text-xs text-warning-strong bg-warning-fg/10 rounded-lg px-3 py-2">
          {notice}
        </p>
      )}
    </div>
  );
}
