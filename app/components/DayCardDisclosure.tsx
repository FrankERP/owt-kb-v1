"use client";

// A service that is NOT the next one, collapsed to a row (spec §12.1):
// "SÁBADO · 19 sep        en 11 días ▾" over a summary — «Lead Gaby y Pau · 5
// canciones» and, when you serve, a «Tú · BGVs» chip (the Inicio redesign,
// 2026-10-21). Opening reveals the ordinary `DayCard`.
// Home renders the next service in full and every other one through this, so the
// page is the run sheet plus a couple of lines instead of a wall of cards.
//
// The caller only hands this a service whose card actually paints (home filters
// on `paintsDayCard` before splitting hero from rest) — a header over an empty
// `Collapse` would open onto nothing.
//
// `Collapse` keeps its children mounted, so the `DayCard` inside a closed one
// still runs `usePlayer`/`useSession`; both providers are global, and a closed
// Collapse is inert + aria-hidden, so nothing inside it is reachable.

//
// A long press on the row (R7 Task 4, spec §12.8) opens its quick actions —
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

/**
 * `sheet` (ADR-0070): home's «Después» list — a hairline row in the page's own
 * type (17 px sentence-case title, a plain countdown) with no card chrome and no
 * tone rail; the parent draws the dividers. Without it, the opaque card with the
 * day rail, as the calendar still shows it.
 */
export default function DayCardDisclosure({ sheet = false, ...props }: DayCardProps & { sheet?: boolean }) {
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
  const songs = props.setlist?.songs?.length ?? 0;
  const summary = [
    ...(props.leads?.length ? [`Lead ${joinNames(props.leads)}`] : []),
    ...(songs ? [`${songs} ${songs === 1 ? "canción" : "canciones"}`] : []),
  ].join(" · ");

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
      title: `${props.day} · OWT`,
      description: props.setlist?.songs?.map((s) => s.title).filter(Boolean).join(" · ") || undefined,
    };
    downloadICS([event], `servicio-owt-${props.date.slice(0, 10)}.ics`);
  }

  const actions: QuickAction[] = [
    { label: "Ver en calendario", onSelect: () => router.push("/schedule") },
    ...(props.date ? [{ label: "Añadir a mi calendario", onSelect: addToCalendar } satisfies QuickAction] : []),
  ];

  return (
    // Opaque, with the card's tone rail (2026-10-20). The row's focus ring is
    // `ring-inset`: this wrapper clips, and an outset ring would vanish.
    <div className={sheet ? "relative" : "brand-surface overflow-hidden rounded-[var(--brand-radius-panel)]"}>
      {!sheet && <span aria-hidden className={`absolute inset-y-0 left-0 z-[1] w-[3px] ${TONE_RAIL[serviceTone(props)]}`} />}
      {/* A raw <button>, not the house Button: this is a disclosure row (the row is
        the affordance), the same exemption SongRow and LibraryRow carry. */}
    <button
        type="button"
        {...longPress}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 ${sheet ? "min-h-[4.5rem] py-4" : "px-5 py-4"}`}
      >
        <span className="min-w-0">
          <span className={sheet ? "block font-body text-[17px] font-semibold text-ink" : "block font-display text-lg uppercase text-ink"}>
            {props.day}
            {shortDate && <span className="text-ink-dim font-normal"> · {shortDate}</span>}
            {/* Same-day sets differ only by the clock, so the collapsed row carries
                it too — matching `DayCard`'s own `day · date · time` header. */}
            {props.time && <span className="text-ink-dim font-normal tabular-nums"> · {props.time}</span>}
          </span>
          {(summary || seats.length > 0) && (
            // Wraps rather than truncates: at «Máximo» the chip drops under the
            // summary instead of pushing the countdown off the row.
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-sm text-ink-muted">
              {summary && <span className="break-words">{summary}</span>}
              {/* The agenda's «tú» chip, class for class: one signal on both surfaces. */}
              {seats.length > 0 && (
                <span className="rounded-full border border-positive-fg/35 bg-positive-fg/10 px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-positive-fg">
                  Tú · {seats.join(", ")}
                </span>
              )}
            </span>
          )}
        </span>
        <span className={`flex shrink-0 items-center gap-3 ${sheet ? "font-body text-sm text-ink-muted" : "font-label text-[11px] uppercase tracking-widest text-ink-dim"}`}>
          {days !== null && formatCountdown(days).toLowerCase()}
          {/* `currentColor` on purpose: `var()` is not substituted inside an SVG
              presentation attribute, so the stroke inherits the span's colour. */}
          <svg
            aria-hidden
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transition-transform duration-base ease-out-brand ${open ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {/* The padding rides on Collapse's inner div: a padded animated element
          floors its own height under border-box and never closes to zero. */}
      <Collapse open={open} id={id} className={sheet ? "pb-4" : "px-2 pb-2"}>
        {/* `nested`: this wrapper already is the card (ground, hairline, rail), so the
            inner one drops its own chrome — two rails 5 px apart otherwise. */}
        {/* `sheet` with `sheet`: the open row keeps the hairline typography and draws
            no card header — this row already names the service. */}
        <DayCard {...props} nested sheet={sheet} />
      </Collapse>
      <QuickActions
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={`${props.day}${shortDate ? ` · ${shortDate}` : ""}`}
        actions={actions}
      />
    </div>
  );
}
