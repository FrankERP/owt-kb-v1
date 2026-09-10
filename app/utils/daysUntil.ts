// The service countdown, in one neutral module: `daysUntil` used to live in
// `NextServiceHero.tsx` ("use client"), and R1 gave it three consumers — the
// hero, `DayCard`'s header pill and the collapsed disclosure. No imports, no
// hooks, so a Server Component may call it too.

// Whole days from `now` to the service date. Both anchors are pinned to LOCAL
// noon so the difference is a clean integer — comparing local midnight against
// the target's noon left a permanent +0.5 that Math.round pushed up, reporting
// a same-day service as "tomorrow".
export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
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
