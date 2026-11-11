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
import { addDaysIso, eventLine, meetingsLede } from "@/app/utils/jovenesEventView";
import { jovenesDayEntry } from "@/app/utils/calendarMinistry";
import { dayTitle, mySeats } from "@/app/utils/agenda";
import { isMinistryManager, levelIn } from "@/app/utils/ministryAccess";
import { showsProgramEditor } from "@/app/utils/jovenesPlannerModel";
import { readJovenesPeople, type JovenesPerson } from "@/app/utils/jovenesPeople";
import { PAGE_LEDE, PAGE_TITLE } from "@/app/utils/homeHero";
import type { JovenesDayEntry } from "@/app/components/CalendarView";
import Navbar from "@/app/components/Navbar";
import Button from "@/app/components/ui/Button";
import JovenesMeetingBody from "@/app/components/jovenes/MeetingBody";
import ProgramEditor from "@/app/components/jovenes/ProgramEditor";
import { revealProps } from "@/app/utils/reveal";

export const metadata: Metadata = {
  title: "Jóvenes — Backstage",
  description: "Las próximas reuniones de Jóvenes: el sábado y las de tu grupo.",
};

const TZ = "America/Mexico_City";
/** How far ahead the list reaches: a page range, not access (plan R8). */
const HORIZON_DAYS = 120;

// Every read goes through the ONE reader (ADR-0081): it carries the id prefix, the ministry,
// `published == true` and the reader's groups as a parameter, so Otro Nivel never receives
// Emprendedores' meetings. This page reads the session, so it is dynamic; it exports no
// `revalidate` and caches nothing (R6, `ministryEventCoverage.test.ts`).
//
// The pastors' list reads in MEMBER mode for everyone, admins included: drafts belong to the
// planner (`/jovenes/admin`), and a page that shows the same thing to every pastor is the one they trust.

export default async function JovenesPage() {
  // The two failure cases stay split, as on /kids: no active session goes to sign-in (sending it
  // to `/` could loop), an active non-member to `/`, whose own gate routes them onward.
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/jovenes");

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
      to: addDaysIso(today, HORIZON_DAYS),
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
  const plans = isManager || levelIn(access, "jovenes") === "leader";
  const editable = new Set(events.filter((e) => showsProgramEditor(e, isManager)).map((e) => e._id));
  const people = editable.size > 0 ? await readJovenesPeople() : [];
  // One shape for the rows here and in the Calendario's day sheet, and ONE answer to «what is
  // mine on this meeting» (the agenda's `mySeats`: seats and program lines, by member id).
  const meetings = events.map((event) => {
    const entry = jovenesDayEntry(event);
    return { event, entry, mine: mySeats({ jovenes: entry }, "") };
  });
  const lede = meetingsLede(meetings.map((m) => ({ date: m.event.date, mine: m.mine.length > 0 })));

  return (
    <div>
      <Navbar title="Jóvenes" />
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-10">
        {/* The page's name in the display face and a lede that says what is coming and what is
            yours (the «millones» scale, ADR-0070). «Planear» is a house button, not a bare link. */}
        <header {...revealProps(0)}>
          <h1 className={PAGE_TITLE}>Jóvenes</h1>
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
          {plans && (
            <Button href="/jovenes/admin" variant="secondary" size="sm" className="mt-5">
              Planear
            </Button>
          )}
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
          <p className="py-20 text-center font-body text-base text-ink-muted" {...revealProps(1)}>
            Aún no hay reuniones publicadas.
          </p>
        ) : (
          <div className="mt-12 space-y-14">
            {meetings.map((m, i) => (
              <Meeting
                key={m.event._id}
                event={m.event}
                entry={m.entry}
                mine={m.mine}
                index={i}
                people={editable.has(m.event._id) ? people : null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One meeting: the DATE as its heading (what tells four Saturdays apart), a line with its name,
 * clock and who it is for, «Tú · …» in the app's one green when something on it is the reader's,
 * then the same hairline rows as the Calendario's day sheet. No frame around it and none inside:
 * the space between meetings separates them. `people` is set only when this reader may edit the
 * program (then the button shows).
 */
function Meeting({
  event: e,
  entry,
  mine,
  index,
  people,
}: {
  event: MinistryEventView;
  entry: JovenesDayEntry;
  mine: string[];
  index: number;
  people: JovenesPerson[] | null;
}) {
  return (
    <article {...revealProps(1 + index)}>
      <h2 className="font-display text-[28px] font-semibold leading-none text-ink md:text-[34px]">{dayTitle(e.date)}</h2>
      <p className="mt-2 font-body text-[15px] leading-snug text-ink-dim">{eventLine(e)}</p>
      {mine.length > 0 && (
        <p className="mt-1.5 font-body text-[15px] font-semibold text-positive-fg">Tú · {mine.join(" · ")}</p>
      )}
      <div className="mt-6">
        <JovenesMeetingBody entry={entry} teamTitle="Equipo" level={3} />
      </div>
      {people && (
        <div className="mt-5">
          <ProgramEditor event={e} people={people} />
        </div>
      )}
    </article>
  );
}
