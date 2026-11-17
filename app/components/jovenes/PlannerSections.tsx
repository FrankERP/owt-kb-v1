"use client";

// Planear Jóvenes' three sections — the Saturday roster, each group's classes, the groups'
// calendar — one at a time on a phone (2026-11-17). Frank: on a phone the planner was one long
// screen whose parts ran into each other. Under `lg` a control at the top picks the section and
// the other two leave the page; from `lg` there is room, so all three stack beside the month map
// as before and the control is not drawn.
//
// The switch is CSS (`hidden lg:block`), never an unmount: each section owns open sheets, a
// half-filled form and a create token, and a pastor who peeks at another section must find them
// as they left them. The month map follows the two sections that are about the MONTH; the classes
// run by book, across months, so it steps aside for them.
import { useState } from "react";
import SegmentedControl from "@/app/components/ui/SegmentedControl";

export type PlannerSection = "saturday" | "classes" | "groups";
type Section = PlannerSection;

/** The month map stays under the navbar while the sections scroll, from `lg`; the banner's height joins in. */
const PLANNER_STICKY = "lg:sticky lg:top-[calc(6.5rem+env(safe-area-inset-top)+var(--impersonation-offset))]";

const OPTIONS: ReadonlyArray<{ value: Section; label: string }> = [
  { value: "saturday", label: "Sábados" },
  { value: "classes", label: "Clases" },
  { value: "groups", label: "Grupos" },
];

export default function PlannerSections({
  map,
  saturday,
  classes,
  groups,
  initial = "saturday",
}: {
  /** The month at a glance (`MonthMap`). */
  map: React.ReactNode;
  saturday: React.ReactNode;
  classes: React.ReactNode;
  groups: React.ReactNode;
  /** The section a phone opens on: where THIS viewer has something to do (a leader who is not an
   *  admin only reads the Saturdays, so the page opens them on their classes). */
  initial?: PlannerSection;
}) {
  const [section, setSection] = useState<Section>(initial);
  const shown = (s: Section) => (section === s ? "" : "hidden lg:block");

  return (
    <div>
      <SegmentedControl
        label="Sección"
        tone="filled"
        value={section}
        onChange={setSection}
        options={OPTIONS}
        className="mb-8 w-full lg:hidden [&>button]:flex-1"
      />
      {/* The month as a picture (ADR-0086): beside the sections from `lg`, where it stays in view
          while they scroll, and UNDER the section on a phone — above it, it was a whole screen
          between the control and the first card. */}
      <div className="flex flex-col gap-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-start lg:gap-x-10 lg:gap-y-0">
        <aside aria-label="El mes de un vistazo" className={`order-2 ${PLANNER_STICKY} ${section === "classes" ? "hidden lg:block" : ""}`}>
          {map}
        </aside>
        <div className="order-1 min-w-0 lg:space-y-16">
          <div className={shown("saturday")}>{saturday}</div>
          <div className={shown("classes")}>{classes}</div>
          <div className={shown("groups")}>{groups}</div>
        </div>
      </div>
    </div>
  );
}
