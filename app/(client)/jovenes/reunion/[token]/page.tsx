import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireActiveSession, requireMinistryMember } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { MinistryEventReadUnavailable, readMinistryEvents, type MinistryEventView } from "@/app/utils/ministryEventReads";
import { rolloutAllows } from "@/app/utils/rollout";
import { addDaysIso, eventHeading } from "@/app/utils/jovenesEventView";
import { jovenesDayEntry } from "@/app/utils/calendarMinistry";
import { dayTitle, mySeats } from "@/app/utils/agenda";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";
import { isMinistryManager, ledGroupsIn } from "@/app/utils/ministryAccess";
import { showsProgramEditor } from "@/app/utils/jovenesPlannerModel";
import { readJovenesPeople } from "@/app/utils/jovenesPeople";
import { readSaturdaySets } from "@/app/utils/jovenesWorshipSet";
import { meetingToken, partViews, writableParts } from "@/app/utils/jovenesPartView";
import { joinNames } from "@/app/utils/ministryEventEmail";
import { audienceTone } from "@/app/utils/jovenesGroupStyle";
import { PAGE_LEDE, SHEET_TITLE } from "@/app/utils/homeHero";
import Navbar from "@/app/components/Navbar";
import Button from "@/app/components/ui/Button";
import { ArrowLeftIcon } from "@/app/components/ui/icons";
import AudienceChips from "@/app/components/jovenes/AudienceChips";
import AudienceRail from "@/app/components/jovenes/AudienceRail";
import DateTile from "@/app/components/jovenes/DateTile";
import JovenesMeetingBody from "@/app/components/jovenes/MeetingBody";
import MeetingMeta from "@/app/components/jovenes/MeetingMeta";
import PartForm from "@/app/components/jovenes/PartForm";
import ProgramEditor from "@/app/components/jovenes/ProgramEditor";
import { revealProps } from "@/app/utils/reveal";

export const metadata: Metadata = {
  title: "Reunión de Jóvenes — Backstage",
  description: "Una reunión de Jóvenes: su equipo, su programa y tu parte.",
};

const TZ = "America/Mexico_City";
/** How far back a meeting still opens (a page range, not access): the email's link outlives the day. */
const BACK_DAYS = 30;
/** No upper bound on purpose: a link to a meeting planned a year ahead must open. */
const FAR = "9999-12-31";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const COUNTDOWN_CHIP =
  "rounded-full border border-ink/[0.16] px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-ink-muted";

// ONE meeting (ADR-0089), where «Llenar mi parte» lands — from the «Te toca» email, from a part of
// yours on any card, from the program editor. Its one read is `readMinistryEvents` (ADR-0081): the
// id prefix, the ministry and the reader's groups as a parameter — the meeting is then picked by
// id from what THIS person may read, so a link to another group's meeting answers 404 like one
// that never existed. Someone who plans (a manager, or a leader of a group) reads in EDITOR mode:
// that arm contains the member arm, plus the drafts they already see in the planner, so an admin
// can fill a part of a meeting that is not published yet. Everyone else reads in member mode, and
// a draft is a 404. The page reads the session, so it is dynamic; it caches nothing (R6).
//
// Which «Mi parte» forms show is cosmetic; the part PATCH decides again on the stored meeting.

