import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActiveSession } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { isMinistryMember, levelIn } from "@/app/utils/ministryAccess";
import { MinistryEventReadUnavailable, readMinistryEvents } from "@/app/utils/ministryEventReads";
import { rolloutAllows } from "@/app/utils/rollout";
import { serverClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import Navbar from "@/app/components/Navbar";
import Button from "@/app/components/ui/Button";
import { ArrowLeftIcon } from "@/app/components/ui/icons";
import MyAvailabilityPanel from "@/app/components/availability/MyAvailabilityPanel";
import { serviceDayKey } from "@/app/utils/serviceReadSelect";
import { revealProps } from "@/app/utils/reveal";
import { PAGE_TITLE } from "@/app/utils/homeHero";
import type { Tone } from "@/app/utils/agenda";
import { MEMBER_AVAILABILITY_QUERY, SERVICE_DATES_QUERY, horizon } from "../queries";

// The calendar, alone (R3 F3). `/me` used to hold four ways to say the same
// thing — weekend pills, Desde/Hasta fields, a drag, a recurring pattern — three
// screens below the services it is read with. The pills and the date fields
// retired; what is left gets the whole page, which is what the drag wanted.
//
// MINISTRY-NEUTRAL: "the days I cannot serve" is not a worship surface, so a
// kids-only volunteer or a Jóvenes pastor reaches this page and gets the whole
// calendar. No `requireWorshipPage`, and nothing here reads a member's Tipo or
// assignments. The GATE is the session alone.
//
// Since 2026-11-17 the page does read the member's ministries, for two things it
// DRAWS and nothing it allows: a Jóvenes pastor sees their own meetings as dots
// (Frank: «los pastores de jóvenes también deben poder registrar su
// disponibilidad» — a calendar that only knew Alabanza's services gave them
// nothing to mark against), and «el viernes es ensayo» is said only to someone in
// Alabanza. The meetings come from the ONE reader, in member mode (ADR-0081): the
// reader's own groups and the whole-ministry meetings, never another group's. That
// import is why this page exports no `revalidate` (R6,
// `ministryEventCoverage.test.ts`); it reads the session, so it was dynamic anyway.
//
// ONE calendar for every ministry, on purpose. A second one under `/jovenes` was the
// obvious alternative and is rejected: the days a person cannot serve are the
// person's, and two calendars would be two writers racing into the same two fields
// (`useAvailability` is the only client writer). The cost, accepted: for someone in
// Alabanza and Jóvenes the nav shows their first section here, since `currentSection`
// sees the path and not `?de=`; the back link is what returns them to Jóvenes.

export const metadata: Metadata = {
  title: "Disponibilidad — Backstage",
  description: "Marca los días en que no puedes servir.",
};

type Props = { searchParams?: Promise<{ de?: string | string[] }> };

export default async function DisponibilidadPage({ searchParams }: Props = {}) {
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/me/disponibilidad");

  const { sanityId } = session.user;
  const { today, limit } = horizon();
  // The session guard read the same 30 s cache entry. Never a gate here: it decides dots and copy.
  const access = await getMemberAccess(sanityId);
  // The same two conditions `/jovenes` opens on, so a dot never shows a meeting its own page hides.
  const inJovenes = rolloutAllows("jovenesEvents", access) && isMinistryMember(access, "jovenes");
  // «Jóvenes» as the way back only for someone who came from there AND may open it: the value is
  // compared, never echoed, so the query cannot name another destination.
  const fromJovenes = inJovenes && (await searchParams)?.de === "jovenes";

  // The generic is load-bearing, not decoration: `_rev` is REQUIRED below by
  // `initialRev`, and an untyped fetch would let a projection edit drop it
  // silently — at which point `PATCH /api/me/availability` 400s and EVERY member
  // loses the ability to save availability, with only "Server returned 400" on
  // screen. Typed, the compiler refuses the projection instead.
  //
  // The member's own document goes through `serverClient` (it needs the read
  // token and `teamMembers` is not a protected service type); the service dates
  // are protected role types and go through the canonical operational client, so
  // a `drafts.*` overlay can never become a dot on the calendar.
  const [member, serviceDates, meetingDays] = await Promise.all([
    serverClient.fetch<{
      _id: string;
      _rev: string;
      member_name: string;
      alias?: string;
      unavailableDates?: string[] | null;
      unavailabilityNotes?: { date: string; note: string }[] | null;
    } | null>(MEMBER_AVAILABILITY_QUERY, { id: sanityId }),
    operationalClient.fetch<{ date: string; tone: Tone }[]>(SERVICE_DATES_QUERY, { today, limit }),
    inJovenes ? jovenesMeetingDays(access, sanityId, today, limit) : Promise.resolve([]),
  ]);

  // Only well-formed calendar days reach the grid's date math, grouped per day
  // in the agenda's tone vocabulary — the grid draws them with the Calendario's
  // own `DayDots`, so a Sunday with a special shows two dots here too.
  const services: Record<string, Tone[]> = {};
  for (const row of Array.isArray(serviceDates) ? serviceDates : []) {
    const day = serviceDayKey(row?.date);
    if (!day) continue;
    (services[day] ??= []).push(row.tone);
  }
  // One dot per day, however many meetings it holds: the dot says «there is something of Jóvenes
  // that day», and a pastor in two groups would otherwise get a row of identical greys. Last in
  // the row, as in the agenda, but never past the third place: `DayDots` draws three, and a
  // Saturday with a service and two specials would otherwise name the meeting in the day's label
  // and the legend while drawing no dot for it.
  for (const date of new Set(meetingDays)) {
    const day = serviceDayKey(date);
    if (!day) continue;
    const tones = (services[day] ??= []);
    tones.splice(Math.min(tones.length, 2), 0, "jovenes");
  }

  const navbarTitle = member?.alias?.trim() || "Disponibilidad";

  return (
    <div>
      <Navbar title={navbarTitle} />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16">
        <div {...revealProps(0)}>
          {/* Back to the page this came from, not to wherever history points: `/me` is the
              parent of this route; Jóvenes' Inicio and Calendario link here with `?de=jovenes`. */}
          <Button variant="ghost" size="sm" href={fromJovenes ? "/jovenes" : "/me"}>
            <ArrowLeftIcon size={13} />
            {fromJovenes ? "Jóvenes" : "Mi semana"}
          </Button>
          {/* The page title in the display face (the «millones» pass, 2026-10-26),
              the scale every member screen now shares. The lede under it is the
              panel's first line: it carries the live count of marked days. */}
          <h1 className={`${PAGE_TITLE} mt-3`}>
            Disponibilidad
          </h1>
        </div>

        {/* A null read is not an empty state — every signed-in member has a
            document, so null means this one was not found. It matters more here
            than anywhere: without `_rev` the calendar would accept edits and then
            400 on every save, so the honest answer is to say so and show none. */}
        {member ? (
          <div className="mt-3" {...revealProps(1)}>
            <MyAvailabilityPanel
              initialRev={member._rev}
              initialDates={member.unavailableDates ?? []}
              initialNotes={member.unavailabilityNotes ?? []}
              services={services}
              rehearsal={isMinistryMember(access, "worship")}
              // Said to the people whose days Planear Jóvenes is handed (ADR-0090): the members
              // of the ministry, which the roster read lists. Not a super-admin outside it, whose
              // days no Jóvenes planner is shown (`levelIn` has no super-admin arm).
              // `inJovenes` carries the rollout: before it reaches a pastor this page says nothing
              // of Jóvenes at all (its pages answer 404). The planner read lists every member
              // whatever the stage, so NARROWING the stage again would leave planners seeing the
              // days of pastors who are no longer told. The stage is «all» (2026-11-12).
              seenByJovenesPlanners={inJovenes && levelIn(access, "jovenes") !== null}
            />
          </div>
        ) : (
          // No live-region role: this is server-rendered and present at first
          // paint, so nothing is being INSERTED for a live region to announce.
          <section
            className="mt-8 rounded-xl border border-negative-strong/30 bg-negative-surface-deepest/35 px-5 py-8 text-center"
            {...revealProps(1)}
          >
            <h2 className="font-display text-lg uppercase text-negative-fg">No pudimos cargar tu perfil</h2>
            <p className="font-body text-sm text-mono-500 mt-1">
              Tus días no disponibles no están disponibles ahora mismo.
              Recarga la página; si sigue igual, avísale a un administrador.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * The days this reader has a Jóvenes meeting in the window: what `/jovenes/calendario` would list
 * for them, as dates only. No read token is «no dots», never a broken calendar: the page's job is
 * the member's own days, and those are read above.
 */
async function jovenesMeetingDays(
  access: Awaited<ReturnType<typeof getMemberAccess>>,
  me: string,
  from: string,
  to: string,
): Promise<string[]> {
  try {
    const events = await readMinistryEvents(access, { me, ministry: "jovenes", from, to, mode: "member" });
    return events.map((e) => e.date);
  } catch (e) {
    if (!(e instanceof MinistryEventReadUnavailable)) throw e;
    return [];
  }
}
