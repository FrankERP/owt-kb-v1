"use client";

// `/me`'s identity header (R3, spec §12.4). It IS the page's heading: the two
// `h2`s it replaced ("Mis próximos servicios" / "Próximos servicios") said what
// the member was looking at; this says what they have to DO — «Te toca el
// domingo 13 · Lead · 11:00 · en 3 días».
//
// The «millones» pass (2026-10-24): the name is the page title in the display face
// (46 px, 76 px from `md`, the scale Inicio and Biblioteca set), beside a bigger
// photo; the alias and the Tipo are ONE muted line under it («Ani · Voz · Líder
// Domingo») instead of a row of uppercase chips; and the seat line is 17 px body
// with the date in ink and the seat in the app's one green — the bordered
// countdown pill is gone, the countdown is the end of the sentence. Uppercase is
// kept for the page's section titles only.
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
import NumberRoll from "./ui/NumberRoll";
import Button from "./ui/Button";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";
import type { SeatAssignment } from "@/app/utils/myWeek";
import { MEMBER_TYPE_LABEL } from "@/app/utils/memberTypes";

type Props = {
  name: string;
  alias?: string;
  photoUrl?: string;
  /** Raw `memberType` values — "Tipo", the only worship eligibility axis. Sanity
      returns `null` for an unset array, so `undefined` alone is not the absent case. */
  memberTypes?: string[] | null;
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
  memberTypes,
  next = null,
  kidsNext = null,
  inWorship = false,
}: Props) {
  const initials = (alias || name).trim().slice(0, 2).toUpperCase() || "??";
  const types = (memberTypes ?? []).filter((t) => typeof t === "string" && t.trim() !== "");
  // The line under the name: the alias (when it is not the name itself) and the
  // Tipo labels, one muted sentence.
  const subtitle = [
    ...(alias && alias.trim() !== name.trim() ? [alias] : []),
    ...types.map((t) => MEMBER_TYPE_LABEL[t] ?? t),
  ].join(" · ");

  // ONE line, in priority order: the next worship service, else the next Kids
  // Sunday, else — for a worship member only — the empty state. The countdown
  // ends the sentence, lowercase («en 3 días»), with the start time before it
  // (D, 2026-10-22: the clock the feed's rule computed, handed over as data; a
  // Kids Sunday carries none).
  const countdown = (iso: string) => formatCountdown(daysUntil(iso)).toLowerCase();
  let line: React.ReactNode = null;
  if (next) {
    // A special service keeps its own name; a weekend one would read "domingo 13
    // · Domingo", so the day word the date already carries is not repeated.
    const weekend = next.day === "Domingo" || next.day === "Sábado";
    line = (
      <>
        Te toca <span className="font-semibold text-ink">el {dayAndNumber(next.dateKey)}</span>
        {!weekend && <> · {next.day}</>}
        {next.seat && (
          <>
            {" · "}
            <span className="font-semibold text-positive-fg">{next.seat}</span>
          </>
        )}
        {next.time && <span className="tabular-nums"> · {next.time}</span>}
        {" · "}
        <NumberRoll value={countdown(next.dateKey)} />
      </>
    );
  } else if (kidsNext) {
    line = (
      <>
        En Oasis Kids te toca <span className="font-semibold text-ink">el {dayAndNumber(kidsNext)}</span>
        {" · "}
        <NumberRoll value={countdown(kidsNext)} />
      </>
    );
  } else if (inWorship) {
    line = (
      // The empty state gets a way on: without one, «sin servicios» read as
      // something broken rather than a quiet stretch (2026-10-22).
      <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>Sin servicios asignados próximamente</span>
        <Button variant="secondary" size="sm" href="/schedule">Ver calendario</Button>
      </span>
    );
  }

  return (
    <header className="flex flex-col gap-5 md:gap-6">
      <div className="flex items-center gap-5 md:gap-7">
        {photoUrl ? (
          // unoptimized: serve the original JPEG/PNG, not Next's WebP — the iOS
          // WKWebView (Capacitor wrap) fails to decode the optimized WebP avatar,
          // the same reason NavMenu's avatar carries it.
          <Image
            src={photoUrl}
            alt=""
            width={104}
            height={104}
            unoptimized
            className="h-[72px] w-[72px] shrink-0 rounded-full object-cover md:h-[104px] md:w-[104px]"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-surface-accent-solid md:h-[104px] md:w-[104px]"
          >
            <span className="font-display text-2xl font-semibold text-on-fill md:text-4xl">{initials}</span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="break-words font-display text-[46px] font-semibold leading-[0.96] tracking-[-0.01em] text-ink md:text-[76px] md:leading-[0.95]">{name}</h1>
          {subtitle && <p className="mt-1.5 font-body text-[15px] text-ink-muted md:text-[17px]">{subtitle}</p>}
        </div>
      </div>

      {line && <p className="font-body text-[17px] leading-snug text-ink-dim md:text-xl">{line}</p>}
    </header>
  );
}
