// The Servicios panel's upcoming month pills. Built from the months that hold a
// service, PLUS the current month and the next `ahead` months even when empty —
// so a month can be opened in the stored editor and given its first service
// (the camp sets, spec 2026-09-22-camp-group-fill-design.md §12) without
// generating the whole month with the solver first.

/** "YYYY-MM" shifted by `n` months. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function upcomingMonthPills(roleMonths: string[], currentYM: string, ahead = 2): string[] {
  const out = new Set(roleMonths.filter((ym) => ym >= currentYM));
  for (let i = 0; i <= ahead; i++) out.add(addMonths(currentYM, i));
  return [...out].sort();
}
