"use client";

import { DayCard, DayCardProps } from "./DayCard";
import NumberRoll from "./ui/NumberRoll";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";

type NextServiceHeroProps = DayCardProps;

export default function NextServiceHero(props: NextServiceHeroProps) {
  const { date } = props;
  const days = date ? daysUntil(date) : null;

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="brand-section-heading">
          <p className="mb-1 font-label text-[10px] uppercase tracking-[0.24em] text-accent">Próximo</p>
          <h2 className="font-display text-3xl font-semibold leading-none text-ink md:text-4xl">Tu próximo servicio</h2>
        </div>
        {days !== null && (
          <span className="shrink-0 rounded-full border border-positive-fg/25 bg-positive-fg/[0.055] px-3 py-1.5 font-label text-[10px] uppercase tracking-widest text-positive-fg">
            <NumberRoll value={formatCountdown(days)} />
          </span>
        )}
      </div>
      <DayCard {...props} />
    </div>
  );
}
