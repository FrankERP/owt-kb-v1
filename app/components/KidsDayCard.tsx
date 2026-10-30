// app/components/KidsDayCard.tsx
// An Oasis Kids Sunday inside the Calendario's day sheet (2026-10-29), for a member of
// both Alabanza and Kids. The sheet's own title is the date and its line is «11:00 · En
// 2 días», so this is only the body: the ministry as a section title, then the four
// seats as hairline rows — the seat, the pair standing in it, and «Tú» in the app's one
// green where the reader is in that pair (decided by member id on the server). The
// planner and the full list stay on `/kids`, one tap away.
//
// NEUTRAL — no hooks — so either side of the boundary can render it.
import Button from "./ui/Button";
import { SHEET_TITLE } from "../utils/homeHero";
import type { KidsDaySeat } from "./CalendarView";

export default function KidsDayCard({ seats }: { seats: KidsDaySeat[] }) {
  return (
    <section aria-label="Oasis Kids">
      <h3 className={`${SHEET_TITLE} pb-2.5`}>Oasis Kids</h3>
      <ul className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
        {seats.map((s) => (
          <li key={s.seat} className="flex items-baseline justify-between gap-4 py-3">
            <span className="font-body text-[15px] text-ink-dim">{s.label}</span>
            <span
              className={`min-w-0 truncate text-right font-body text-[17px] ${
                s.mine ? "font-semibold text-positive-fg" : s.pair ? "text-ink" : "italic text-ink-muted"
              }`}
            >
              {s.mine ? `Tú · ${s.pair ?? ""}` : (s.pair ?? "Sin asignar")}
            </span>
          </li>
        ))}
      </ul>
      <Button href="/kids" variant="secondary" size="sm" className="mt-5">
        Ver Oasis Kids
      </Button>
    </section>
  );
}
