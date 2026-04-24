import { client } from "@/sanity/lib/client";
import Navbar from "@/app/components/Navbar";
import { DayCard } from "@/app/components/DayCard";
import { SundayRole, SaturdayRole, Setlist } from "@/app/utils/interface";

export const revalidate = 60;

// ─── Queries ─────────────────────────────────────────────────────────────────

const SETLIST_FRAGMENT = `
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

async function getUpcomingRoles() {
  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date(Date.now() + 63 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [sundays, saturdays, sunSetlists, satSetlists] = await Promise.all([
    client.fetch<SundayRole[]>(`
      *[_type == "sunday_role" && week >= "${today}" && week <= "${limit}"] | order(week asc) {
        _id, week,
        Lead[]-> { member_name, alias },
        instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
        foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
        BGVs[]-> { member_name, alias },
        Chorus[]-> { member_name, alias },
      }
    `),
    client.fetch<SaturdayRole[]>(`
      *[_type == "saturday_role" && week >= "${today}" && week <= "${limit}"] | order(week asc) {
        _id, week,
        Lead[]-> { member_name, alias },
        instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
        foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
        BGVs[]-> { member_name, alias },
        Chorus[]-> { member_name, alias },
      }
    `),
    client.fetch<Setlist[]>(`
      *[_type == "featuredSongs" && week >= "${today}" && week <= "${limit}"] | order(week asc) { ${SETLIST_FRAGMENT} }
    `),
    client.fetch<Setlist[]>(`
      *[_type == "saturdarSongs" && week >= "${today}" && week <= "${limit}"] | order(week asc) { ${SETLIST_FRAGMENT} }
    `),
  ]);

  return { sundays, saturdays, sunSetlists, satSetlists };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SchedulePage() {
  const { sundays, saturdays, sunSetlists, satSetlists } = await getUpcomingRoles();

  // Build date → setlist lookup maps
  const sunSetlistMap = new Map<string, Setlist>();
  sunSetlists.forEach(s => sunSetlistMap.set(s.week.slice(0, 10), s));
  const satSetlistMap = new Map<string, Setlist>();
  satSetlists.forEach(s => satSetlistMap.set(s.week.slice(0, 10), s));

  // Group by weekend — key is the Sunday date (YYYY-MM-DD)
  const weekendMap = new Map<string, { saturday?: SaturdayRole; sunday?: SundayRole }>();

  saturdays.forEach((sat) => {
    // Add 1 day to Saturday date using Date.UTC to avoid timezone shifts
    const [y, m, d] = sat.week.slice(0, 10).split("-").map(Number);
    const key = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    weekendMap.set(key, { ...weekendMap.get(key), saturday: sat });
  });

  sundays.forEach((sun) => {
    const key = sun.week.slice(0, 10);
    weekendMap.set(key, { ...weekendMap.get(key), sunday: sun });
  });

  const weekends = Array.from(weekendMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <Navbar title="Calendario" schedule />

      <div className="mx-auto max-w-7xl px-6 pt-10 pb-16 space-y-14">
        <h2 className="font-display text-center text-2xl md:text-3xl font-bold">
          Próximos fines de semana
        </h2>

        {weekends.length === 0 && (
          <p className="text-center font-label text-sm text-gray-400 py-20">
            No hay roles asignados para los próximos dos meses.
          </p>
        )}

        {weekends.map(([sundayKey, { saturday, sunday }]) => {
          const label = new Date(sundayKey + "T12:00:00").toLocaleDateString("es-ES", {
            month: "long",
            day: "numeric",
          });
          const monthYear = new Date(sundayKey + "T12:00:00").toLocaleDateString("es-ES", {
            year: "numeric",
            month: "long",
          });

          return (
            <div key={sundayKey}>
              {/* Weekend label */}
              <div className="flex items-center gap-4 mb-6">
                <div className="flex-1 h-px bg-[#003572]/20 dark:bg-[#00bfff]/10" />
                <div className="text-center shrink-0">
                  <p className="font-display text-base md:text-lg font-bold uppercase">
                    {label}
                  </p>
                  <p className="font-label text-[10px] md:text-xs uppercase tracking-widest text-gray-500">
                    {monthYear}
                  </p>
                </div>
                <div className="flex-1 h-px bg-[#003572]/20 dark:bg-[#00bfff]/10" />
              </div>

              {/* Role cards */}
              <div className={`grid grid-cols-1 gap-6 ${saturday ? "md:grid-cols-2" : "max-w-xl mx-auto"}`}>
                {saturday && (
                  <DayCard
                    day="Sábado"
                    date={saturday.week}
                    setlist={satSetlistMap.get(saturday.week.slice(0, 10))}
                    leads={saturday.Lead?.map(m => m.alias || m.member_name) ?? []}
                    instruments={saturday.instruments?.map(s => ({ label: s.instrument, person: s.person }))}
                    fohTeam={saturday.foh_team?.map(s => ({ label: s.role, person: s.person }))}
                    bgvs={saturday.BGVs}
                    chorus={saturday.Chorus}
                  />
                )}
                {sunday && (
                  <DayCard
                    day="Domingo"
                    date={sunday.week}
                    setlist={sunSetlistMap.get(sunday.week.slice(0, 10))}
                    leads={sunday.Lead?.map(m => m.alias || m.member_name) ?? []}
                    instruments={sunday.instruments?.map(s => ({ label: s.instrument, person: s.person }))}
                    fohTeam={sunday.foh_team?.map(s => ({ label: s.role, person: s.person }))}
                    bgvs={sunday.BGVs}
                    chorus={sunday.Chorus}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
