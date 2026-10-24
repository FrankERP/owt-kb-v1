// The line home now leads with (the «premium» Inicio redesign, approved by Frank
// on a mock 2026-10-21): «Hola, Frank / Te toca el sábado / Lead con Gaby · en 4
// días · 5 canciones». It replaced «Programación / Esta semana», which read the
// same for everyone, when the one question a member opens the app with is "do I
// serve, and when".
//
// NEUTRAL module — no "use client" — because `app/(client)/page.tsx` is a Server
// Component and CALLS it (ADR-0028). Who "you" are is matched by display name, the
// same rule `DayCard` and the agenda use (`myNameFromSession` → `mySeats`), so the
// line and the green «tú» on the card can never disagree.

import { mySeats } from "./agenda";
import { daysUntil } from "./daysUntil";
import { compareServiceTime } from "./serviceTime";
import { serviceStartTime } from "./calendarFeed";
import { plural } from "./plural";

export type GreetingService = {
  day: string;
  date?: string;
  time?: string | null;
  setlist?: { songs?: unknown[] } | null;
  leads?: string[];
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
  bgvs?: Array<{ member_name: string; alias?: string }>;
  chorus?: Array<{ member_name: string; alias?: string }>;
};

export type HomeGreeting = {
  /** «Hola, Frank», or null when the session carries no name at all. */
  hello: string | null;
  /** The heading, split so the page can colour the day word: `${lead}${day}`. */
  lead: string;
  day: string;
  sub: string;
};

/** "Gaby" · "Gaby y Pau" · "Gaby, Pau y Lupe". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** The first word of alias || name: «Hola, Frank», not «Hola, Frank Rocha». */
export function firstName(user?: { alias?: string | null; name?: string | null }): string {
  const full = user?.alias?.trim() || user?.name?.trim() || "";
  return full.split(/\s+/)[0] ?? "";
}

/**
 * The greeting for the services home shows. `myName` is `myNameFromSession`'s
 * lowercased display name; `now` is injectable for tests. The service picked is
 * the EARLIEST upcoming one the member is seated in — by date, then by a special's
 * clock — never the hero card, which is the next service for everyone.
 */
export function homeGreeting(
  services: GreetingService[],
  user: { alias?: string | null; name?: string | null } | undefined,
  myName: string,
  now: Date = new Date(),
): HomeGreeting {
  const name = firstName(user);
  const hello = name ? `Hola, ${name}` : null;

  const mine = services
    .filter((s) => !!s.date && daysUntil(s.date, now) >= 0 && mySeats(s, myName).length > 0)
    // `compareServiceTime`, the one comparator: an untimed set sorts LAST, as the
    // page's own `order(date asc, time asc)` puts it.
    .sort((a, b) => a.date!.localeCompare(b.date!) || compareServiceTime(a.time, b.time))[0];

  if (!mine) return { hello, lead: "Esta semana", day: "", sub: "Esta vez no te toca servir." };

  const days = daysUntil(mine.date!, now);
  // Local noon, never a bare `new Date(iso)` — the UTC day-flip invariant.
  const weekday = new Date(mine.date!.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long" });
  const [lead, day] = days === 0 ? ["Te toca ", "hoy"] : days === 1 ? ["Te toca ", "mañana"] : ["Te toca el ", weekday];

  // «Lead con Gaby»: a co-lead is the one partner worth naming — the rest of the
  // team is on the card right below.
  const seats = mySeats(mine, myName).map((seat) => {
    if (seat !== "Lead") return seat;
    const others = (mine.leads ?? []).filter((l) => l.toLowerCase().trim() !== myName);
    return others.length ? `Lead con ${joinNames(others)}` : "Lead";
  });
  const weekend = mine.day === "Sábado" || mine.day === "Domingo";
  const songs = mine.setlist?.songs?.length ?? 0;
  const sub = [
    // A special names itself; «el sábado» already says Sábado.
    ...(weekend ? [] : [mine.time ? `${mine.day} · ${mine.time}` : mine.day]),
    seats.join(" · "),
    // A weekend's clock is the team's standing hour (the feed's rule). Since the
    // Inicio type pass (ADR-0070) the hero card has no countdown pill of its own,
    // so this line is where the hour lives: «Eléctrica · 11:00 · en 2 días».
    ...(weekend ? [serviceStartTime("weekend", mine.day, null)!] : []),
    // «hoy»/«mañana» are already the heading's own word.
    ...(days >= 2 ? [`en ${days} días`] : []),
    ...(songs ? [plural(songs, "canción", "canciones")] : []),
  ].join(" · ");

  return { hello, lead, day, sub };
}
