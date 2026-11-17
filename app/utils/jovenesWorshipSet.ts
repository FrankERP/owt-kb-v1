import "server-only";

// Alabanza's setlist for a Saturday of Jóvenes (ADR-0089; plan
// `docs/superpowers/plans/2026-11-17-jovenes-meeting-parts.md` §6). Frank, 2026-11-17: «Estaría
// bueno que jalaras el set de la parte de alabanza para que ellos supieran cuales son las
// canciones».
//
// THE ONE PLACE a Jóvenes pastor sees worship data, so it hands over as little as the ask needs:
// each song's title and the key it is played in. No team, no notes, no links (a Jóvenes-only
// pastor cannot open a song page), and nothing at all for a service that is still a draft — the
// same rule the worship home applies (`publishedSetlist`): a setlist is shown only when that
// date's role is published, and an ambiguous duplicate of either shows nothing (`pickUnique`).

import { operationalClient } from "@/sanity/lib/operationalClient";
import { publishedSetlist } from "./draftGating";
import { pickUnique } from "./serviceReadSelect";

export type WorshipSong = { title: string; key: string | null };

/** A Saturday's role (published or absent) and its setlist, by `week` (the Saturday's own date). */
export const SATURDAY_SETS_QUERY = `{
  "roles": *[_type == "saturday_role" && week in $dates && published != false]{ week },
  "sets": *[_type == "saturdarSongs" && week in $dates]{ week, "songs": songs[]{ "title": song->title, "key": play_key } }
}`;

type Row = { week?: unknown; songs?: unknown };
type Result = { roles?: Row[] | null; sets?: Row[] | null } | null;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (x: unknown): string | null => (typeof x === "string" && ISO_DATE.test(x.slice(0, 10)) ? x.slice(0, 10) : null);

/** Pure half: the query's answer as songs per date. Exported for the groq-js test. */
export function saturdaySetsFrom(result: Result, dates: readonly string[]): Map<string, WorshipSong[]> {
  const out = new Map<string, WorshipSong[]>();
  const roles = Array.isArray(result?.roles) ? result.roles : [];
  const sets = Array.isArray(result?.sets) ? result.sets : [];
  for (const date of new Set(dates)) {
    const role = pickUnique(roles.filter((r) => day(r?.week) === date));
    const set = publishedSetlist(role, pickUnique(sets.filter((s) => day(s?.week) === date)));
    if (!set || !Array.isArray(set.songs)) continue;
    const songs = set.songs
      .filter((s): s is { title: string; key?: unknown } => !!s && typeof s === "object" && typeof (s as { title?: unknown }).title === "string" && (s as { title: string }).title.trim() !== "")
      .map((s) => ({ title: s.title.trim(), key: typeof s.key === "string" && s.key.trim() ? s.key.trim() : null }));
    if (songs.length > 0) out.set(date, songs);
  }
  return out;
}

/**
 * The published Saturday setlists of these dates, as titles and keys. The caller passes only the
 * dates of Saturday meetings its reader already holds; a date with no published service, no
 * setlist or no songs is simply absent. A failed read answers «no setlists», never an error page:
 * the songs are a courtesy on a meeting, not the meeting.
 */
export async function readSaturdaySets(dates: readonly string[]): Promise<Map<string, WorshipSong[]>> {
  const wanted = [...new Set(dates.filter((d) => ISO_DATE.test(d)))];
  if (wanted.length === 0) return new Map();
  try {
    const result = await operationalClient.fetch<Result>(SATURDAY_SETS_QUERY, { dates: wanted });
    return saturdaySetsFrom(result, wanted);
  } catch (err) {
    console.error(JSON.stringify({ event: "jovenes_worship_set_failed" }), err);
    return new Map();
  }
}
