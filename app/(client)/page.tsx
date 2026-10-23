import Image from "next/image";
import { operationalClient } from "@/sanity/lib/operationalClient";
import Button from "@/app/components/ui/Button";
import { Setlist, SetlistSong, SpecialRole } from "../utils/interface";
import Navbar from "../components/Navbar";
import { revealProps } from "../utils/reveal";
import { DayCard, type DayCardProps } from "../components/DayCard";
import DayCardDisclosure from "../components/DayCardDisclosure";
import { paintsDayCard } from "../utils/paintsDayCard";
import { publishedSetlist } from "../utils/draftGating";
import { pickUnique } from "../utils/serviceReadSelect";
import { requireWorshipPage } from "../utils/worshipPageGate";
import { myNameFromSession } from "../utils/agenda";
import { homeGreeting } from "../utils/homeGreeting";
import { seatPhotos } from "../utils/teamSections";
import { heroPhotoPosition, heroPhotoSrc, SHEET_TITLE, type HomeHero } from "../utils/homeHero";

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

// `photo` per seat feeds the team's faces: an uploaded photo first, else the
// Google account's picture (24 of 27 members with a Tipo had one on 2026-10-21,
// almost all of it Google's). Members are public on this dataset, so the URLs
// need no token.
const PHOTO = `coalesce(profilePhoto.asset->url, googlePhotoUrl)`;
const PERSON_PHOTO = `coalesce(person->profilePhoto.asset->url, person->googlePhotoUrl)`;
const ROLE_FIELDS = `_id, week,
  Lead[]->{ member_name, alias, "photo": ${PHOTO} },
  instruments[]{ instrument, "person": coalesce(person->alias, person->member_name), "photo": ${PERSON_PHOTO} },
  foh_team[]{ role, "person": coalesce(person->alias, person->member_name), "photo": ${PERSON_PHOTO} },
  BGVs[]->{ member_name, alias, "photo": ${PHOTO} },
  Chorus[]->{ member_name, alias, "photo": ${PHOTO} }`;

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
  "specials": *[_type == "special_role"   && date >= $today && date <= $sun && published != false] | order(date asc, time asc) {
    _id, date, time, service_name, team_notes,
    songs[]{ play_key, medley_tag, "title": song->title, "slug": song->slug, "_id": song->_id, "author": song->author, "bpm": song->bpm, "key": song->key, "leads": leads[]->{ member_name, alias } },
    ${ROLE_FIELDS}
  },
  "viewer": *[_type == "teamMembers" && _id == $me][0]{ memberType },
  "home": *[_id == "homeSettings"][0]{ "photo": heroPhoto.asset->url, "hotspot": heroPhoto.hotspot{ x, y }, "crop": heroPhoto.crop{ top, bottom, left, right }, heroAlt }
}`;

export const revalidate = 60;

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function Home() {
  const session = await requireWorshipPage("/");
  const { sat, sun } = getThisWeekend();
  const today = localToday();

  type WeekendRole = {
    _id: string;
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
    viewer: { memberType?: string[] } | null;
    home: HomeHero | null;
  }>(WEEKEND_QUERY, { sun, sat, today, me: session.user.sanityId });

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

  // Only ONE card may carry the countdown pill, and five sets can share a day.
  // `specials` arrives ordered `date asc, time asc`, so when several of them sit
  // on `nextDate` the FIRST is the next service and the rest are later that day.
  const nextSpecialId = nextDate
    ? specials.find((sp) => sp.date === nextDate && paints({ songs: sp.songs }, sp))?._id ?? null
    : null;

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
          time: sp.time ?? null,
          roleId: sp._id,
          serviceId: sp._id,
          setlist: sp.songs?.length ? { songs: sp.songs as SetlistSong[], week: sp.date, team_notes: sp.team_notes } : undefined,
          leads: sp.Lead?.map((m) => m.alias || m.member_name) ?? [],
          instruments: sp.instruments?.map((s) => ({ label: s.instrument, person: s.person })),
          fohTeam: sp.foh_team?.map((s) => ({ label: s.role, person: s.person })),
          bgvs: sp.BGVs,
          chorus: sp.Chorus,
          isNext: sp._id === nextSpecialId,
        } satisfies DayCardProps,
      })),
    ...(hasSaturdayCard
      ? [{
          key: "saturday",
          props: {
            day: "Sábado",
            date: satSongs?.week ?? satRole?.week,
            serviceId: satRole?._id,
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
            serviceId: sunRole?._id,
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

  // Who "you" are, decided HERE as well as in the card: the session the cards
  // read is client-side and arrives after hydration, so without this the first
  // paint would open nobody's section and the greeting would have no one to
  // greet. Same rule (`myNameFromSession`), so the two can never disagree.
  const myName = myNameFromSession(session.user);
  const viewer = {
    photos: seatPhotos([satRole, sunRole, ...specials]),
    viewerTypes: weekend.viewer?.memberType ?? null,
    viewerName: myName,
    viewerIsAdmin: ["super-admin", "admin"].includes(session.user.role),
  };
  const greeting = homeGreeting(services.map((s) => s.props), session.user, myName);
  // The team photo behind the greeting (ADR-0071): the ONE Studio document
  // (`_id` "homeSettings", a singleton pane in `sanity/structure.ts`), published
  // — this client reads the published perspective. Without it the band is just
  // the greeting on the page, never a blank block.
  const photo = weekend.home?.photo
    ? {
        src: heroPhotoSrc(weekend.home.photo, weekend.home.crop),
        position: heroPhotoPosition(weekend.home.hotspot, weekend.home.crop),
        alt: weekend.home.heroAlt?.trim() ?? "",
      }
    : null;

  return (
    <div>
      {/* `cue={false}`: the greeting band below carries the countdown. */}
      <Navbar title="OWT" cue={false} />

      {/* The band (ADR-0071, the «Inicio de millones» mock, variant B): the page
          opens on the member's own answer — «Te toca el domingo / Eléctrica ·
          11:00 · en 2 días» — set LARGE in the display face over the team photo,
          with a scrim so the words stay on the page's own ground. The day word
          is green: the colour the card uses for «tú». «Hola, Frank» is body
          text, not an eyebrow: the sheet keeps its small caps for section
          titles only. */}
      <section
        aria-label="Tu próximo servicio"
        className={`relative flex flex-col justify-end ${photo ? "min-h-[24rem] md:min-h-[32rem]" : "pt-12"}`}
        {...revealProps(0)}
      >
        {photo && (
          <>
            {/* `unoptimized`: the original JPEG, never Next's WebP — the iOS
                WKWebView fails to decode it (same reason as the avatars).
                `priority`: it is the page's largest paint. */}
            <Image
              src={photo.src}
              alt={photo.alt}
              fill
              unoptimized
              priority
              sizes="100vw"
              className="object-cover"
              style={{ objectPosition: photo.position }}
            />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-surface-base via-surface-base/60 to-transparent" />
          </>
        )}
        <div className="relative mx-auto w-full max-w-7xl px-6 pb-2">
          {greeting.hello && <p className="font-body text-[17px] text-ink-muted">{greeting.hello}</p>}
          <h2 className="mt-2 font-display text-[3.25rem] font-semibold leading-[0.98] tracking-tight text-ink md:text-[5.5rem]">
            {greeting.lead}
            {greeting.day && <span className="text-positive-fg">{greeting.day}</span>}
          </h2>
          {hero && <p className="mt-3 font-body text-[17px] leading-snug text-ink md:text-xl">{greeting.sub}</p>}
        </div>
      </section>

      <div className="mx-auto mb-16 max-w-7xl px-6 pt-6">
        {/* No hero means no painting service at all — the quiet-week state. */}
        {!hero ? (
          <div className="flex flex-col items-center gap-3 py-16 text-mono-600">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className="font-label text-sm uppercase tracking-widest text-center">Aún no hay servicios publicados esta semana</p>
            {/* A quiet week with nowhere to go read as an error. Two ways on: the
                calendar (what comes next) and the library (what to rehearse). */}
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button variant="secondary" size="sm" href="/schedule">Ver calendario</Button>
              <Button variant="ghost" size="sm" href="/biblioteca">Biblioteca</Button>
            </div>
          </div>
        ) : (
          <>
            {/* The hero is the run SHEET, straight on the page (ADR-0071): the
                lit card it sat in until 2026-10-23 was one more frame around the
                most-seen content, and the type pass is about fewer frames, not
                more. `DayCard hero` draws no panel, rail or header of its own. */}
            <div {...revealProps(1)}>
              <DayCard {...hero.props} {...viewer} layout="wide" hero />
            </div>
            {/* «Después»: the week's other services as hairline rows, under the
                sheet's third small-caps title. */}
            {rest.length > 0 && (
              <section aria-labelledby="home-despues" className="mt-12">
                <h3 id="home-despues" className={SHEET_TITLE}>Después</h3>
                <div className="mt-2 divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
                  {rest.map((s, i) => (
                    <div key={s.key} {...revealProps(2 + i)}>
                      <DayCardDisclosure {...s.props} {...viewer} sheet />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
