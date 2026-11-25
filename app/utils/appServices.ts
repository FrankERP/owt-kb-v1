// The native app's «Próximos servicios» (ADR-0091; native/ios): the same worship services the
// Calendario shows, read with the same rules, shaped for a phone.
//
// NEUTRAL module (no client, no I/O): the route fetches `APP_SERVICES_QUERY` through the
// published-perspective `operationalClient` and hands the rows to `buildAppServices`, which is
// tested without a network. What it keeps from the web, on purpose:
//
//  - draft gating: a role with `published == false` is not read (absent = visible), like every
//    member-facing worship read; setlists ride on their role's week;
//  - fail closed on a duplicate weekend target (`indexUniqueByKey`): two Sunday roles, or two
//    Sunday setlists, for one week show NO service that week rather than an arbitrary one;
//  - a special is its own target, keyed by id, so two on one day both show;
//  - the window: today (CDMX) through +95 days, the Calendario's default view.
//
// What it does better than the web: «tú» is decided by member ID (the web matches display
// names), so two people who share an alias never see each other's seat as their own.

import { indexUniqueByKey, serviceDayKey } from "./serviceReadSelect";
import { pastorMessageBodyOf } from "./serviceThread";
import { SONG_COVER_GROQ, songCoverUrl } from "./songCover";
import { serviceStartTime } from "./calendarFeed";
import { seatLabel } from "./myWeek";
import { isWorshipNight } from "./serviceFormat";
import { SPECIAL_SERVICE_FALLBACK } from "./emailServiceLabel";

export const APP_SERVICES_DAYS_AHEAD = 95;

/** Today in CDMX, then the window's last day: `YYYY-MM-DD` string math at UTC noon, no clock skew. */
export function appServicesWindow(today: string): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const to = new Date(Date.UTC(y!, m! - 1, d! + APP_SERVICES_DAYS_AHEAD, 12)).toISOString().slice(0, 10);
  return { from: today, to };
}

const PHOTO = `coalesce(profilePhoto.asset->url, googlePhotoUrl)`;
const PERSON = `"id": person._ref, "name": coalesce(person->alias, person->member_name), "photo": coalesce(person->profilePhoto.asset->url, person->googlePhotoUrl)`;
const MEMBER = `{ _id, member_name, alias, "photo": ${PHOTO} }`;
const SONG = `play_key, medley_tag,
    "id": song->_id, "slug": song->slug.current, "title": song->title, "author": song->author,
    "songKey": song->key, "bpm": song->bpm, "timeSig": song->timeSig, "cover": ${SONG_COVER_GROQ}`;
const ROLE = `_id, _type, week, date, time, service_name, format, team_notes,
  Lead[]->${MEMBER}, BGVs[]->${MEMBER}, Chorus[]->${MEMBER},
  instruments[]{ instrument, ${PERSON} },
  foh_team[]{ role, ${PERSON} },
  "pastor_message": ${pastorMessageBodyOf("^._id")}`;
const SETLIST = `week, team_notes, songs[]{ ${SONG} }`;

/** One read for the whole window. Every value is a GROQ parameter; nothing is interpolated at run time. */
export const APP_SERVICES_QUERY = `{
  "sundays":     *[_type == "sunday_role"   && week >= $from && week <= $to && published != false] { ${ROLE} },
  "saturdays":   *[_type == "saturday_role" && week >= $from && week <= $to && published != false] { ${ROLE} },
  "specials":    *[_type == "special_role"  && date >= $from && date <= $to && published != false] { ${ROLE},
    songs[]{ ${SONG}, "leads": leads[]->{ member_name, alias } } },
  "sunSetlists": *[_type == "featuredSongs" && week >= $from && week <= $to] { ${SETLIST} },
  "satSetlists": *[_type == "saturdarSongs" && week >= $from && week <= $to] { ${SETLIST} }
}`;

// ─── Rows as GROQ returns them (every field may be null) ────────────────────────

