// Who a meeting is for, as chips: «Todo Jóvenes» in the app's accent with the people icon, or one
// chip per group in the group's own colour with its monogram (ADR-0086). The monogram is why the
// colour is never the only thing telling two groups apart.
//
// NEUTRAL — no hooks.
import { UsersIcon } from "../ui/icons";
import { audienceBadges } from "../../utils/jovenesGroupStyle";
import type { MinistryEventView } from "../../utils/ministryEventReads";

export default function AudienceChips({ audience, className = "" }: { audience: MinistryEventView["audience"]; className?: string }) {
  return (
    <ul aria-label="Para" className={`flex flex-wrap gap-1.5 ${className}`}>
      {audienceBadges(audience).map((b) => (
        <li
          key={b.key}
          className={`inline-flex items-center gap-1.5 rounded-full border py-[3px] pl-[3px] pr-2.5 font-body text-[13px] font-semibold leading-tight ${b.tone.chip}`}
        >
          {b.monogram ? (
            <span
              aria-hidden="true"
              className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-label text-[9px] font-bold tracking-[0.04em] text-surface-base ${b.tone.solid}`}
            >
              {b.monogram}
            </span>
          ) : (
            <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">
              <UsersIcon size={12} />
            </span>
          )}
          {b.label}
        </li>
      ))}
    </ul>
  );
}
