"use client";

// A service that is NOT the next one, as a folded CARD (ADR-0087): the date as a calendar leaf
// in the day's colour, the day as the card's title, the clock, and — instead of a sentence —
// who leads as faces, the set as a stack of its songs' pictures, «Tú · EG» with the seat's glyph.
// A tap opens the ordinary `DayCard` sheet inside the same card. It is the object the Jóvenes
// list draws for a meeting (ADR-0086): Inicio and `/me` render the next service in full and
// every other one through this, so three services read as three things, not as three lines.
//
// The caller only hands this a service whose card actually paints (home filters
// on `paintsDayCard` before splitting hero from rest) — a header over an empty
// `Collapse` would open onto nothing.
//
// `Collapse` keeps its children mounted, so the `DayCard` inside a closed one
// still runs `usePlayer`/`useSession`; both providers are global, and a closed
// Collapse is inert + aria-hidden, so nothing inside it is reachable.
//
// A long press on the head (R7 Task 4, spec §12.8) opens its quick actions —
// the agenda, or this one service as an .ics — instead of toggling it open.

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DayCard, type DayCardProps } from "./DayCard";
import Collapse from "./ui/Collapse";
import QuickActions, { type QuickAction } from "./ui/QuickActions";
import useLongPress from "./ui/useLongPress";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";
import type { ICSEvent } from "@/app/utils/ics";
import { downloadICS } from "@/app/utils/icsDownload";
import { serviceStartTime } from "@/app/utils/calendarFeed";
import { normalizeText } from "@/app/utils/normalizeText";
import { myNameFromSession, mySeats, serviceTone, TONE_RAIL } from "@/app/utils/agenda";
import { joinNames } from "@/app/utils/homeGreeting";
import { plural } from "@/app/utils/plural";
import { COUNTDOWN_CHIP, MINE_CHIP, SERVICE_TONE } from "@/app/utils/serviceToneStyle";
import DateTile from "./jovenes/DateTile";
import ServiceFacts from "./service/ServiceFacts";
import SeatIcon from "./service/SeatIcon";
import { ChevronDownIcon, ClockIcon } from "./ui/icons";

