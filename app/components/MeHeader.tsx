"use client";

// `/me`'s identity header (R3, spec §12.4). It IS the page's heading: the two
// `h2`s it replaced ("Mis próximos servicios" / "Próximos servicios") said what
// the member was looking at; this says what they have to DO — «Te toca el
// domingo 13 · Lead», with the countdown beside it.
//
// Everything it renders is computed on the server and handed over as plain data
// (`next`, `kidsNext`): the page is a Server Component, so no function may cross
// this boundary (ADR-0028) — `nextSeatLine`/`seatLabel` run there, in the neutral
// `app/utils/myWeek.ts`.
//
// WORSHIP COPY IS GATED. A kids-only member gets no worship text at all, the
// empty state included — "Sin servicios asignados próximamente" is itself a
// worship surface (spec §5.1), which is why `inWorship` is a prop and not an
// inference from `next == null`. `app/(client)/me/__tests__/mePage.test.tsx`
// pins it.

import Image from "next/image";
import Button from "./ui/Button";
import NumberRoll from "./ui/NumberRoll";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";
import type { SeatAssignment } from "@/app/utils/myWeek";
import { MEMBER_TYPE_LABEL } from "@/app/utils/memberTypes";

type Props = {
  name: string;
  alias?: string;
  photoUrl?: string;
  /** Raw `memberType` values — "Tipo", the only worship eligibility axis. */
  memberTypes?: string[];
  /** The member's next worship service, already reduced by `nextSeatLine`. */
  next?: SeatAssignment | null;
  /** The member's next Oasis Kids Sunday (`YYYY-MM-DD`), if any. */
  kidsNext?: string | null;
  /** Worship membership — see the note above. */
  inWorship?: boolean;
};

/** Local noon, never a bare `new Date(iso)` — the UTC day-flip invariant. */
function dayAndNumber(iso: string): string {
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
  });
}

export default function MeHeader({
  name,
  alias,
  photoUrl,
  memberTypes = [],
  next = null,
  kidsNext = null,
  inWorship = false,
}: Props) {
  const initials = (alias || name).trim().slice(0, 2).toUpperCase() || "??";
  const types = memberTypes.filter((t) => typeof t === "string" && t.trim() !== "");

  // ONE line, in priority order: the next worship service, else the next Kids
  // Sunday, else — for a worship member only — the empty state.
  let line: string | null = null;
  let countdownDate: string | null = null;
  if (next) {
    // A special service keeps its own name; a weekend one would read "domingo 13
    // · Domingo", so the day word the date already carries is not repeated.
    const weekend = next.day === "Domingo" || next.day === "Sábado";
    line =
      `Te toca el ${dayAndNumber(next.dateKey)}` +
      (weekend ? "" : ` · ${next.day}`) +
      (next.seat ? ` · ${next.seat}` : "");
    countdownDate = next.dateKey;
  } else if (kidsNext) {
    line = `En Oasis Kids te toca el ${dayAndNumber(kidsNext)}`;
    countdownDate = kidsNext;
  } else if (inWorship) {
    line = "Sin servicios asignados próximamente";
  }

  return (
    <header className="flex flex-wrap items-center gap-4">
      {photoUrl ? (
        // unoptimized: serve the original JPEG/PNG, not Next's WebP — the iOS
        // WKWebView (Capacitor wrap) fails to decode the optimized WebP avatar,
        // the same reason NavMenu's avatar carries it.
        <Image
          src={photoUrl}
          alt=""
          width={64}
          height={64}
          unoptimized
          className="h-16 w-16 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-accent-solid"
        >
          <span className="font-label text-base uppercase tracking-widest text-on-fill">{initials}</span>
        </div>
      )}

      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="font-display text-2xl font-semibold leading-none text-ink md:text-3xl">{name}</h1>
        {alias && alias.trim() !== name.trim() && (
          <p className="font-body text-sm text-ink-muted">{alias}</p>
        )}
        {types.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {types.map((t) => (
              <li
                key={t}
                className="rounded-full border border-surface-accent-30 px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-mono-500"
              >
                {MEMBER_TYPE_LABEL[t] ?? t}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button variant="ghost" size="sm" href="#ajustes" className="shrink-0">
        Editar perfil
      </Button>

      {line && (
        <p className="flex w-full flex-wrap items-center gap-3 font-body text-base text-ink">
          <span className="min-w-0">{line}</span>
          {countdownDate && (
            // The hero's countdown pill, same tokens: two countdowns on one page
            // that disagreed on their chrome would read as two different things.
            <span className="shrink-0 rounded-full border border-positive-fg/25 bg-positive-fg/[0.055] px-3 py-1.5 font-label text-[10px] uppercase tracking-widest text-positive-fg">
              <NumberRoll value={formatCountdown(daysUntil(countdownDate))} />
            </span>
          )}
        </p>
      )}
    </header>
  );
}
