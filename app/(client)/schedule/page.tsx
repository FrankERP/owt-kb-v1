import { client } from "@/sanity/lib/client";
import Navbar from "@/app/components/Navbar";
import CalendarView, { ActiveDay } from "@/app/components/CalendarView";
import { SundayRole, SaturdayRole, Setlist, SpecialRole, SetlistSong } from "@/app/utils/interface";

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

const TZ = "America/Mexico_City";

function localToday(): string {
  return new Date().toLocaleDateString("sv", { timeZone: TZ });
}

async function getUpcomingRoles() {
  const today = localToday();
  // ~3 months ahead to cover current month + 2 full months
  const [y, m, d] = today.split("-").map(Number);
  const limit = new Date(Date.UTC(y, m - 1, d + 95)).toISOString().slice(0, 10);
  // Monday of this week so specials earlier in the week are included
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  const daysToMon = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(Date.UTC(y, m - 1, d + daysToMon));
  const weekStartStr = weekStart.toISOString().slice(0, 10);

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

  const specials = await client.fetch<SpecialRole[]>(`
    *[_type == "special_role" && date >= "${weekStartStr}" && date <= "${limit}"] | order(date asc) {
      _id, date, service_name,
      songs[] { play_key, "title": song->title, "slug": song->slug, "_id": song->_id, "author": song->author, "key": song->key },
      Lead[]-> { member_name, alias },
      instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
      foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
      BGVs[]-> { member_name, alias },
      Chorus[]-> { member_name, alias },
    }
  `);

  return { sundays, saturdays, sunSetlists, satSetlists, specials };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SchedulePage() {
  const { sundays, saturdays, sunSetlists, satSetlists, specials } = await getUpcomingRoles();

  const sunSetlistMap = new Map<string, Setlist>();
  sunSetlists.forEach((s) => sunSetlistMap.set(s.week.slice(0, 10), s));
  const satSetlistMap = new Map<string, Setlist>();
  satSetlists.forEach((s) => satSetlistMap.set(s.week.slice(0, 10), s));

  const activeDays: Record<string, ActiveDay[]> = {};

  const push = (dateStr: string, entry: ActiveDay) => {
    activeDays[dateStr] = [...(activeDays[dateStr] ?? []), entry];
  };

  sundays.forEach((sun) => {
    const dateStr = sun.week.slice(0, 10);
    push(dateStr, {
      day: "Domingo",
      date: sun.week,
      leads: sun.Lead?.map((m) => m.alias || m.member_name) ?? [],
      setlist: sunSetlistMap.get(dateStr),
      instruments: sun.instruments?.map((s) => ({ label: s.instrument, person: s.person })),
      fohTeam: sun.foh_team?.map((s) => ({ label: s.role, person: s.person })),
      bgvs: sun.BGVs,
      chorus: sun.Chorus,
    });
  });

  saturdays.forEach((sat) => {
    const dateStr = sat.week.slice(0, 10);
    push(dateStr, {
      day: "Sábado",
      date: sat.week,
      leads: sat.Lead?.map((m) => m.alias || m.member_name) ?? [],
      setlist: satSetlistMap.get(dateStr),
      instruments: sat.instruments?.map((s) => ({ label: s.instrument, person: s.person })),
      fohTeam: sat.foh_team?.map((s) => ({ label: s.role, person: s.person })),
      bgvs: sat.BGVs,
      chorus: sat.Chorus,
    });
  });

  specials.forEach((sp) => {
    const dateStr = sp.date.slice(0, 10);
    const setlist = sp.songs?.length
      ? ({ songs: sp.songs as SetlistSong[], week: sp.date } satisfies Setlist)
      : undefined;
    push(dateStr, {
      day: sp.service_name || "Servicio Especial",
      date: sp.date,
      leads: sp.Lead?.map((m) => m.alias || m.member_name) ?? [],
      setlist,
      instruments: sp.instruments?.map((s) => ({ label: s.instrument, person: s.person })),
      fohTeam: sp.foh_team?.map((s) => ({ label: s.role, person: s.person })),
      bgvs: sp.BGVs,
      chorus: sp.Chorus,
    });
  });

  return (
    <div>
      <Navbar title="Calendario" tags schedule />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16">
        <h2 className="font-display text-center text-2xl md:text-3xl font-bold mb-10">
          Próximos fines de semana
        </h2>
        {Object.keys(activeDays).length === 0 && (
          <p className="text-center font-label text-sm text-gray-400 py-20">
            No hay roles asignados para los próximos tres meses.
          </p>
        )}
        <CalendarView activeDays={activeDays} />
      </div>
    </div>
  );
}