type MemberRow = { _id?: string | null; member_name?: string | null; alias?: string | null; photo?: string | null } | null;
type SeatRow = { instrument?: string | null; role?: string | null; id?: string | null; name?: string | null; photo?: string | null } | null;
type SongRow = {
  play_key?: string | null;
  medley_tag?: string | null;
  id?: string | null;
  slug?: string | null;
  title?: string | null;
  author?: string | null;
  songKey?: string | null;
  bpm?: number | string | null;
  timeSig?: string | null;
  cover?: string | null;
  leads?: Array<{ member_name?: string | null; alias?: string | null } | null> | null;
} | null;
export type AppRoleRow = {
  _id?: string | null;
  _type?: string | null;
  week?: string | null;
  date?: string | null;
  time?: string | null;
  service_name?: string | null;
  format?: string | null;
  team_notes?: string | null;
  Lead?: MemberRow[] | null;
  BGVs?: MemberRow[] | null;
  Chorus?: MemberRow[] | null;
  instruments?: SeatRow[] | null;
  foh_team?: SeatRow[] | null;
  pastor_message?: string | null;
  songs?: SongRow[] | null;
};
export type AppSetlistRow = { week?: string | null; team_notes?: string | null; songs?: SongRow[] | null };
export type AppServicesRows = {
  sundays?: AppRoleRow[] | null;
  saturdays?: AppRoleRow[] | null;
  specials?: AppRoleRow[] | null;
  sunSetlists?: AppSetlistRow[] | null;
  satSetlists?: AppSetlistRow[] | null;
};

// ─── The wire shape (the app decodes exactly this) ──────────────────────────────

