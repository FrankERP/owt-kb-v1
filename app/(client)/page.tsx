import { client } from "@/sanity/lib/client";
import { Setlist, SundayRole, SaturdayRole } from "../utils/interface";
import Navbar from "../components/Navbar";
import SongSearchList from "../components/SongSearchList";
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
        "person": person->member_name,
      },
      foh_team[] {
        role,
        "person": person->member_name,
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
      "Lead": Lead->member_name,
      "Lead__Support": Lead__Support->member_name,
      instruments[] {
        instrument,
        "person": person->member_name,
      },
      foh_team[] {
        role,
        "person": person->member_name,
      },
      BGVs[]-> { member_name, alias },
      Chorus[]-> { member_name, alias },
    }
  `;
  return await client.fetch(query);
}

export const revalidate = 60;

// ─── Sub-components ─────────────────────────────────────────────────────────

interface DayCardProps {
  day: string;
  date?: string;
  setlist?: Setlist | null;
  leads?: string[];
  leadSupport?: string;
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
  bgvs?: Array<{ member_name: string }>;
  chorus?: Array<{ member_name: string }>;
}

function DayCard({ day, date, setlist, leads, leadSupport, instruments, fohTeam, bgvs, chorus }: DayCardProps) {
  const hasRole = !!(leads?.length || instruments?.length || fohTeam?.length || bgvs?.length || chorus?.length);
  const hasSetlist = !!(setlist?.songs?.length);

  if (!hasSetlist && !hasRole) return null;

  return (
    <div className="border border-[#003572] dark:border-[#00bfff] rounded-xl overflow-hidden shadow-md shadow-[#00bfff]/20">
      <div className="bg-[#003572] dark:bg-[#001f3f] px-5 py-4 border-b border-[#002249] dark:border-[#00bfff]">
        <h3 className="font-display text-lg font-bold uppercase text-[#C8D8EB]">
          {day}
        </h3>
        {date && (
          <p className="text-xs text-[#C8D8EB]/60 capitalize mt-0.5">
            {new Date(date).toLocaleDateString("es-ES", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
      </div>

      <div className="p-5 space-y-5">
        {hasSetlist && (
          <section>
            <h4 className="font-label text-xs uppercase tracking-widest text-gray-400 mb-3">
              Setlist
            </h4>
            <ol className="space-y-3">
              {setlist!.songs.map((song, i) => (
                <li key={song._id} className="flex items-start gap-2">
                  <span className="text-gray-400 text-sm w-4 shrink-0 mt-0.5">{i + 1}.</span>
                  <div>
                    <Link
                      href={`/posts/${song.slug.current}`}
                      className="hover:text-[#00bfff] transition-colors"
                    >
                      <span className="font-body text-sm font-semibold">{song.title}</span>
                      <span className="text-gray-500 text-sm"> — {song.author}</span>
                    </Link>
                    <div className="font-label text-xs mt-0.5">
                      <span className="text-[#00bfff]">{song.play_key || song.key}</span>
                      {song.play_key && song.key && song.play_key !== song.key && (
                        <span className="text-gray-400 ml-1.5">orig. {song.key}</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {hasRole && (
          <section className={hasSetlist ? "border-t border-gray-200 dark:border-gray-800 pt-5" : ""}>
            <h4 className="font-label text-xs uppercase tracking-widest text-gray-400 mb-3">
              Equipo
            </h4>

            {leads && leads.length > 0 && (
              <Row label={leads.length > 1 ? "Líderes" : "Lead"} value={leads.join(", ")} />
            )}
            {leadSupport && <Row label="Support" value={leadSupport} />}

            {instruments && instruments.length > 0 && (
              <div className="mt-3">
                <SectionDivider label="Instrumentos" />
                {instruments.map((s, i) => (
                  <Row key={i} label={s.label} value={s.person} />
                ))}
              </div>
            )}

            {fohTeam && fohTeam.length > 0 && (
              <div className="mt-3">
                <SectionDivider label="Front of House" />
                {fohTeam.map((s, i) => (
                  <Row key={i} label={s.label} value={s.person} />
                ))}
              </div>
            )}

            {bgvs && bgvs.length > 0 && (
              <div className="mt-3">
                <SectionDivider label="BGVs" />
                <p className="font-body text-sm">{bgvs.map(m => m.member_name).join(", ")}</p>
              </div>
            )}

            {chorus && chorus.length > 0 && (
              <div className="mt-3">
                <SectionDivider label="Coro" />
                <p className="font-body text-sm">{chorus.map(m => m.member_name).join(", ")}</p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-0.5">
      <span className="font-label text-xs text-gray-500 uppercase tracking-wide shrink-0">
        {label}
      </span>
      <span className="font-body text-sm text-right">{value}</span>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="font-label text-xs text-gray-400 uppercase tracking-wide shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}

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
      <Navbar title="Songs" tags />

      <div className="mx-auto max-w-7xl px-6 pt-10 mb-12">
        <h2 className="font-display text-center text-2xl font-bold mb-6">
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
            leads={sunRole?.Lead?.map(m => m.member_name) ?? []}
            instruments={sunRole?.instruments?.map(s => ({ label: s.instrument, person: s.person }))}
            fohTeam={sunRole?.foh_team?.map(s => ({ label: s.role, person: s.person }))}
            bgvs={sunRole?.BGVs}
            chorus={sunRole?.Chorus}
          />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 pt-10">
        <h2 className="font-display uppercase flex justify-center text-2xl font-bold mb-4">
          Todas las canciones
        </h2>
      </div>
      <SongSearchList posts={posts ?? []} />
    </div>
  );
}
