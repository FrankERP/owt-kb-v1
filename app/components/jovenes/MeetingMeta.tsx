// A meeting's clock, arrival and place as icon + words, in one wrapping line. The icons are what
// let the eye find «when» and «where» without reading the line (ADR-0086); every part is optional.
//
// NEUTRAL — no hooks.
import { ClockIcon, MapPinIcon } from "../ui/icons";

export default function MeetingMeta({
  time,
  arrival,
  place,
  className = "",
}: {
  time: string | null;
  arrival: string | null;
  place: string | null;
  className?: string;
}) {
  if (!time && !arrival && !place) return null;
  return (
    <p className={`flex flex-wrap items-center gap-x-3.5 gap-y-1 font-body text-[15px] leading-snug text-ink-muted ${className}`}>
      {(time || arrival) && (
        <span className="inline-flex items-center gap-1.5">
          <ClockIcon size={14} className="shrink-0 text-ink-dim" />
          <span>
            {time && <span className="font-semibold tabular-nums text-ink">{time}</span>}
            {time && arrival && " · "}
            {arrival && <span className="whitespace-nowrap tabular-nums">llegada {arrival}</span>}
          </span>
        </span>
      )}
      {place && (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <MapPinIcon size={14} className="shrink-0 text-ink-dim" />
          <span className="min-w-0 break-words">{place}</span>
        </span>
      )}
    </p>
  );
}
