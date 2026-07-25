"use client";

// The signature readiness strip: Equipo · Setlist · Propuesta · Disponibilidad
// (Plan B item 7).
//
// Every module comes from `readinessStripModules`, which reads only the shipped
// readiness dimensions — this component picks nothing. The strip is a 2-column
// grid at 320px and a 4-column one from `sm` up, so it can never force horizontal
// overflow on a narrow iPhone.

import ReadinessBadge from "./ReadinessBadge";
import { readinessStripModules } from "./serviceCardModel";
import type { ServiceReadiness } from "./serviceReadiness";

export default function ReadinessStrip({
  readiness,
  labelledBy,
}: {
  readiness: ServiceReadiness;
  labelledBy?: string;
}) {
  const modules = readinessStripModules(readiness);
  return (
    <ul
      aria-label={labelledBy ? undefined : "Estado de preparación"}
      aria-labelledby={labelledBy}
      className="grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4"
    >
      {modules.map((module) => (
        <li key={module.key} className="min-w-0">
          <ReadinessBadge
            label={module.label}
            text={module.text}
            icon={module.icon}
            tone={module.tone}
            className="w-full"
          />
        </li>
      ))}
    </ul>
  );
}
