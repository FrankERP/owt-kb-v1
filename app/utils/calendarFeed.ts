// The member calendar feed's read model and event builder
// (docs/superpowers/specs/2026-10-15-member-calendar-feed-design.md, D4).
//
// NEUTRAL and pure — no Sanity client, no secret, no "use client" — so the route handler calls it
// and every rule is unit-testable over plain objects. The token half lives in
// `calendarFeedToken.ts` (server only: it needs `node:crypto` and the secret).

import { isServiceTime } from "./serviceTime";
import { pickUnique, serviceDayKey } from "./serviceReadSelect";
import { seatLabel } from "./myWeek";
import { SPECIAL_SERVICE_FALLBACK } from "./emailServiceLabel";
import type { ICSEvent } from "./ics";

/** The two feed variants: every published service, or only the member's own. */
export type FeedScope = "all" | "mine";

/** `?solo=mios` selects the member's own services; anything else is the whole schedule. */
export function feedScopeFromSearch(params: URLSearchParams): FeedScope {
  return params.get("solo") === "mios" ? "mine" : "all";
}

/** The only two query strings a feed URL may carry (spec D5): none, or exactly `?solo=mios`. */
export function isCanonicalFeedSearch(search: string): boolean {
  return search === "" || search === "?solo=mios";
}

export const FEED_DAYS_BACK = 60;
export const FEED_DAYS_AHEAD = 365;

/**
 * The CDMX window the feed spans: 60 days back (a past service stays on the calendar for a while
 * instead of vanishing the day after) to a year ahead. `sv` formats `YYYY-MM-DD`, which is what
 * Sanity `date` fields compare against.
 */
export function feedWindow(now: number = Date.now()): { from: string; to: string } {
  const day = 86_400_000;
  const fmt = (t: number) => new Date(t).toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  return { from: fmt(now - FEED_DAYS_BACK * day), to: fmt(now + FEED_DAYS_AHEAD * day) };
}

/** The five member-referencing seat paths (CLAUDE.md invariant), as a GROQ predicate on `$id`. */
const SEATED = `(
    $id in Lead[]._ref ||
    $id in BGVs[]._ref ||
    $id in Chorus[]._ref ||
    $id in instruments[].person._ref ||
    $id in foh_team[].person._ref
  )`;

const TEAM = `
      "seated": ${SEATED},
      "isLead": $id in Lead[]._ref,
      "isBGV": $id in BGVs[]._ref,
      "isChorus": $id in Chorus[]._ref,
      "myInstrument": instruments[person._ref == $id][0].instrument,
      "myFohRole": foh_team[person._ref == $id][0].role,
      "Lead": Lead[]->{ member_name, alias },
      "BGVs": BGVs[]->{ member_name, alias },
      "Chorus": Chorus[]->{ member_name, alias },
      "instruments": instruments[]{ instrument, "member_name": person->member_name, "alias": person->alias },
      "foh_team": foh_team[]{ role, "member_name": person->member_name, "alias": person->alias }`;

const SONG = `play_key, medley_tag, "title": song->title, "key": song->key`;

/**
 * One read for the whole feed, through the canonical published-perspective client (the caller's
 * job). `published != false` is the worship draft-gating rule (absent = visible). Weekend setlists
 * are joined by `week` and fetched as ARRAYS — collapsed with `pickUnique`, never `[0]`. No
 * `team_notes`, no email, no availability: the feed carries the schedule and nothing else (D4).
 */
export function calendarFeedQuery(scope: FeedScope): string {
  const mine = scope === "mine" ? ` && ${SEATED}` : "";
  return `{
    "sundays": *[_type == "sunday_role" && week >= $from && week <= $to && published != false${mine}] | order(week asc) {
      _id, "date": week,${TEAM},
      "setlists": *[_type == "featuredSongs" && week == ^.week] { songs[] { ${SONG} } }
    },
    "saturdays": *[_type == "saturday_role" && week >= $from && week <= $to && published != false${mine}] | order(week asc) {
      _id, "date": week,${TEAM},
      "setlists": *[_type == "saturdarSongs" && week == ^.week] { songs[] { ${SONG} } }
    },
    "specials": *[_type == "special_role" && date >= $from && date <= $to && published != false${mine}] | order(date asc, time asc) {
      _id, date, time, service_name,${TEAM},
      songs[] { ${SONG}, "leads": leads[]->{ member_name, alias } }
    }
  }`;
}

type Person = { member_name?: string | null; alias?: string | null } | null;
type FeedSong = {
  play_key?: string | null;
  medley_tag?: string | null;
  title?: string | null;
  key?: string | null;
  leads?: Person[] | null;
} | null;

export type FeedRole = {
  _id: string;
  date?: unknown;
  time?: unknown;
  service_name?: string | null;
  seated?: boolean;
  isLead?: boolean;
  isBGV?: boolean;
  isChorus?: boolean;
  myInstrument?: string | null;
  myFohRole?: string | null;
  Lead?: Person[] | null;
  BGVs?: Person[] | null;
  Chorus?: Person[] | null;
  instruments?: Array<{ instrument?: string | null } & NonNullable<Person> | null> | null;
  foh_team?: Array<{ role?: string | null } & NonNullable<Person> | null> | null;
  setlists?: Array<{ songs?: FeedSong[] | null } | null> | null;
  songs?: FeedSong[] | null;
};

export type FeedData = {
  sundays?: FeedRole[] | null;
  saturdays?: FeedRole[] | null;
  specials?: FeedRole[] | null;
} | null;

