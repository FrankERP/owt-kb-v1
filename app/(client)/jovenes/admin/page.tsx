import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireActiveSession } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { isMinistryManager, isMinistryMember, ledGroupsIn } from "@/app/utils/ministryAccess";
import {
  MinistryEventReadUnavailable,
  readMinistryEvents,
  type MinistryEventView,
} from "@/app/utils/ministryEventReads";
import { rolloutAllows } from "@/app/utils/rollout";
import {
  groupEvents,
  monthRange,
  monthTitle,
  parseMonth,
  plannerLede,
  saturdayRows,
  shiftMonth,
  type PlannerViewer,
} from "@/app/utils/jovenesPlannerModel";
import { readJovenesPeople } from "@/app/utils/jovenesPeople";
import { PAGE_LEDE } from "@/app/utils/homeHero";
import Navbar from "@/app/components/Navbar";
import Button from "@/app/components/ui/Button";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from "@/app/components/ui/icons";
import SaturdayPlanner from "@/app/components/jovenes/SaturdayPlanner";
import GroupCalendar from "@/app/components/jovenes/GroupCalendar";
import GroupClasses from "@/app/components/jovenes/GroupClasses";
import MonthMap from "@/app/components/jovenes/MonthMap";
import PlannerSections from "@/app/components/jovenes/PlannerSections";
import { revealProps } from "@/app/utils/reveal";

export const metadata: Metadata = {
  title: "Planear Jóvenes — Backstage",
  description: "El rol del sábado de Jóvenes y el calendario de cada grupo, por mes.",
};

const TZ = "America/Mexico_City";

// Planear Jóvenes (ADR-0081, plan §7.3 PR C). Its ONE read is `readMinistryEvents` in EDITOR
// mode, so an admin sees drafts and a leader sees the published meetings plus their groups'
// drafts — never another group's. The page reads the session and is dynamic; it caches nothing
// (R6). Admins edit the Saturday roster here; a leader sees it. Below it, the groups' calendars
// (PR D): a leader creates and edits their groups' meetings, an admin everyone's. Every write is
// decided again by `ministryEventCommit.ts`.

