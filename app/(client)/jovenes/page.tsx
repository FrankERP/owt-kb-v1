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
import {
  addDaysIso,
  audienceLabel,
  eventDayLabel,
  eventHeading,
  mySeats,
  seatRoleLabel,
} from "@/app/utils/jovenesEventView";
import Navbar from "@/app/components/Navbar";
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
// planner (PR C), and a page that shows the same thing to every pastor is the one they trust.

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

  return (
    <div>
      <Navbar title="Jóvenes" />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-8">
        <h2 className="font-display text-2xl md:text-3xl font-bold" {...revealProps(0)}>
          Próximas reuniones
        </h2>

        {unavailable ? (
          <p role="alert" className="rounded-2xl border border-edge-accent-subtle bg-surface-raised p-5 font-body text-sm text-ink-muted" {...revealProps(1)}>
            No pudimos leer las reuniones en este momento. Intenta de nuevo más tarde.
          </p>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-mono-600" {...revealProps(1)}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className="font-label text-sm uppercase tracking-widest">Aún no hay reuniones publicadas</p>
          </div>
        ) : (
          <div className="space-y-5">
            {events.map((e, i) => (
              <EventCard key={e._id} event={e} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventCard({ event: e, index }: { event: MinistryEventView; index: number }) {
  const mine = mySeats(e);
  const when = [e.time, e.arrival ? `llegada ${e.arrival}` : null].filter(Boolean).join(" · ");
  return (
    <article
      className={`rounded-2xl border p-5 ${mine.length > 0 ? "border-accent bg-surface-accent-faint" : "border-edge-accent-subtle bg-surface-raised"}`}
      {...revealProps(1 + index)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
            <span className="capitalize">{eventDayLabel(e.date)}</span>
            {when && <> · {when}</>}
          </p>
          <h3 className="mt-1 font-display text-lg md:text-xl font-bold text-ink">{eventHeading(e)}</h3>
          <p className="mt-1 font-body text-sm text-ink-muted">{audienceLabel(e.audience)}</p>
        </div>
        {mine.length > 0 && (
          <span className="animate-pop rounded-full border border-accent px-3 py-1 font-label text-[11px] uppercase tracking-widest text-accent">
            Te toca — {mine.join(" · ")}
          </span>
        )}
      </header>

      {e.seats.length > 0 && (
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          {e.seats.map((s) => (
            <div key={s._key} className="flex items-baseline justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2">
              <dt className="font-label text-[11px] uppercase tracking-widest text-mono-500">{seatRoleLabel(s.role)}</dt>
              <dd className={`min-w-0 truncate font-body text-sm ${s.mine ? "text-accent" : s.name ? "text-ink-muted" : "text-mono-600 italic"}`}>
                {s.name ?? "Sin asignar"}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {e.program.length > 0 && (
        <section className="mt-4">
          <h4 className="font-label text-[11px] uppercase tracking-widest text-mono-500">Programa</h4>
          <ol className="mt-2 space-y-1">
            {e.program.map((l) => (
              <li key={l._key} className="flex flex-wrap items-baseline gap-x-2 font-body text-sm">
                <span className="text-ink">{l.label ?? "—"}</span>
                {l.memberId && (
                  <span className={l.mine ? "text-accent" : l.name ? "text-ink-muted" : "text-mono-600 italic"}>
                    {l.name ?? "Sin asignar"}
                  </span>
                )}
                {l.note && <span className="text-mono-500">· {l.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {e.notes && <p className="mt-4 whitespace-pre-line font-body text-sm text-ink-muted">{e.notes}</p>}
    </article>
  );
}
