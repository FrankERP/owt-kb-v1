// The colour rail on a meeting card's left edge: the accent for all of Jóvenes, the group's own
// colour for a group meeting, and one segment per group for a shared one (ADR-0087). It draws
// itself top to bottom after the card rises (`animate-rail-draw`), delayed by the card's own
// stagger index, which it inherits as `--reveal-i`.
//
// NEUTRAL — no hooks.
import { audienceRail } from "../../utils/jovenesGroupStyle";
import type { MinistryEventView } from "../../utils/ministryEventReads";

export default function AudienceRail({ audience, muted = false }: { audience: MinistryEventView["audience"]; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute inset-y-0 left-0 flex w-[3px] origin-top animate-rail-draw flex-col [animation-delay:calc(var(--reveal-i,0)*40ms+120ms)] ${muted ? "opacity-50" : ""}`}
    >
      {audienceRail(audience).map((solid, i) => (
        <span key={i} className={`flex-1 ${solid}`} />
      ))}
    </span>
  );
}
