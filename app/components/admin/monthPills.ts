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

/**
 * A month tab's label (the Servicios board, phase 5 of the «millones» pass): the
 * full Spanish month name, capitalised — «Noviembre» — with the year only when it
 * is not the current one («Marzo 2025»), so «Roles previos» stays readable a year
 * on and the upcoming tabs carry no digits the admin has to parse.
 */
export function formatMonthTab(ym: string, currentYM: string): string {
  const date = new Date(`${ym}-01T12:00:00`);
  const month = date.toLocaleDateString("es-MX", { month: "long" });
  const name = month.charAt(0).toUpperCase() + month.slice(1);
  return ym.slice(0, 4) === currentYM.slice(0, 4) ? name : `${name} ${ym.slice(0, 4)}`;
}
