import { client } from "@/sanity/lib/client";
import Navbar from "@/app/components/Navbar";
import CalendarView, { ActiveDay } from "@/app/components/CalendarView";
import { SundayRole, SaturdayRole, Setlist, SpecialRole, SetlistSong } from "@/app/utils/interface";

export const revalidate = 60;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TZ = "America/Mexico_City";

function localToday(): string {
  return new Date().toLocaleDateString("sv", { timeZone: TZ });
}

// ─── Query ────────────────────────────────────────────────────────────────────

const SETLIST_FRAGMENT = `songs[]{
  play_key,
  "title": song->title, "slug": song->slug, "_id": song->_id,
  "author": song->author, "timeSig": song->timeSig, "bpm": song->bpm, "key": song->key
}, week`;

const ROLE_FIELDS = `_id, week,
  Lead[]->{ member_name, alias },
  instruments[]{ instrument, "person": coalesce(person->alias, person->member_name) },
  foh_team[]{ role, "person": coalesce(person->alias, person->member_name) },
  BGVs[]->{ member_name, alias },
  Chorus[]->{ member_name, alias }`;

const SCHEDULE_QUERY = `{
  "sundays":     *[_type == "sunday_role"   && week >= $today && week <= $limit && published != false] | order(week asc)  { ${ROLE_FIELDS} },
  "saturdays":   *[_type == "saturday_role" && week >= $today && week <= $limit && published != false] | order(week asc)  { ${ROLE_FIELDS} },
  "sunSetlists": *[_type == "featuredSongs" && week >= $today && week <= $limit] | order(week asc)  { ${SETLIST_FRAGMENT} },
  "satSetlists": *[_type == "saturdarSongs" && week >= $today && week <= $limit] | order(week asc)  { ${SETLIST_FRAGMENT} },
  "specials":    *[_type == "special_role"  && date >= $weekStart && date <= $limit && published != false] | order(date asc) {
    _id, date, service_name,
    songs[]{ play_key, "title": song->title, "slug": song->slug, "_id": song->_id, "author": song->author, "key": song->key },
    ${ROLE_FIELDS}
  }
}`;

async function getScheduleData() {
  const today = localToday();
  const [y, m, d] = today.split("-").map(Number);
  const limit = new Date(Date.UTC(y, m - 1, d + 95)).toISOString().slice(0, 10);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const daysToMon = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(Date.UTC(y, m - 1, d + daysToMon)).toISOString().slice(0, 10);

  return client.fetch<{
    sundays: SundayRole[];
    saturdays: SaturdayRole[];
    sunSetlists: Setlist[];
    satSetlists: Setlist[];
    specials: SpecialRole[];
  }>(SCHEDULE_QUERY, { today, limit, weekStart });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SchedulePage() {
  const { sundays, saturdays, sunSetlists, satSetlists, specials } = await getScheduleData();

  const sunSetlistMap = new Map(sunSetlists.map((s) => [s.week.slice(0, 10), s]));
  const satSetlistMap = new Map(satSetlists.map((s) => [s.week.slice(0, 10), s]));

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