export type AppPerson = { id: string | null; name: string; seat: string; photo: string | null; mine: boolean };
export type AppSection = { id: "voces" | "banda" | "cabina"; label: string; people: AppPerson[] };
export type AppSong = {
  id: string | null;
  slug: string | null;
  title: string;
  author: string | null;
  /** The key the team plays it in this service. */
  key: string | null;
  /** The song's own key in the library. */
  songKey: string | null;
  bpm: number | null;
  timeSig: string | null;
  cover: string | null;
  coverLarge: string | null;
  medley: string | null;
  /** A worship night's song leaders (one or two); empty otherwise. */
  leads: string[];
};
export type AppService = {
  id: string;
  kind: "sunday" | "saturday" | "special";
  date: string;
  /** `"HH:mm"` wall-clock CDMX by the calendar feed's rule; null = all day. */
  time: string | null;
  title: string;
  worshipNight: boolean;
  /** The caller's seats here, «Lead · Keys» order; empty when they do not serve. */
  mySeats: string[];
  sections: AppSection[];
  songs: AppSong[];
  teamNotes: string | null;
  pastorMessage: string | null;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** A face at 3× a 48 pt circle, square, JPEG (WebP decodes poorly on iOS). A Google photo passes through. */
export function appAvatarUrl(url: unknown): string | null {
  const u = text(url);
  if (!u) return null;
  if (!u.startsWith("https://cdn.sanity.io/images/")) return u;
  return `${u.split("?")[0]}?w=144&h=144&fit=crop&fm=jpg`;
}

function memberName(m: MemberRow): string | null {
  return m ? (text(m.alias) ?? text(m.member_name)) : null;
}

function bpmOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function songsOf(rows: SongRow[] | null | undefined): AppSong[] {
  if (!Array.isArray(rows)) return [];
  const out: AppSong[] = [];
  for (const s of rows) {
    const title = s ? text(s.title) : null;
    if (!s || !title) continue; // a dangling song reference is not a song
    out.push({
      id: text(s.id),
      slug: text(s.slug),
      title,
      author: text(s.author),
      key: text(s.play_key),
      songKey: text(s.songKey),
      bpm: bpmOf(s.bpm),
      timeSig: text(s.timeSig),
      cover: songCoverUrl(s.cover, "tile"),
      coverLarge: songCoverUrl(s.cover, "hero"),
      medley: text(s.medley_tag),
      leads: (Array.isArray(s.leads) ? s.leads : []).map((l) => (l ? (text(l.alias) ?? text(l.member_name)) : null)).filter((n): n is string => !!n),
    });
  }
  return out;
}

function sectionsOf(role: AppRoleRow, me: string): { sections: AppSection[]; mySeats: string[] } {
  const voice = (rows: MemberRow[] | null | undefined, seat: string): AppPerson[] =>
    (Array.isArray(rows) ? rows : []).flatMap((m) => {
      const name = memberName(m);
      if (!m || !name) return [];
      const id = text(m._id);
      return [{ id, name, seat, photo: appAvatarUrl(m.photo), mine: id === me }];
    });
  const seats = (rows: SeatRow[] | null | undefined, label: "instrument" | "role"): AppPerson[] =>
    (Array.isArray(rows) ? rows : []).flatMap((s) => {
      const name = s ? text(s.name) : null;
      if (!s || !name) return []; // an empty seat is not a person
      const id = text(s.id);
      return [{ id, name, seat: text(s[label]) ?? "", photo: appAvatarUrl(s.photo), mine: id === me }];
    });

  const leads = voice(role.Lead, "Lead");
  const bgvs = voice(role.BGVs, "BGV");
  const chorus = voice(role.Chorus, "Coro");
  const band = seats(role.instruments, "instrument");
  const booth = seats(role.foh_team, "role");
  const sections: AppSection[] = [
    { id: "voces" as const, label: "Voces", people: [...leads, ...bgvs, ...chorus] },
    { id: "banda" as const, label: "Banda", people: band },
    { id: "cabina" as const, label: "Cabina", people: booth },
  ].filter((s) => s.people.length > 0);

  // The SAME order and words as `/me` and the `.ics` (seatLabel), decided by id.
  const label = seatLabel({
    isLead: leads.some((p) => p.mine),
    myInstrument: band.filter((p) => p.mine).map((p) => p.seat).filter(Boolean).join(" · ") || undefined,
    myFohRole: booth.filter((p) => p.mine).map((p) => p.seat).filter(Boolean).join(" · ") || undefined,
    isBGV: bgvs.some((p) => p.mine),
    isChorus: chorus.some((p) => p.mine),
  });
  return { sections, mySeats: label ? label.split(" · ") : [] };
}

/**
 * The services in the window, earliest first (date, then start time, then title). `me` is the
 * caller's member id. Records with no usable date are dropped, as the Calendario drops them.
 */
export function buildAppServices(rows: AppServicesRows, me: string): AppService[] {
  const list = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
  const sunSets = indexUniqueByKey(list(rows.sunSetlists), (s) => serviceDayKey(s.week));
  const satSets = indexUniqueByKey(list(rows.satSetlists), (s) => serviceDayKey(s.week));
  const sundays = indexUniqueByKey(list(rows.sundays), (r) => serviceDayKey(r.week));
  const saturdays = indexUniqueByKey(list(rows.saturdays), (r) => serviceDayKey(r.week));

  const out: AppService[] = [];
  const weekend = (kind: "sunday" | "saturday", roles: Map<string, AppRoleRow>, sets: Map<string, AppSetlistRow>) => {
    roles.forEach((role, date) => {
      const id = text(role._id);
      if (!id) return;
      const set = sets.get(date);
      const day = kind === "sunday" ? "Domingo" : "Sábado";
      out.push({
        id,
        kind,
        date,
        time: serviceStartTime("weekend", day, null) ?? null,
        title: day,
        worshipNight: false,
        ...sectionsOf(role, me),
        songs: songsOf(set?.songs),
        teamNotes: text(set?.team_notes),
        pastorMessage: text(role.pastor_message),
      });
    });
  };
  weekend("sunday", sundays, sunSets);
  weekend("saturday", saturdays, satSets);

  for (const sp of list(rows.specials)) {
    const id = text(sp?._id);
    const date = serviceDayKey(sp?.date);
    if (!sp || !id || !date) continue;
    out.push({
      id,
      kind: "special",
      date,
      time: serviceStartTime("special", "", sp.time) ?? null,
      title: text(sp.service_name) ?? SPECIAL_SERVICE_FALLBACK,
      worshipNight: isWorshipNight(sp),
      ...sectionsOf(sp, me),
      songs: songsOf(sp.songs),
      teamNotes: text(sp.team_notes),
      pastorMessage: text(sp.pastor_message),
    });
  }

  return out.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.title.localeCompare(b.title, "es"),
  );
}
