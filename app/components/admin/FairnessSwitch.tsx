"use client";

// «Cuenta para equidad» (solver v3 C1 §6): the house Switch, its visible label, an
// optional help line, and — for a service of a past month — the reason line that is
// the Switch's accessible description (§6.0). ONE component for the four surfaces
// (the grid's create and stored headers, the calendar's special composer and «+ Nuevo
// servicio»), so the copy and the a11y wiring cannot drift between them.
// `FairnessEngineNote` is the once-per-surface «aplica con el nuevo solver» note (U7).

import { useId } from "react";
import Switch from "@/app/components/ui/Switch";
import { FAIRNESS_ENGINE_NOTE, FAIRNESS_LABEL, FAIRNESS_PAST_REASON } from "./fairnessToggleModel";
import type { SolverEngine } from "./solverEngine";

export function FairnessSwitch({
  checked,
  onChange,
  disabled = false,
  past,
  ariaLabel,
  help,
}: {
  /** The EFFECTIVE value — the caller has already applied §6.0. */
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** §6.0: a service of a past month — the Switch is disabled and says why. */
  past: boolean;
  ariaLabel: string;
  help?: string;
}) {
  const reasonId = useId();
  return (
    <div className="space-y-1" data-fairness-switch="">
      <span className="inline-flex items-center gap-2">
        <Switch
          size="sm"
          checked={checked}
          onChange={onChange}
          disabled={disabled || past}
          aria-label={ariaLabel}
          aria-describedby={past ? reasonId : undefined}
        />
        <span aria-hidden="true" className="font-label text-[10px] uppercase tracking-widest text-mono-500">
          {FAIRNESS_LABEL}
        </span>
      </span>
      {help && <p className="font-body text-[11px] text-mono-500">{help}</p>}
      {past && (
        <p id={reasonId} className="font-body text-[10px] text-warning-strong">
          {FAIRNESS_PAST_REASON}
        </p>
      )}
    </div>
  );
}

/**
 * «Cuenta para equidad: aplica con el nuevo solver…» — once per surface, only while the engine is
 * v2. The engine is the server-resolved prop (C6 CTL-1, ENG-4), never the constant.
 */
export function FairnessEngineNote({ engine }: { engine: SolverEngine }) {
  if (engine !== "v2") return null;
  return (
    <p data-fairness-engine-note="" className="font-body text-[11px] text-mono-500">
      {FAIRNESS_ENGINE_NOTE}
    </p>
  );
}
