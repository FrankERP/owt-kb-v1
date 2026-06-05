import { client } from "@/sanity/lib/client";
import { Setlist, SetlistSong, SpecialRole } from "../utils/interface";
import Navbar from "../components/Navbar";
import SongSearchList from "../components/SongSearchList";
import { DayCard } from "../components/DayCard";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TZ = "America/Mexico_City";

function localToday(): string {
  return new Date().toLocaleDateString("sv", { timeZone: TZ });
}

function getThisWeekend(): { sat: string; sun: string } {
  const today = localToday();
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const daysUntilSun = dow === 0 ? 0 : 7 - dow;
  const sun = new Date(Date.UTC(y, m - 1, d + daysUntilSun));
  const sat = new Date(Date.UTC(y, m - 1, d + daysUntilSun - 1));
  return {
    sun: sun.toISOString().slice(0, 10),
    sat: sat.toISOString().slice(0, 10),
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

const POSTS_QUERY = `*[_type == "post"] | order(title asc) {
  _id, _createdAt, title, author, slug, publishDate, excerpt, timeSig, bpm, key,
  tags[]->{ _id, slug, name }
}`;

const SETLIST_FIELDS = `songs[]{
  play_key,
  medley_tag,
  "title": song->title, "slug": song->slug, "_id": song->_id,
  "author": song->author, "timeSig": song->timeSig, "bpm": song->bpm, "key": song->key
}, week`;

const ROLE_FIELDS = `week,
  Lead[]->{ member_name, alias },
  instruments[]{ instrument, "person": coalesce(person->alias, person->member_name) },
  foh_team[]{ role, "person": coalesce(person->alias, person->member_name) },
  BGVs[]->{ member_name, alias },
  Chorus[]->{ member_name, alias }`;

// One combined GROQ fetch for all weekend data — GROQ params prevent query cache misses
const WEEKEND_QUERY = `{
  "sunSongs": *[_type == "featuredSongs"  && week == $sun][0] { ${SETLIST_FIELDS} },
  "satSongs": *[_type == "saturdarSongs"  && week == $sat][0] { ${SETLIST_FIELDS} },
  "sunRole":  *[_type == "sunday_role"    && week == $sun][0] { ${ROLE_FIELDS} },
  "satRole":  *[_type == "saturday_role"  && week == $sat][0] { ${ROLE_FIELDS} },
  "specials": *[_type == "special_role"   && date >= $today && date <= $sun] | order(date asc) {
    _id, date, service_name,
    songs[]{ play_key, medley_tag, "title": song->title, "slug": song->slug, "_id": song->_id, "author": song->author, "key": song->key },
    ${ROLE_FIELDS}
  }
}`;

export const revalidate = 60;

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function Home() {
  const { sat, sun } = getThisWeekend();
  const today = localToday();

  const [posts, weekend] = await Promise.all([
    client.fetch(POSTS_QUERY),
    client.fetch<{
      sunSongs: Setlist | null;
      satSongs: Setlist | null;
      sunRole: { week: string; Lead: { member_name: string; alias?: string }[]; instruments: { instrument: string; person: string }[]; foh_team: { role: string; person: string }[]; BGVs: { member_name: string; alias?: string }[]; Chorus: { member_name: string; alias?: string }[] } | null;
      satRole: { week: string; Lead: { member_name: string; alias?: string }[]; instruments: { instrument: string; person: string }[]; foh_team: { role: string; person: string }[]; BGVs: { member_name: string; alias?: string }[]; Chorus: { member_name: string; alias?: string }[] } | null;
      specials: SpecialRole[];
    }>(WEEKEND_QUERY, { sun, sat, today }),
  ]);

  const { sunSongs, satSongs, sunRole, satRole, specials } = weekend;

  const hasSaturday = !!(satSongs?.songs?.length || satRole);
  const hasSpecials = specials.length > 0;
  const totalCards = (hasSaturday ? 1 : 0) + 1 + specials.length;

  // Determine the nearest upcoming service date
  const allDates = [
    hasSaturday ? (satSongs?.week ?? satRole?.week) : undefined,
    sunSongs?.week ?? sunRole?.week,
    ...specials.map((s) => s.date),
  ].filter((d): d is string => !!d && d >= today);
  const nextDate = allDates.sort()[0] ?? null;

  return (
    <div>
      <Navbar title="OWT" tags schedule />

      <div className="mx-auto max-w-7xl px-6 pt-10 mb-12">
        <h2 className="font-display text-center text-2xl md:text-3xl font-bold mb-6">
          Esta semana
        </h2>
        <div className={`grid grid-cols-1 gap-6 ${totalCards > 1 ? "md:grid-cols-2" : "max-w-xl mx-auto"}`}>
          {hasSpecials && specials.map((sp) => (
            <DayCard
              key={sp._id}
              day={sp.service_name || "Servicio Especial"}
              date={sp.date}
              setlist={sp.songs?.length ? { songs: sp.songs as SetlistSong[], week: sp.date } : undefined}
              leads={sp.Lead?.map((m) => m.alias || m.member_name) ?? []}
              instruments={sp.instruments?.map((s) => ({ label: s.instrument, person: s.person }))}
              fohTeam={sp.foh_team?.map((s) => ({ label: s.role, person: s.person }))}
              bgvs={sp.BGVs}
              chorus={sp.Chorus}
              isNext={sp.date === nextDate}
            />
          ))}
          {hasSaturday && (
            <DayCard
              day="Sábado"
              date={satSongs?.week ?? satRole?.week}
              setlist={satSongs}
              leads={satRole?.Lead?.map((m) => m.alias || m.member_name) ?? []}
              instruments={satRole?.instruments?.map((s) => ({ label: s.instrument, person: s.person }))}
              fohTeam={satRole?.foh_team?.map((s) => ({ label: s.role, person: s.person }))}
              bgvs={satRole?.BGVs}
              chorus={satRole?.Chorus}
              isNext={(satSongs?.week ?? satRole?.week) === nextDate}
            />
          )}
          <DayCard
            day="Domingo"
            date={sunSongs?.week ?? sunRole?.week}
            setlist={sunSongs}
            leads={sunRole?.Lead?.map((m) => m.alias || m.member_name) ?? []}
            instruments={sunRole?.instruments?.map((s) => ({ label: s.instrument, person: s.person }))}
            fohTeam={sunRole?.foh_team?.map((s) => ({ label: s.role, person: s.person }))}
            bgvs={sunRole?.BGVs}
            chorus={sunRole?.Chorus}
            isNext={(sunSongs?.week ?? sunRole?.week) === nextDate}
          />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 pt-10">
        <h2 className="font-display uppercase flex justify-center text-2xl md:text-3xl font-bold mb-4">
          Todas las canciones
        </h2>
      </div>
      <SongSearchList posts={posts ?? []} />
    </div>
  );
}
