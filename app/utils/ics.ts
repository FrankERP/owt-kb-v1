// Minimal iCalendar (.ics) builder for all-day service events.

export interface ICSEvent {
  uid: string;
  date: string;        // YYYY-MM-DD (all-day)
  title: string;
  description?: string;
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function ymd(date: string): string {
  return date.slice(0, 10).replace(/-/g, "");
}

function addDay(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, "");
}

export function buildICS(events: ICSEvent[], calName = "Oasis Worship Team"): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OWT//Servicios//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calName)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@owt`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${addDay(e.date)}`,
      `SUMMARY:${esc(e.title)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
