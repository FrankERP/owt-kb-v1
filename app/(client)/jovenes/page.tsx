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
import { jovenesDayEntry } from "@/app/utils/calendarMinistry";
import { mySeats } from "@/app/utils/agenda";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";
import { isMinistryManager, ledGroupsIn } from "@/app/utils/ministryAccess";
import { showsProgramEditor } from "@/app/utils/jovenesPlannerModel";
import { readJovenesPeople } from "@/app/utils/jovenesPeople";
import { PAGE_LEDE, PAGE_TITLE } from "@/app/utils/homeHero";
import Navbar from "@/app/components/Navbar";
import Button from "@/app/components/ui/Button";
import JovenesMeetingList from "@/app/components/jovenes/MeetingList";
import { CalendarIcon, CalendarOffIcon } from "@/app/components/ui/icons";
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
  // «Planear» for a manager or a leader of at least one group (per group, plan 2026-11-11 §5.1).
  const plans = isManager || ledGroupsIn(access, "jovenes").length > 0;
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
      <div className="mx-auto max-w-3xl px-5 pb-16 pt-10 sm:px-6">
        {/* The page's name in the display face and a lede that says what is coming and what is
            yours (the «millones» scale, ADR-0070). «Planear» is a house button, beside the title
            from `sm` and under the lede on a phone. */}
        <header className="sm:flex sm:items-end sm:justify-between sm:gap-6" {...revealProps(0)}>
          <div className="min-w-0">
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
          </div>
          {plans && (
            <Button href="/jovenes/admin" variant="secondary" size="md" className="mt-5 shrink-0 sm:mb-1 sm:mt-0">
              <CalendarIcon size={14} />
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
          <div
            className="mt-10 flex flex-col items-center gap-3 rounded-[var(--brand-radius-panel)] border border-dashed border-ink/[0.16] px-6 py-14 text-center"
            {...revealProps(1)}
          >
            <CalendarOffIcon size={28} className="text-ink-dim" />
            <p className="font-body text-base text-ink-muted">Aún no hay reuniones publicadas.</p>
          </div>
        ) : (
          <div className="mt-9">
            {/* Cards, not rows (ADR-0086): the next meeting open and lit, the rest folded under
                their month, each with its date leaf and its audience's colour. */}
            <JovenesMeetingList
              items={meetings.map(({ event: e, ...m }) => ({
                // Only what a card draws crosses to the browser; the whole view (member ids, the
                // revision) goes to `ProgramEditor` alone, for a meeting this reader may edit.
                event: { _id: e._id, date: e.date, time: e.time, arrival: e.arrival, place: e.place, title: e.title, kind: e.kind, audience: e.audience },
                entry: m.entry,
                mine: m.mine,
                countdown: formatCountdown(daysUntil(e.date)),
                editor: editable.has(e._id) ? <ProgramEditor event={e} people={people} /> : null,
              }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
