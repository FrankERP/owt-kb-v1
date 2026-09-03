"use client";

// Planner fixture — the full-screen portal path (Child A2 step 2).
//
// `PlannerGrid` full-screen is `createPortal(surface, document.body)` (`:2008`) behind
// an OPAQUE `fixed inset-0 z-50 … bg-[#010b17]` overlay (`:1769`). That path renders
// outside the normal tree and is exactly what makes it worth baselining — and exactly
// why it cannot share a page with the swatches, which it would cover entirely.
//
// `PlannerGrid` is hostable: zero `fetch`, zero `useSession`, nothing from `next-auth`,
// and its own tests render it with no providers at all. Its `CueDialog`s are mounted only
// under `pendingMove` and `pendingCopy`, and this fixture reaches neither, so nothing
// throws without a provider.
//
// FULL SCREEN IS NOT A PROP. `PlannerGridProps` does not declare it; it is
// `useState(false)` at `:553`, entered ONLY via the toggle at `:1823`. A static render
// takes the `: surface` branch and never reaches the portal. So this host ACTIVATES the
// toggle on mount, the same interaction `participationAlongside.test.tsx:660` performs.
//
// `PlannerGrid.tsx` itself is NOT modified — adding a prop would be a production change
// outside this plan's boundary.

import { useEffect, useRef, useState } from "react";
import PlannerGrid from "@/app/components/admin/PlannerGrid";
import { buildRows, buildColumns } from "@/app/components/admin/plannerModel";
import type { GridRow, GridColumn } from "@/app/components/admin/plannerModel";
import type { RankMember } from "@/app/components/admin/candidateRanking";

const ROWS: GridRow[] = buildRows();
const COLUMNS: GridColumn[] = buildColumns({ sundayDates: ["2026-08-09"], activeSatDates: ["2026-08-08"] });

// PLACEHOLDER NAMES, DELIBERATELY — do not "improve" these back to real ones.
//
// This fixture used the first names of six actual team members. It exercises
// PlannerGrid's layout, which needs names of realistic LENGTH, not real people:
// nothing here reads Sanity, and these strings are the only personal data the
// gallery would carry. That matters because this route IS served publicly as of
// ADR-0017 — it is the one surface built to render both themes without a session
// — and a name published to the open internet is not retractable.
//
// themeGallery.test.ts pins these values. If you are changing them, change them
// there too, deliberately.
//
// Kept short and varied so the column widths still get a realistic workout.
const MEMBERS: RankMember[] = [
  { _id: "m1", member_name: "Ana", memberType: ["voz"] },
  { _id: "m2", member_name: "Beto", memberType: ["voz"] },
  { _id: "m3", member_name: "Cami", memberType: ["voz"] },
  { _id: "d1", member_name: "Dani", memberType: ["instrumento"] },
  { _id: "d2", member_name: "Emi", memberType: ["instrumento"] },
  { _id: "f1", member_name: "Fito", memberType: ["foh"] },
];

const noop = () => {};

export function PlannerFixture() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(false);

  // Activate full screen once, on mount. The failure mode is SILENT — if this does not
  // fire, the baseline captures the collapsed grid while looking plausible — so the
  // verification asserts the portal overlay is the topmost painted body child, not
  // merely that a portal node exists.
  useEffect(() => {
    const button = hostRef.current?.querySelector<HTMLButtonElement>("[data-planner-fullscreen]");
    if (!button) return;
    button.click();
    setActivated(true);
  }, []);

  return (
    <div ref={hostRef} data-gallery-surface="planner" data-planner-fullscreen-activated={activated}>
      <p className="text-sm opacity-80">
        La cuadrícula entra en pantalla completa al montar. Su superficie opaca es el sujeto de
        esta captura.
      </p>
      <PlannerGrid
        rows={ROWS}
        columns={COLUMNS}
        cells={[]}
        members={MEMBERS}
        savedWindow={[]}
        preflightFor={() => null}
        createBlockFor={() => null}
        canReceive={() => true}
        skipped={new Set()}
        unaddressableDates={[]}
        unresolvedNames={[]}
        unfilled={[]}
        onCellsChange={noop}
        onRowsChange={noop}
        onToggleSkip={noop}
        onAuto={noop}
        autoState={{ pending: false, error: null, disabledReason: null }}
        diagnostics={null}
      />
    </div>
  );
}
