"use client";

// The one door into an edit on `/me/disponibilidad`: «Marcar días» arms the
// grid's selection mode, «Listo» leaves it. It is the page's primary action —
// a member comes here to mark days, so the button that lets them is the
// filled one, full width on a phone (design pass C, 2026-10-22; it was a
// `pill` «Seleccionar fechas» sitting above the month pager). `aria-pressed`
// says which state it is in, since a primary button has no pressed look of
// its own. Owned by the host (`MyAvailabilityPanel`), which holds `selecting`
// and hands it to `AvailabilityGrid`, so the mode is one piece of state with
// one toggle.

import Button from "@/app/components/ui/Button";
import { CalendarOffIcon } from "@/app/components/ui/icons";

export default function MarkDaysButton({
  selecting,
  onToggle,
  className = "",
}: {
  selecting: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Button variant="primary" onClick={onToggle} aria-pressed={selecting} className={className}>
      {selecting ? "Listo" : (
        <>
          <CalendarOffIcon size={14} />
          Marcar días
        </>
      )}
    </Button>
  );
}