export default async function JovenesPlannerPage({ searchParams }: { searchParams: Promise<{ mes?: string | string[] }> }) {
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/jovenes/admin");

  const { sanityId } = session.user;
  const access = await getMemberAccess(sanityId);
  // Rollout first, 404 to everyone it does not reach yet (plan G6), as on /jovenes.
  if (!rolloutAllows("jovenesEvents", access)) notFound();
  if (!access.active || !isMinistryMember(access, "jovenes")) redirect("/");
  const isManager = isMinistryManager(access, "jovenes");
  // The groups this person LEADS (per group, plan 2026-11-11 §5.1); a pastor who leads none — a
  // `leader` with an empty `leaderOf` included — has nothing to plan: back to Jóvenes' Inicio.
  const led = ledGroupsIn(access, "jovenes");
  if (!isManager && led.length === 0) redirect("/jovenes");

  const today = new Date().toLocaleDateString("sv", { timeZone: TZ });
  const month = parseMonth((await searchParams).mes, today.slice(0, 7));
  const { from, to } = monthRange(month);

  let events: MinistryEventView[] = [];
  // «Clases del grupo» reads its rosters over their whole future (NO upper bound, so the list
  // «Recorrer» sends is the server's own set, plan 2026-11-12 L3) and a year back for «Anteriores»:
  // the same one reader in the same mode, just a wider window.
  let classEvents: MinistryEventView[] = [];
  let unavailable = false;
  try {
    [events, classEvents] = await Promise.all([
      readMinistryEvents(access, { me: sanityId, ministry: "jovenes", from, to, mode: "editor" }),
      readMinistryEvents(access, { me: sanityId, ministry: "jovenes", from: `${shiftMonth(month, -12)}-01`, to: "9999-12-31", mode: "editor" }),
    ]);
  } catch (e) {
    // No read token: say so, never «no meetings» (R4).
    if (!(e instanceof MinistryEventReadUnavailable)) throw e;
    unavailable = true;
  }
  // Admins pick seats for the Saturday roster; admins and leaders pick a class's responsable from
  // the group's members (plan 2026-11-12 §4). Group membership is already public (base plan §8).
  //
  // The planner is the ONE page that also asks for the days a person marked as «no disponible»
  // (ADR-0090): `awayFor` is the access this page's gate read, and the read hands back days only
  // for the people that reader may see (an admin everyone, a leader the members of the groups
  // they lead), date only, never the note.
  const people = await readJovenesPeople({ awayFor: access, today });
  // The buttons' view of who is looking (cosmetic). The groups a leader leads are the groups the
  // writer counts for them (W3) — `ledGroupsIn`, the same answer.
  const viewer: PlannerViewer = { me: sanityId, isManager, led };
  const defaultDate = month === today.slice(0, 7) ? today : `${month}-01`;
  const rows = saturdayRows(month, events);
  const groups = groupEvents(month, events);
  const title = monthTitle(month);

  return (
    <div>
      <Navbar title="Planear Jóvenes" />
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-6">
        {/* The MONTH is the page title, as in the Calendario: it is the one thing that changes
            here, and its arrows are the round controls that header uses. «Rol del sábado» and
            «Calendario de grupos» are the two sections under it (2026-11-10). */}
        <header {...revealProps(0)}>
          <Button variant="ghost" size="sm" href="/jovenes" className="-ml-3">
            <ArrowLeftIcon size={13} />
            Jóvenes
          </Button>
          <div className="mt-2 flex items-end justify-between gap-3">
            {/* The size follows the viewport under 390 px so «Septiembre» still fits beside the
                arrows (the Calendario header's own measure). The year joins from `md`. No
                `truncate`: with this tight a line height its overflow-hidden would shave the
                descenders of «Mayo» and «Agosto». */}
            <h1
              aria-label={`${title.name} ${title.year}`}
              className="min-w-0 font-display text-[clamp(40px,11.8vw,46px)] font-semibold leading-[0.98] tracking-[-0.01em] text-ink md:text-[76px] md:leading-[0.95]"
            >
              {title.name}
              <span className="hidden text-ink-dim md:inline"> {title.year}</span>
            </h1>
            <div className="flex shrink-0 items-center gap-2 pb-1.5">
              <Button href={`/jovenes/admin?mes=${shiftMonth(month, -1)}`} aria-label="Mes anterior" variant="round">
                <ChevronLeftIcon size={18} />
              </Button>
              <Button href={`/jovenes/admin?mes=${shiftMonth(month, 1)}`} aria-label="Mes siguiente" variant="round">
                <ChevronRightIcon size={18} />
              </Button>
            </div>
          </div>
          {!unavailable && (
            <p className={`${PAGE_LEDE} mt-3`}>
              <span className="md:hidden">{title.year} · </span>
              {plannerLede(month, rows, groups).map((part, i) => (
                <span key={part.text}>
                  {i > 0 && " · "}
                  <span className={part.strong ? "text-ink" : undefined}>{part.text}</span>
                </span>
              ))}
            </p>
          )}
        </header>
        {unavailable ? (
          <p
            role="alert"
            className="mt-10 border-l-2 border-negative-strong/60 py-1 pl-4 font-body text-[15px] leading-snug text-negative-fg"
          >
            No pudimos leer las reuniones en este momento. Intenta de nuevo más tarde.
          </p>
        ) : (
          // One section at a time on a phone, all three beside the month map from `lg`
          // (`PlannerSections`, 2026-11-17).
          <div className="mt-8 lg:mt-10" {...revealProps(1)}>
            <PlannerSections
              initial={isManager ? "saturday" : "classes"}
              map={<MonthMap month={month} events={events} today={today} />}
              saturday={<SaturdayPlanner month={month} rows={rows} people={people} canEdit={isManager} defaultDate={defaultDate} />}
              classes={<GroupClasses events={classEvents} viewer={viewer} people={people} today={today} />}
              groups={<GroupCalendar events={groups} viewer={viewer} defaultDate={defaultDate} />}
            />
          </div>
        )}
      </div>
    </div>
  );
}
