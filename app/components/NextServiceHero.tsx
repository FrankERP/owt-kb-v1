"use client";

import { DayCard, DayCardProps } from "./DayCard";

interface NextServiceHeroProps extends DayCardProps {}

// Whole days from `now` to the service date. Both anchors are pinned to LOCAL
// noon so the difference is a clean integer — comparing local midnight against
// the target's noon left a permanent +0.5 that Math.round pushed up, reporting
// a same-day service as "tomorrow".
export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const target = new Date(dateStr.slice(0, 10) + "T12:00:00");
  return Math.round((target.getTime() - todayNoon.getTime()) / 86400_000);
}

export default function NextServiceHero(props: NextServiceHeroProps) {
  const { date } = props;
  const days = date ? daysUntil(date) : null;

  let countdownText = "";
  if (days !== null) {
    if (days === 0) countdownText = "Hoy";
    else if (days === 1) countdownText = "Mañana";
    else countdownText = `En ${days} día${days !== 1 ? "s" : ""}`;
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="brand-section-heading">
          <p className="mb-1 font-label text-[10px] uppercase tracking-[0.24em] text-brand-beam">Próximo</p>
          <h2 className="font-display text-3xl font-semibold leading-none text-brand-frost md:text-4xl">Tu próximo servicio</h2>
        </div>
        {countdownText && (
          <span className="shrink-0 rounded-full border border-brand-signal/25 bg-brand-signal/[0.055] px-3 py-1.5 font-label text-[10px] uppercase tracking-widest text-brand-signal">
            {countdownText}
          </span>
        )}
      </div>
      <DayCard {...props} />
    </div>
  );
}
