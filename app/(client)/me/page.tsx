import type { Metadata } from "next";
import Link from "next/link";
import { requireActiveSession } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { redirect } from "next/navigation";
import { serverClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import Navbar from "@/app/components/Navbar";
import { DayCard, type DayCardProps } from "@/app/components/DayCard";
import DayCardDisclosure from "@/app/components/DayCardDisclosure";
import MeHeader from "@/app/components/MeHeader";
import SettingsCard from "@/app/components/SettingsCard";
import ThemeAnnouncement from "@/app/components/ui/ThemeAnnouncement";
import MyAvailabilityPanel from "@/app/components/availability/MyAvailabilityPanel";
import AddToCalendarButton from "@/app/components/AddToCalendarButton";
import { Setlist, SetlistSong, ProposalStatus } from "@/app/utils/interface";
import { describeContributors } from "@/app/utils/proposalContributors";
import { pickUnique, serviceDayKey } from "@/app/utils/serviceReadSelect";
import { orderProposals } from "@/app/utils/serviceReadModel";
import { nextSeatLine, seatLabel } from "@/app/utils/myWeek";
import { paintsDayCard } from "@/app/utils/paintsDayCard";
import { revealProps } from "@/app/utils/reveal";
import { KIDS_SEATS, KIDS_SEAT_LABELS, type KidsSeat } from "@/app/utils/kidsTypes";

export const metadata: Metadata = {
  title: "Mi perfil — Oasis Worship Team",
  description: "Tus próximos servicios, disponibilidad y ajustes de perfil.",
};

export const revalidate = 60;

const TZ = "America/Mexico_City";

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Continuar propuesta",
  pending: "Propuesta pendiente",
  approved: "Setlist aprobada",
  changes_requested: "Ver comentarios",
};

const STATUS_STYLE: Record<ProposalStatus, string> = {
  draft: "border-surface-accent-30 text-mono-400 hover:border-accent dark:hover:border-surface-accent-30 hover:text-accent",
  pending: "border-recency-fg/40 text-recency-strong hover:border-recency-strong",
  approved: "border-positive-deep/40 text-positive-strong cursor-default",
  changes_requested: "border-negative-strong/40 text-negative-fg hover:border-negative-muted",
};

/**
 * The member's own next Oasis Kids Sundays. Same published contract as `/kids`:
 * the FILTER is `published == true` (a `kidsSchedule` carries the field from
 * birth, and `null == true` is false, which excludes a field-less document — the
 * safe direction). The seat flags are coalesced because an empty seat
 * dereferences to null and `$id in null` is null, not false.
 */
const KIDS_ME_QUERY = `*[_type == "kidsSchedule" && published == true && date >= $today && (
    $id in ensenanza->members[]._ref ||
    $id in chiquitos->members[]._ref ||
    $id in medianos->members[]._ref ||
    $id in grandes->members[]._ref
  )] | order(date asc) [0...3] {
    date,
    "ensenanza": coalesce($id in ensenanza->members[]._ref, false),
    "chiquitos": coalesce($id in chiquitos->members[]._ref, false),
    "medianos":  coalesce($id in medianos->members[]._ref, false),
    "grandes":   coalesce($id in grandes->members[]._ref, false)
  }`;

type KidsMeRow = { date?: string } & Partial<Record<KidsSeat, boolean>>;

