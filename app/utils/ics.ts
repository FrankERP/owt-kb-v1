// Minimal iCalendar (.ics) builder (RFC 5545) for service events.
//
// Two callers: the one-shot download on `/me` (`AddToCalendarButton`, all-day events) and the
// member calendar feed (`app/api/calendar/[memberId]/[token]/route.ts`, all-day weekends plus
// timed specials). NEUTRAL module — no "use client", no imports — so both a client component and
// a route handler may call it.

export interface ICSEvent {
  uid: string;
  date: string;        // YYYY-MM-DD
  title: string;
  description?: string;
  /** `"HH:mm"`, wall-clock America/Mexico_City. Absent → an all-day event. Already validated
   *  by the caller (`isServiceTime`); it is only ever formatted as text, never made a `Date`. */
  time?: string;
  /** Length of a timed event, in minutes (default 120). Ignored for all-day events. */
  durationMinutes?: number;
  url?: string;
}

export interface ICSOptions {
  /** Domain appended to every UID (`<uid>@<domain>`). */
  uidDomain?: string;
  /** Hint to the subscribing app on how often to re-fetch (`REFRESH-INTERVAL`,
   *  `X-PUBLISHED-TTL`). Only meaningful for a subscription feed. */
  refreshMinutes?: number;
}

/** The one timezone every service time is written in. Mexico has had no DST since 2022, so a
 *  single STANDARD rule at UTC−6 is exact for every date the app shows. */
export const ICS_TZID = "America/Mexico_City";

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${ICS_TZID}`,
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0600",
  "TZNAME:CST",
  "END:STANDARD",
  "END:VTIMEZONE",
];

function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function ymd(date: string): string {
  return date.slice(0, 10).replace(/-/g, "");
}

function addDay(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, "");
}

const encoder = new TextEncoder();

/**
 * RFC 5545 §3.1: a content line is at most 75 OCTETS; longer lines continue on the next line
 * after CRLF + one space. Splits only between code points, so a multi-byte character (an accent,
 * the ⭐ in a title) is never cut in half.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75; // the first line holds 75 octets; continuations hold 74 after the space
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function durationOf(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `PT${h ? `${h}H` : ""}${r ? `${r}M` : ""}`;
}

export function buildICS(events: ICSEvent[], calName = "Oasis Worship Team", options: ICSOptions = {}): string {
  const uidDomain = options.uidDomain ?? "owt";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const timed = events.some((e) => e.time);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OWT//Servicios//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calName)}`,
  ];
  if (options.refreshMinutes) {
    const every = durationOf(options.refreshMinutes);
    lines.push(`X-WR-TIMEZONE:${ICS_TZID}`, `REFRESH-INTERVAL;VALUE=DURATION:${every}`, `X-PUBLISHED-TTL:${every}`);
  }
  if (timed) lines.push(...VTIMEZONE);
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@${uidDomain}`, `DTSTAMP:${stamp}`);
    if (e.time) {
      lines.push(
        `DTSTART;TZID=${ICS_TZID}:${ymd(e.date)}T${e.time.replace(":", "")}00`,
        `DURATION:${durationOf(e.durationMinutes ?? 120)}`,
      );
    } else {
      lines.push(`DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${addDay(e.date)}`);
    }
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n");
}