export default async function JovenesMeetingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.toLowerCase();
  const session = await requireActiveSession();
  // Only a token the writer could have minted goes into a callback URL.
  if (!session) redirect(UUID.test(token) ? `/auth/signin?callbackUrl=/jovenes/reunion/${token}` : "/auth/signin?callbackUrl=/jovenes");

  const { sanityId } = session.user;
  const access = await getMemberAccess(sanityId);
  // The rollout holds on the server, and first (plan G6), as on /jovenes.
  if (!rolloutAllows("jovenesEvents", access)) notFound();
  const member = await requireMinistryMember("jovenes");
  if (!member) redirect("/");
  if (!UUID.test(token)) notFound();

  const today = new Date().toLocaleDateString("sv", { timeZone: TZ });
  const isManager = isMinistryManager(access, "jovenes");
  const plans = isManager || ledGroupsIn(access, "jovenes").length > 0;
  let events: MinistryEventView[] = [];
  let unavailable = false;
  try {
    events = await readMinistryEvents(access, {
      me: sanityId,
      ministry: "jovenes",
      from: addDaysIso(today, -BACK_DAYS),
      to: FAR,
      mode: plans ? "editor" : "member",
    });
  } catch (e) {
    // No read token: say so, never «that meeting does not exist» (R4).
    if (!(e instanceof MinistryEventReadUnavailable)) throw e;
    unavailable = true;
  }
  const event = events.find((e) => meetingToken(e._id) === token) ?? null;
  if (!unavailable && !event) notFound();

  const back = (
    <Button variant="ghost" size="sm" href="/jovenes" className="-ml-3">
      <ArrowLeftIcon size={13} />
      Jóvenes
    </Button>
  );

  if (!event) {
    return (
      <div>
        <Navbar title="Jóvenes" />
        <div className="mx-auto max-w-3xl px-5 pb-16 pt-8 sm:px-6">
          {back}
          <p role="alert" className="mt-8 border-l-2 border-negative-strong/60 py-1 pl-4 font-body text-[15px] leading-snug text-negative-fg">
            No pudimos leer esta reunión en este momento. Intenta de nuevo más tarde.
          </p>
        </div>
      </div>
    );
  }

  const editsProgram = showsProgramEditor(event, isManager);
  // Alabanza's songs, for the Saturday meeting only: that date's PUBLISHED worship setlist.
  const [sets, people] = await Promise.all([
    event.kind === "saturday" ? readSaturdaySets([event.date]) : Promise.resolve(new Map<string, never>()),
    editsProgram ? readJovenesPeople() : Promise.resolve([]),
  ]);
  const entry = jovenesDayEntry(event, event.kind === "saturday" ? (sets.get(event.date) ?? null) : undefined);
  const mine = mySeats({ jovenes: entry }, "");
  const parts = partViews(event);
  const forms = writableParts(parts, { editsProgram, published: event.published });
  const own = forms.filter((p) => p.mine);
  const others = forms.filter((p) => !p.mine);
  const tone = audienceTone(event.audience);

  const form = (p: (typeof forms)[number], open: boolean) => (
    <PartForm
      key={p.id}
      ministry={event.ministry}
      eventId={event._id}
      rev={event.rev}
      part={p.id}
      initial={{ note: p.note ?? "", music: p.music, helpers: p.helpers ?? "" }}
      mine={p.mine}
      who={joinNames(p.people.map((x) => x.name).filter((n): n is string => !!n)) || null}
      defaultOpen={open}
    />
  );

  return (
    <div>
      <Navbar title="Jóvenes" />
      <div className="mx-auto max-w-3xl px-5 pb-16 pt-8 sm:px-6">
        <header {...revealProps(0)}>
          {back}
          <div className="mt-4 flex items-start gap-4">
            <DateTile date={event.date} tone={tone} size="lg" decorative />
            <div className="min-w-0 space-y-2">
              <h1 className="break-words font-display text-[34px] font-semibold uppercase leading-[0.98] tracking-[0.02em] text-ink md:text-[52px]">
                {eventHeading(event)}
              </h1>
              <p className={PAGE_LEDE}>{dayTitle(event.date)}</p>
              <MeetingMeta time={event.time} arrival={event.arrival} place={event.place} />
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <AudienceChips audience={event.audience} />
                {!event.published && <span className={COUNTDOWN_CHIP}>Borrador</span>}
                {event.date >= today && <span className={COUNTDOWN_CHIP}>{formatCountdown(daysUntil(event.date))}</span>}
                {mine.length > 0 && (
                  <span className="rounded-full border border-positive-fg/35 bg-positive-fg/10 px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-positive-fg">
                    Tú · {mine.join(" · ")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        {own.length > 0 && (
          <section aria-labelledby="mi-parte" className="mt-9 space-y-3" {...revealProps(1)}>
            <h2 id="mi-parte" className={SHEET_TITLE}>
              {own.length === 1 ? "Tu parte" : "Tus partes"}
            </h2>
            {/* The reader's own part opens ready to fill: it is what the email sent them here for. */}
            {own.map((p) => form(p, true))}
          </section>
        )}

        <section aria-labelledby="la-reunion" className="mt-9" {...revealProps(2)}>
          <h2 id="la-reunion" className={`${SHEET_TITLE} pb-3`}>
            La reunión
          </h2>
          <article className="brand-surface relative overflow-hidden rounded-[var(--brand-radius-panel)]">
            <AudienceRail audience={event.audience} />
            <div className="relative py-5 pl-6 pr-5">
              <JovenesMeetingBody entry={entry} teamTitle="Equipo" level={3} columns partLinks={false} />
              {editsProgram && (
                <div className="mt-5">
                  <ProgramEditor event={event} people={people} />
                </div>
              )}
            </div>
          </article>
        </section>

        {others.length > 0 && (
          <section aria-labelledby="otras-partes" className="mt-9 space-y-3" {...revealProps(3)}>
            <h2 id="otras-partes" className={SHEET_TITLE}>
              Llenar por alguien más
            </h2>
            <p className="font-body text-[15px] leading-snug text-ink-muted">
              Cada responsable llena su parte desde su correo; tú también puedes hacerlo por ellos.
            </p>
            {others.map((p) => form(p, false))}
          </section>
        )}
      </div>
    </div>
  );
}