/** Pinned to local noon — a bare `new Date(iso)` flips the day at UTC-6. */
function kidsDayLabel(day: string): string {
  return new Date(day + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default async function MePage() {
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/me");

  const { sanityId } = session.user;

  // The generic is load-bearing, not decoration: `_rev` is REQUIRED below by
  // `initialRev`, and an untyped fetch would let a projection edit drop it
  // silently — at which point `PATCH /api/me/availability` 400s and EVERY
  // member loses the ability to save availability, with only "Server returned
  // 400" on screen. Typed, the compiler refuses the projection instead.
  const member = await serverClient.fetch<{
    _id: string;
    _rev: string;
    // Non-optional to match ProfilePanel's MemberProfile, which this feeds:
    // every teamMembers document carries them.
    member_name: string;
    email: string;
    role: string;
    alias?: string;
    memberType?: string[];
    notifPrefs?: Record<string, unknown>;
    unavailableDates?: string[];
    unavailabilityNotes?: { date: string; note: string }[];
    photoUrl?: string;
    hasPassword: boolean;
  } | null>(
    // `_rev` feeds the availability calendar's save precondition: the PATCH
    // requires the revision this page was rendered at, because a Kids manager
    // can write the same two fields while this tab sits open.
    `*[_type == "teamMembers" && _id == $id][0] {
      _id, _rev, member_name, alias, email, role, memberType, notifPrefs,
      unavailableDates, unavailabilityNotes,
      "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl),
      "hasPassword": defined(passwordHash) && passwordHash != ""
    }`,
    { id: sanityId }
  );

  const today = new Date().toLocaleDateString("sv", { timeZone: TZ });
  // Server component: a fresh per-request date is the intended behavior.
  // eslint-disable-next-line react-hooks/purity
  const limit = new Date(Date.now() + 365 * 86400 * 1000)
    .toLocaleDateString("sv", { timeZone: TZ });

  const memberFilter = `(
    $id in Lead[]._ref ||
    $id in BGVs[]._ref ||
    $id in Chorus[]._ref ||
    $id in instruments[].person._ref ||
    $id in foh_team[].person._ref
  )`;

  // eslint-disable-next-line react-hooks/purity -- server component, as above
  const calendarLimit = new Date(Date.now() + 365 * 86400 * 1000)
    .toLocaleDateString("sv", { timeZone: TZ });

  // Ministry membership decides which halves of this page exist at all, so it is
  // resolved BEFORE the reads: a kids-only member must not even query worship.
  // `getMemberAccess` is the 30s-TTL entry `requireActiveSession` already filled,
  // so both checks are free.
  const { ministries } = await getMemberAccess(sanityId);
  const inWorship = ministries.includes("worship");
  const inKids = ministries.includes("kids");

  // All three reads below touch protected service types, so they go through the
  // canonical (published-perspective) client — a `drafts.*` overlay is never a
  // member's assignment, proposal, or calendar date. The member's OWN profile
  // read above stays on `serverClient`: it needs the read token and `teamMembers`
  // is not a protected service type. Weekend setlists are fetched as arrays and
  // collapsed with `pickUnique` below, never `[0]`.
  //
  // The first two are WORSHIP reads and are skipped entirely for a member who is
  // not in that ministry — nothing downstream of them renders for such a member
  // (spec §5.1: worship surfaces are "none"), so querying and discarding would be
  // pure cost. The third is not skipped: it feeds the availability calendar, which
  // every member sees.
  const [data, proposals, serviceDates] = await Promise.all([
    inWorship ? operationalClient.fetch(
      `{
        "sundays": *[_type == "sunday_role" && week >= $today && week <= $limit && published != false && ${memberFilter}] | order(week asc) {
          _id, week,
          "isLead": $id in Lead[]._ref,
          "isBGV": $id in BGVs[]._ref,
          "isChorus": $id in Chorus[]._ref,
          "myInstrument": instruments[person._ref == $id][0].instrument,
          "myFohRole": foh_team[person._ref == $id][0].role,
          Lead[]-> { member_name, alias },
          instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
          foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
          BGVs[]-> { member_name, alias },
          Chorus[]-> { member_name, alias },
          "setlistCandidates": *[_type == "featuredSongs" && week == ^.week] {
            songs[] {
              play_key,
              medley_tag,
              "title": song->title, "slug": song->slug, "_id": song->_id,
              "author": song->author, "bpm": song->bpm, "key": song->key,
            },
            week,
            team_notes,
          }
        },
        "saturdays": *[_type == "saturday_role" && week >= $today && week <= $limit && published != false && ${memberFilter}] | order(week asc) {
          _id, week,
          "isLead": $id in Lead[]._ref,
          "isBGV": $id in BGVs[]._ref,
          "isChorus": $id in Chorus[]._ref,
          "myInstrument": instruments[person._ref == $id][0].instrument,
          "myFohRole": foh_team[person._ref == $id][0].role,
          Lead[]-> { member_name, alias },
          instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
          foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
          BGVs[]-> { member_name, alias },
          Chorus[]-> { member_name, alias },
          "setlistCandidates": *[_type == "saturdarSongs" && week == ^.week] {
            songs[] {
              play_key,
              medley_tag,
              "title": song->title, "slug": song->slug, "_id": song->_id,
              "author": song->author, "bpm": song->bpm, "key": song->key,
            },
            week,
            team_notes,
          }
        },
        "specials": *[_type == "special_role" && date >= $today && date <= $limit && published != false && ${memberFilter}] | order(date asc) {
          _id, date, service_name, team_notes,
          "isLead": $id in Lead[]._ref,
          "isBGV": $id in BGVs[]._ref,
          "isChorus": $id in Chorus[]._ref,
          "myInstrument": instruments[person._ref == $id][0].instrument,
          "myFohRole": foh_team[person._ref == $id][0].role,
          Lead[]-> { member_name, alias },
          instruments[] { instrument, "person": coalesce(person->alias, person->member_name) },
          foh_team[] { role, "person": coalesce(person->alias, person->member_name) },
          BGVs[]-> { member_name, alias },
          Chorus[]-> { member_name, alias },
          songs[] {
            play_key,
            medley_tag,
            "title": song->title, "slug": song->slug, "_id": song->_id,
            "author": song->author, "bpm": song->bpm, "key": song->key,
          }
        }
      }`,
      { today, limit, id: sanityId }
    ) : null,
    inWorship ? operationalClient.fetch(
      // One shared proposal per service I lead. Contributors drive the "compartida
      // · con Ana" hint so a lead sees, where they already look, that a co-lead is
      // in the shared setlist too. `_createdAt` is projected so a stray duplicate
      // resolves deterministically (see `proposalMap` below) instead of by
      // whichever row happened to arrive last.
      `*[_type == "setlistProposal" && service_date >= $today &&
         $id in service_ref->Lead[]._ref] {
        _id, _createdAt, status,
        "service_ref": service_ref._ref,
        "contributors": contributors[]{ "id": person->_id, "name": coalesce(person->alias, person->member_name) }
      }`,
      { id: sanityId, today }
    ) : [],
    operationalClient.fetch<string[]>(
      `[
        ...*[_type == "sunday_role"   && week >= $today && week <= $limit && published != false].week,
        ...*[_type == "saturday_role" && week >= $today && week <= $limit && published != false].week,
        ...*[_type == "special_role"  && date >= $today && date <= $limit && published != false].date,
      ]`,
      { today, limit: calendarLimit }
    ),
  ]);

  // Oasis Kids: only for members whose ministries include it, so a worship-only
  // member pays no query and sees nothing new.
  const kidsRows = inKids
    ? await operationalClient.fetch<KidsMeRow[]>(KIDS_ME_QUERY, { today, id: sanityId })
    : [];
  const kidsAssignments = (Array.isArray(kidsRows) ? kidsRows : [])
    .map((row) => {
      const day = serviceDayKey(row?.date);
      return day ? { day, seats: KIDS_SEATS.filter((seat) => row[seat] === true) } : null;
    })
    .filter((a): a is { day: string; seats: KidsSeat[] } => a !== null);

  // One shared proposal per service, keyed by service_ref (= role doc _id). No
  // author filter — the shared doc may have been created by any co-lead. If a
  // stray duplicate ever exists for one service, resolve it by the canonical
  // display order (pending, changes_requested, draft, approved, then oldest
  // `_createdAt`) instead of last-write-wins, so the CTA a lead sees is stable
  // across renders.
  const rawProposals = (Array.isArray(proposals) ? proposals : []) as Array<{
    _id: string; _createdAt?: string; status: ProposalStatus;
    service_ref: string; contributors?: Array<{ id: string; name: string }>;
  }>;
  const proposalsByService = new Map<string, typeof rawProposals>();
  for (const p of rawProposals) {
    if (!p?.service_ref) continue;
    const list = proposalsByService.get(p.service_ref);
    if (list) list.push(p);
    else proposalsByService.set(p.service_ref, [p]);
  }
  const proposalMap = new Map<string, { _id: string; status: ProposalStatus; hint: string }>();
  for (const [serviceRef, list] of proposalsByService) {
    const [winner] = orderProposals(
      list.map((p) => ({ ...p, createdAt: p._createdAt ?? null })),
    );
    if (!winner) continue;
    proposalMap.set(serviceRef, {
      _id: winner._id, status: winner.status,
      hint: describeContributors(winner.contributors, sanityId),
    });
  }

  type RoleDoc = {
    _id: string;
    week?: string;
    date?: string;
    service_name?: string;
    isLead?: boolean;
    isBGV?: boolean;
    isChorus?: boolean;
    myInstrument?: string;
    myFohRole?: string;
    Lead?: Array<{ member_name: string; alias?: string }>;
    instruments?: Array<{ instrument: string; person: string }>;
    foh_team?: Array<{ role: string; person: string }>;
    BGVs?: Array<{ member_name: string; alias?: string }>;
    Chorus?: Array<{ member_name: string; alias?: string }>;
    setlist?: Setlist;
    setlistCandidates?: Setlist[];
    songs?: SetlistSong[];
    team_notes?: string;
  };

  // Fail closed on an ambiguous weekend setlist target: a duplicate canonical
  // `featuredSongs`/`saturdarSongs` for the same week yields no setlist on the
  // card rather than an arbitrary `[0]`.
  const withSetlist = (d: RoleDoc): RoleDoc => ({
    ...d,
    setlist: pickUnique(d.setlistCandidates) ?? undefined,
  });

  // A malformed/missing service date can neither be sorted nor rendered, so the
  // record is dropped here instead of throwing on `localeCompare` or date math.
  const asAssignment = (dateValue: unknown, day: string, doc: RoleDoc) => {
    const dateKey = serviceDayKey(dateValue);
    return dateKey ? { dateKey, day, doc } : null;
  };

  const roleDocs = (v: unknown): RoleDoc[] => (Array.isArray(v) ? (v as RoleDoc[]) : []);

  const allAssignments: Array<{ dateKey: string; day: string; doc: RoleDoc }> = [
    ...roleDocs(data?.sundays).map((d) => asAssignment(d.week, "Domingo", withSetlist(d))),
    ...roleDocs(data?.saturdays).map((d) => asAssignment(d.week, "Sábado", withSetlist(d))),
    ...roleDocs(data?.specials).map((d) => asAssignment(d.date, d.service_name || "Servicio Especial", d)),
  ]
    .filter((a): a is { dateKey: string; day: string; doc: RoleDoc } => a !== null)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  // The `DayCardProps` for one assignment, so the hero and the collapsed rows
  // below it are fed from ONE place — they were two copies of the same nine
  // props, and the R1 split is exactly where a drift between them would hide.
  const cardProps = ({ day, doc, dateKey }: (typeof allAssignments)[number]): DayCardProps => ({
    day,
    date: dateKey,
    roleId: day !== "Domingo" && day !== "Sábado" ? doc._id : undefined,
    setlist: doc.setlist ?? (doc.songs?.length ? { songs: doc.songs, week: dateKey, team_notes: doc.team_notes } : undefined),
    leads: doc.Lead?.map((m) => m.alias || m.member_name),
    instruments: doc.instruments?.map((s) => ({ label: s.instrument, person: s.person })),
    fohTeam: doc.foh_team?.map((s) => ({ label: s.role, person: s.person })),
    bgvs: doc.BGVs,
    chorus: doc.Chorus,
  });

  // Only the assignments whose card will actually paint something reach the
  // header/hero split below — same guard, same reason as the home page's own
  // `paintsDayCard` filter (`app/(client)/page.tsx`): a published role whose
  // seats were all cleared is a normal stored state, not a corrupt one, and a
  // header naming a service that renders nothing would be worse than silence.
  const visibleAssignments = allAssignments.filter((a) => {
    const { setlist, leads, instruments, fohTeam, bgvs, chorus } = cardProps(a);
    return paintsDayCard({ setlist, leads, instruments, fohTeam, bgvs, chorus });
  });

  // The hero is the earliest visible assignment (the list is already sorted by
  // `dateKey` above); everything after it collapses to a `DayCardDisclosure` row.
  const heroAssignment = visibleAssignments[0] ?? null;
  const restAssignments = visibleAssignments.slice(1);

  // Only well-formed calendar days reach the availability calendar's date math.
  const calendarServiceDates = (Array.isArray(serviceDates) ? serviceDates : [])
    .map((d) => serviceDayKey(d))
    .filter((d): d is string => d !== null);

  const navbarTitle = member?.alias?.trim() || "Mi perfil";

  // The header's one line: which service is next and which seat the member holds
  // in it. `nextSeatLine`/`seatLabel` live in the NEUTRAL `app/utils/myWeek.ts`
  // precisely so this Server Component may call them (ADR-0028) — `MeHeader` is a
  // client module and receives the result as data, never a function.
  const nextSeat = nextSeatLine(
    visibleAssignments.map(({ dateKey, day, doc }) => ({ dateKey, day, seat: seatLabel(doc) })),
  );

  const calendarServices = visibleAssignments.map(({ dateKey, day, doc }) => {
    const role = seatLabel(doc);
    return {
      uid: doc._id,
      date: dateKey,
      title: role ? `${day} · Oasis Worship (${role})` : `${day} · Oasis Worship`,
      description: role ? `Tu rol: ${role}` : undefined,
    };
  });

  // "compartida · con Ana" — a persistent cue that a co-lead is in the same
  // shared setlist. Rendered under the CTA (or standalone on an approved card).
  function contributorHint(hint: string) {
    if (!hint) return null;
    return (
      <p className="mt-2 flex items-center gap-1.5 font-body text-xs text-accent/80">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span className="min-w-0 truncate">Propuesta compartida · {hint}</span>
      </p>
    );
  }

  // One CTA per service reflecting the SHARED proposal status (not "mine vs
  // theirs"), plus the contributor hint.
  function renderProposalCta(doc: RoleDoc) {
    if (!doc.isLead) return null;
    const proposal = proposalMap.get(doc._id);

    if (!proposal) {
      return (
        <Link
          href={`/me/propose/${doc._id}`}
          className="mt-3 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-surface-accent-30 font-label text-xs uppercase tracking-widest text-mono-500 hover:border-accent dark:hover:border-dashed hover:text-accent transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Proponer setlist
        </Link>
      );
    }

    if (proposal.status === "approved") {
      return (
        <>
          <div className={`mt-3 flex items-center justify-center gap-1.5 py-2 rounded-lg border font-label text-xs uppercase tracking-widest ${STATUS_STYLE[proposal.status]}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            {STATUS_LABEL[proposal.status]}
          </div>
          {contributorHint(proposal.hint)}
        </>
      );
    }

    return (
      <>
        <Link
          href={`/me/propose/${doc._id}`}
          className={`mt-3 flex items-center justify-center gap-1.5 py-2 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${STATUS_STYLE[proposal.status]}`}
        >
          {STATUS_LABEL[proposal.status]}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
        {contributorHint(proposal.hint)}
      </>
    );
  }

  return (
    <div>
      <Navbar title={navbarTitle} schedule tags />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-12">
        {/* Top of /me, per parent Q2. Its "Elígelo aquí" is an anchor to #tema,
            because ThemeControl renders below the service cards, the availability
            calendar and ProfilePanel — most of a phone-page away. */}
        <ThemeAnnouncement />

        {/* The page's heading, and the only place the empty state is said: the two
            `h2`s ("Mis próximos servicios" / "Próximos servicios") are gone, and
            «Sin servicios asignados próximamente» moved INTO this line. `inWorship`
            is passed so that a kids-only volunteer still gets no worship copy —
            the empty state is itself a worship surface (spec §5.1). Tipo chips are
            worship copy too — a member's Tipo is the worship eligibility axis, so a
            kids-only volunteer sees no chips either.

            Both lines are gated HERE as well as by the reads above (which a
            kids-only member never runs). That is deliberate belt-and-braces: the
            header is the one surface that claims "this is what you have to do", so
            it must stay correct if a read ever stops being ministry-skipped. */}
        <div {...revealProps(0)}>
          <MeHeader
            // A null profile read is reported by its own panel below; the header
            // still renders, falling back to the session's name.
            name={member?.member_name || session.user.name || "Mi perfil"}
            alias={member?.alias}
            photoUrl={member?.photoUrl}
            memberTypes={inWorship ? member?.memberType : undefined}
            next={inWorship ? nextSeat : null}
            kidsNext={inKids ? (kidsAssignments[0]?.day ?? null) : null}
            inWorship={inWorship}
          />
        </div>

        {/* Upcoming WORSHIP services — hidden outright for a member who is not in
            that ministry, and absent entirely when there are none: the header says
            so, so an empty column here would say it twice. The next service is the
            full hero; every other one is a collapsed `DayCardDisclosure` row (R1),
            each still followed by its own proposal CTA.

            The hero renders as `<DayCard {...} hero />` directly, WITHOUT `isNext`
            — the header above already carries the one countdown pill for this
            service (`next`/`nextSeat`), and `isNext` is what makes `DayCard` draw
            its OWN countdown pill. Passing both would put two countdowns for the
            same date on one page; the header owns it, the hero card just shows the
            "Ensayar" action. */}
        {inWorship && heroAssignment && (
          <div className="space-y-4" {...revealProps(1)}>
            <div className="flex justify-end">
              <AddToCalendarButton services={calendarServices} />
            </div>
            <div key={heroAssignment.doc._id}>
              <DayCard {...cardProps(heroAssignment)} hero />
              {renderProposalCta(heroAssignment.doc)}
            </div>
            {restAssignments.length > 0 && (
              <>
                {/* Visually silent — the collapsed rows read fine without a printed
                    heading, but a screen reader landing mid-page needs to know it
                    left the hero and entered the rest of the run sheet. */}
                <h2 className="sr-only">Después</h2>
                {restAssignments.map((assignment) => (
                  <div key={assignment.doc._id}>
                    <DayCardDisclosure {...cardProps(assignment)} />
                    {renderProposalCta(assignment.doc)}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Oasis Kids — only for members of that ministry */}
        {inKids && (
          <section aria-labelledby="mis-roles-kids" {...revealProps(2)}>
            <h2
              id="mis-roles-kids"
              className="font-display text-center text-xl md:text-2xl font-bold mb-6"
            >
              Mis roles en Oasis Kids
            </h2>
            <div className="rounded-2xl border border-edge-accent-subtle bg-surface-raised p-5">
              {kidsAssignments.length === 0 ? (
                <p className="text-center font-body text-sm text-mono-500">
                  No tienes domingos asignados en Oasis Kids por ahora.
                </p>
              ) : (
                <ul className="space-y-2">
                  {kidsAssignments.map(({ day, seats }) => (
                    <li
                      key={day}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2"
                    >
                      <span className="font-body text-sm capitalize text-ink-muted">
                        {kidsDayLabel(day)}
                      </span>
                      <span className="font-label text-[11px] uppercase tracking-widest text-accent">
                        {seats.map((seat) => KIDS_SEAT_LABELS[seat]).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/kids"
                className="mt-4 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest text-mono-500 hover:border-accent hover:text-accent transition-colors"
              >
                Ver Oasis Kids
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </section>
        )}

        {/* Availability + profile settings.
            Both hang off the SAME `member` read, so they are branched together
            rather than each on its own `member &&`. A null read used to remove
            both without a word — two thirds of this page's controls simply not
            there, on a page that otherwise rendered fine, so it looked like a
            feature the member does not have rather than something that failed.
            It is not an empty state: every signed-in member has a document, so
            null means the read did not find theirs. */}
        {member ? (
          <>
            <div {...revealProps(3)}>
              <MyAvailabilityPanel
                initialRev={member._rev}
                initialDates={member.unavailableDates ?? []}
                initialNotes={member.unavailabilityNotes ?? []}
                serviceDates={calendarServiceDates}
              />
            </div>
            <SettingsCard member={member} {...revealProps(4)} />
          </>
        ) : (
          <>
            {/* No live-region role: this is server-rendered and present at first
                paint, so nothing is being INSERTED for a live region to announce,
                and screen readers treat already-present live content
                inconsistently. The heading carries the message. */}
            <section className="rounded-xl border border-negative-strong/30 bg-negative-surface-deepest/35 px-5 py-8 text-center" {...revealProps(3)}>
              <h2 className="font-display text-lg uppercase text-negative-fg">No pudimos cargar tu perfil</h2>
              <p className="font-body text-sm text-mono-500 mt-1">
                Tus días no disponibles y tus ajustes no están disponibles ahora mismo.
                Recarga la página; si sigue igual, avísale a un administrador.
              </p>
            </section>
            {/* Tema and Tamaño de texto are device-local, so they survive a failed
                profile read — and `#ajustes` keeps a target for the header link.
                No `member`, so the card renders without its Perfil subsection. */}
            <SettingsCard member={null} {...revealProps(4)} />
          </>
        )}
      </div>
    </div>
  );
}
