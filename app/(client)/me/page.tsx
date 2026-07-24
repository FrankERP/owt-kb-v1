import type { Metadata } from "next";
import Link from "next/link";
import { requireActiveSession } from "@/app/utils/authGuards";
import { redirect } from "next/navigation";
import { serverClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import Navbar from "@/app/components/Navbar";
import { DayCard } from "@/app/components/DayCard";
import NextServiceHero from "@/app/components/NextServiceHero";
import ProfilePanel from "@/app/components/ProfilePanel";
import TextSizeControl from "@/app/components/TextSizeControl";
import AvailabilityCalendar from "@/app/components/AvailabilityCalendar";
import AddToCalendarButton from "@/app/components/AddToCalendarButton";
import { Setlist, SetlistSong, ProposalStatus } from "@/app/utils/interface";
import { describeContributors } from "@/app/utils/proposalContributors";
import { pickUnique, serviceDayKey } from "@/app/utils/serviceReadSelect";
import { orderProposals } from "@/app/utils/serviceReadModel";

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
  draft: "border-[#003572]/30 dark:border-[#00bfff]/20 text-gray-400 hover:border-[#00bfff] hover:text-[#00bfff]",
  pending: "border-yellow-500/40 text-yellow-400 hover:border-yellow-400",
  approved: "border-green-500/40 text-green-400 cursor-default",
  changes_requested: "border-red-500/40 text-red-400 hover:border-red-300",
};

