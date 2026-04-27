import { client } from "@/sanity/lib/client";
import { SundayRole, SaturdayRole, Setlist, SpecialRole, SetlistSong } from "../utils/interface";
import Navbar from "../components/Navbar";
import SongSearchList from "../components/SongSearchList";
import { DayCard } from "../components/DayCard";
import Link from "next/link";
// ─── Helpers ─────────────────────────────────────────────────────────────────

const TZ = "America/Mexico_City";

function localToday(): string {
  return new Date().toLocaleDateString("sv", { timeZone: TZ }); // "sv" locale → YYYY-MM-DD
}

function getThisWeekend(): { sat: string; sun: string } {
  const today = localToday();
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
  const daysUntilSun = dow === 0 ? 0 : 7 - dow;
  const sun = new Date(Date.UTC(y, m - 1, d + daysUntilSun));
  const sat = new Date(Date.UTC(y, m - 1, d + daysUntilSun - 1));
  return {
    sun: sun.toISOString().slice(0, 10),
    sat: sat.toISOString().slice(0, 10),
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

async function getPosts() {
  const query = `
    *[_type == "post"] {
      _id,
      title,
      author,
      slug,
      publishDate,
      excerpt,
      timeSig,
      bpm,
      key,
      tags[] -> {
        _id,
        slug,
        name,
      }
    }`;
  return await client.fetch(query);
}

const SETLIST_FIELDS = `
  songs[] {
    play_key,
    "title": song->title,
    "slug": song->slug,
    "_id": song->_id,
    "author": song->author,
    "timeSig": song->timeSig,
    "bpm": song->bpm,
    "key": song->key,
  },
  week,
`;

async function getSundaySongs(date: string): Promise<Setlist | null> {
  return await client.fetch(`
    *[_type == "featuredSongs" && week == "${date}"][0] { ${SETLIST_FIELDS} }
  `);
}

async function getSaturdaySongs(date: string): Promise<Setlist | null> {
  return await client.fetch(`
    *[_type == "saturdarSongs" && week == "${date}"][0] { ${SETLIST_FIELDS} }
  `);
}

async function getSundayRole(date: string): Promise<SundayRole | null> {
  return await client.fetch(`
    *[_type == "sunday_role" && week == "${date}"][0] {
      week,
      Lead[]-> { member_name, alias },
      instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
      foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
      BGVs[]-> { member_name, alias },
      Chorus[]-> { member_name, alias },
    }
  `);
}

async function getSaturdayRole(date: string): Promise<SaturdayRole | null> {
  return await client.fetch(`
    *[_type == "saturday_role" && week == "${date}"][0] {
      week,
      Lead[]-> { member_name, alias },
      instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
      foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
      BGVs[]-> { member_name, alias },
      Chorus[]-> { member_name, alias },
    }
  `);
}

async function getSpecialServicesThisWeek(today: string, sun: string): Promise<SpecialRole[]> {
  return await client.fetch(`
    *[_type == "special_role" && date >= "${today}" && date <= "${sun}"] | order(date asc) {
      _id, date, service_name,
      songs[] { play_key, "title": song->title, "slug": song->slug, "_id": song->_id, "author": song->author, "key": song->key },
      Lead[]-> { member_name, alias },
      instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
      foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
      BGVs[]-> { member_name, alias },
      Chorus[]-> { member_name, alias },
    }
  `);
}

export const revalidate = 60;

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function Home() {
  const { sat, sun } = getThisWeekend();
  const today = localToday();

  const [posts, sunSongs, satSongs, sunRole, satRole, specials] = await Promise.all([
    getPosts(),
    getSundaySongs(sun),
    getSaturdaySongs(sat),
    getSundayRole(sun),
    getSaturdayRole(sat),
    getSpecialServicesThisWeek(today, sun),
  ]);

  const hasSaturday = !!(satSongs?.songs?.length || satRole);
  const hasSpecials = specials.length > 0;
  const totalCards = (hasSaturday ? 1 : 0) + 1 + specials.length;

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
              leads={sp.Lead?.map(m => m.alias || m.member_name) ?? []}
              instruments={sp.instruments?.map(s => ({ label: s.instrument, person: s.person }))}
              fohTeam={sp.foh_team?.map(s => ({ label: s.role, person: s.person }))}
              bgvs={sp.BGVs}
              chorus={sp.Chorus}
            />
          ))}
          {hasSaturday && (
            <DayCard
              day="Sábado"
              date={satSongs?.week ?? satRole?.week}
              setlist={satSongs}
              leads={satRole?.Lead?.map(m => m.alias || m.member_name) ?? []}
              instruments={satRole?.instruments?.map(s => ({ label: s.instrument, person: s.person }))}
              fohTeam={satRole?.foh_team?.map(s => ({ label: s.role, person: s.person }))}
              bgvs={satRole?.BGVs}
              chorus={satRole?.Chorus}
            />
          )}
          <DayCard
            day="Domingo"
            date={sunSongs?.week ?? sunRole?.week}
            setlist={sunSongs}
            leads={sunRole?.Lead?.map(m => m.alias || m.member_name) ?? []}
            instruments={sunRole?.instruments?.map(s => ({ label: s.instrument, person: s.person }))}
            fohTeam={sunRole?.foh_team?.map(s => ({ label: s.role, person: s.person }))}
            bgvs={sunRole?.BGVs}
            chorus={sunRole?.Chorus}
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
