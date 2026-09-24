// MCP OAuth — the consent page's «hace N minutos/horas/días» for how long ago
// a client registered (spec O8). Relative time needs no timezone. Neutral
// module, so the Server Component page may call it (ADR-0028).

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(n: number, one: string, many: string): string {
  return `hace ${n} ${n === 1 ? one : many}`;
}

/** Spanish relative age, floored to the largest whole unit. Negative or non-finite reads as just now. */
export function registrationAgeLabel(ageSeconds: number): string {
  const s = Number.isFinite(ageSeconds) && ageSeconds > 0 ? Math.floor(ageSeconds) : 0;
  if (s < MINUTE) return "hace menos de un minuto";
  if (s < HOUR) return plural(Math.floor(s / MINUTE), "minuto", "minutos");
  if (s < DAY) return plural(Math.floor(s / HOUR), "hora", "horas");
  return plural(Math.floor(s / DAY), "día", "días");
}
