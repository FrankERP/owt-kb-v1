import { operationalClient } from "@/sanity/lib/operationalClient";
import { Setlist, SetlistSong, SpecialRole } from "../utils/interface";
import Navbar from "../components/Navbar";
import { revealProps } from "../utils/reveal";
import { DayCard, type DayCardProps } from "../components/DayCard";
import DayCardDisclosure from "../components/DayCardDisclosure";
import { paintsDayCard } from "../utils/paintsDayCard";
import { publishedSetlist } from "../utils/draftGating";
import { pickUnique } from "../utils/serviceReadSelect";
import { requireWorshipPage } from "../utils/worshipPageGate";

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

const SETLIST_FIELDS = `songs[]{
  play_key,
  medley_tag,
  "title": song->title, "slug": song->slug, "_id": song->_id,
  "author": song->author, "timeSig": song->timeSig, "bpm": song->bpm, "key": song->key
}, week, team_notes`;

const ROLE_FIELDS = `week,
  Lead[]->{ member_name, alias },
  instruments[]{ instrument, "person": coalesce(person->alias, person->member_name) },
  foh_team[]{ role, "person": coalesce(person->alias, person->member_name) },
  BGVs[]->{ member_name, alias },
  Chorus[]->{ member_name, alias }`;

// One combined GROQ fetch for all weekend data — GROQ params prevent query cache
// misses. Weekend single-target keys return arrays (no `[0]`); the page picks a
// unique canonical target in JS and fails closed on an ambiguous duplicate,
// rather than leaking an arbitrary `[0]`. Read through the published perspective
// so `drafts.*` overlays never surface to members.
const WEEKEND_QUERY = `{
  "sunSongs": *[_type == "featuredSongs"  && week == $sun] { ${SETLIST_FIELDS} },
  "satSongs": *[_type == "saturdarSongs"  && week == $sat] { ${SETLIST_FIELDS} },
  "sunRole":  *[_type == "sunday_role"    && week == $sun && published != false] { ${ROLE_FIELDS} },
  "satRole":  *[_type == "saturday_role"  && week == $sat && published != false] { ${ROLE_FIELDS} },
  "specials": *[_type == "special_role"   && date >= $today && date <= $sun && published != false] | order(date asc) {
    _id, date, service_name, team_notes,
    songs[]{ play_key, medley_tag, "title": song->title, "slug": song->slug, "_id": song->_id, "author": song->author, "bpm": song->bpm, "key": song->key },
    ${ROLE_FIELDS}
  }
}`;

