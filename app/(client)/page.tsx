import { client } from "@/sanity/lib/client";
import { SundayRole, SaturdayRole, Setlist } from "../utils/interface";
import Navbar from "../components/Navbar";
import SongSearchList from "../components/SongSearchList";
import { DayCard } from "../components/DayCard";
import Link from "next/link";
// ─── Helpers ─────────────────────────────────────────────────────────────────

function getThisWeekend(): { sat: string; sun: string } {
  const now = new Date();
  const dow = now.getUTCDay(); // 0=Sun … 6=Sat
  const daysUntilSun = dow === 0 ? 0 : 7 - dow;
  const sun = new Date(now);
  sun.setUTCDate(now.getUTCDate() + daysUntilSun);
  const sat = new Date(sun);
  sat.setUTCDate(sun.getUTCDate() - 1);
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

export const revalidate = 60;

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function Home() {
  const { sat, sun } = getThisWeekend();
  const [posts, sunSongs, satSongs, sunRole, satRole] = await Promise.all([
    getPosts(),
    getSundaySongs(sun),
    getSaturdaySongs(sat),
    getSundayRole(sun),
    getSaturdayRole(sat),
  ]);

  const hasSaturday = !!(satSongs?.songs?.length || satRole);

  return (
    <div>
      <Navbar title="OWT" tags schedule />

      <div className="mx-auto max-w-7xl px-6 pt-10 mb-12">
        <h2 className="font-display text-center text-2xl md:text-3xl font-bold mb-6">
          Este fin de semana
        </h2>
        <div className={`grid grid-cols-1 gap-6 ${hasSaturday ? "md:grid-cols-2" : "max-w-xl mx-auto"}`}>
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
