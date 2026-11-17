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
import { HOME_LOOKBACK_DAYS, JOVENES_HORIZON_DAYS, homeCards, homeSections } from "@/app/utils/jovenesHomeModel";
import { isMinistryManager, ledGroupsIn } from "@/app/utils/ministryAccess";
import { readJovenesPeople } from "@/app/utils/jovenesPeople";
import { PAGE_LEDE, PAGE_TITLE } from "@/app/utils/homeHero";
import Navbar from "@/app/components/Navbar";
import Button from "@/app/components/ui/Button";
import JovenesHome from "@/app/components/jovenes/JovenesHome";
import { jovenesMeetingItems, type JovenesListItem } from "@/app/components/jovenes/meetingItems";
import { CalendarIcon } from "@/app/components/ui/icons";
import { revealProps } from "@/app/utils/reveal";

export const metadata: Metadata = {
  title: "Jóvenes — Backstage",
  description: "La próxima reunión de Jóvenes, lo que te toca y lo que sigue.",
};

const TZ = "America/Mexico_City";
// Every read goes through the ONE reader (ADR-0081): it carries the id prefix, the ministry,
// `published == true` and the reader's groups as a parameter, so Otro Nivel never receives
// Emprendedores' meetings. This page reads the session, so it is dynamic; it exports no
// `revalidate` and caches nothing (R6, `ministryEventCoverage.test.ts`).
//
// The pastors' pages read in MEMBER mode for everyone, admins included: drafts belong to the
// planner (`/jovenes/admin`), and a page that shows the same thing to every pastor is the one they trust.
//
// «Inicio» since 2026-11-17: the next meeting, the reader's turns, the few after it and the last
// one held (`JovenesHome`). The whole horizon moved to `/jovenes/calendario`.

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
      // A little back, for «Reunión anterior»: the same reader and the same arm, a wider window.
      from: addDaysIso(today, -HOME_LOOKBACK_DAYS),
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
  const placed = (m: JovenesListItem) => ({ date: m.event.date, mine: m.mine.length > 0 });
  // The people to pick from are read only when a card this page DRAWS carries the editor. Inicio
  // reads a year and draws at most five cards, so «some meeting this reader may edit» (the
  // Calendario's question) would read the roster for an editor that is never on screen. The first
  // pass builds the items without people to learn which cards those are; where one has the
  // editor, the items are built again with the roster.
  const draft = jovenesMeetingItems(events, { isManager, people: [], today });
  const editing = homeCards(homeSections(draft, today, placed)).some((m) => m.editor !== null);
  const meetings = editing ? jovenesMeetingItems(events, { isManager, people: await readJovenesPeople(), today }) : draft;
  const sections = homeSections(meetings, today, placed);
  const coming = meetings.filter((m) => m.event.date >= today);
  const lede = meetingsLede(coming.map((m) => ({ date: m.event.date, mine: m.mine.length > 0 })));

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
            {coming.length > 0 && (
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
        ) : (
          <div className="mt-9">
            {/* Cards, not rows (ADR-0086): the next meeting open and lit, the reader's turns, the
                few after it folded, the last one held. The rest is the Calendario's. */}
            <JovenesHome sections={sections} />
          </div>
        )}
      </div>
    </div>
  );
}
