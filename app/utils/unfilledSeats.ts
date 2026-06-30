/**
 * Turn the solver's `unfilled_seats` strings (e.g. "W2 Sunday Sun.Choir #2")
 * into a grouped, Spanish, user-facing summary for the schedule preview.
 *
 * A non-empty result means the month was short-staffed and the solver left some
 * non-Lead seats unfilled (degradation order: Choir → BGV → 2nd Lead).
 */

export interface UnfilledSummary {
  week: number;
  service: string; // "Domingo" | "Sábado"
  labels: string[]; // e.g. ["1 Líder", "2 Coros"]
}

const SERVICE_ES: Record<string, string> = {
  Sunday: "Domingo",
  Saturday: "Sábado",
};

// role -> [singular, plural]
const ROLE_ES: Record<string, [string, string]> = {
  Lead: ["Líder", "Líderes"],
  BGV: ["BGV", "BGV"],
  Choir: ["Coro", "Coros"],
};

// Most-severe degradation first.
const ROLE_SEVERITY: Record<string, number> = { Lead: 0, BGV: 1, Choir: 2 };

const SEAT_RE = /^W(\d+)\s+(\w+)\s+\w+\.(\w+)\s+#\d+$/;

export function summarizeUnfilledSeats(seats: string[]): UnfilledSummary[] {
  const groups = new Map<
    string,
    { week: number; service: string; counts: Record<string, number> }
  >();

  for (const seat of seats) {
    const m = SEAT_RE.exec(seat.trim());
    if (!m) continue;
    const week = parseInt(m[1], 10);
    const service = SERVICE_ES[m[2]] ?? m[2];
    const role = m[3];
    const key = `${week}|${service}`;
    if (!groups.has(key)) groups.set(key, { week, service, counts: {} });
    const g = groups.get(key)!;
    g.counts[role] = (g.counts[role] ?? 0) + 1;
  }

  const out: UnfilledSummary[] = [];
  for (const { week, service, counts } of groups.values()) {
    const labels = Object.entries(counts)
      .sort((a, b) => (ROLE_SEVERITY[a[0]] ?? 9) - (ROLE_SEVERITY[b[0]] ?? 9))
      .map(([role, n]) => {
        const [singular, plural] = ROLE_ES[role] ?? [role, role];
        return `${n} ${n === 1 ? singular : plural}`;
      });
    out.push({ week, service, labels });
  }

  return out.sort((a, b) => a.week - b.week || a.service.localeCompare(b.service));
}