/** The display name every surface uses: alias, else name (`DayCard`'s own rule). */
function nameOf(p: Person): string {
  return (p?.alias?.trim() || p?.member_name?.trim() || "").trim();
}

function names(list: Person[] | null | undefined): string[] {
  return (Array.isArray(list) ? list : []).map(nameOf).filter(Boolean);
}

function songLines(songs: FeedSong[]): string[] {
  const lines: string[] = [];
  let n = 0;
  for (const s of songs) {
    const title = s?.title?.trim();
    if (!title) continue;
    n += 1;
    const key = s?.play_key?.trim() || s?.key?.trim();
    const leads = names(s?.leads);
    let line = `${n}. ${title}`;
    if (key) line += ` — Tono: ${key}`;
    if (s?.medley_tag?.trim()) line += " (medley)";
    if (leads.length) line += ` · dirige ${leads.join(" y ")}`;
    lines.push(line);
  }
  return lines;
}

function teamLines(role: FeedRole): string[] {
  const lines: string[] = [];
  const section = (label: string, list: string[]) => {
    if (list.length) lines.push(`${label}: ${list.join(", ")}`);
  };
  section("Lead", names(role.Lead));
  section("BGVs", names(role.BGVs));
  section("Coro", names(role.Chorus));
  for (const seat of Array.isArray(role.instruments) ? role.instruments : []) {
    const who = nameOf(seat);
    if (who) lines.push(`${seat?.instrument?.trim() || "Instrumento"}: ${who}`);
  }
  for (const seat of Array.isArray(role.foh_team) ? role.foh_team : []) {
    const who = nameOf(seat);
    if (who) lines.push(`FOH · ${seat?.role?.trim() || "Equipo"}: ${who}`);
  }
  return lines;
}

function serviceSongs(role: FeedRole, kind: "weekend" | "special"): FeedSong[] {
  if (kind === "special") return Array.isArray(role.songs) ? role.songs : [];
  const setlist = pickUnique(Array.isArray(role.setlists) ? role.setlists : null);
  return Array.isArray(setlist?.songs) ? setlist.songs : [];
}

/**
 * One `ICSEvent` per role document that paints something (a seat filled or a song), in date
 * order. A seated member's title leads with ⭐ and their seat (`seatLabel`, `/me`'s wording); the
 * seat is decided by member ID in the query (`seated`), never by comparing names.
 */
export function buildFeedEvents(data: FeedData, origin: string): ICSEvent[] {
  const rows: Array<{ role: FeedRole; label: string; kind: "weekend" | "special" }> = [
    ...(data?.sundays ?? []).map((role) => ({ role, label: "Domingo", kind: "weekend" as const })),
    ...(data?.saturdays ?? []).map((role) => ({ role, label: "Sábado", kind: "weekend" as const })),
    ...(data?.specials ?? []).map((role) => ({
      role,
      label: role?.service_name?.replace(/\s+/g, " ").trim() || SPECIAL_SERVICE_FALLBACK,
      kind: "special" as const,
    })),
  ];

  const events: Array<ICSEvent & { sortTime: string }> = [];
  for (const { role, label, kind } of rows) {
    if (!role?._id) continue;
    const date = serviceDayKey(role.date);
    if (!date) continue;
    const songs = songLines(serviceSongs(role, kind));
    const team = teamLines(role);
    if (!songs.length && !team.length) continue; // paints nothing — same rule as `/me`

    const seat = role.seated
      ? seatLabel({
          isLead: role.isLead,
          isBGV: role.isBGV,
          isChorus: role.isChorus,
          myInstrument: role.myInstrument ?? undefined,
          myFohRole: role.myFohRole ?? undefined,
        })
      : "";
    const title = role.seated
      ? `⭐ ${label}${seat ? ` · ${seat}` : ""} · Oasis Worship`
      : `${label} · Oasis Worship`;

    const description: string[] = [];
    if (role.seated) description.push(seat ? `Tu lugar: ${seat}` : "Te toca servir", "");
    description.push("Canciones", ...(songs.length ? songs : ["Setlist pendiente"]), "");
    description.push("Equipo", ...(team.length ? team : ["Sin asignar"]));
    if (origin) description.push("", `Abrir en la app: ${origin}/me`);

    const time = kind === "special" && isServiceTime(role.time) ? role.time : undefined;
    events.push({
      uid: role._id,
      date,
      title,
      description: description.join("\n"),
      time,
      url: origin ? `${origin}/me` : undefined,
      sortTime: time ?? "",
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.sortTime.localeCompare(b.sortTime));
  return events.map(({ sortTime: _sortTime, ...e }) => e);
}

export type FeedUrls = {
  /** https URL of the whole schedule (for copying). */
  all: string;
  /** https URL of only the member's services. */
  mine: string;
  /** webcal:// variants — iPhone/Mac open them straight into Calendar. */
  webcalAll: string;
  webcalMine: string;
  /** Google Calendar's "add by URL" deep links. */
  googleAll: string;
  googleMine: string;
};

/** What `/me/ajustes` hands `CalendarFeedPanel`: signed URLs, or one line saying why not.
 *  `preview` marks a dev deployment, where outside calendar apps cannot reach the feed. */
export type CalendarFeedState =
  | { kind: "ready"; urls: FeedUrls; preview?: boolean }
  | { kind: "unavailable"; message: string };

/** The calendar's name in the subscribing app. */
export function feedCalendarName(scope: FeedScope): string {
  return scope === "mine" ? "Oasis Worship · mis servicios" : "Oasis Worship";
}
