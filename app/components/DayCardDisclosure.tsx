"use client";

// A service that is NOT the next one, collapsed to a single line (spec §12.1):
// "SÁBADO · 19 sep        en 11 días ▾". Opening reveals the ordinary `DayCard`.
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
import { DayCard, type DayCardProps } from "./DayCard";
import Collapse from "./ui/Collapse";
import QuickActions, { type QuickAction } from "./ui/QuickActions";
import useLongPress from "./ui/useLongPress";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";
import { buildICS, type ICSEvent } from "@/app/utils/ics";
import { normalizeText } from "@/app/utils/normalizeText";

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

  // The same blob-download mechanics as `AddToCalendarButton`, for the ONE service
  // this row stands for rather than the member's whole upcoming list. The UID
  // prefers `serviceId` (the service document's own `_id`, set at both call
  // sites) over `roleId` (only ever set for a special) so a weekend service
<<<<<<< HEAD
  // gets a stable per-document UID too, matching `/me`'s `<_id>@owt` form —
  // `normalizeText` strips accents/case so the `${date}-${day}` fallback never
  // carries non-ASCII into the UID.
  function addToCalendar() {
    if (!props.date) return;
    const event: ICSEvent = {
      uid: normalizeText(props.serviceId || props.roleId || `${props.date}-${props.day}`),
=======
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
>>>>>>> claude/motion-r7-appwide
      date: props.date,
      title: `${props.day} · OWT`,
      description: props.setlist?.songs?.map((s) => s.title).filter(Boolean).join(" · ") || undefined,
    };
    const blob = new Blob([buildICS([event])], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `servicio-owt-${props.date.slice(0, 10)}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const actions: QuickAction[] = [
    { label: "Ver en calendario", onSelect: () => router.push("/schedule") },
    ...(props.date ? [{ label: "Añadir a mi calendario", onSelect: addToCalendar } satisfies QuickAction] : []),
  ];

  return (
    <div className="rounded-[var(--brand-radius-panel)] border border-ink-dim/15">
      {/* A raw <button>, not the house Button: this is a disclosure row (the row is
        the affordance), the same exemption SongRow and LibraryRow carry. */}
    <button
        type="button"
        {...longPress}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="font-display text-lg uppercase text-ink">
          {props.day}
          {shortDate && <span className="text-ink-dim font-normal"> · {shortDate}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-3 font-label text-[11px] uppercase tracking-widest text-ink-dim">
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
      <Collapse open={open} id={id} className="px-2 pb-2">
        <DayCard {...props} />
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
