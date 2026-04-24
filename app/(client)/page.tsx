import { client } from "@/sanity/lib/client";
import { SundayRole, SaturdayRole } from "../utils/interface";
import Navbar from "../components/Navbar";
import SongSearchList from "../components/SongSearchList";
import { DayCard } from "../components/DayCard";
import Link from "next/link";
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

async function getSundaySongs(): Promise<Setlist | null> {
  const today = new Date().toISOString().slice(0, 10);
  const query = `
    *[_type == "featuredSongs" && week >= "${today}"] | order(week asc)[0] {
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
    }
  `;
  return await client.fetch(query);
}

async function getSaturdaySongs(): Promise<Setlist | null> {
  const today = new Date().toISOString().slice(0, 10);
  const query = `
    *[_type == "saturdarSongs" && week >= "${today}"] | order(week asc)[0] {
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
    }
  `;
  return await client.fetch(query);
}

async function getSundayRole(): Promise<SundayRole | null> {
  const today = new Date().toISOString().slice(0, 10);
  const query = `
    *[_type == "sunday_role" && week >= "${today}"] | order(week asc)[0] {
      week,
      Lead[]-> { member_name, alias },
      instruments[] {
        instrument,
        "person": coalesce(person->alias, person->member_name),
      },
      foh_team[] {
        role,
        "person": coalesce(person->alias, person->member_name),
      },
      BGVs[]-> { member_name, alias },
      Chorus[]-> { member_name, alias },
    }
  `;
  return await client.fetch(query);
}

async function getSaturdayRole(): Promise<SaturdayRole | null> {
  const today = new Date().toISOString().slice(0, 10);
  const query = `
    *[_type == "saturday_role" && week >= "${today}"] | order(week asc)[0] {
      week,
      "Lead": coalesce(Lead->alias, Lead->member_name),
      "Lead__Support": coalesce(Lead__Support->alias, Lead__Support->member_name),
      instruments[] {
        instrument,
        "person": coalesce(person->alias, person->member_name),
      },
      foh_team[] {
        role,
        "person": coalesce(person->alias, person->member_name),
      },
      BGVs[]-> { member_name, alias },
      Chorus[]-> { member_name, alias },
    }
  `;
  return await client.fetch(query);
}

export const revalidate = 60;

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function Home() {
  const [posts, sunSongs, satSongs, sunRole, satRole] = await Promise.all([
    getPosts(),
    getSundaySongs(),
    getSaturdaySongs(),
    getSundayRole(),
    getSaturdayRole(),
  ]);

  const hasSaturday = !!(satSongs?.songs?.length || satRole);

  return (
    <div>
      <Navbar title="Songs" tags schedule />

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
              leads={satRole?.Lead ? [satRole.Lead] : []}
              leadSupport={satRole?.Lead__Support}
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
