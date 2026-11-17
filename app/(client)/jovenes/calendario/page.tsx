import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireActiveSession, requireMinistryMember } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import {
  MinistryEventReadUnavailable,
  readMinistryEvents,
  type MinistryEventView,
} from "@/app/utils/ministryEventReads";
import { rolloutAllows } from "@/app/utils/rollout";
import { addDaysIso, meetingsLede } from "@/app/utils/jovenesEventView";
import { JOVENES_HORIZON_DAYS } from "@/app/utils/jovenesHomeModel";
import { isMinistryManager, ledGroupsIn } from "@/app/utils/ministryAccess";
import { readJovenesPeople } from "@/app/utils/jovenesPeople";
import { readSaturdaySets } from "@/app/utils/jovenesWorshipSet";
import { PAGE_LEDE, PAGE_TITLE } from "@/app/utils/homeHero";
import Navbar from "@/app/components/Navbar";
import Button from "@/app/components/ui/Button";
import JovenesMeetingList from "@/app/components/jovenes/MeetingList";
import { anyProgramEditor, jovenesMeetingItems } from "@/app/components/jovenes/meetingItems";
import { CalendarIcon, CalendarOffIcon } from "@/app/components/ui/icons";
import { JOVENES_AVAILABILITY_HREF } from "@/app/components/navSections";
import { revealProps } from "@/app/utils/reveal";

export const metadata: Metadata = {
  title: "Calendario de Jóvenes — Backstage",
  description: "Todas las reuniones de Jóvenes por venir: el sábado y las de tu grupo, en lista o por mes.",
};

const TZ = "America/Mexico_City";
// Jóvenes' Calendario (2026-11-17): every meeting to come, as the list `/jovenes` used to be plus
// a month grid. The same gates and the same ONE read as «Inicio» (`/jovenes`): the rollout first
// and on the server, membership, then `readMinistryEvents` in MEMBER mode — it carries the id
// prefix, the ministry, `published == true` and the reader's groups as a parameter, so Otro Nivel
// never receives Emprendedores' meetings (ADR-0081). The page reads the session, so it is dynamic;
// it exports no `revalidate` and caches nothing (R6, `ministryEventCoverage.test.ts`).
//
// MEMBER mode for everyone, admins included: drafts belong to the planner (`/jovenes/admin`).

export default async function JovenesCalendarPage() {
  // The two failure cases stay split, as on /jovenes: no active session goes to sign-in, an
  // active non-member to `/`, whose own gate routes them onward.
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/jovenes/calendario");

  const { sanityId } = session.user;
  // The membership guard below reads the same 30 s cache entry.
  const access = await getMemberAccess(sanityId);
  // The rollout holds on the SERVER (plan G6), not only in the nav, and FIRST: before it reaches
  // someone the page answers 404 to everyone alike, so a redirect never hints that it exists.
  if (!rolloutAllows("jovenesEvents", access)) notFound();
  const member = await requireMinistryMember("jovenes");
  if (!member) redirect("/");

  const today = new Date().toLocaleDateString("sv", { timeZone: TZ });
  let events: MinistryEventView[] = [];
  let unavailable = false;
  try {
    events = await readMinistryEvents(access, {
      me: sanityId,
      ministry: "jovenes",
      from: today,
      to: addDaysIso(today, JOVENES_HORIZON_DAYS),
      mode: "member",
    });
  } catch (e) {
    // No read token: say so, never «no meetings» (R4). Anything else is a real failure.
    if (!(e instanceof MinistryEventReadUnavailable)) throw e;
    unavailable = true;
  }
  // «Editar programa» for an admin, and for the encargado or apoyo of a whole-ministry meeting
  // (W3a). Cosmetic: the program PATCH decides again on the stored event.
  const isManager = isMinistryManager(access, "jovenes");
  // «Planear» for a manager or a leader of at least one group (per group, plan 2026-11-11 §5.1).
  const plans = isManager || ledGroupsIn(access, "jovenes").length > 0;
  // Alabanza's songs on a Saturday meeting (ADR-0089): that date's published worship setlist.
  const [people, sets] = await Promise.all([
    anyProgramEditor(events, isManager, today) ? readJovenesPeople() : Promise.resolve([]),
    readSaturdaySets(events.filter((e) => e.kind === "saturday").map((e) => e.date)),
  ]);
  const meetings = jovenesMeetingItems(events, { isManager, people, today, sets });
  const lede = meetingsLede(meetings.map((m) => ({ date: m.event.date, mine: m.mine.length > 0 })));

  return (
    <div>
      <Navbar title="Calendario" />
      {/* Wider than «Inicio»: from `lg` the month grid sits beside its day's cards. */}
      <div className="mx-auto max-w-5xl px-5 pb-16 pt-10 sm:px-6">
        <header className="sm:flex sm:items-end sm:justify-between sm:gap-6" {...revealProps(0)}>
          <div className="min-w-0">
            <h1 className={PAGE_TITLE}>Calendario</h1>
            {meetings.length > 0 && (
              <p className={`${PAGE_LEDE} mt-3`}>
                {lede.count}
                {lede.mine && (
                  <>
                    {" · "}
                    <span className="text-ink">{lede.mine}</span>
                  </>
                )}
              </p>
            )}
          </div>
          <div className="mt-5 flex shrink-0 flex-wrap gap-2 sm:mb-1 sm:mt-0">
            {/* The same two buttons as «Inicio»: every pastor's own days, and the planner for those who plan. */}
            <Button href={JOVENES_AVAILABILITY_HREF} variant="secondary" size="md">
              <CalendarOffIcon size={14} />
              Disponibilidad
            </Button>
            {plans && (
              <Button href="/jovenes/admin" variant="secondary" size="md">
                <CalendarIcon size={14} />
                Planear
              </Button>
            )}
          </div>
        </header>

        {unavailable ? (
          <p
            role="alert"
            className="mt-10 border-l-2 border-negative-strong/60 py-1 pl-4 font-body text-[15px] leading-snug text-negative-fg"
            {...revealProps(1)}
          >
            No pudimos leer las reuniones en este momento. Intenta de nuevo más tarde.
          </p>
        ) : meetings.length === 0 ? (
          <div
            className="mt-10 flex flex-col items-center gap-3 rounded-[var(--brand-radius-panel)] border border-dashed border-ink/[0.16] px-6 py-14 text-center"
            {...revealProps(1)}
          >
            <CalendarOffIcon size={28} className="text-ink-dim" />
            <p className="font-body text-base text-ink-muted">Aún no hay reuniones publicadas.</p>
          </div>
        ) : (
          <div className="mt-9">
            <JovenesMeetingList items={meetings} today={today} />
          </div>
        )}
      </div>
    </div>
  );
}
