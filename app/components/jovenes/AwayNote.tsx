import { awayLine } from "@/app/utils/jovenesAway";
import { CalendarOffIcon } from "@/app/components/ui/icons";

/**
 * «Ana: no disponible ese día» on a planner card (ADR-0090): someone on this meeting marked its
 * day, perhaps after the roster was built. In the availability colour, the one the member's own
 * calendar paints a marked day with. Renders nothing for an empty list. No "use client": it only
 * draws, and both planner sections (client components) render it.
 */
export default function AwayNote({ names }: { names: readonly string[] }) {
  const line = awayLine(names);
  if (!line) return null;
  return (
    <p className="flex gap-2 font-body text-[14px] leading-snug text-availability-soft">
      <CalendarOffIcon size={14} className="mt-[3px] shrink-0" />
      <span className="min-w-0 break-words">{line}</span>
    </p>
  );
}
