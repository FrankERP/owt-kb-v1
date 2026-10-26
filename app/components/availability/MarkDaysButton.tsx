"use client";

// The one door into an edit on `/me/disponibilidad`: «Marcar días» arms the
// grid's selection mode, «Listo» leaves it. It is the page's primary action —
// a member comes here to mark days, so the button that lets them is the
// filled one (design pass C, 2026-10-22; it was a `pill` «Seleccionar fechas»
// sitting above the month pager). While the mode is ON the same button is the
// ring `secondary` reading «Listo» (the «millones» pass, 2026-10-26): the filled
// button is the call to act, and once the member is acting the only thing left
// to press is the way out, which should not shout. `aria-pressed` still says
// which state it is in, for a reader that cannot see the fill. Owned by the
// host (`MyAvailabilityPanel`), which holds `selecting` and hands it to
// `AvailabilityGrid`, so the mode is one piece of state with one toggle.

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
    <Button
      variant={selecting ? "secondary" : "primary"}
      size="lg"
      onClick={onToggle}
      aria-pressed={selecting}
      className={className}
    >
      {selecting ? "Listo" : (
        <>
          <CalendarOffIcon size={14} />
          Marcar días
        </>
      )}
    </Button>
  );
}