export default async function MePage() {
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/me");

  const { sanityId } = session.user;

  const member = await serverClient.fetch(
    `*[_type == "teamMembers" && _id == $id][0] {
      _id, member_name, alias, email, role, memberType, notifPrefs,
      unavailableDates, unavailabilityNotes,
      "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl),
      "hasPassword": defined(passwordHash) && passwordHash != ""
    }`,
    { id: sanityId }
  );

  const today = new Date().toLocaleDateString("sv", { timeZone: TZ });
  const limit = new Date(Date.now() + 365 * 86400 * 1000)
    .toLocaleDateString("sv", { timeZone: TZ });

  const memberFilter = `(
    $id in Lead[]._ref ||
    $id in BGVs[]._ref ||
    $id in Chorus[]._ref ||
    $id in instruments[].person._ref ||
    $id in foh_team[].person._ref
  )`;

  const calendarLimit = new Date(Date.now() + 365 * 86400 * 1000)
    .toLocaleDateString("sv", { timeZone: TZ });

  // All three reads below touch protected service types, so they go through the
  // canonical (published-perspective) client — a `drafts.*` overlay is never a
  // member's assignment, proposal, or calendar date. The member's OWN profile
  // read above stays on `serverClient`: it needs the read token and `teamMembers`
  // is not a protected service type. Weekend setlists are fetched as arrays and
  // collapsed with `pickUnique` below, never `[0]`.
  const [data, proposals, serviceDates] = await Promise.all([
    operationalClient.fetch(
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
              "author": song->author, "key": song->key,
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
              "author": song->author, "key": song->key,
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
            "author": song->author, "key": song->key,
          }
        }
      }`,
      { today, limit, id: sanityId }
    ),
    operationalClient.fetch(
      // One shared proposal per service I lead. Contributors drive the "compartida
      // · con Ana" hint so a lead sees, where they already look, that a co-lead is
      // in the shared setlist too. `_createdAt` is projected so a stray duplicate
      // resolves deterministically (see `proposalMap` below) instead of by
      // whichever row happened to arrive last.
      `*[_type == "setlistProposal" && service_date >= $today &&
         $id in service_ref->Lead[]._ref] {
        _id, _createdAt, status, admin_notes,
        "service_ref": service_ref._ref,
        "contributors": contributors[]{ "id": person->_id, "name": coalesce(person->alias, person->member_name) }
      }`,
      { id: sanityId, today }
    ),
    operationalClient.fetch<string[]>(
      `[
        ...*[_type == "sunday_role"   && week >= $today && week <= $limit && published != false].week,
        ...*[_type == "saturday_role" && week >= $today && week <= $limit && published != false].week,
        ...*[_type == "special_role"  && date >= $today && date <= $limit && published != false].date,
      ]`,
      { today, limit: calendarLimit }
    ),
  ]);

  // One shared proposal per service, keyed by service_ref (= role doc _id). No
  // author filter — the shared doc may have been created by any co-lead. If a
  // stray duplicate ever exists for one service, resolve it by the canonical
  // display order (pending, changes_requested, draft, approved, then oldest
  // `_createdAt`) instead of last-write-wins, so the CTA a lead sees is stable
  // across renders.
  const rawProposals = (Array.isArray(proposals) ? proposals : []) as Array<{
    _id: string; _createdAt?: string; status: ProposalStatus; admin_notes?: string;
    service_ref: string; contributors?: Array<{ id: string; name: string }>;
  }>;
  const proposalsByService = new Map<string, typeof rawProposals>();
  for (const p of rawProposals) {
    if (!p?.service_ref) continue;
    const list = proposalsByService.get(p.service_ref);
    if (list) list.push(p);
    else proposalsByService.set(p.service_ref, [p]);
  }
  const proposalMap = new Map<string, { _id: string; status: ProposalStatus; admin_notes?: string; hint: string }>();
  for (const [serviceRef, list] of proposalsByService) {
    const [winner] = orderProposals(
      list.map((p) => ({ ...p, createdAt: p._createdAt ?? null })),
    );
    if (!winner) continue;
    proposalMap.set(serviceRef, {
      _id: winner._id, status: winner.status, admin_notes: winner.admin_notes,
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

  // Only well-formed calendar days reach the availability calendar's date math.
  const calendarServiceDates = (Array.isArray(serviceDates) ? serviceDates : [])
    .map((d) => serviceDayKey(d))
    .filter((d): d is string => d !== null);

  const navbarTitle = member?.alias?.trim() || "Mi perfil";

  // The member's specific seat(s) for a service, for the calendar event body.
  function myRoleLabel(doc: RoleDoc): string {
    const roles: string[] = [];
    if (doc.isLead) roles.push("Lead");
    if (doc.myInstrument) roles.push(doc.myInstrument);
    if (doc.myFohRole) roles.push(`FOH: ${doc.myFohRole}`);
    if (doc.isBGV) roles.push("BGV");
    if (doc.isChorus) roles.push("Coro");
    return roles.join(" · ");
  }

  const calendarServices = allAssignments.map(({ dateKey, day, doc }) => {
    const role = myRoleLabel(doc);
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
      <p className="mt-2 flex items-center gap-1.5 font-body text-xs text-[#00bfff]/80">
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
          className="mt-3 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest text-gray-500 hover:border-[#00bfff] hover:text-[#00bfff] transition-colors"
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

        {/* Upcoming services */}
        <div>
          {allAssignments.length === 0 ? (
            <>
              <h2 className="font-display text-center text-2xl md:text-3xl font-bold mb-2">
                Mis próximos servicios
              </h2>
              <div className="flex flex-col items-center gap-3 py-20 text-gray-600">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <p className="font-label text-sm uppercase tracking-widest">Sin servicios asignados próximamente</p>
              </div>
            </>
          ) : (
            <div className="space-y-10">
              {/* Toolbar */}
              <div className="flex justify-end -mb-6">
                <AddToCalendarButton services={calendarServices} />
              </div>

              {/* Hero: next assignment */}
              {(() => {
                const { day, doc, dateKey } = allAssignments[0];
                const setlist = doc.setlist ?? (doc.songs?.length ? { songs: doc.songs, week: dateKey, team_notes: doc.team_notes } : undefined);
                return (
                  <div>
                    <NextServiceHero
                      day={day}
                      date={dateKey}
                      roleId={day !== "Domingo" && day !== "Sábado" ? doc._id : undefined}
                      setlist={setlist}
                      leads={doc.Lead?.map((m) => m.alias || m.member_name)}
                      instruments={doc.instruments?.map((s) => ({ label: s.instrument, person: s.person }))}
                      fohTeam={doc.foh_team?.map((s) => ({ label: s.role, person: s.person }))}
                      bgvs={doc.BGVs}
                      chorus={doc.Chorus}
                    />
                    {renderProposalCta(doc)}
                  </div>
                );
              })()}

              {/* Remaining assignments */}
              {allAssignments.length > 1 && (
                <div>
                  <h2 className="font-display text-center text-xl md:text-2xl font-bold mb-6">
                    Próximos servicios
                  </h2>
                  <div className="space-y-6">
                    {allAssignments.slice(1).map(({ day, doc, dateKey }) => {
                      const setlist = doc.setlist ?? (doc.songs?.length ? { songs: doc.songs, week: dateKey, team_notes: doc.team_notes } : undefined);
                      return (
                        <div key={doc._id}>
                          <DayCard
                            day={day}
                            date={dateKey}
                            roleId={day !== "Domingo" && day !== "Sábado" ? doc._id : undefined}
                            setlist={setlist}
                            leads={doc.Lead?.map((m) => m.alias || m.member_name)}
                            instruments={doc.instruments?.map((s) => ({ label: s.instrument, person: s.person }))}
                            fohTeam={doc.foh_team?.map((s) => ({ label: s.role, person: s.person }))}
                            bgvs={doc.BGVs}
                            chorus={doc.Chorus}
                          />
                          {renderProposalCta(doc)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Availability */}
        {member && (
          <AvailabilityCalendar
            initialDates={member.unavailableDates ?? []}
            initialNotes={member.unavailabilityNotes ?? []}
            serviceDates={calendarServiceDates}
          />
        )}

        {/* Profile settings */}
        {member && <ProfilePanel initialMember={member} />}
        <TextSizeControl />

      </div>
    </div>
  );
}
