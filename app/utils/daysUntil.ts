// The service countdown, in one neutral module: `daysUntil` used to live in
// the hero that is now `MeHeader.tsx` ("use client"), and R1 gave it three
// consumers — the hero, `DayCard`'s header pill and the collapsed disclosure.
// No imports, no hooks, so a Server Component may call it too.

// Whole days from `now` to the service date. Both anchors are pinned to LOCAL
// noon so the difference is a clean integer — comparing local midnight against
// the target's noon left a permanent +0.5 that Math.round pushed up, reporting
// a same-day service as "tomorrow". "Today" is pinned to America/Mexico_City
// rather than the runtime's local date, because the card is now server-rendered
// on `/` and Vercel's runtime clock is UTC — reading `now.getFullYear()` etc.
// there reports the team's evening service as still a day away.
export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const [y, m, d] = now
    .toLocaleDateString("sv", { timeZone: "America/Mexico_City" })
    .split("-")
    .map(Number);
  const todayNoon = new Date(y, m - 1, d, 12, 0, 0, 0);
  const target = new Date(dateStr.slice(0, 10) + "T12:00:00");
  return Math.round((target.getTime() - todayNoon.getTime()) / 86400_000);
}

// The countdown label. Negative days read as "Hace N días" rather than the
// nonsense "En -1 días" the hero's inline branch produced — every surface that
// shows this filters to upcoming services, so it is a floor, not a feature.
export function formatCountdown(days: number): string {
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  if (days < 0) return `Hace ${-days} día${days === -1 ? "" : "s"}`;
  return `En ${days} días`;
}
