import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActiveSession } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { isMinistryManager, isMinistryMember, levelIn } from "@/app/utils/ministryAccess";
import {
  MinistryEventReadUnavailable,
  readMinistryEvents,
  type MinistryEventView,
} from "@/app/utils/ministryEventReads";
import { rolloutAllows } from "@/app/utils/rollout";
import { monthRange, parseMonth, saturdayRows } from "@/app/utils/jovenesPlannerModel";
import { readJovenesPeople } from "@/app/utils/jovenesPeople";
import Navbar from "@/app/components/Navbar";
import SaturdayPlanner from "@/app/components/jovenes/SaturdayPlanner";
import { revealProps } from "@/app/utils/reveal";

export const metadata: Metadata = {
  title: "Planear Jóvenes — Backstage",
  description: "El rol del sábado de Jóvenes por mes.",
};

const TZ = "America/Mexico_City";

// Planear Jóvenes (ADR-0081, plan §7.3 PR C). Its ONE read is `readMinistryEvents` in EDITOR
// mode, so an admin sees drafts and a leader sees the published meetings plus their groups'
// drafts — never another group's. The page reads the session and is dynamic; it caches nothing
// (R6). Admins edit the Saturday roster here; a leader sees it (their groups' calendars arrive
// with PR D). Every write is decided again by `ministryEventCommit.ts`.

export default async function JovenesPlannerPage({ searchParams }: { searchParams: Promise<{ mes?: string | string[] }> }) {
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=/jovenes/admin");

  const { sanityId } = session.user;
  const access = await getMemberAccess(sanityId);
  // Rollout first, 404 to everyone it does not reach yet (plan G6), as on /jovenes.
  if (!rolloutAllows("jovenesEvents", access)) notFound();
  if (!access.active || !isMinistryMember(access, "jovenes")) redirect("/");
  const isManager = isMinistryManager(access, "jovenes");
  // A pastor with no planner level has nothing to plan: back to the meetings list.
  if (!isManager && levelIn(access, "jovenes") !== "leader") redirect("/jovenes");

  const today = new Date().toLocaleDateString("sv", { timeZone: TZ });
  const month = parseMonth((await searchParams).mes, today.slice(0, 7));
  const { from, to } = monthRange(month);

  let events: MinistryEventView[] = [];
  let unavailable = false;
  try {
    events = await readMinistryEvents(access, { me: sanityId, ministry: "jovenes", from, to, mode: "editor" });
  } catch (e) {
    // No read token: say so, never «no meetings» (R4).
    if (!(e instanceof MinistryEventReadUnavailable)) throw e;
    unavailable = true;
  }
  const people = isManager ? await readJovenesPeople() : [];

  return (
    <div>
      <Navbar title="Planear Jóvenes" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 pb-16 space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3" {...revealProps(0)}>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Rol del sábado</h1>
          <Link href="/jovenes" className="font-label text-sm text-mono-500 hover:text-accent">
            Ver reuniones
          </Link>
        </div>
        {unavailable ? (
          <p role="alert" className="rounded-2xl border border-edge-accent-subtle bg-surface-raised p-5 font-body text-sm text-ink-muted">
            No pudimos leer las reuniones en este momento. Intenta de nuevo más tarde.
          </p>
        ) : (
          <div {...revealProps(1)}>
            <SaturdayPlanner month={month} rows={saturdayRows(month, events)} people={people} canEdit={isManager} />
          </div>
        )}
      </div>
    </div>
  );
}
