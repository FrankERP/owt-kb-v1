import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActiveSession } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import Navbar from "@/app/components/Navbar";
import Button from "@/app/components/ui/Button";
import MyAvailabilityPanel from "@/app/components/availability/MyAvailabilityPanel";
import { serviceDayKey } from "@/app/utils/serviceReadSelect";
import { revealProps } from "@/app/utils/reveal";
import { MEMBER_AVAILABILITY_QUERY, SERVICE_DATES_QUERY, horizon } from "../queries";

// The calendar, alone (R3 F3). `/me` used to hold four ways to say the same
// thing — weekend pills, Desde/Hasta fields, a drag, a recurring pattern — three
// screens below the services it is read with. The pills and the date fields
// retired; what is left gets the whole page, which is what the drag wanted.
//
// MINISTRY-NEUTRAL: "the days I cannot serve" is not a worship surface, so a
// kids-only volunteer reaches this page and gets the whole calendar. No
// `requireWorshipPage`, and nothing here reads a member's Tipo or assignments.

export const metadata: Metadata = {
  title: "Disponibilidad — Oasis Worship Team",
  description: "Marca los días en que no puedes servir.",
};

export const revalidate = 60;

export default async function DisponibilidadPage() {
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/me/disponibilidad");

  const { sanityId } = session.user;
  const { today, limit } = horizon();

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
  const [member, serviceDates] = await Promise.all([
    serverClient.fetch<{
      _id: string;
      _rev: string;
      member_name: string;
      alias?: string;
      unavailableDates?: string[] | null;
      unavailabilityNotes?: { date: string; note: string }[] | null;
    } | null>(MEMBER_AVAILABILITY_QUERY, { id: sanityId }),
    operationalClient.fetch<string[]>(SERVICE_DATES_QUERY, { today, limit }),
  ]);

  // Only well-formed calendar days reach the grid's date math.
  const calendarServiceDates = (Array.isArray(serviceDates) ? serviceDates : [])
    .map((d) => serviceDayKey(d))
    .filter((d): d is string => d !== null);

  const navbarTitle = member?.alias?.trim() || "Disponibilidad";

  return (
    <div>
      <Navbar title={navbarTitle} schedule tags />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-8">
        <div {...revealProps(0)}>
          {/* Back to the page this came from, not to wherever history points:
              `/me` is the parent of this route and the only place that links here. */}
          <Button variant="ghost" size="sm" href="/me">
            ← Mi semana
          </Button>
          <h1 className="font-display text-2xl uppercase tracking-wide mt-2">
            Disponibilidad
          </h1>
          <p className="font-label text-xs uppercase tracking-widest text-mono-500 mt-0.5">
            Marca los días en que no puedes · el viernes es ensayo
          </p>
        </div>

        {/* A null read is not an empty state — every signed-in member has a
            document, so null means this one was not found. It matters more here
            than anywhere: without `_rev` the calendar would accept edits and then
            400 on every save, so the honest answer is to say so and show none. */}
        {member ? (
          <div {...revealProps(1)}>
            <MyAvailabilityPanel
              initialRev={member._rev}
              initialDates={member.unavailableDates ?? []}
              initialNotes={member.unavailabilityNotes ?? []}
              serviceDates={calendarServiceDates}
            />
          </div>
        ) : (
          // No live-region role: this is server-rendered and present at first
          // paint, so nothing is being INSERTED for a live region to announce.
          <section
            className="rounded-xl border border-negative-strong/30 bg-negative-surface-deepest/35 px-5 py-8 text-center"
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