export const revalidate = 60;

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function Home() {
  await requireWorshipPage("/");
  const { sat, sun } = getThisWeekend();
  const today = localToday();

  type WeekendRole = {
    week: string;
    Lead: { member_name: string; alias?: string }[];
    instruments: { instrument: string; person: string }[];
    foh_team: { role: string; person: string }[];
    BGVs: { member_name: string; alias?: string }[];
    Chorus: { member_name: string; alias?: string }[];
  };

  const weekend = await operationalClient.fetch<{
    sunSongs: Setlist[];
    satSongs: Setlist[];
    sunRole: WeekendRole[];
    satRole: WeekendRole[];
    specials: SpecialRole[];
  }>(WEEKEND_QUERY, { sun, sat, today });

  // Fail closed on an ambiguous weekend target: a duplicate canonical document
  // yields null (nothing rendered) rather than an arbitrary `[0]`.
  const sunSongs = pickUnique(weekend.sunSongs);
  const satSongs = pickUnique(weekend.satSongs);
  const sunRole = pickUnique(weekend.sunRole);
  const satRole = pickUnique(weekend.satRole);
  const specials = Array.isArray(weekend.specials) ? weekend.specials : [];

  // Draft-gating: only surface a weekend setlist when its role is published
  // (the role queries above already filter `published != false`). Otherwise a
  // draft service would leak its song list to members before publication.
  const sunSetlist = publishedSetlist(sunRole, sunSongs);
  const satSetlist = publishedSetlist(satRole, satSongs);

  // A Saturday service is only surfaced when it has a published role — a draft
  // Saturday (role filtered out) must not appear at all, setlist or otherwise.
  const hasSaturday = !!satRole;

  // A quiet week would otherwise show the "Esta semana" heading over an empty
  // page: DayCard renders nothing for a service with no published setlist and
  // no assigned seat. Share DayCard's own guard rather than re-deriving it, and
  // keep only the services that will actually paint — a collapsed disclosure
  // whose card renders `null` would open onto nothing.
  //
  // The guard lives in `utils/paintsDayCard`, NOT in `DayCard.tsx`, because this
  // page is a Server Component and `DayCard.tsx` is `"use client"`. Importing it
  // from there yields a client reference, not the function, and calling it threw
  // on every render of `/` in production on 2026-09-02.
  const paints = (
    setlist: { songs?: unknown[] } | null | undefined,
    role: { Lead?: unknown[]; instruments?: unknown[]; foh_team?: unknown[]; BGVs?: unknown[]; Chorus?: unknown[] } | null | undefined,
  ) =>
    paintsDayCard({
      setlist,
      leads: role?.Lead,
      instruments: role?.instruments,
      fohTeam: role?.foh_team,
      bgvs: role?.BGVs,
      chorus: role?.Chorus,
    });
  const hasSunday = paints(sunSetlist, sunRole);
  const hasSaturdayCard = hasSaturday && paints(satSetlist, satRole);

  // The nearest upcoming service date AMONG THE SERVICES THAT PAINT. A
  // published special with no seats and no songs renders nothing, so naming
  // it "next" would hand the hero slot (and the countdown) to nobody.
  const allDates = [
    hasSaturdayCard ? (satSongs?.week ?? satRole?.week) : undefined,
    hasSunday ? (sunSongs?.week ?? sunRole?.week) : undefined,
    ...specials.filter((sp) => paints({ songs: sp.songs }, sp)).map((s) => s.date),
  ].filter((d): d is string => !!d && d >= today);
  const nextDate = allDates.sort()[0] ?? null;

  // One list, in the order the page has always shown them: specials, Saturday,
  // Sunday. Splitting it into "the next service" and "the rest" is what makes
  // home a run sheet (spec §12.1) — the hero card in full, everything else one
  // line deep in a disclosure.
  const services: Array<{ key: string; props: DayCardProps }> = [
    ...specials
      .filter((sp) => paints({ songs: sp.songs }, sp))
      .map((sp) => ({
        key: sp._id,
        props: {
          day: sp.service_name || "Servicio Especial",
          date: sp.date,
          roleId: sp._id,
          setlist: sp.songs?.length ? { songs: sp.songs as SetlistSong[], week: sp.date, team_notes: sp.team_notes } : undefined,
          leads: sp.Lead?.map((m) => m.alias || m.member_name) ?? [],
          instruments: sp.instruments?.map((s) => ({ label: s.instrument, person: s.person })),
          fohTeam: sp.foh_team?.map((s) => ({ label: s.role, person: s.person })),
          bgvs: sp.BGVs,
          chorus: sp.Chorus,
          isNext: sp.date === nextDate,
        } satisfies DayCardProps,
      })),
    ...(hasSaturdayCard
      ? [{
          key: "saturday",
          props: {
            day: "Sábado",
            date: satSongs?.week ?? satRole?.week,
            setlist: satSetlist,
            leads: satRole?.Lead?.map((m) => m.alias || m.member_name) ?? [],
            instruments: satRole?.instruments?.map((s) => ({ label: s.instrument, person: s.person })),
            fohTeam: satRole?.foh_team?.map((s) => ({ label: s.role, person: s.person })),
            bgvs: satRole?.BGVs,
            chorus: satRole?.Chorus,
            isNext: (satSongs?.week ?? satRole?.week) === nextDate,
          } satisfies DayCardProps,
        }]
      : []),
    ...(hasSunday
      ? [{
          key: "sunday",
          props: {
            day: "Domingo",
            date: sunSongs?.week ?? sunRole?.week,
            setlist: sunSetlist,
            leads: sunRole?.Lead?.map((m) => m.alias || m.member_name) ?? [],
            instruments: sunRole?.instruments?.map((s) => ({ label: s.instrument, person: s.person })),
            fohTeam: sunRole?.foh_team?.map((s) => ({ label: s.role, person: s.person })),
            bgvs: sunRole?.BGVs,
            chorus: sunRole?.Chorus,
            isNext: (sunSongs?.week ?? sunRole?.week) === nextDate,
          } satisfies DayCardProps,
        }]
      : []),
  ];

  // The hero is the next service. `nextDate` only ever names a painting
  // service, so `isNext` finds it whenever anything is upcoming; a week whose
  // services are all in the past names none, and then the earliest card by
  // date takes the hero slot rather than leaving the page headless.
  const byDate = (a: { props: DayCardProps }, b: { props: DayCardProps }) => (a.props.date ?? "9999").localeCompare(b.props.date ?? "9999");
  const hero = services.find((s) => s.props.isNext) ?? [...services].sort(byDate)[0];
  const rest = services.filter((s) => s !== hero);

  return (
    <div>
      <Navbar title="OWT" tags schedule />

      <div className="mx-auto mb-16 max-w-7xl px-6 pt-12">
        <div className="brand-section-heading mb-7" {...revealProps(0)}>
          <p className="font-label text-[10px] uppercase tracking-[0.24em] text-accent">Programación</p>
          <h2 className="mt-1 font-display text-3xl font-semibold text-ink md:text-4xl">Esta semana</h2>
        </div>
        {/* No hero means no painting service at all — the quiet-week state. */}
        {!hero ? (
          <div className="flex flex-col items-center gap-3 py-16 text-mono-600">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className="font-label text-sm uppercase tracking-widest text-center">Aún no hay servicios publicados esta semana</p>
          </div>
        ) : (
          <>
            {/* The hero spans the container — no centred `max-w-3xl` card. The
                lit-card pass (spec §23, decision Q) reads `data-lit`; its CSS
                lives in `app/brand.css` (`.brand-lit-card[data-lit]::after`). */}
            <div className="brand-lit-card" data-lit {...revealProps(1)}>
              <DayCard {...hero.props} layout="wide" hero />
            </div>
            {rest.length > 0 && (
              <div className="mt-4 space-y-3">
                {rest.map((s, i) => (
                  <div key={s.key} {...revealProps(2 + i)}>
                    <DayCardDisclosure {...s.props} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