export default function DayCardDisclosure(props: DayCardProps) {
  const [open, setOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const longPress = useLongPress(() => setActionsOpen(true));
  const router = useRouter();
  const id = useId();
  // Local noon, never a bare `new Date(iso)` — the UTC day-flip invariant.
  const shortDate = props.date
    ? new Date(props.date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : "";
  const days = props.date ? daysUntil(props.date) : null;
  // `viewerName` covers first paint, before the client session arrives — the
  // card inside reads the same pair, so the chip and its green «tú» agree.
  const { data: session } = useSession();
  const myName = myNameFromSession(session?.user) || props.viewerName || "";
  const seats = mySeats(props, myName);
  const songs = props.setlist?.songs ?? [];
  const leads = props.leads ?? [];
  const tone = serviceTone(props);
  const toneStyle = SERVICE_TONE[tone];
  // The clock by the feed's one rule, the same the `.ics` below mints.
  const clock = serviceStartTime(props.roleId ? "special" : "weekend", props.day, props.time);
  // What a screen reader hears for the head, in the order the eye takes it in.
  const label = [
    `${props.day}${shortDate ? `, ${shortDate}` : ""}${clock ? `, ${clock}` : ""}`,
    ...(days !== null ? [formatCountdown(days).toLowerCase()] : []),
    ...(leads.length ? [`Lead ${joinNames(leads)}`] : []),
    ...(songs.length ? [plural(songs.length, "canción", "canciones")] : []),
    ...(seats.length ? [`te toca: ${seats.join(", ")}`] : []),
  ].join(", ");

  // The same `downloadICS` as `DownloadCalendarRow` on `/me`, for the ONE service
  // this row stands for rather than the member's whole upcoming list. The UID
  // prefers `serviceId` (the service document's own `_id`, set at both call
  // sites) over `roleId` (only ever set for a special) so a weekend service
  // gets a stable per-document UID too, matching `/me`'s `<_id>@owt` form.
  // A Sanity `_id` goes in RAW — `/me`'s own export uses the raw `_id`, and a
  // document id may carry uppercase, so folding it here would mint a SECOND UID
  // for the same service and the calendar would hold two copies of it. Only the
  // `${date}-${day}` fallback is `normalizeText`ed, because `props.day` is a
  // Spanish label ("Sábado") and non-ASCII has no business in a UID.
  function addToCalendar() {
    if (!props.date) return;
    const event: ICSEvent = {
      uid: props.serviceId || props.roleId || normalizeText(`${props.date}-${props.day}`),
      date: props.date,
      // Same start time as `/me`'s whole-list download and the feed: this row and
      // that list mint the same UID for one service, so they must agree on when
      // it starts. `roleId` is only ever set for a special (see above).
      time: serviceStartTime(props.roleId ? "special" : "weekend", props.day, props.time),
      title: `${props.day} · Oasis Worship`,
      description: props.setlist?.songs?.map((s) => s.title).filter(Boolean).join(" · ") || undefined,
    };
    downloadICS([event], `servicio-${props.date.slice(0, 10)}.ics`);
  }

  const actions: QuickAction[] = [
    { label: "Ver en calendario", onSelect: () => router.push("/schedule") },
    ...(props.date ? [{ label: "Añadir a mi calendario", onSelect: addToCalendar } satisfies QuickAction] : []),
  ];

  return (
    <article className="brand-surface relative overflow-hidden rounded-[var(--brand-radius-panel)] transition-[border-color] duration-fast ease-out-brand hover:border-ink/20">
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 z-[1] w-[3px] origin-top animate-rail-draw [animation-delay:calc(var(--reveal-i,0)*40ms+120ms)] ${TONE_RAIL[tone]}`}
      />
      {/* A raw <button>, not the house Button: the card's head is a disclosure row (the
          row is the affordance), the same exemption SongRow and LibraryRow carry. Its
          focus ring is `ring-inset`: the card clips, and an outset ring would vanish. */}
      <button
        type="button"
        {...longPress}
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="relative flex w-full gap-3.5 py-4 pl-5 pr-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
      >
        {/* `decorative`: the head's own label already says the date. */}
        {props.date && <DateTile decorative date={props.date.slice(0, 10)} tone={toneStyle} />}
        <span className="block min-w-0 flex-1 space-y-2">
          <span className="flex items-start justify-between gap-3">
            <span className="block min-w-0 break-words pt-0.5 font-display text-[22px] font-semibold uppercase leading-none tracking-[0.02em] text-ink md:text-2xl">
              {props.day}
            </span>
            <span aria-hidden className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/[0.12] text-ink-muted">
              <ChevronDownIcon size={16} className={`transition-transform duration-base ease-out-brand ${open ? "rotate-180" : ""}`} />
            </span>
          </span>
          {/* Same-day sets differ only by the clock, so the folded card carries it. */}
          {clock && (
            <span className="flex items-center gap-1.5 font-body text-[15px] leading-snug text-ink-muted">
              <ClockIcon size={14} className="shrink-0 text-ink-dim" />
              <span className="font-semibold tabular-nums text-ink">{clock}</span>
            </span>
          )}
          {/* Wraps rather than truncates: at «Máximo» a chip drops under the other
              instead of pushing anything off the card. */}
          {(days !== null || seats.length > 0) && (
            <span className="flex flex-wrap items-center gap-1.5">
              {days !== null && <span className={COUNTDOWN_CHIP}>{formatCountdown(days)}</span>}
              {seats.length > 0 && (
                <span className={MINE_CHIP}>
                  <SeatIcon seat={seats[0]} size={11} />
                  Tú · {seats.join(", ")}
                </span>
              )}
            </span>
          )}
          {/* Folded, the card still says who leads and whether the songs are in — as
              faces and pictures. It closes as the body opens (the crossed `Collapse` of
              a Jóvenes card), its top padding inside so an open card keeps no gap. */}
          <Collapse open={!open}>
            <ServiceFacts leads={leads} songs={songs} photos={props.photos} myName={myName} className="pt-1" />
          </Collapse>
        </span>
      </button>
      {/* The padding rides on Collapse's inner div: a padded animated element
          floors its own height under border-box and never closes to zero. */}
      <Collapse open={open} id={id} className="border-t border-ink/[0.08] py-5 pl-5 pr-4">
        {/* `nested sheet`: this card already names the service, so the inner one draws
            the sheet's body alone — songs with their pictures, the team as faces. */}
        <DayCard {...props} nested sheet />
      </Collapse>
      <QuickActions
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={`${props.day}${shortDate ? ` · ${shortDate}` : ""}`}
        actions={actions}
      />
    </article>
  );
}
